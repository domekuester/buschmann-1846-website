import { InvalidArgumentError } from '../../domain/errors';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';
import type { EditableOrder, EditableOrderItem } from '../../domain/admin-order-edit';
import type { EditableOrderItemRow, EditableOrderRow } from './rows';

/**
 * Die Datenbasis der Bearbeitungsansicht — zwei Abfragen, kein Umweg.
 *
 * DIE EINZIGE ABFRAGE DES SYSTEMS, DIE STORNIERTE POSITIONEN LIEST. Alle
 * anderen filtern sie weg (`AND cancelled_at IS NULL`), weil sie den GÜLTIGEN
 * Stand meinen. Diese hier beantwortet die andere Frage: „was steht in dieser
 * Bestellung — und was stand einmal darin?" Ohne sie wäre die Stornierung
 * unsichtbar, und genau das soll sie nicht sein.
 *
 * Diese Datei kennt kein HTTP, keine Sitzung und keine Rolle. Wer fragen
 * darf, entscheidet die Wache in der HTTP-Schicht.
 */

/**
 * Q1 — die Bestellung.
 *
 * KEIN JOIN AUF customers: Der Kundenname steht als Snapshot in der
 * Bestellung, und das ist auch hier der richtige Wert. Der angenehme
 * Nebeneffekt ist derselbe wie beim Produktionstag — E-Mail, Telefon und
 * interne Notiz können auf diesem Weg nicht abfließen, weil die Tabelle nicht
 * gelesen wird.
 */
const Q_ORDER = `
  SELECT id, order_number, customer_name_snapshot, fulfillment_date, status,
         payment_status, total_amount_cents, updated_at
    FROM orders
   WHERE order_number = ?
`;

/**
 * Q2 — die Positionen, AKTIVE WIE STORNIERTE.
 *
 * Hier fehlt bewusst das `AND i.cancelled_at IS NULL`, das in jeder anderen
 * Abfrage auf order_items steht. Die Spalte wird stattdessen GELESEN: Die
 * Ansicht muss eine stornierte Position zeigen und als solche kennzeichnen.
 *
 * Der JOIN auf products liest GENAU EINE Spalte: sort_order — dieselbe
 * Entscheidung und dieselbe Begründung wie im Produktionstag. Name, Einheit
 * und Preis kommen aus den Snapshot-Spalten der Position.
 *
 * unit_cost_cents_snapshot wird NICHT gelesen. Was ein Kuchen Buschmann
 * kostet, gehört nicht auf eine Seite, auf der Mengen geändert werden — und
 * was nicht geladen wird, kann dort nicht landen.
 *
 * Der Filter ist die Bestell-ID aus Q1 und nicht noch einmal die
 * Bestellnummer: Es geht um genau eine Bestellung, die eben gefunden wurde.
 */
const Q_ITEMS = `
  SELECT i.id, i.product_id, i.product_name_snapshot, i.product_unit_snapshot,
         i.unit_price_cents, i.quantity, i.line_total_cents, i.cancelled_at
    FROM order_items i
    JOIN products p ON p.id = i.product_id
   WHERE i.order_id = ?
   ORDER BY p.sort_order, i.product_name_snapshot, i.id
`;

/**
 * Die beiden Abfragen, nach außen sichtbar — damit ein Test DIESE prüft und
 * nicht eine Kopie. Dass es GENAU ZWEI sind, ist Vertrag.
 */
export const ADMIN_ORDER_EDIT_QUERIES = {
  order: Q_ORDER,
  items: Q_ITEMS,
} as const;

export async function findEditableOrder(
  db: D1Database,
  orderNumber: string,
): Promise<EditableOrder | null> {
  const row = await db.prepare(Q_ORDER).bind(orderNumber).first<EditableOrderRow>();
  if (row === null) {
    return null;
  }

  if (!isOrderStatus(row.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }
  if (!isPaymentStatus(row.payment_status)) {
    throw new InvalidArgumentError('Der gespeicherte Zahlungsstatus der Bestellung ist unbekannt.');
  }

  const { results } = await db.prepare(Q_ITEMS).bind(row.id).all<EditableOrderItemRow>();

  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name_snapshot,
    fulfillmentDate: row.fulfillment_date,
    status: row.status,
    paymentStatus: row.payment_status,
    totalCents: row.total_amount_cents,
    version: row.updated_at,
    items: results.map(toItem),
  };
}

function toItem(row: EditableOrderItemRow): EditableOrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    productUnit: row.product_unit_snapshot,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    lineTotalCents: row.line_total_cents,
    cancelledAt: row.cancelled_at,
  };
}
