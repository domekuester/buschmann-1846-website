import { plusDays } from '../domain/clock';
import type { DashboardDay } from '../domain/dashboard-day';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import { countsTowardsRevenue, orderStatusLabel } from '../domain/order-status';
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
  };
}
