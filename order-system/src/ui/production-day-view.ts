import { plusDays } from '../domain/clock';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import { orderStatusLabel } from '../domain/order-status';
import type { ProductionDay } from '../domain/production-day';
import { formatGermanDate } from './format';

/**
 * Das Ansichtsmodell eines Produktionstags — alles, was die Seite anzeigt,
 * und nichts, was sie nicht anzeigt.
 *
 * WARUM ES DIESE SCHICHT GIBT. Das Lesemodell aus Phase 3B ist die fachliche
 * Antwort; es kennt keine Sprache und keine Darstellung. Zwischen ihm und dem
 * HTML muss dreierlei passieren: Status und Fulfillment werden deutsch, der
 * Tag bekommt eine lesbare Form und Nachbartage, und der Umbenennungsfall
 * wird erkennbar gemacht. Stünde das im Renderer, stünde Logik in
 * Zeichenkettenverkettung — und wäre nur über HTML prüfbar.
 *
 * Diese Datei ist REIN. Keine Datenbank, keine Uhr, kein Zufall, kein
 * Request. Sie bekommt einen ProductionDay und gibt eine Ansicht zurück;
 * derselbe Eingabewert ergibt immer dieselbe Ausgabe. Deshalb laufen ihre
 * Tests im Projekt „domain" ohne Worker-Runtime.
 *
 * WAS HIER NICHT PASSIERT:
 *
 *   Es wird NICHT sortiert. Die Reihenfolge der Backliste bestimmt Phase 3B
 *   (sortOrder, Name, ID, Einheit) und dort ist sie geprüft. Eine zweite
 *   Sortierung wäre eine zweite Meinung darüber, wie das Sortiment geordnet
 *   ist — und irgendwann eine, die von der ersten abweicht.
 *
 *   Es wird NICHT gefiltert. Welche Bestellungen produktionsrelevant sind,
 *   steht in OPEN_PRODUCTION_STATUSES und in der Abfrage. Hier noch einmal zu
 *   filtern hieße, einen Datenfehler zu verstecken statt ihn zu zeigen.
 *
 *   Es wird NICHT gerechnet. orderCount und totalUnits kommen aus der
 *   Aggregation; sie hier neu zu bilden wäre eine zweite Summe, die der
 *   ersten widersprechen könnte.
 *
 *   Es entsteht KEIN Preisfeld. Es gibt keins zu übernehmen — das Lesemodell
 *   führt keine Preise. Diese Ansicht ist finanzfrei durch Bauart.
 */

/**
 * Eine Zeile der Backliste.
 *
 * `renamed` ist die einzige Information, die hier neu entsteht — siehe
 * markiereUmbenennungen().
 */
export interface ProductionLineView {
  /** Snapshot aus der Bestellung, nicht der heutige Stammdatenname. */
  readonly name: string;
  /** Snapshot aus der Bestellung. „Blech" bleibt „Blech". */
  readonly unit: string;
  readonly quantity: number;
  /**
   * Dieselbe Produkt-ID kommt an diesem Tag mit einer abweichenden
   * Bezeichnung vor. Die Seite kennzeichnet diese Zeile dezent, damit sie
   * nicht wie ein doppelter Eintrag aussieht.
   */
  readonly renamed: boolean;
}

export interface ProductionOrderItemView {
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
}

export interface ProductionOrderView {
  readonly orderNumber: string;
  readonly customerName: string;
  /** „Neu", „Bestätigt", „In Produktion" — aus orderStatusLabel(). */
  readonly statusLabel: string;
  /** „Lieferung" oder „Abholung" — aus fulfillmentLabel(). */
  readonly fulfillmentLabel: string;
  /**
   * Kundeneingabe oder null. Leerraum allein gilt als keine Notiz: Ein
   * versehentliches Leerzeichen soll keinen Notizblock erzeugen.
   */
  readonly note: string | null;
  readonly items: readonly ProductionOrderItemView[];
}

export interface ProductionDayView {
  /** 'JJJJ-MM-TT' — für URLs und das Datumsfeld. */
  readonly day: string;
  /** „Dienstag, 25. August 2026" — für Menschen. */
  readonly dayLabel: string;
  readonly previousDay: string;
  readonly previousDayLabel: string;
  readonly nextDay: string;
  readonly nextDayLabel: string;
  readonly orderCount: number;
  readonly totalUnits: number;
  readonly products: readonly ProductionLineView[];
  readonly orders: readonly ProductionOrderView[];
  /** Ein Tag ohne offene Bestellungen — ein normaler Zustand, kein Fehler. */
  readonly isEmpty: boolean;
}

export function toProductionDayView(day: ProductionDay): ProductionDayView {
  return {
    day: day.date,
    dayLabel: formatGermanDate(day.date),

    /**
     * VORHER UND NACHHER SIND KALENDERTAGE, keine Geschäftstage.
     *
     * plusDays rechnet über Date.UTC und ist damit auch an einem
     * Sommerzeitwechsel exakt. Ein Sonntag wird NICHT übersprungen: Ob
     * Buschmann sonntags produziert, ist eine Geschäftsregel, die dieses
     * System nicht kennt — sie hier in einer Oberfläche zum ersten Mal
     * festzuschreiben wäre der falsche Ort und die falsche Gelegenheit.
     */
    previousDay: plusDays(day.date, -1),
    previousDayLabel: formatGermanDate(plusDays(day.date, -1)),
    nextDay: plusDays(day.date, 1),
    nextDayLabel: formatGermanDate(plusDays(day.date, 1)),

    orderCount: day.orderCount,
    totalUnits: day.totalUnits,

    products: markiereUmbenennungen(day.products),

    orders: day.orders.map((order) => ({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      statusLabel: orderStatusLabel(order.status),
      fulfillmentLabel: fulfillmentLabel(order.fulfillmentType),
      note: normalisiereNotiz(order.note),
      items: order.items.map((item) => ({
        name: item.productName,
        unit: item.productUnit,
        quantity: item.quantity,
      })),
    })),

    /**
     * Beide Bedingungen, nicht eine. Sie fallen bei korrekten Daten immer
     * zusammen — eine Bestellung ohne Positionen kann es nicht geben, und
     * Positionen ohne Bestellung erst recht nicht. Genau deshalb ist die
     * UND-Verknüpfung richtig: Weichen sie einmal voneinander ab, ist etwas
     * kaputt, und dann soll die Seite Daten zeigen und nicht „nichts zu tun".
     */
    isEmpty: day.orderCount === 0 && day.products.length === 0,
  };
}

/**
 * Erkennt den Umbenennungsfall aus Phase 3B und macht ihn kennzeichenbar.
 *
 * DER FALL: Dieselbe Produkt-ID kommt an einem Tag mit unterschiedlichen
 * Namens- oder Einheits-Snapshots vor, weil zwischen zwei Bestellungen das
 * Produkt umbenannt wurde. Die Aggregation führt sie bewusst NICHT zusammen —
 * eine Summe über „8 Blech" und „3 Stück" wäre eine Zahl ohne Bedeutung.
 *
 * Für die Backstube sieht das ohne Erklärung aus wie ein doppelter Eintrag.
 * Diese Funktion liefert die Grundlage dafür, es zu erklären.
 *
 * DIE ERSTE ZEILE EINER GRUPPE BLEIBT UNMARKIERT. Markiert wird das
 * Abweichende, nicht der Normalfall — sonst stünde an zwei Zeilen derselbe
 * Hinweis und keine der beiden wäre der Bezugspunkt. „Erste" heißt: erste in
 * der von Phase 3B bestimmten Reihenfolge, also die mit der niedrigsten
 * sortOrder. Eine eigene Auswahl zu treffen hieße, die dortige Ordnung zu
 * überstimmen.
 *
 * MASSGEBLICH IST DIE PRODUKT-ID, NICHT DER NAME. Zwei verschiedene Produkte,
 * die zufällig gleich heißen, sind kein Umbenennungsfall — sie sind zwei
 * Produkte, und ein Hinweis dort wäre schlicht falsch.
 */
function markiereUmbenennungen(
  lines: ProductionDay['products'],
): readonly ProductionLineView[] {
  const gesehen = new Set<number>();

  return lines.map((line) => {
    const schonDa = gesehen.has(line.productId);
    gesehen.add(line.productId);

    return {
      name: line.productName,
      unit: line.productUnit,
      quantity: line.quantity,
      renamed: schonDa,
    };
  });
}

/**
 * Eine Notiz aus lauter Leerzeichen ist keine Notiz.
 *
 * Ohne diese Stelle erzeugte ein versehentlich abgeschicktes Leerzeichen
 * einen Notizblock mit Überschrift und leerem Inhalt — sichtbarer Platz für
 * nichts. Die Entscheidung fällt HIER und nicht im Renderer: Sie ist eine
 * Aussage darüber, wann eine Notiz existiert, und keine über HTML.
 *
 * Getrimmt wird NICHT der angezeigte Wert. Führende Zeilenumbrüche in einer
 * echten Notiz gehören zur Eingabe des Cafés; sie zu entfernen wäre eine
 * stille Änderung an Kundendaten.
 */
function normalisiereNotiz(note: string | null): string | null {
  if (note === null || note.trim().length === 0) {
    return null;
  }
  return note;
}
