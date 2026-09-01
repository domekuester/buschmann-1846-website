import type {
  AnalyticsCustomerGroup,
  AnalyticsInput,
  AnalyticsItemGroup,
  AnalyticsOrderGroup,
  AnalyticsProductGroup,
  AnalyticsSegmentGroup,
} from '../../domain/analytics';
import { InvalidArgumentError } from '../../domain/errors';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';

/**
 * Die Datenbasis der Auswertung — FÜNF Abfragen, und immer dieselben fünf.
 *
 * DIE ZAHL HÄNGT AN NICHTS. Nicht an der Zahl der Tage, nicht an der Zahl der
 * Bestellungen, nicht an der Zahl der Produkte oder Kunden. Ein Jahr kostet
 * dieselben fünf Abfragen wie ein Tag. Das ist der Unterschied zwischen
 * dieser Datei und der naheliegenden Fassung, die den Tagesüberblick in einer
 * Schleife aufruft — 365 Tage × 2 Abfragen wären 730, und zwar für eine
 * Seite, die niemand als teuer wahrnimmt.
 *
 * HIER WIRD AGGREGIERT, UND DAS IST DER UNTERSCHIED ZUM WOCHENREPOSITORY.
 * Die Wochenübersicht liest sieben Tage Rohzeilen und zählt in der Domäne;
 * bei einem Jahr wären das jede Bestellung und jede Position des Jahres im
 * Arbeitsspeicher eines Workers — für eine Seite, die davon sechs Zahlen und
 * zwei Listen mit je sechs Zeilen zeigt.
 *
 * DIE UMSATZREGEL BLEIBT TROTZDEM IN DER DOMÄNE. Der Trick dabei ist eine
 * einzige Entscheidung, und sie ist die wichtigste dieser Datei: Es wird
 * NACH dem Status GRUPPIERT und nicht nach ihm GEFILTERT. Kein
 * `WHERE status <> 'cancelled'`, nirgends. Was zählt, entscheidet
 * countsTowardsRevenue() in domain/analytics.ts — die Abfragen liefern die
 * stornierten Zeilen mit, und die Domäne wirft sie weg. Ein Statusfilter in
 * SQL wäre eine zweite Fassung der Umsatzregel als Zeichenkette, und zwar
 * eine, die kein Domänentest je zu Gesicht bekommt.
 *
 * `i.cancelled_at IS NULL` STEHT TROTZDEM IN SQL. Das ist kein Widerspruch —
 * dieselbe Unterscheidung wie im Wochenrepository: Ob eine BESTELLUNG zählt,
 * ist eine fachliche Regel mit einem Namen. Ob eine POSITIONSZEILE noch zur
 * Bestellung gehört, ist die Frage, welche Zeilen es überhaupt gibt, und die
 * beantwortet die Abfrage.
 *
 * `order_item_changes` KOMMT HIER NICHT VOR. Die Änderungshistorie ist ein
 * Protokoll; sie zu summieren hieße, jede nachträgliche Mengenänderung als
 * zusätzlichen Verkauf zu melden. Ein Test prüft, dass der Tabellenname in
 * keiner dieser fünf Abfragen steht.
 *
 * ALLE BEREICHE SIND HALBOFFEN — `>= ? AND < ?`. Der Endtag gehört NICHT
 * dazu. Die geschlossene Form der Wochenübersicht ist für sieben feste Tage
 * richtig; hier stoßen Monate und Jahre aneinander, und der doppelt gezählte
 * Randtag ist der klassische Fehler einer Auswertung.
 */

/**
 * Bestellungen je Tag, Status und Zahlungsstand.
 *
 * `total_amount_cents` IST DER AKTUELLE AKTIVE BETRAG. Er wird bei jeder
 * Positionsänderung aus `SUM(line_total_cents) WHERE cancelled_at IS NULL`
 * neu gebildet (application/edit-order-item.ts) und besteht aus den
 * Preisschnappschüssen der Bestellung. Es gibt deshalb keinen Grund, den
 * Umsatz hier aus den Positionen neu zusammenzusetzen — und einen guten
 * Grund, es nicht zu tun: Zwei Rechenwege für dieselbe Zahl sind zwei
 * Meinungen darüber, was eine Bestellung gekostet hat.
 *
 * Der Bereichsfilter greift auf idx_orders_day (fulfillment_date, status) zu.
 * Geprüft wird das nicht hier, sondern mit EXPLAIN QUERY PLAN im Test.
 */
const Q_ORDERS = `
  SELECT o.fulfillment_date AS day,
         o.status           AS status,
         o.payment_status   AS payment_status,
         COUNT(*)           AS order_count,
         SUM(o.total_amount_cents) AS revenue_cents
    FROM orders o
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date < ?
   GROUP BY o.fulfillment_date, o.status, o.payment_status
`;

/**
 * Stück und Herstellkosten — ZWEI Gruppierungen übereinander.
 *
 * DIE INNERE FASST JE BESTELLUNG ZUSAMMEN, die äußere je Tag und Status.
 * Der Umweg hat genau einen Grund, und er heißt `missing_order_count`:
 * „Bei drei Bestellungen fehlen Kosten" ist eine Aussage über Bestellungen
 * und lässt sich aus einer flachen Positionssumme nicht mehr gewinnen. Ohne
 * die innere Gruppierung müsste man dafür eine sechste Abfrage stellen.
 *
 * EIN FEHLENDER KOSTENWERT WIRD NICHT ZU 0. Er erhöht `missing_item_count`,
 * und seine Position trägt zu `known_cost_cents` nichts bei. Das ist der
 * Unterschied zwischen „wir wissen es nicht" und „es kostet nichts" — und
 * genau der Unterschied, an dem eine erfundene Marge entsteht.
 */
const Q_ITEMS = `
  SELECT day,
         status,
         SUM(units)              AS units,
         SUM(known_cost_cents)   AS known_cost_cents,
         SUM(item_count)         AS item_count,
         SUM(missing_item_count) AS missing_item_count,
         COUNT(*)                AS order_count,
         SUM(CASE WHEN missing_item_count > 0 THEN 1 ELSE 0 END) AS missing_order_count
    FROM (
      SELECT o.fulfillment_date AS day,
             o.status           AS status,
             SUM(i.quantity)    AS units,
             SUM(CASE WHEN i.unit_cost_cents_snapshot IS NULL
                      THEN 0
                      ELSE i.unit_cost_cents_snapshot * i.quantity END) AS known_cost_cents,
             COUNT(*)           AS item_count,
             SUM(CASE WHEN i.unit_cost_cents_snapshot IS NULL THEN 1 ELSE 0 END) AS missing_item_count
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
       WHERE o.fulfillment_date >= ? AND o.fulfillment_date < ?
         AND i.cancelled_at IS NULL
       GROUP BY i.order_id
    )
   GROUP BY day, status
`;

/**
 * Die Produkte des Zeitraums — aus den SCHNAPPSCHÜSSEN der Positionen.
 *
 * ES WIRD NICHT AUF products ODER catalog_products VERBUNDEN, und das ist
 * die eigentliche Aussage dieser Abfrage: Name, Einheit und Preis kommen aus
 * der Bestellung, so wie sie damals war. Der heutige Katalogpreis kommt in
 * dieser Datei nicht vor. Eine Auswertung, die vergangene Monate mit den
 * Preisen von heute bewertet, schreibt Geschichte um.
 *
 * `MAX(i.id)` ENTSCHEIDET BEI EINER UMBENENNUNG, welcher Name gilt — die
 * Auswahl selbst trifft die Domäne. Hier steht nur die Zahl, an der sie es
 * festmachen kann.
 */
const Q_PRODUCTS = `
  SELECT i.product_id            AS product_id,
         i.product_name_snapshot AS name,
         i.product_unit_snapshot AS unit,
         o.status                AS status,
         MAX(i.id)               AS latest_item_id,
         SUM(i.quantity)         AS units,
         SUM(i.line_total_cents) AS revenue_cents
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date < ?
     AND i.cancelled_at IS NULL
   GROUP BY i.product_id, i.product_name_snapshot, i.product_unit_snapshot, o.status
`;

/**
 * Die Kunden des Zeitraums — ebenfalls aus dem Schnappschuss.
 *
 * ES WIRD NICHT AUF customers VERBUNDEN. Gebraucht wird der Name, unter dem
 * bestellt wurde, und der steht in der Bestellung. Ein JOIN brächte
 * Anschrift, Kontaktperson, Telefonnummer und interne Notiz in die
 * Reichweite dieser Abfrage — nichts davon zeigt eine Rangliste, und was
 * eine Seite nicht zeigt, soll sie nicht laden.
 */
const Q_CUSTOMERS = `
  SELECT o.customer_id             AS customer_id,
         o.customer_name_snapshot  AS name,
         o.status                  AS status,
         MAX(o.id)                 AS latest_order_id,
         COUNT(*)                  AS order_count,
         SUM(o.total_amount_cents) AS revenue_cents
    FROM orders o
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date < ?
   GROUP BY o.customer_id, o.customer_name_snapshot, o.status
`;

/**
 * Die beiden leisen Aufteilungen in EINER Abfrage.
 *
 * Zustellart und Preisgruppe gemeinsam zu gruppieren kostet höchstens
 * 2 × 3 × 5 Zeilen und spart eine ganze Abfrage. Die Domäne bildet daraus
 * zwei getrennte Aufteilungen.
 *
 * DIE PREISGRUPPE IST EINE VERBINDUNG UND KEIN SCHNAPPSCHUSS. Das System
 * führt keine Historie der Preislistenzuordnung; `LEFT JOIN` sagt hier
 * ausdrücklich, dass ein Kunde auch keine haben darf — dann steht NULL, und
 * die Oberfläche nennt es „Ohne Preisgruppe" statt ihn stillschweigend zu
 * den Gastronomen zu zählen.
 */
const Q_SEGMENTS = `
  SELECT o.fulfillment_type       AS fulfillment_type,
         l.code                   AS price_group_code,
         o.status                 AS status,
         COUNT(*)                 AS order_count,
         SUM(o.total_amount_cents) AS revenue_cents
    FROM orders o
    LEFT JOIN customers   c ON c.id = o.customer_id
    LEFT JOIN price_lists l ON l.id = c.price_list_id
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date < ?
   GROUP BY o.fulfillment_type, l.code, o.status
`;

/**
 * Die fünf Abfragen, nach außen sichtbar — damit ein Test DIESE prüft und
 * nicht eine Kopie. Dass es genau fünf sind, ist Vertrag.
 */
export const ANALYTICS_QUERIES = {
  orders: Q_ORDERS,
  items: Q_ITEMS,
  products: Q_PRODUCTS,
  customers: Q_CUSTOMERS,
  segments: Q_SEGMENTS,
} as const;

interface OrderRow {
  day: string;
  status: string;
  payment_status: string;
  order_count: number;
  revenue_cents: number;
}

interface ItemRow {
  day: string;
  status: string;
  units: number;
  known_cost_cents: number;
  item_count: number;
  missing_item_count: number;
  order_count: number;
  missing_order_count: number;
}

interface ProductRow {
  product_id: number;
  name: string;
  unit: string;
  status: string;
  latest_item_id: number;
  units: number;
  revenue_cents: number;
}

interface CustomerRow {
  customer_id: number;
  name: string;
  status: string;
  latest_order_id: number;
  order_count: number;
  revenue_cents: number;
}

interface SegmentRow {
  fulfillment_type: string;
  price_group_code: string | null;
  status: string;
  order_count: number;
  revenue_cents: number;
}

/**
 * Liest die fünf Gruppierungen.
 *
 * ZWEI BEREICHE UND NICHT EINER: Kurve und Vergleichszeitraum brauchen einen
 * weiteren Blick zurück als der gewählte Zeitraum selbst, die beiden
 * Ranglisten und die Aufteilungen aber ausdrücklich nicht — eine Topliste
 * über „September plus August plus die Kurve" wäre schlicht falsch. Der
 * weite Bereich gilt für Bestell- und Positionszeilen, der enge für den
 * Rest. Beide werden vom Aufrufer aus demselben ReportingPeriod gebildet.
 *
 * ALLE FÜNF LAUFEN GLEICHZEITIG. Sie hängen nicht voneinander ab; nacheinander
 * zu warten wäre fünfmal die Umlaufzeit für dasselbe Ergebnis.
 */
export async function findAnalyticsGroups(
  db: D1Database,
  queryStart: string,
  queryEnd: string,
  periodStart: string,
  periodEnd: string,
): Promise<AnalyticsInput> {
  const [orders, items, products, customers, segments] = await Promise.all([
    db.prepare(Q_ORDERS).bind(queryStart, queryEnd).all<OrderRow>(),
    db.prepare(Q_ITEMS).bind(queryStart, queryEnd).all<ItemRow>(),
    db.prepare(Q_PRODUCTS).bind(periodStart, periodEnd).all<ProductRow>(),
    db.prepare(Q_CUSTOMERS).bind(periodStart, periodEnd).all<CustomerRow>(),
    db.prepare(Q_SEGMENTS).bind(periodStart, periodEnd).all<SegmentRow>(),
  ]);

  return {
    orders: orders.results.map(toOrderGroup),
    items: items.results.map(toItemGroup),
    products: products.results.map(toProductGroup),
    customers: customers.results.map(toCustomerGroup),
    segments: segments.results.map(toSegmentGroup),
  };
}

/**
 * Wandelt eine Zeile — und PRÜFT dabei, was das Schema bereits prüft.
 *
 * Dieselbe Regel wie im Wochenrepository: Ein Wert aus D1 ist für TypeScript
 * zunächst nur ein `string`. Ohne diese Prüfungen wären die Zuweisungen an
 * OrderStatus, PaymentStatus und FulfillmentType Behauptungen — und ein
 * unbekannter Status käme als „nicht storniert" in den Umsatz.
 */
function toOrderGroup(row: OrderRow): AnalyticsOrderGroup {
  return {
    day: row.day,
    status: pruefeStatus(row.status),
    paymentStatus: pruefeZahlungsstand(row.payment_status),
    orderCount: row.order_count,
    revenueCents: row.revenue_cents,
  };
}

function toItemGroup(row: ItemRow): AnalyticsItemGroup {
  return {
    day: row.day,
    status: pruefeStatus(row.status),
    units: row.units,
    knownCostCents: row.known_cost_cents,
    itemCount: row.item_count,
    missingItemCount: row.missing_item_count,
    orderCount: row.order_count,
    missingOrderCount: row.missing_order_count,
  };
}

function toProductGroup(row: ProductRow): AnalyticsProductGroup {
  return {
    productId: row.product_id,
    name: row.name,
    unit: row.unit,
    status: pruefeStatus(row.status),
    latestItemId: row.latest_item_id,
    units: row.units,
    revenueCents: row.revenue_cents,
  };
}

function toCustomerGroup(row: CustomerRow): AnalyticsCustomerGroup {
  return {
    customerId: row.customer_id,
    name: row.name,
    status: pruefeStatus(row.status),
    latestOrderId: row.latest_order_id,
    orderCount: row.order_count,
    revenueCents: row.revenue_cents,
  };
}

function toSegmentGroup(row: SegmentRow): AnalyticsSegmentGroup {
  if (!isFulfillmentType(row.fulfillment_type)) {
    throw new InvalidArgumentError('Die gespeicherte Zustellart der Bestellung ist unbekannt.');
  }
  return {
    fulfillmentType: row.fulfillment_type,
    priceGroupCode: row.price_group_code,
    status: pruefeStatus(row.status),
    orderCount: row.order_count,
    revenueCents: row.revenue_cents,
  };
}

function pruefeStatus(value: string) {
  if (!isOrderStatus(value)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }
  return value;
}

function pruefeZahlungsstand(value: string) {
  if (!isPaymentStatus(value)) {
    throw new InvalidArgumentError('Der gespeicherte Zahlungsstatus der Bestellung ist unbekannt.');
  }
  return value;
}
