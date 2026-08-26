import { toUtcTimestamp } from '../domain/clock';
import type { OrderNumber } from '../domain/order-number';
import { paymentRecordedAtFor, type PaymentStatus } from '../domain/payment-status';
import {
  findOrderFulfillmentDate,
  updateOrderPayment,
} from '../infrastructure/d1/order-repository';

/**
 * „Diese Bestellung ist bezahlt — bar."
 *
 * Der vierte schreibende Adminvorgang des Systems und bewusst der einfachste:
 * eine Bestellung, ein Zahlungsstand, ein Zeitpunkt.
 *
 * ER IST NICHT changeOrderStatus() MIT ANDEREN WERTEN. Der Unterschied ist
 * fachlich und steht ausführlich in domain/payment-status.ts: Der
 * Produktionsstatus ist eine Reise mit erlaubten Wegen, der Zahlungsstand ist
 * ein Eintrag, der korrigiert werden darf. Deshalb gibt es hier
 *
 *   KEIN canTransitionTo()  — jeder Stand darf jedem folgen. Wer „Bar" statt
 *                             „Karte" gewählt hat, korrigiert es, statt zu
 *                             stornieren.
 *   KEINEN Konfliktausgang  — zwei Einträge nacheinander sind kein Streit,
 *                             sondern zwei Blicke auf denselben Tresen; der
 *                             jüngere gilt.
 *   KEINE Auditspalten      — wer den Status gesetzt hat, steht seit Phase 4A
 *                             in der Bestellung; eine Zahlungshistorie ist
 *                             eine eigene Tabelle und keine Zeile hier.
 *
 * DIESE FUNKTION ENTSCHEIDET NICHT, OB SIE AUFGERUFEN WERDEN DARF. Rolle,
 * Sitzung, Origin und CSRF-Token stehen in der HTTP-Schicht und ausschließlich
 * dort — dieselbe Trennung wie bei changeOrderStatus() und placeCafeOrder().
 * Der Parameter, über den sich hier eine Rolle behaupten ließe, existiert
 * nicht.
 *
 * DER ZAHLUNGSSTAND ÄNDERT AM UMSATZ NICHTS. In dieser Datei kommt kein
 * Betrag vor, weder gelesen noch geschrieben.
 */

/**
 * Was bei dem Versuch herausgekommen ist.
 *
 * Nur ZWEI Ausgänge — gegenüber vier beim Statuswechsel. Es fehlen
 * 'invalid_transition' (es gibt keine Übergangsregel) und 'conflict' (es gibt
 * keine Bedingung, an der ein zweiter Schreiber scheitern könnte). Ein
 * Rückgabetyp, der Fälle führt, die nicht eintreten können, wäre eine
 * Behauptung über eine Fachlichkeit, die es nicht gibt.
 */
export type RecordOrderPaymentResult =
  /** Eingetragen — mit dem Liefertag, auf den die Oberfläche zurückführt. */
  | { readonly outcome: 'recorded'; readonly fulfillmentDate: string }
  /** Diese Bestellnummer gibt es nicht. */
  | { readonly outcome: 'unknown_order' };

export interface RecordOrderPaymentCommand {
  /**
   * Eine bereits GEPRÜFTE Bestellnummer, kein String — dieselbe Regel wie in
   * changeOrderStatus(). Wer einen OrderNumber hat, hat ihn durch
   * OrderNumber.parse() geholt; aus einem Anfragepfad lässt er sich nicht
   * herbeireden.
   */
  readonly orderNumber: OrderNumber;
  /** Der gewünschte Zahlungsstand, bereits als solcher erkannt. */
  readonly target: PaymentStatus;
  /**
   * Der Zeitpunkt wird ÜBERGEBEN und nicht abgeleitet. Kein Date.now() —
   * sonst hinge das Ergebnis daran, wann die Funktion läuft, und
   * payment_recorded_at wäre in keinem Test prüfbar.
   */
  readonly now: Date;
}

export async function recordOrderPayment(
  db: D1Database,
  command: RecordOrderPaymentCommand,
): Promise<RecordOrderPaymentResult> {
  const { orderNumber, target, now } = command;

  /**
   * ZUERST DER LIEFERTAG, DANN DER SCHREIBVORGANG.
   *
   * Der Tag wird nicht gebraucht, um schreiben zu dürfen — er wird gebraucht,
   * um danach an die richtige Stelle zurückzuführen, und er muss aus der
   * DATENBANK kommen: Ein Rückkehrziel aus der Anfrage wäre ein Open
   * Redirect. Ihn davor zu lesen kostet eine Abfrage und erspart den Fall,
   * dass geschrieben wurde und das Ziel fehlt.
   */
  const fulfillmentDate = await findOrderFulfillmentDate(db, orderNumber.value);
  if (fulfillmentDate === null) {
    return { outcome: 'unknown_order' };
  }

  const geschrieben = await updateOrderPayment(db, {
    orderNumber: orderNumber.value,
    paymentStatus: target,
    /**
     * DIE ZEITPUNKTREGEL KOMMT AUS DER DOMÄNE. Hier steht kein `target ===
     * 'unpaid' ? null : …` — das wäre eine zweite Fassung der Regel, und die
     * CHECK-Bedingung aus Migration 0015 fiele ihr als Erstes zum Opfer.
     */
    paymentRecordedAt: paymentRecordedAtFor(target, now),
    updatedAt: toUtcTimestamp(now),
  });

  /**
   * Zwischen dem Lesen des Tages und dieser Zeile kann die Bestellung
   * verschwunden sein — praktisch ausgeschlossen, weil nichts in diesem
   * System Bestellungen löscht, und trotzdem geprüft: Eine Erfolgsmeldung
   * ohne geschriebene Zeile ist die eine Antwort, die niemals gegeben werden
   * darf.
   */
  if (!geschrieben) {
    return { outcome: 'unknown_order' };
  }

  return { outcome: 'recorded', fulfillmentDate };
}
