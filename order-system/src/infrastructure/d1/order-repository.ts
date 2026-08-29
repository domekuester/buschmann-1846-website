import { InvalidArgumentError } from '../../domain/errors';
import { FulfillmentDate } from '../../domain/fulfillment-date';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { Money } from '../../domain/money';
import { Order } from '../../domain/order';
import { OrderItem } from '../../domain/order-item';
import { OrderNumber } from '../../domain/order-number';
import { unitCostFromCents } from '../../domain/product-cost';
import { isOrderStatus, type OrderStatus } from '../../domain/order-status';
import type { PaymentStatus } from '../../domain/payment-status';
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
                                  unit_price_cents, quantity, line_total_cents,
                                  unit_cost_cents_snapshot)
              VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        order.orderNumber.value,
        item.productId,
        item.productNameSnapshot,
        item.productUnitSnapshot,
        item.unitPrice.cents,
        item.quantity,
        item.lineTotal.cents,
        /**
         * Der Kostenschnappschuss — aus der POSITION und aus nichts sonst.
         *
         * Es gibt in dieser Datei keine Abfrage auf catalog_products und
         * keinen Parameter für einen Kostenwert. Was hier geschrieben wird,
         * hat Order.place() aus dem Kostenbuch übernommen; ein `null` ist
         * dabei ein Wert und kein fehlendes Argument (§3, §9).
         */
        item.unitCostSnapshot === null ? null : item.unitCostSnapshot.cents,
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
      `SELECT product_id, product_name_snapshot, product_unit_snapshot, unit_price_cents, quantity,
              unit_cost_cents_snapshot
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
        /**
         * Ebenso der Kostenschnappschuss: aus der Position und niemals aus
         * catalog_products. Ein JOIN auf den heutigen Kostenwert wäre genau
         * die Regel, gegen die Migration 0017 antritt — eine spätere
         * Kostenänderung schriebe sonst die Vergangenheit um.
         */
        unitCost: unitCostFromCents(item.unit_cost_cents_snapshot),
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

/**
 * Was ein Statuswechsel schreiben darf — und die Feldliste IST die Regel.
 *
 * Es gibt keinen Parameter für Kunde, Liefertag, Notiz, Betrag oder
 * Positionen, weil es für sie keine Anweisung gibt: Der UPDATE unten nennt
 * ausschließlich Status, technischen Update-Zeitpunkt und die beiden
 * Last-Change-Auditfelder. Eine weitere Spalte wäre eine bewusste Änderung an
 * dieser Datei und kein Nebeneffekt eines Aufrufers.
 */
export interface OrderStatusUpdate {
  readonly orderNumber: string;
  /**
   * Der Status, gegen den die Domäne den Übergang geprüft hat.
   *
   * Er ist kein Protokollwert, sondern eine BEDINGUNG — siehe unten.
   */
  readonly expectedStatus: OrderStatus;
  readonly newStatus: OrderStatus;
  readonly updatedAt: string;
  readonly actorAccountId: number;
  readonly statusChangedAt: string;
}

/**
 * Setzt den Status einer Bestellung — aber nur, wenn sie noch dort steht, wo
 * der Aufrufer sie gelesen hat.
 *
 * DAS `AND status = ?` IST DER GANZE PUNKT DIESER FUNKTION.
 *
 * Zwischen dem Lesen einer Bestellung und ihrem Schreiben liegt Zeit, und in
 * dieser Zeit kann ein zweiter Adminbrowser dieselbe Bestellung weitergesetzt
 * haben. Ein UPDATE nur über die Bestellnummer würde diese Änderung still
 * überschreiben: Admin A hätte gegen „bestätigt" geprüft und auf einen Stand
 * geschrieben, den es nicht mehr gibt — und beide Oberflächen zeigten
 * anschließend einen Erfolg an, obwohl eine der beiden Entscheidungen
 * verschwunden ist.
 *
 * Mit der Bedingung ist der Fall entschieden, bevor er entsteht: Passt der
 * Ausgangsstatus nicht mehr, trifft die Anweisung keine Zeile, und der
 * Rückgabewert sagt das. Das ist optimistische Nebenläufigkeit im kleinsten
 * möglichen Umfang — eine zusätzliche Spalte in der WHERE-Klausel. Kein Lock,
 * kein Durable Object, keine Warteschlange, keine Versionsspalte und damit
 * auch keine Versionsspalte.
 *
 * DER RÜCKGABEWERT IST `changes` UND NICHT `success`. D1 meldet eine
 * erfolgreich AUSGEFÜHRTE Anweisung auch dann als erfolgreich, wenn sie null
 * Zeilen betroffen hat — genau der Fall, um den es hier geht. Nur die Anzahl
 * geänderter Zeilen unterscheidet „geschrieben" von „nicht mehr zuständig".
 *
 * Ein Ergebnis größer eins kann es nicht geben: order_number ist UNIQUE
 * (Migration 0003). Der Vergleich auf genau 1 hält das fest, statt sich darauf
 * zu verlassen.
 */
export async function updateOrderStatus(
  db: D1Database,
  update: OrderStatusUpdate,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE orders
          SET status = ?,
              updated_at = ?,
              status_changed_by_account_id = ?,
              status_changed_at = ?
        WHERE order_number = ?
          AND status = ?`,
    )
    .bind(
      update.newStatus,
      update.updatedAt,
      update.actorAccountId,
      update.statusChangedAt,
      update.orderNumber,
      update.expectedStatus,
    )
    .run();

  return meta.changes === 1;
}

/**
 * Was ein Zahlungseintrag schreiben darf — und die Feldliste IST die Regel,
 * genau wie bei OrderStatusUpdate.
 *
 * Es gibt keinen Parameter für Betrag, Kunde, Liefertag, Positionen oder
 * Produktionsstatus, weil der UPDATE unten sie nicht nennt. Eine weitere
 * Spalte wäre eine bewusste Änderung an dieser Datei und kein Nebeneffekt
 * eines Aufrufers — und ein Betragsfeld an dieser Stelle wäre der Anfang
 * eines Kassensystems.
 */
export interface OrderPaymentUpdate {
  readonly orderNumber: string;
  readonly paymentStatus: PaymentStatus;
  /**
   * Der Zeitpunkt des Eintrags — oder null.
   *
   * Er wird HIER NICHT ABGELEITET. Welcher Wert zu welchem Status gehört,
   * entscheidet paymentRecordedAtFor() in der Domäne; diese Datei schreibt,
   * was sie bekommt. Zwei Stellen mit derselben Regel wären eine zu viel —
   * und die CHECK-Bedingung aus Migration 0015 fängt eine Abweichung ab,
   * statt sie zu speichern.
   */
  readonly paymentRecordedAt: string | null;
  readonly updatedAt: string;
}

/**
 * Trägt den Zahlungsstand einer Bestellung ein.
 *
 * KEIN BEDINGTER UPDATE, ANDERS ALS BEIM STATUSWECHSEL — und das ist eine
 * fachliche Entscheidung, keine Nachlässigkeit.
 *
 * Beim Status ist das `AND status = ?` der ganze Punkt: Dort gibt es einen
 * Lebenszyklus, und zwei gleichzeitige Admins könnten eine Bestellung an
 * verschiedene Stellen dieses Zyklus setzen — der verlorene Schreibvorgang
 * wäre eine verschwundene Entscheidung.
 *
 * Der Zahlungsstand hat keinen Lebenszyklus. Er ist ein EINTRAG: „ich habe
 * gerade gesehen, dass bar bezahlt wurde." Wenn zwei Leute nacheinander
 * eintragen, ist der letzte Eintrag der richtige — er ist der jüngere Blick
 * auf denselben Sachverhalt. Ein Konflikt mit einer Fehlerseite zwänge hier
 * jemanden, eine Seite neu zu laden, um dasselbe noch einmal einzutragen.
 *
 * Der Rückgabewert ist trotzdem `changes === 1` und nicht `void`: Er
 * unterscheidet „geschrieben" von „diese Bestellnummer gibt es nicht".
 * order_number ist UNIQUE (Migration 0003), mehr als eine Zeile kann es
 * nicht sein.
 */
export async function updateOrderPayment(
  db: D1Database,
  update: OrderPaymentUpdate,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE orders
          SET payment_status = ?,
              payment_recorded_at = ?,
              updated_at = ?
        WHERE order_number = ?`,
    )
    .bind(
      update.paymentStatus,
      update.paymentRecordedAt,
      update.updatedAt,
      update.orderNumber,
    )
    .run();

  return meta.changes === 1;
}

/**
 * Der Liefertag einer Bestellung — und sonst nichts.
 *
 * WOZU EINE EIGENE ABFRAGE, WO ES findOrderByNumber() GIBT: Jene lädt das
 * ganze Aggregat samt Positionen, prüft den Gesamtbetrag gegen die Summe der
 * Positionen und wirft, wenn beides nicht zusammenpasst. Für einen
 * Zahlungseintrag wäre das zweierlei zu viel — eine zweite Abfrage für
 * Positionen, die niemand braucht, und eine Prüfung, die den Eintrag an einer
 * Bestellung verhindern würde, die man gerade deswegen anfassen will.
 *
 * WOZU ÜBERHAUPT: Nach dem Eintrag muss die Oberfläche auf den Tag
 * zurückführen, auf dem die Bestellung steht. Dieser Tag kommt aus der
 * DATENBANK und niemals aus der Anfrage — sonst wäre das Rückkehrziel vom
 * Aufrufer bestimmt, und genau daraus entsteht ein Open Redirect.
 */
export async function findOrderFulfillmentDate(
  db: D1Database,
  orderNumber: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT fulfillment_date FROM orders WHERE order_number = ?')
    .bind(orderNumber)
    .first<{ fulfillment_date: string }>();

  return row === null ? null : row.fulfillment_date;
}
