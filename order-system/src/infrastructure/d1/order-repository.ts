import { InvalidArgumentError } from '../../domain/errors';
import { FulfillmentDate } from '../../domain/fulfillment-date';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { Money } from '../../domain/money';
import { Order } from '../../domain/order';
import { OrderItem } from '../../domain/order-item';
import { OrderNumber } from '../../domain/order-number';
import { isOrderStatus } from '../../domain/order-status';
import type { OrderItemRow, OrderRow } from './rows';

/**
 * Schreibt eine Bestellung samt Positionen — vollständig oder gar nicht.
 *
 * D1 führt die Anweisungen eines batch() in einer einzigen impliziten
 * Transaktion aus. Scheitert eine davon, wird keine wirksam. Das ist der
 * vorgesehene Weg für atomare Schreibvorgänge; eine selbst gebaute
 * Pseudo-Transaktion aus mehreren Einzelaufrufen wäre genau das, was Regel 18
 * ausschließt.
 *
 * Die Positionen beziehen ihre order_id über ein Subselect auf die eindeutige
 * Bestellnummer, nicht über last_insert_rowid(). Der Grund ist Lesbarkeit und
 * Verlässlichkeit: Das Subselect sagt ausdrücklich, zu welcher Bestellung die
 * Position gehört, statt sich auf die Ausführungsreihenfolge innerhalb des
 * Batches und den Verbindungszustand zu verlassen.
 *
 * submissionId ist die Absendekennung der Bestellseite und optional, weil
 * nicht jede Bestellung über sie entsteht — der Anwendungsfall aus Phase 1
 * kennt sie nicht. Sie ist bewusst KEIN Feld des Order-Aggregats: Wie oft ein
 * Daumen auf eine Schaltfläche getippt hat, ist keine Eigenschaft einer
 * Bestellung. Sie geht in denselben INSERT und damit in dieselbe Zeile —
 * damit kann keine Bestellung ohne ihre Kennung und keine Kennung ohne ihre
 * Bestellung existieren.
 */
export async function saveOrder(
  db: D1Database,
  order: Order,
  submissionId: string | null = null,
): Promise<void> {
  const insertOrder = db
    .prepare(
      `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, delivery_address_snapshot, note, status,
                           total_amount_cents, submission_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      order.orderNumber.value,
      order.customerId,
      order.customerNameSnapshot,
      order.fulfillmentType,
      order.fulfillmentDate.value,
      order.deliveryAddressSnapshot,
      order.note,
      order.status,
      order.total().cents,
      submissionId,
      order.createdAt,
      order.updatedAt,
    );

  const insertItems = order.items.map((item) =>
    db
      .prepare(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                  unit_price_cents, quantity, line_total_cents)
              VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        order.orderNumber.value,
        item.productId,
        item.productNameSnapshot,
        item.productUnitSnapshot,
        item.unitPrice.cents,
        item.quantity,
        item.lineTotal.cents,
      ),
  );

  await db.batch([insertOrder, ...insertItems]);
}

/**
 * Liest eine Bestellung zurück — ausschließlich aus ihren eigenen Spalten.
 *
 * Es wird bewusst NICHT auf products oder customers verbunden. Eine Bestellung
 * ist ein Dokument: Name, Einheit, Preis und Adresse stehen als Snapshot in
 * ihren eigenen Zeilen. Ein JOIN würde genau die Regel aushebeln, die eine
 * spätere Preisänderung nicht rückwirkend wirken lässt.
 */
export async function findOrderByNumber(db: D1Database, orderNumber: string): Promise<Order | null> {
  const row = await db
    .prepare(
      `SELECT id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
              fulfillment_date, delivery_address_snapshot, note, status, total_amount_cents,
              created_at, updated_at
         FROM orders
        WHERE order_number = ?`,
    )
    .bind(orderNumber)
    .first<OrderRow>();

  if (row === null) {
    return null;
  }

  const { results } = await db
    .prepare(
      `SELECT product_id, product_name_snapshot, product_unit_snapshot, unit_price_cents, quantity
         FROM order_items
        WHERE order_id = ?
        ORDER BY id`,
    )
    .bind(row.id)
    .all<OrderItemRow>();

  return toOrder(row, results);
}

/**
 * Sucht die Bestellung, die aus einem bestimmten Absendevorgang entstanden
 * ist. Das ist die Leseseite des Doppelklick-Schutzes: Trifft eine zweite
 * Anfrage mit derselben Kennung ein, wird nicht noch einmal bestellt, sondern
 * die vorhandene Bestellung zurückgegeben.
 *
 * Der Kunde gehört zum Schlüssel und ist nicht bloß eine zusätzliche
 * Bedingung: Ohne ihn könnte ein Café mit einer geratenen Kennung die
 * Bestellung eines anderen Cafés auslesen.
 */
export async function findOrderBySubmission(
  db: D1Database,
  customerId: number,
  submissionId: string,
): Promise<Order | null> {
  const row = await db
    .prepare(
      `SELECT order_number FROM orders WHERE customer_id = ? AND submission_id = ?`,
    )
    .bind(customerId, submissionId)
    .first<{ order_number: string }>();

  return row === null ? null : findOrderByNumber(db, row.order_number);
}

function toOrder(row: OrderRow, itemRows: readonly OrderItemRow[]): Order {
  if (!isFulfillmentType(row.fulfillment_type)) {
    throw new InvalidArgumentError('Der gespeicherte Fulfillment-Typ der Bestellung ist unbekannt.');
  }
  if (!isOrderStatus(row.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }

  const items = itemRows.map(
    (item) =>
      new OrderItem({
        productId: item.product_id,
        productNameSnapshot: item.product_name_snapshot,
        productUnitSnapshot: item.product_unit_snapshot,
        // Der Snapshot aus der Position, nicht der heutige Produktpreis.
        unitPrice: Money.fromCents(item.unit_price_cents),
        quantity: item.quantity,
      }),
  );

  const order = Order.restore({
    orderNumber: OrderNumber.fromString(row.order_number),
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    fulfillmentType: row.fulfillment_type,
    // Ein gespeicherter Liefertag darf in der Vergangenheit liegen — die
    // Regel gilt beim Bestellen, nicht beim Lesen. Deshalb wird hier nicht
    // gegen "heute" geprüft.
    fulfillmentDate: FulfillmentDate.restore(row.fulfillment_date),
    deliveryAddressSnapshot: row.delivery_address_snapshot,
    note: row.note,
    status: row.status,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  // Der gespeicherte Gesamtbetrag muss der Summe der Positionen entsprechen.
  // Weicht er ab, ist die Zeile beschädigt — dann lieber ein Fehler als eine
  // Bestellung, die zwei verschiedene Beträge behauptet.
  if (order.total().cents !== row.total_amount_cents) {
    throw new InvalidArgumentError(
      'Der gespeicherte Gesamtbetrag der Bestellung passt nicht zu ihren Positionen.',
    );
  }

  return order;
}
