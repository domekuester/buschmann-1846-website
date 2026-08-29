import type { CustomerOrderLine } from '../../domain/customer-history';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';
import { InvalidArgumentError } from '../../domain/errors';

/**
 * Die letzten Bestellungen EINES Kunden.
 *
 * EINE ABFRAGE FÜR DIE GANZE LISTE, und kein Zugriff je Bestellung. Weder
 * order_items noch products noch catalog_products kommen darin vor: Tag,
 * Nummer, Stand und Betrag stehen vollständig in orders selbst, seit
 * total_amount_cents (0003) und payment_status (0015) dort liegen. Ein JOIN
 * auf die Positionen wäre nicht nur ein N+1 in Verkleidung, sondern die
 * Einladung, den Betrag aus heutigen Preisen neu zu bilden.
 *
 * SIE VERBINDET AUCH NICHT AUF customers. Der Kunde steht bereits fest — er
 * ist der Parameter dieser Abfrage.
 *
 * SORTIERUNG: fulfillment_date DESC, id DESC.
 *
 * Der Produktionstag führt, weil er die fachlich relevante Zeitachse ist:
 * „Was hat der Kunde zuletzt bekommen?" fragt nach dem Liefertag, nicht nach
 * dem Zeitpunkt des Klicks. Der zweite Schlüssel ist die Kennung und damit
 * die Einfügereihenfolge — sie ist EINDEUTIG (INTEGER PRIMARY KEY) und macht
 * die Reihenfolge zweier Bestellungen desselben Tages damit stabil. Ohne ihn
 * dürfte SQLite bei gleichem Tag jede Reihenfolge liefern, und dieselbe Seite
 * sähe bei zwei Aufrufen verschieden aus.
 *
 * DER INDEX DAZU GIBT ES SEIT 0003: idx_orders_customer_day auf
 * (customer_id, fulfillment_date). Diese Phase legt keinen neuen an.
 *
 * DAS LIMIT IST EIN PARAMETER UND KEINE KONSTANTE IN DIESEM SQL. Wie viele
 * Zeilen die Seite zeigt, ist eine Entscheidung der Fachlichkeit
 * (CUSTOMER_ORDER_HISTORY_LIMIT) — sie hier ein zweites Mal hinzuschreiben
 * hieße, dass die Überschrift „Letzte 10 Bestellungen" und die Abfrage
 * irgendwann verschiedene Zahlen meinen.
 *
 * STORNIERTE BESTELLUNGEN BLEIBEN SICHTBAR. Eine Historie, die sie wegließe,
 * wäre keine Historie: „Wir hatten doch für Freitag bestellt" ist genau die
 * Frage, für die es diese Seite gibt, und „storniert" ist darauf eine
 * Antwort.
 */
export async function loadCustomerOrderHistory(
  db: D1Database,
  customerId: number,
  limit: number,
): Promise<CustomerOrderLine[]> {
  const { results } = await db.prepare(
    `SELECT order_number, fulfillment_date, status, payment_status, total_amount_cents
       FROM orders
      WHERE customer_id = ?
      ORDER BY fulfillment_date DESC, id DESC
      LIMIT ?`,
  ).bind(customerId, limit).all<CustomerOrderQueryRow>();

  return results.map(toOrderLine);
}

interface CustomerOrderQueryRow {
  order_number: string;
  fulfillment_date: string;
  status: string;
  payment_status: string;
  total_amount_cents: number;
}

/**
 * Eine Datenbankzeile als Historienzeile.
 *
 * DIE BEIDEN STÄNDE WERDEN GEPRÜFT UND NICHT ZUGESICHERT. Ein gespeicherter
 * Wert, den die Domäne nicht kennt, ist eine beschädigte Zeile; ihn als
 * OrderStatus durchzureichen hieße, ihn ungeprüft an orderStatusLabel() zu
 * geben, das dafür `undefined` zurückgäbe — und auf der Seite stünde dann
 * nichts, wo ein Stand stehen müsste. Dieselbe Regel wie in
 * order-repository.ts.
 */
function toOrderLine(row: CustomerOrderQueryRow): CustomerOrderLine {
  if (!isOrderStatus(row.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status einer Bestellung ist unbekannt.');
  }
  if (!isPaymentStatus(row.payment_status)) {
    throw new InvalidArgumentError('Der gespeicherte Zahlungsstand einer Bestellung ist unbekannt.');
  }

  return {
    orderNumber: row.order_number,
    fulfillmentDate: row.fulfillment_date,
    status: row.status,
    paymentStatus: row.payment_status,
    // Der SNAPSHOT aus der Bestellung. Er wird hier nicht nachgerechnet.
    totalCents: row.total_amount_cents,
  };
}
