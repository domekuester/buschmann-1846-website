import { plusDays } from '../domain/clock';
import type { DashboardDay } from '../domain/dashboard-day';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import { ORDER_STATUSES, countsTowardsRevenue, orderStatusLabel } from '../domain/order-status';
import {
  PAYMENT_STATUSES,
  isPaid,
  paymentStatusLabel,
  type PaymentStatus,
} from '../domain/payment-status';
import { formatEuro, formatGermanDate, formatGermanTimestamp } from './format';

/**
 * Das Ansichtsmodell des Tagesüberblicks — alles, was die Seite anzeigt, und
 * nichts, was sie nicht anzeigt.
 *
 * WARUM ES DIESE SCHICHT GIBT — dieselbe Begründung wie bei
 * production-day-view.ts: Das Lesemodell ist die fachliche Antwort und kennt
 * keine Sprache. Zwischen ihm und dem HTML muss dreierlei passieren: Status
 * und Zahlungsstand werden deutsch, Cent werden Eurobeträge, und der Tag
 * bekommt eine lesbare Form samt Nachbartagen. Stünde das im Renderer, stünde
 * Logik in Zeichenkettenverkettung — und wäre nur über HTML prüfbar.
 *
 * DIESE DATEI IST REIN. Keine Datenbank, keine Uhr, kein Zufall, kein
 * Request. Derselbe Eingabewert ergibt immer dieselbe Ausgabe; deshalb laufen
 * ihre Tests im Projekt „domain" ohne Worker-Runtime.
 *
 * ES WIRD NICHT GERECHNET. orderCount, revenueCents, unpaidCents und die
 * übrigen Zahlen kommen aus der Aggregation und werden hier ausschließlich
 * FORMATIERT. Eine zweite Summe in dieser Datei könnte der ersten
 * widersprechen — und die auf dem Bildschirm sichtbare wäre die falsche.
 *
 * ES WIRD NICHT GEFILTERT UND NICHT SORTIERT. Welche Bestellung storniert
 * ist, entscheidet die Domäne; die Reihenfolge bestimmt die Abfrage.
 */

/** Die Auswahl im Zahlungsformular — aus der Domänenliste, nicht daneben. */
export interface PaymentOptionView {
  readonly value: PaymentStatus;
  readonly label: string;
}

/**
 * Die fünf Zahlungsstände als Auswahl.
 *
 * SIE ENTSTEHT AUS PAYMENT_STATUSES und ist keine eigene Liste. Eine
 * handgeschriebene Aufzählung im Formular wäre eine zweite Fassung der
 * Domänenliste — und die stille Sorte Fehler, bei der ein Zustand existiert,
 * aber niemand ihn auswählen kann.
 */
export const PAYMENT_OPTIONS: readonly PaymentOptionView[] = PAYMENT_STATUSES.map((value) => ({
  value,
  label: paymentStatusLabel(value),
}));

export interface DashboardOrderRowView {
  readonly orderNumber: string;
  readonly customerName: string;
  /** „Neu", „In Produktion", „Storniert" — aus orderStatusLabel(). */
  readonly statusLabel: string;
  /**
   * Diese Bestellung zählt in keiner Summe mit.
   *
   * Eine Frage der DARSTELLUNG, aber mit derselben Quelle wie die Summen:
   * countsTowardsRevenue(). Eine Zeile, die als storniert gezeigt wird,
   * während sie im Umsatz steht, wäre schlimmer als gar keine Kennzeichnung.
   */
  readonly isCancelled: boolean;
  /** Der gespeicherte Stand — er bestimmt die Vorauswahl im Formular. */
  readonly paymentStatus: PaymentStatus;
  /** „Offen", „Bar bezahlt" — aus paymentStatusLabel(). */
  readonly paymentStatusLabel: string;
  readonly isPaid: boolean;
  /** „43,50 €" — aus dem gespeicherten Gesamtbetrag. */
  readonly amountLabel: string;
  /** „25.08.2026, 09:12" — wann bestellt wurde, nicht der Liefertag. */
  readonly orderedAtLabel: string;
  /** „Lieferung" oder „Abholung". */
  readonly fulfillmentLabel: string;
}

export interface DashboardProductLineView {
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
}

/**
 * EIN STÜCK EINES RINGDIAGRAMMS.
 *
 * `dashArray` und `dashOffset` sind GEOMETRIE und keine Kennzahl. Sie stehen
 * hier und nicht im Renderer, weil sie sonst als Rechnung in einer
 * Zeichenkettenverkettung stünden und nur über HTML prüfbar wären — dieselbe
 * Begründung, aus der diese Datei überhaupt existiert.
 *
 * ES WIRD DABEI NICHTS SUMMIERT. Jeder `count` kommt fertig aus der
 * Aggregation; hier wird er ausschließlich ins Verhältnis zum ebenfalls
 * fertigen Gesamtwert gesetzt. Eine zweite Summe entstünde erst, wenn diese
 * Datei anfinge, Bestellungen zu zählen — und das tut sie nicht.
 */
export interface DonutSegmentView {
  /** 'bezahlt', 'offen' oder ein OrderStatus — er wählt die Farbe im CSS. */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** „3 Bestellungen" — mit Einzahl, wo es eine ist. */
  readonly countLabel: string;
  /** „60,90 €" beim Zahlungsring, leer beim Statusring. */
  readonly detailLabel: string;
  readonly dashArray: string;
  readonly dashOffset: string;
}

export interface DonutView {
  readonly total: number;
  readonly totalLabel: string;
  /**
   * Das Wort unter der Zahl in der Mitte — „gesamt" und nicht
   * „Bestellungen".
   *
   * Ein Befund aus dem Browser: „BESTELLUNGEN" stand breiter als das Loch des
   * Rings und lief über die Ringspur hinaus. Das Wort steht ohnehin schon im
   * Tafelkopf („7 Bestellungen"); in der Mitte muss nur stehen, dass diese
   * Zahl die Summe ist.
   */
  readonly totalCaption: string;
  /** „7 Bestellungen" — die Angabe im Tafelkopf. */
  readonly totalCountLabel: string;
  readonly segments: readonly DonutSegmentView[];
  readonly isEmpty: boolean;
  /** „zusätzlich 1 storniert" — oder leer. */
  readonly footnote: string;
}

export interface DashboardDayView {
  /** 'JJJJ-MM-TT' — für URLs und das Datumsfeld. */
  readonly day: string;
  /** „Freitag, 28. August 2026" — für Menschen. */
  readonly dayLabel: string;
  readonly previousDay: string;
  readonly previousDayLabel: string;
  readonly nextDay: string;
  readonly nextDayLabel: string;

  readonly orderCount: number;
  readonly cancelledCount: number;
  readonly revenueLabel: string;
  readonly openCount: number;
  readonly customerCount: number;
  readonly totalUnits: number;
  readonly unpaidLabel: string;
  readonly unpaidCount: number;

  /**
   * An diesem Tag ist ÜBERHAUPT nichts bestellt worden.
   *
   * Der Unterschied zu „orderCount === 0" ist der Storno: Ein Tag, an dem
   * eine Bestellung eingegangen und wieder storniert wurde, ist nicht leer —
   * er hat eine Geschichte, und die Seite soll sie zeigen statt „nichts los"
   * zu behaupten.
   */
  readonly isEmpty: boolean;

  readonly orders: readonly DashboardOrderRowView[];
  readonly topProducts: readonly DashboardProductLineView[];

  /** Bezahlt gegen offen — über die Bestellungen, die zählen. */
  readonly paymentDonut: DonutView;
  /** Wo die Bestellungen des Tages stehen — stornierte eingeschlossen. */
  readonly statusDonut: DonutView;
}

export function toDashboardView(day: DashboardDay): DashboardDayView {
  const previousDay = plusDays(day.date, -1);
  const nextDay = plusDays(day.date, 1);

  return {
    day: day.date,
    dayLabel: formatGermanDate(day.date),
    previousDay,
    previousDayLabel: formatGermanDate(previousDay),
    nextDay,
    nextDayLabel: formatGermanDate(nextDay),

    orderCount: day.orderCount,
    cancelledCount: day.cancelledCount,
    revenueLabel: formatEuro(day.revenueCents),
    openCount: day.openCount,
    customerCount: day.customerCount,
    totalUnits: day.totalUnits,
    unpaidLabel: formatEuro(day.unpaidCents),
    unpaidCount: day.unpaidCount,

    isEmpty: day.orders.length === 0,

    orders: day.orders.map((order) => ({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      statusLabel: orderStatusLabel(order.status),
      isCancelled: !countsTowardsRevenue(order.status),
      paymentStatus: order.paymentStatus,
      paymentStatusLabel: paymentStatusLabel(order.paymentStatus),
      isPaid: isPaid(order.paymentStatus),
      amountLabel: formatEuro(order.totalCents),
      orderedAtLabel: formatGermanTimestamp(order.createdAt),
      fulfillmentLabel: fulfillmentLabel(order.fulfillmentType),
    })),

    topProducts: day.topProducts.map((line) => ({
      name: line.productName,
      unit: line.productUnit,
      quantity: line.quantity,
    })),

    paymentDonut: zahlungsring(day),
    statusDonut: statusring(day),
  };
}

/** „1 Bestellung", „3 Bestellungen" — die Einzahl ist kein Schönheitsfehler. */
function bestellungen(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Bestellung' : 'Bestellungen'}`;
}

/**
 * Aus fertigen Anteilen wird ein Ring.
 *
 * DER TRICK MIT DEM RADIUS 15.9155: Der Umfang eines Kreises mit diesem
 * Radius ist 2πr = 100,000… — also genau 100. Damit IST eine
 * `stroke-dasharray`-Länge unmittelbar ein Prozentsatz, und es muss nirgends
 * mit π gerechnet werden.
 *
 * WARUM ATTRIBUTE UND KEINE STILE: Die CSP dieser Anwendung erlaubt
 * `style-src 'self'` und kein `'unsafe-inline'`. Ein `style="stroke-dasharray:…"`
 * am Segment würde vom Browser verworfen, und der Ring wäre leer. `dasharray`
 * und `dashoffset` sind in SVG aber PRÄSENTATIONSATTRIBUTE — sie gehen durch,
 * ohne dass die CSP aufgeweicht werden muss. Die Farben kommen deshalb
 * umgekehrt aus Klassen und nicht aus Attributen.
 */
function ring(
  eintraege: readonly { key: string; label: string; count: number; detailLabel: string }[],
  totalCaption: string,
  footnote = '',
): DonutView {
  const total = eintraege.reduce((summe, eintrag) => summe + eintrag.count, 0);

  /**
   * DIE LÜCKE ZWISCHEN ZWEI STÜCKEN — ein Befund aus dem Browser.
   *
   * Ohne sie stoßen die Stücke stumpf aneinander, und der Ring liest sich nur
   * so gut, wie sich seine beiden Farben unterscheiden. Bei fünf Stücken in
   * einer Helligkeitsreihe ist das zu wenig: Zwei benachbarte Blautöne wurden
   * zu einem Bogen. Eine Lücke von einer Einheit auf hundert trennt sie
   * unabhängig von der Farbe — und damit auch für ein Auge, das die Töne gar
   * nicht auseinanderhält.
   *
   * Sie wächst nicht mit: Bei einem sehr kleinen Stück nimmt sie höchstens ein
   * Drittel davon, damit ein einzelnes Achtel nicht zum Strich schrumpft. Bei
   * einem einzigen Stück gibt es keine Lücke — ein Ring aus einem Stück ist
   * ein geschlossener Ring.
   */
  const stuecke = eintraege.filter((eintrag) => eintrag.count > 0).length;

  let gelaufen = 0;
  const segments = eintraege.map((eintrag) => {
    const laenge = total === 0 ? 0 : (eintrag.count / total) * 100;
    const luecke = stuecke < 2 ? 0 : Math.min(1, laenge / 3);
    const gezeichnet = Math.max(laenge - luecke, 0);
    const segment: DonutSegmentView = {
      key: eintrag.key,
      label: eintrag.label,
      count: eintrag.count,
      countLabel: bestellungen(eintrag.count),
      detailLabel: eintrag.detailLabel,
      dashArray: `${runde(gezeichnet)} ${runde(100 - gezeichnet)}`,
      dashOffset: `${runde(-gelaufen)}`,
    };
    gelaufen += laenge;
    return segment;
  });

  return {
    total,
    totalLabel: String(total),
    totalCaption,
    totalCountLabel: bestellungen(total),
    segments,
    isEmpty: total === 0,
    footnote,
  };
}

/** Drei Nachkommastellen reichen für einen Ring von 100 Einheiten Umfang. */
function runde(wert: number): string {
  return String(Math.round(wert * 1000) / 1000);
}

/**
 * BEZAHLT GEGEN OFFEN — über die Bestellungen, die zählen.
 *
 * Der Ring umfasst genau `orderCount`: Was hier steht, lässt sich gegen die
 * Kennzahl „Bestellungen" darüber nachzählen. Stornierte sind NICHT als
 * drittes Stück dabei — sie haben keinen Zahlungsanspruch, stehen in keiner
 * Summe des Tages, und als Stück im Zahlungsring machten sie die Gesamtzahl
 * des Rings zu einer Zahl, die auf der Seite sonst nirgends vorkommt. Sie
 * stehen stattdessen als Fußnote darunter — mit demselben Wort wie auf der
 * Kennzahlenkarte.
 *
 * BEIDE STÜCKE STEHEN AUCH BEI NULL IN DER LEGENDE. „Offen: 0 Bestellungen"
 * ist eine gute Nachricht und soll lesbar sein — dieselbe Regel, aus der die
 * Kennzahlenkarte „0,00 €" zeigt, statt zu verschwinden.
 */
function zahlungsring(day: DashboardDay): DonutView {
  return ring(
    [
      {
        key: 'bezahlt',
        label: 'Bezahlt',
        count: day.paidCount,
        detailLabel: formatEuro(day.paidCents),
      },
      {
        key: 'offen',
        label: 'Noch offen',
        count: day.unpaidCount,
        detailLabel: formatEuro(day.unpaidCents),
      },
    ],
    'gesamt',
    day.cancelledCount === 0 ? '' : `zusätzlich ${bestellungen(day.cancelledCount)} storniert`,
  );
}

/**
 * WO DIE BESTELLUNGEN DES TAGES STEHEN — stornierte eingeschlossen.
 *
 * Die Reihenfolge ist die des Lebenslaufs einer Bestellung (ORDER_STATUSES)
 * und nicht die der Häufigkeit: Ein Ring, dessen Stücke je nach Tag die
 * Plätze tauschen, ist von Tag zu Tag nicht wiederzuerkennen.
 *
 * STATUS OHNE BESTELLUNG STEHEN NICHT IN DER LEGENDE. Anders als beim
 * Zahlungsring: Dort sind es zwei feste Hälften, hier bis zu fünf Zeilen, und
 * „Bestätigt: 0 Bestellungen" beantwortet keine Frage, die jemand stellt.
 */
function statusring(day: DashboardDay): DonutView {
  return ring(
    ORDER_STATUSES.filter((status) => day.statusCounts[status] > 0).map((status) => ({
      key: status,
      label: orderStatusLabel(status),
      count: day.statusCounts[status],
      detailLabel: '',
    })),
    'gesamt',
  );
}
