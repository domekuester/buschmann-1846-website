import { InvalidArgumentError } from '../../domain/errors';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { OPEN_PRODUCTION_STATUSES, isOrderStatus } from '../../domain/order-status';
import type { ProductionOrder, ProductionOrderItem } from '../../domain/production-day';
import type { ProductionItemRow, ProductionOrderRow } from './rows';

/**
 * Die Datenbasis eines Produktionstags — zwei Abfragen, kein Umweg.
 *
 * Diese Datei kennt kein HTTP, keine Sitzung, kein Cookie und keine Rolle.
 * Sie bekommt einen bereits geprüften Kalendertag und liefert Zeilen. Wer
 * fragen darf, entscheidet die Wache in der HTTP-Schicht — hier noch einmal
 * zu prüfen wäre eine zweite Stelle, an der die Autorisierung stünde, und
 * damit eine, die irgendwann von der ersten abweicht.
 *
 * WAS HIER NICHT PASSIERT: Es wird nicht aggregiert. Summen sind eine
 * fachliche Regel und stehen in domain/production-day.ts, wo sie ohne
 * Datenbank prüfbar sind.
 *
 * DER PARAMETER HEISST `day` UND NICHT `date`. Ein Kalendertag ist kein
 * Zeitpunkt; die Unterscheidung ist dieselbe, die clock.ts trifft, und der
 * Grund, warum in dieser Datei kein einziges Date-Objekt vorkommt.
 */

/**
 * Die Platzhalter des IN-Ausdrucks — aus der LÄNGE der Statusliste erzeugt,
 * nicht abgeschrieben.
 *
 * Damit gibt es keinen Weg, OPEN_PRODUCTION_STATUSES zu ändern, ohne dass die
 * Abfrage folgt: Ein vierter Status erzeugt automatisch ein viertes '?', und
 * der Wert wird automatisch mitgebunden. Eine handgeschriebene Liste
 * `IN ('new', 'confirmed', 'in_production')` wäre eine zweite Fassung
 * derselben Regel — und die stille Sorte Fehler, bei der ein neuer Status
 * fachlich zählt, in der Abfrage aber fehlt.
 *
 * Die WERTE stammen ebenfalls aus dieser Liste, also aus Code. Sie kommen nie
 * aus einer Anfrage, und sie werden nie in den SQL-Text geschrieben — sie
 * werden gebunden wie jeder andere Wert auch.
 */
const STATUS_PLATZHALTER = OPEN_PRODUCTION_STATUSES.map(() => '?').join(', ');

/**
 * Q1 — welche Bestellungen es an diesem Tag gibt.
 *
 * KEIN JOIN AUF customers. Der Kundenname steht als Snapshot in der
 * Bestellung (Migration 0003) und ist dort auch der richtige Wert: Benennt
 * sich ein Café um, soll die Bestellung von letzter Woche nicht rückwirkend
 * anders heißen.
 *
 * Der angenehme Nebeneffekt ist Datenminimierung durch Bauart — E-Mail,
 * Telefon, Ansprechpartner und interne Notiz können auf diesem Weg nicht
 * abfließen, weil die Tabelle nicht gelesen wird.
 *
 * Ausdrücklich NICHT gelesen: id als Ausgabewert (sie wird nur zum Zuordnen
 * gebraucht und verlässt diese Datei nicht), customer_id, submission_id,
 * total_amount_cents, delivery_address_snapshot, created_at, updated_at.
 *
 * ORDER BY: Kundenname, dann Bestellnummer. Die Bestellnummer ist UNIQUE,
 * damit ist die Reihenfolge vollständig bestimmt und kein Test kann flattern.
 */
const Q_ORDERS = `
  SELECT id, order_number, customer_name_snapshot, fulfillment_type, note, status
    FROM orders
   WHERE fulfillment_date = ?
     AND status IN (${STATUS_PLATZHALTER})
   ORDER BY customer_name_snapshot, order_number
`;

/**
 * Q2 — was in diesen Bestellungen steht.
 *
 * Der Filter ist DERSELBE Tagesausdruck wie in Q1 und nicht eine Liste der
 * eben ermittelten Bestell-IDs. Beides wären zwei Abfragen; der Tagesausdruck
 * benutzt denselben Index, hat eine feste Zahl Platzhalter und braucht die
 * Kopplung an Q1 nicht.
 *
 * Damit sind es ZWEI Abfragen je Request — unabhängig davon, ob der Tag eine
 * Bestellung hat oder vierzig. Es gibt keine Schleife über Bestellungen,
 * keine Abfrage je Position, keine je Produkt und keine je Kunde.
 *
 * DER JOIN AUF products LIEST GENAU EINE SPALTE: sort_order. Name, Einheit
 * und Preis kommen aus den Snapshot-Spalten der Position — ein Join auf
 * products.name würde genau die Regel aushebeln, die eine Umbenennung nicht
 * rückwirkend wirken lässt. Die Sortierreihenfolge dagegen ist eine
 * Eigenschaft der Gegenwart („so ist unser Sortiment geordnet") und im
 * aktuellen Datensatz richtig aufgehoben.
 *
 * Der Join ist ein INNER JOIN und kann trotzdem keine Zeile verlieren:
 * order_items.product_id trägt einen Fremdschlüssel mit ON DELETE RESTRICT
 * (Migration 0004). Ein je bestelltes Produkt kann nicht verschwinden. Ein
 * LEFT JOIN hätte ein NULL in sort_order möglich gemacht und damit eine
 * Fallunterscheidung für einen Fall verlangt, den das Schema ausschließt.
 *
 * unit_price_cents und line_total_cents werden NICHT gelesen. Was nicht
 * geladen wird, kann nicht versehentlich serialisiert werden.
 */
const Q_ITEMS = `
  SELECT i.order_id, i.product_id, i.product_name_snapshot,
         i.product_unit_snapshot, p.sort_order, i.quantity
    FROM order_items i
    JOIN orders   o ON o.id = i.order_id
    JOIN products p ON p.id = i.product_id
   WHERE o.fulfillment_date = ?
     AND o.status IN (${STATUS_PLATZHALTER})
   ORDER BY i.order_id, p.sort_order, i.product_name_snapshot, i.product_id
`;

/**
 * Liefert die produktionsrelevanten Bestellungen eines Tages samt Positionen.
 *
 * Ein Tag ohne Bestellungen ergibt eine leere Liste — das ist kein Fehler,
 * sondern ein freier Tag.
 */
export async function findProductionOrders(
  db: D1Database,
  day: string,
): Promise<readonly ProductionOrder[]> {
  const parameter = [day, ...OPEN_PRODUCTION_STATUSES];

  const [orderZeilen, itemZeilen] = await Promise.all([
    db
      .prepare(Q_ORDERS)
      .bind(...parameter)
      .all<ProductionOrderRow>(),
    db
      .prepare(Q_ITEMS)
      .bind(...parameter)
      .all<ProductionItemRow>(),
  ]);

  /**
   * Die Zuordnung Position → Bestellung, in linearer Zeit.
   *
   * Die Reihenfolge innerhalb einer Bestellung bleibt dabei die der Abfrage,
   * weil push() anhängt und Q2 nach order_id sortiert ist.
   */
  const positionen = new Map<number, ProductionOrderItem[]>();
  for (const zeile of itemZeilen.results) {
    const liste = positionen.get(zeile.order_id);
    const position: ProductionOrderItem = {
      productId: zeile.product_id,
      productName: zeile.product_name_snapshot,
      productUnit: zeile.product_unit_snapshot,
      sortOrder: zeile.sort_order,
      quantity: zeile.quantity,
    };

    if (liste === undefined) {
      positionen.set(zeile.order_id, [position]);
    } else {
      liste.push(position);
    }
  }

  return orderZeilen.results.map((zeile) => toProductionOrder(zeile, positionen.get(zeile.id)));
}

/**
 * Wandelt eine Zeile in eine Bestellung — und prüft dabei, was das Schema
 * bereits prüft.
 *
 * Ein Wert aus D1 ist für TypeScript zunächst nur ein `string`. Ohne diese
 * Prüfungen wären die Zuweisungen an `OrderStatus` und `FulfillmentType`
 * Behauptungen statt Prüfungen. toOrder() im Order-Repository verfährt
 * genauso.
 *
 * DIE BEIDEN PRÜFUNGEN SIND UNTERSCHIEDLICH ERREICHBAR, und das ist kein
 * Versehen:
 *
 *   fulfillment_type  wird von der Abfrage NICHT gefiltert. Ein unbekannter
 *                     Wert käme durch, wenn er hier nicht abgefangen würde.
 *                     Dieser Fall ist getestet.
 *
 *   status            kann diese Abfrage gar nicht verlassen — der IN-Filter
 *                     lässt ausschließlich die drei produktionsrelevanten
 *                     Werte durch. Die Prüfung ist damit über die Abfrage
 *                     unerreichbar und bleibt trotzdem stehen: Sie ist die
 *                     Stelle, an der die Verengung stattfindet, und sie ist
 *                     die Absicherung für den Tag, an dem jemand den Filter
 *                     ändert.
 */
function toProductionOrder(
  zeile: ProductionOrderRow,
  items: readonly ProductionOrderItem[] | undefined,
): ProductionOrder {
  if (!isOrderStatus(zeile.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }
  if (!isFulfillmentType(zeile.fulfillment_type)) {
    throw new InvalidArgumentError('Der gespeicherte Fulfillment-Typ der Bestellung ist unbekannt.');
  }

  return {
    orderNumber: zeile.order_number,
    customerName: zeile.customer_name_snapshot,
    status: zeile.status,
    fulfillmentType: zeile.fulfillment_type,
    note: zeile.note,
    /**
     * Eine Bestellung ohne Positionen ist eine leere Liste und kein Grund zu
     * scheitern. Das Order-Aggregat verlangt mindestens eine Position, das
     * Schema aber nicht — und eine Tagesübersicht, die eine Bestellung
     * stillschweigend verschwinden lässt, ist schlimmer als eine, die sie mit
     * null Positionen zeigt.
     */
    items: items ?? [],
  };
}
