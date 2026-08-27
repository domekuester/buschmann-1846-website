import type { OrderStatus } from './order-status';
import type { PaymentStatus } from './payment-status';

/**
 * Die Bestellhistorie eines Kunden — als Lesemodell des Adminbereichs.
 *
 * SIE BEANTWORTET GENAU EINE FRAGE: „Was hat dieser Kunde zuletzt bestellt,
 * und wo steht es?" Nicht, was in den Bestellungen drin war (das steht in der
 * Produktion), nicht, was daran verdient wurde (das steht im Dashboard), und
 * nicht, wie sich sein Umsatz entwickelt.
 *
 * JEDE ZAHL HIER IST EIN SNAPSHOT UND KEINE NEUBERECHNUNG. `totalCents` ist
 * der gespeicherte Gesamtbetrag aus orders.total_amount_cents — derselbe
 * Wert, den die Bestellung beim Anlegen bekommen hat. Ihn aus den Positionen
 * mit heutigen Katalogpreisen neu zu bilden hieße, eine Bestellung von
 * letzter Woche rückwirkend teurer zu machen, sobald jemand eine Preisliste
 * pflegt. Dieselbe Regel wie in dashboard-day.ts, und aus demselben Grund.
 *
 * WAS HIER NICHT STEHT, VERLÄSST DIE DATENBANK NICHT: keine Herstellkosten,
 * kein Rohertrag, keine Marge, keine Positionen, keine Zugangsdaten, keine
 * Notiz. Eine Kundenhistorie braucht Tag, Nummer, Stand und Betrag — sonst
 * nichts. Was nicht geladen wird, kann nicht abfließen (§18).
 */

/**
 * Wie viele Bestellungen die Detailansicht zeigt.
 *
 * ZEHN, UND DIE SEITE SAGT ES AUCH SO. Es gibt bewusst keine Blätterfunktion:
 * Die Frage am Tresen lautet „was war zuletzt?", nicht „zeig mir alles seit
 * 2024". Eine Liste, die vollständig AUSSIEHT, es aber nicht ist, wäre die
 * schlechtere von zwei Antworten — deshalb steht die Zahl in der Überschrift.
 */
export const CUSTOMER_ORDER_HISTORY_LIMIT = 10;

/** Eine Bestellung, wie die Kundendetailansicht sie sieht. */
export interface CustomerOrderLine {
  readonly orderNumber: string;
  /** Der Produktionstag — ein TAG in Europe/Berlin, 'JJJJ-MM-TT', ohne Uhrzeit. */
  readonly fulfillmentDate: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  /** Der GESPEICHERTE Gesamtbetrag in Cent. Snapshot, nicht neu gerechnet. */
  readonly totalCents: number;
}
