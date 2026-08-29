import { plusDays } from '../domain/clock';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import {
  ORDER_STATUSES,
  canTransitionTo,
  orderStatusLabel,
  type OrderStatus,
} from '../domain/order-status';
import type { ProductionDay } from '../domain/production-day';
import { formatGermanDate, formatGermanTimestamp } from './format';

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

/**
 * Eine anklickbare Statusaktion — Phase 4B.
 *
 * WOHER SIE KOMMT: aus canTransitionTo(). Nicht aus einer Liste in dieser
 * Datei, nicht aus einer im Renderer, nicht aus einer in der HTTP-Schicht.
 * Siehe statusAktionen() weiter unten; dort steht die ganze Ableitung in drei
 * Zeilen, und sie enthält keinen einzigen Statusvergleich.
 */
export interface StatusActionView {
  /** Der Zielstatus — der Wert des versteckten Feldes im Formular. */
  readonly target: OrderStatus;
  /** „Bestätigen", „Produktion starten" — was auf der Schaltfläche steht. */
  readonly label: string;
  /**
   * Diese Aktion bringt die Bestellung nicht voran, sondern beendet sie.
   *
   * Eine Frage der DARSTELLUNG und keine der Domäne: Für canTransitionTo()
   * ist ein Übergang erlaubt oder nicht, mehr sagt die Regel nicht. Ob eine
   * erlaubte Aktion zurückhaltender aussehen soll, entscheidet die
   * Oberfläche — und deshalb steht das Merkmal hier und nicht in
   * order-status.ts.
   */
  readonly destructive: boolean;
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
  readonly lastStatusChange: {
    readonly changedAtLabel: string;
    readonly changedBy: string;
  } | null;
  readonly items: readonly ProductionOrderItemView[];
  /**
   * Was ein Mitarbeiter mit dieser Bestellung als Nächstes tun kann —
   * ausschließlich das, was die Domäne erlaubt. Eine leere Liste heißt
   * Endzustand und ist kein Sonderfall.
   */
  readonly actions: readonly StatusActionView[];
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
      lastStatusChange:
        order.lastStatusChange?.changedBy == null
          ? null
          : {
              changedAtLabel: formatGermanTimestamp(order.lastStatusChange.changedAt),
              changedBy: order.lastStatusChange.changedBy,
            },
      items: order.items.map((item) => ({
        name: item.productName,
        unit: item.productUnit,
        quantity: item.quantity,
      })),
      actions: statusAktionen(order.status),
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

/**
 * DIE STATUSAKTIONEN EINER BESTELLUNG — und die Stelle, an der Phase 4B am
 * ehesten hätte falsch abbiegen können.
 *
 * ES GIBT HIER KEINE ZWEITE ÜBERGANGSTABELLE. Kein `if (status === 'new')`,
 * keine Aufzählung erlaubter Ziele, keine Kopie von ALLOWED_TARGETS. Die
 * Funktion geht die Statusliste der Domäne durch und FRAGT für jeden Eintrag
 * canTransitionTo() — dieselbe Funktion, die der Anwendungsfall vor dem
 * Schreiben fragt und das Aggregat in withStatus() ein zweites Mal.
 *
 * Damit ist die Oberfläche nicht bloß „zufällig einig" mit dem Server: Sie
 * kann gar nichts anderes anbieten. Ändert jemand die Tabelle in
 * order-status.ts, ändern sich die Schaltflächen mit, ohne dass hier eine
 * Zeile angefasst werden müsste — und ohne dass jemand es vergessen könnte.
 *
 * DIE REIHENFOLGE KOMMT AUS ORDER_STATUSES und ist damit die des
 * Lebenszyklus. Das ist keine Kosmetik: 'cancelled' steht dort zuletzt, also
 * steht die abbrechende Aktion in der Karte hinter der fortschreitenden. Eine
 * eigene Sortierung wäre eine zweite Meinung über eine Ordnung, die es schon
 * gibt.
 *
 * EINE SCHALTFLÄCHE OHNE ZUGANG IST KEINE BERECHTIGUNG. Diese Funktion
 * entscheidet, was ein Admin SIEHT. Ob er es DARF, entscheidet die Wache in
 * http/guard.ts — jedes Mal neu, bei jedem POST. Das ist die Trennung, ohne
 * die eine ausgeblendete Schaltfläche wie Sicherheit aussähe.
 */
export function statusAktionen(status: OrderStatus): readonly StatusActionView[] {
  return ORDER_STATUSES.filter((ziel) => canTransitionTo(status, ziel)).map((ziel) => ({
    target: ziel,
    label: AKTIONSLABEL[ziel],
    destructive: ABBRUCH[ziel],
  }));
}

/**
 * Wie eine Aktion auf Deutsch heißt.
 *
 * REINE DARSTELLUNG. Diese Tabelle entscheidet NICHT, ob ein Übergang
 * möglich ist — sie benennt nur einen, der es bereits ist. Das ist der
 * Unterschied, an dem die Regel „keine zweite State Machine" hängt.
 *
 * SIE IST VOLLSTÄNDIG, und zwar mit Absicht: Ein Record über OrderStatus
 * zwingt jeden, der einen sechsten Status hinzufügt, ihm hier einen Namen zu
 * geben. Mit einer lückenhaften Zuordnung verschwände eine von der Domäne
 * erlaubte Aktion still aus der Oberfläche — und das wäre wieder eine zweite
 * Entscheidung darüber, was möglich ist.
 *
 * DESHALB STEHT AUCH 'new' DARIN, obwohl heute kein Übergang dorthin führt:
 * Der Eintrag ist der Platzhalter für den Tag, an dem sich das ändert, und
 * nicht die Behauptung, dass es die Schaltfläche gibt. Erlaubt wird sie
 * ausschließlich in order-status.ts.
 *
 * Die Labels sind VERBEN, keine Zustandsnamen. Auf der Schaltfläche steht,
 * was passiert, wenn man sie drückt — „Bestätigen", nicht „Bestätigt"; der
 * Zustandsname steht darüber im Statusfeld.
 */
const AKTIONSLABEL: Readonly<Record<OrderStatus, string>> = {
  new: 'Zurück auf Neu setzen',
  confirmed: 'Bestätigen',
  in_production: 'Produktion starten',
  completed: 'Abschließen',
  cancelled: 'Stornieren',
};

/**
 * Welche Aktion beendet statt voranzubringen.
 *
 * Auch das ist Darstellung: Die Domäne kennt „abbrechend" nicht, und
 * isFinalStatus() wäre die falsche Quelle — 'completed' ist ebenfalls ein
 * Endzustand und trotzdem der normale Abschluss der Arbeit. Was Storno
 * besonders macht, ist die Folge für den Kunden, nicht die Struktur der
 * Zustandsmenge.
 */
const ABBRUCH: Readonly<Record<OrderStatus, boolean>> = {
  new: false,
  confirmed: false,
  in_production: false,
  completed: false,
  cancelled: true,
};
