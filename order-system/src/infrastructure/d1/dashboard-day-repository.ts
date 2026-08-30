import type { DashboardOrder, DashboardOrderItem } from '../../domain/dashboard-day';
import { InvalidArgumentError } from '../../domain/errors';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';
import type { DashboardItemRow, DashboardOrderRow } from './rows';

/**
 * Die Datenbasis des Tagesüberblicks — zwei Abfragen, kein Umweg.
 *
 * Sie ist der Zwilling von production-day-repository.ts und unterscheidet
 * sich von ihm in genau zwei Punkten, die beide fachlich sind:
 *
 *   KEIN STATUSFILTER. Die Produktionsabfrage lässt nur die zwei bestätigten
 *   Produktionsstatus durch, weil eine Backliste nur zeigt, was angenommen
 *   wurde und noch zu backen ist. Der
 *   Überblick zeigt den GANZEN Tag: abgeschlossene Bestellungen, weil sie
 *   Umsatz sind, und stornierte, weil ihr Fehlen sonst wie ein Datenverlust
 *   aussähe. Gefiltert wird nicht in SQL, sondern in der Aggregation — und
 *   dort nur für die Summen, nicht für die Liste.
 *
 *   BETRÄGE. Die Produktionsabfrage liest bewusst keinen einzigen Cent; diese
 *   liest total_amount_cents, weil die Frage nach dem Umsatz ohne ihn nicht zu
 *   beantworten ist. Das ist keine Aufweichung der Datenminimierung, sondern
 *   ihr Gegenstück: Jede Abfrage liest, was ihre Frage braucht, und nichts
 *   darüber hinaus.
 *
 * WAS AUCH HIER NICHT GELESEN WIRD: Lieferadresse, Kundennotiz,
 * Positionspreise, submission_id, E-Mail, Telefon. customers wird gar nicht
 * verbunden — der Kundenname steht als Snapshot in der Bestellung. Was nicht
 * in der Abfrage steht, kann nicht versehentlich in einer Seite landen.
 *
 * FACHLICHE BETRÄGE WERDEN NICHT AGGREGIERT. Umsatz und Herstellkosten stehen
 * in domain/dashboard-day.ts, wo sie ohne Datenbank prüfbar sind. Die einzige
 * SQL-Aggregation zählt rein operative E-Mail-Zustände je Bestellung; sie
 * bildet weder Preise noch Kosten und dupliziert daher keine Geschäftsregel.
 */

/**
 * Q1 — welche Bestellungen an diesem Tag stehen.
 *
 * `customer_id` wird gelesen und `customer_name_snapshot` ebenfalls, und
 * beides hat einen eigenen Grund: Der Name ist der historische Wert, der
 * angezeigt wird; die Kennung ist der heutige Wert, über den Kunden GEZÄHLT
 * werden. Über den Namen zu zählen machte aus zwei gleichnamigen Cafés eines
 * und aus einem umbenannten zwei.
 *
 * ORDER BY: Bestellzeitpunkt, dann Bestellnummer. Der Zeitpunkt ist die
 * Reihenfolge, in der ein Betrieb seinen Tag erlebt; die Bestellnummer ist
 * UNIQUE und macht die Ordnung vollständig bestimmt, damit kein Test flattert.
 */
const Q_ORDERS = `
  SELECT o.id, o.order_number, o.customer_id, o.customer_name_snapshot,
         o.fulfillment_type, o.status, o.payment_status, o.total_amount_cents,
         o.created_at,
         COALESCE(e.notification_count, 0) AS email_notification_count,
         COALESCE(e.pending_count, 0) AS email_pending_count,
         COALESCE(e.failed_count, 0) AS email_failed_count
         , COALESCE(e.retryable_count, 0) AS email_retryable_count
    FROM orders o
    LEFT JOIN (
      SELECT order_id,
             COUNT(*) AS notification_count,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
             , SUM(CASE
                 WHEN status IN ('pending', 'failed') AND claim_token IS NULL THEN 1 ELSE 0
               END) AS retryable_count
        FROM email_outbox
       GROUP BY order_id
    ) e ON e.order_id = o.id
   WHERE o.fulfillment_date = ?
   ORDER BY o.created_at, o.order_number
`;

/**
 * Q2 — was in diesen Bestellungen steht.
 *
 * Der Filter ist DERSELBE Tagesausdruck wie in Q1 und nicht eine Liste der
 * eben ermittelten Bestell-IDs — dieselbe Entscheidung wie in
 * production-day-repository.ts und aus demselben Grund: Es bleibt bei ZWEI
 * Abfragen je Seite, ob der Tag eine Bestellung hat oder vierzig. Keine
 * Schleife, keine Abfrage je Position, keine je Produkt.
 *
 * Der JOIN auf products liest GENAU EINE Spalte: sort_order. Name und Einheit
 * kommen aus den Snapshot-Spalten der Position; ein Join auf products.name
 * würde die Regel aushebeln, die eine Umbenennung nicht rückwirkend wirken
 * lässt. Die Sortierreihenfolge dagegen ist eine Eigenschaft der Gegenwart.
 *
 * unit_price_cents und line_total_cents werden NICHT gelesen. Der Betrag
 * einer Bestellung steht in ihrem eigenen Snapshot; ihn hier ein zweites Mal
 * aus den Positionen bilden zu können wäre die Einladung, es zu tun.
 *
 * unit_cost_cents_snapshot WIRD GELESEN — seit Phase 7B, und es ist die
 * einzige Geldspalte dieser Abfrage. Der Unterschied zum Verkaufspreis ist
 * kein Geschmack: Der Positionspreis wäre eine zweite Fassung des
 * Gesamtbetrags, der Kostenwert ist die einzige Fassung einer Zahl, die
 * nirgendwo sonst steht. Herstellkosten hängen daran, WAS in einer
 * Bestellung liegt; aus `total_amount_cents` sind sie nicht abzuleiten.
 *
 * ER KOSTET KEINE ZUSÄTZLICHE ABFRAGE. Die Positionen werden ohnehin
 * geladen — für „Meistbestellt" und für die Zahl der Einheiten. Die
 * Kostenspalte reist in Zeilen mit, die es schon gibt; die Seite braucht
 * nach wie vor GENAU ZWEI Abfragen, ob der Tag eine Bestellung hat oder
 * vierzig.
 *
 * DER JOIN GEHT NICHT AUF catalog_products. Der HEUTIGE Kostenwert eines
 * Produkts hat in dieser Abfrage nichts zu suchen: Er würde eine Bestellung
 * von letzter Woche rückwirkend neu bewerten. Gelesen wird ausschließlich
 * der Schnappschuss aus der Position selbst.
 */
const Q_ITEMS = `
  SELECT i.order_id, i.product_id, i.product_name_snapshot,
         i.product_unit_snapshot, p.sort_order, i.quantity,
         i.unit_cost_cents_snapshot
    FROM order_items i
    JOIN orders   o ON o.id = i.order_id
    JOIN products p ON p.id = i.product_id
   WHERE o.fulfillment_date = ?
   ORDER BY i.order_id, p.sort_order, i.product_name_snapshot, i.product_id
`;

/**
 * Die beiden Abfragen, nach außen sichtbar — damit ein Test DIESE prüfen kann
 * und nicht eine Kopie, die irgendwann von ihnen abweicht. Dass es GENAU ZWEI
 * sind, ist Vertrag und keine Momentaufnahme.
 */
export const DASHBOARD_DAY_QUERIES = {
  orders: Q_ORDERS,
  items: Q_ITEMS,
} as const;

/**
 * Liefert alle Bestellungen eines Liefertages samt Positionen.
 *
 * Ein Tag ohne Bestellungen ergibt eine leere Liste — kein Fehler, sondern
 * ein ruhiger Tag.
 */
export async function findDashboardOrders(
  db: D1Database,
  day: string,
): Promise<readonly DashboardOrder[]> {
  const [orderZeilen, itemZeilen] = await Promise.all([
    db.prepare(Q_ORDERS).bind(day).all<DashboardOrderRow>(),
    db.prepare(Q_ITEMS).bind(day).all<DashboardItemRow>(),
  ]);

  // Die Zuordnung Position → Bestellung in linearer Zeit. Die Reihenfolge
  // innerhalb einer Bestellung bleibt die der Abfrage, weil push() anhängt.
  const positionen = new Map<number, DashboardOrderItem[]>();
  for (const zeile of itemZeilen.results) {
    const position: DashboardOrderItem = {
      productId: zeile.product_id,
      productName: zeile.product_name_snapshot,
      productUnit: zeile.product_unit_snapshot,
      sortOrder: zeile.sort_order,
      quantity: zeile.quantity,
      unitCostCents: leseKosten(zeile.unit_cost_cents_snapshot),
    };

    const liste = positionen.get(zeile.order_id);
    if (liste === undefined) {
      positionen.set(zeile.order_id, [position]);
    } else {
      liste.push(position);
    }
  }

  return orderZeilen.results.map((zeile) => toDashboardOrder(zeile, positionen.get(zeile.id)));
}

/**
 * Ein gespeicherter Kostenwert — oder „unbekannt".
 *
 * WARUM HIER NICHTS GEWORFEN WIRD, obwohl drei Zeilen weiter unten ein
 * unbekannter Status sehr wohl zum Fehler führt: Für einen kaputten Status
 * gibt es keine ehrliche Darstellung — jeder Wert, den man ersatzweise
 * einsetzte, wäre eine Behauptung. Für einen kaputten Kostenwert gibt es
 * genau eine, und sie steht ohnehin im Typ: `null` heißt „unbekannt".
 *
 * Der Ersatz fällt damit auf die SICHERE Seite. Eine negative oder gebrochene
 * Zahl aus der Spalte — nur über einen Weg an der CHECK-Bedingung aus 0017
 * vorbei denkbar — macht den Tag „nicht vollständig kalkuliert" und lässt
 * Rohertrag und Marge verschwinden. Sie kann keine falsche Marge erzeugen,
 * und sie bringt keine Tagesansicht zum Erliegen, die außer dieser einen
 * Zahl vollständig in Ordnung ist.
 */
function leseKosten(cents: number | null): number | null {
  if (cents === null || !Number.isInteger(cents) || cents < 0) {
    return null;
  }
  return cents;
}

/**
 * Wandelt eine Zeile in eine Bestellung — und PRÜFT dabei, was das Schema
 * bereits prüft.
 *
 * Ein Wert aus D1 ist für TypeScript zunächst nur ein `string`. Ohne diese
 * drei Prüfungen wären die Zuweisungen an OrderStatus, FulfillmentType und
 * PaymentStatus Behauptungen statt Prüfungen — dieselbe Regel, der
 * toProductionOrder() und toOrder() folgen.
 *
 * DER STATUSFILTER FEHLT HIER, und deshalb ist die Statusprüfung anders als
 * in der Produktionsabfrage tatsächlich ERREICHBAR: Diese Abfrage lässt jeden
 * gespeicherten Status durch. Ein unbekannter Wert in der Spalte — nur über
 * einen Weg an den CHECK-Bedingungen vorbei denkbar — führt hier zu einem
 * Fehler und nicht zu einer Seite, die ihn als Status anzeigt.
 *
 * DER GESAMTBETRAG WIRD NICHT GEGEN DIE POSITIONEN GEPRÜFT. Das
 * Order-Aggregat tut das (siehe order-repository.ts) und wirft bei einer
 * Abweichung — richtig für ein Dokument, das bearbeitet werden soll, falsch
 * für einen Überblick: Eine einzige beschädigte Zeile brächte sonst die ganze
 * Tagesansicht zum Erliegen, statt sie zu zeigen, damit jemand es merkt.
 */
function toDashboardOrder(
  zeile: DashboardOrderRow,
  items: readonly DashboardOrderItem[] | undefined,
): DashboardOrder {
  if (!isOrderStatus(zeile.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }
  if (!isFulfillmentType(zeile.fulfillment_type)) {
    throw new InvalidArgumentError('Der gespeicherte Fulfillment-Typ der Bestellung ist unbekannt.');
  }
  if (!isPaymentStatus(zeile.payment_status)) {
    throw new InvalidArgumentError('Der gespeicherte Zahlungsstatus der Bestellung ist unbekannt.');
  }

  const emailSummary = zeile.email_notification_count === 0
    ? undefined
    : {
        status: zeile.email_failed_count > 0
          ? 'failed' as const
          : zeile.email_pending_count > 0
            ? 'pending' as const
            : 'sent' as const,
        count: zeile.email_notification_count,
        canRetry: zeile.email_retryable_count > 0,
      };

  return {
    orderNumber: zeile.order_number,
    customerId: zeile.customer_id,
    customerName: zeile.customer_name_snapshot,
    status: zeile.status,
    paymentStatus: zeile.payment_status,
    fulfillmentType: zeile.fulfillment_type,
    totalCents: zeile.total_amount_cents,
    createdAt: zeile.created_at,
    /**
     * Eine Bestellung ohne Positionen ist eine leere Liste und kein Grund zu
     * scheitern — dieselbe Entscheidung wie in der Produktionsansicht. Eine
     * Tagesansicht, die eine Bestellung stillschweigend verschwinden lässt,
     * ist schlimmer als eine, die sie mit null Positionen zeigt.
     */
    items: items ?? [],
    ...(emailSummary === undefined ? {} : { emailSummary }),
  };
}
