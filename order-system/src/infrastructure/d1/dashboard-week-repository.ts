import type { CostItem } from '../../domain/cost-summary';
import type { DashboardWeekOrder } from '../../domain/dashboard-week';
import { InvalidArgumentError } from '../../domain/errors';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';
import type { DashboardWeekItemRow, DashboardWeekOrderRow } from './rows';

/**
 * Die Datenbasis der Wochenübersicht — ZWEI Abfragen über sieben Tage.
 *
 * DAS IST DER GANZE GRUND, WARUM ES DIESE DATEI GIBT. Die naheliegende
 * Fassung — getDashboardDay() siebenmal in einer Schleife — hätte 14 Abfragen
 * gekostet, jede davon mit allen Positionen und Produkten eines Tages, für
 * eine Ansicht, die weder Positionen noch Produkte zeigt. Eine Wochenansicht,
 * die siebenmal so teuer ist wie eine Tagesansicht, ist die Sorte Bequemlichkeit,
 * die man erst bemerkt, wenn der Betrieb Bestellungen hat.
 *
 * Hier stehen stattdessen ZWEI Bereichsfilter über fulfillment_date. Sie
 * kosten dasselbe, ob die Woche leer ist oder voll — es gibt keine Schleife,
 * keine Abfrage je Tag und keine je Bestellung.
 *
 * WARUM ES SEIT PHASE 7B ZWEI SIND UND NICHT EINE. Herstellkosten stehen an
 * der POSITION und nicht an der Bestellung; ohne Positionszeilen gibt es
 * keinen Rohertrag, sondern nur eine Schätzung. Die zweite Abfrage ist der
 * Preis dafür — eine feste Zahl, keine wachsende: Sie kostet dasselbe bei
 * einer Bestellung wie bei vierhundert, und die Wochenansicht bleibt damit
 * billiger als eine einzige Tagesansicht plus Wochenübersicht zusammen.
 *
 * ES WERDEN FÜNF SPALTEN JE BESTELLUNG GELESEN und drei je Position: Kennung,
 * Liefertag, Status, Zahlungsstand, Betrag — und Bestellzugehörigkeit, Menge,
 * Kostenschnappschuss. Kein Kundenname, keine Bestellnummer, keine Adresse,
 * keine Notiz, kein Produktname, keine Einheit, kein Verkaufspreis. Die
 * Wochenansicht zeigt Zahlen je Tag; was sie nicht zeigt, lädt sie nicht. Ein
 * späteres „zeig doch schnell den Kunden mit an" muss hier vorbei und ist
 * damit eine Entscheidung und kein Versehen.
 *
 * ES WIRD NICHT AGGREGIERT. Kein SUM(), kein GROUP BY, kein COUNT — dieselbe
 * Regel wie im Tagesüberblick, und hier mit besonderem Gewicht: Ein SUM() in
 * SQL wäre eine zweite Fassung der Umsatzregel, und zwar eine, die den
 * Stornofilter als Zeichenkette im WHERE trüge. Die Woche würde dann eines
 * Tages einen anderen Umsatz melden als der Tag, den sie verlinkt. Gezählt
 * wird in domain/dashboard-week.ts, ohne Datenbank und vollständig geprüft.
 */

/**
 * Die Bestellungen einer Kalenderwoche.
 *
 * DER BEREICH IST BEIDSEITIG GESCHLOSSEN — `>= Montag AND <= Sonntag`. Ein
 * `< Montag + 7` wäre gleichwertig und läse sich als „bis irgendwann"; die
 * geschlossene Form nennt den Sonntag ausdrücklich und ist damit das, was
 * ein Test prüfen kann. Der vergessene Sonntag ist der klassische Fehler
 * dieser Art von Abfrage.
 *
 * Der Filter greift auf idx_orders_day (fulfillment_date, status) zu: Der
 * Index beginnt mit genau dieser Spalte, und ein Bereichsvergleich auf der
 * ersten Indexspalte ist ein Indexscan über die sieben Tage — kein
 * Tabellenscan. Geprüft wird das nicht hier, sondern mit EXPLAIN QUERY PLAN
 * im Test.
 *
 * ES GIBT KEIN ORDER BY, und das ist kein Vergessen: Die Aggregation summiert
 * und ist von der Reihenfolge unabhängig — jede Sortierung wäre reine Arbeit
 * für ein Ergebnis, das niemand sieht. Die Reihenfolge der sieben Tage
 * entsteht aus dem Kalender und nicht aus dieser Abfrage.
 */
const Q_ORDERS = `
  SELECT o.id, o.fulfillment_date, o.status, o.payment_status, o.total_amount_cents
    FROM orders o
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date <= ?
`;

/**
 * Die Kostenzeilen derselben Woche — DREI Spalten und kein Produkt.
 *
 * DER FILTER IST DERSELBE BEREICHSAUSDRUCK wie in Q1 und nicht eine Liste der
 * eben ermittelten Bestell-IDs — dieselbe Entscheidung wie im Tagesüberblick
 * und aus demselben Grund: Es bleibt bei ZWEI Abfragen je Woche, ob in ihr
 * eine Bestellung steht oder vierhundert. Keine Schleife, keine Abfrage je
 * Tag, keine je Bestellung.
 *
 * ES WIRD NICHT AUF products ODER catalog_products VERBUNDEN. Für die
 * Wochenansicht gibt es nichts, was von dort käme: keinen Namen, keine
 * Sortierung — und ganz besonders keinen HEUTIGEN Kostenwert. Gelesen wird
 * ausschließlich der Schnappschuss der Position; alles andere hieße, eine
 * Bestellung von Montag am Sonntag neu zu bewerten.
 *
 * ES GIBT KEIN ORDER BY. Gezählt wird summierend; jede Sortierung wäre Arbeit
 * für ein Ergebnis, das niemand sieht.
 *
 * KEIN STATUSFILTER IN SQL. Welche Bestellung zählt, entscheidet
 * countsTowardsRevenue() in der Domäne — an EINER Stelle für Umsatz und
 * Kosten. Ein `WHERE status <> 'cancelled'` hier wäre eine zweite Fassung der
 * Umsatzregel, und zwar eine als Zeichenkette.
 */
const Q_ITEMS = `
  SELECT i.order_id, i.quantity, i.unit_cost_cents_snapshot
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date <= ?
`;

/**
 * Die beiden Abfragen, nach außen sichtbar — damit ein Test DIESE prüft und
 * nicht eine Kopie. Dass es GENAU ZWEI sind, ist Vertrag: Die Zahl hängt
 * nicht daran, wie viele Tage, Bestellungen oder Positionen die Woche hat.
 */
export const DASHBOARD_WEEK_QUERIES = {
  orders: Q_ORDERS,
  items: Q_ITEMS,
} as const;

/**
 * Liefert alle Bestellungen einer Woche in ihrer schlanken Wochenform.
 *
 * Eine Woche ohne Bestellungen ergibt eine leere Liste — kein Fehler, sondern
 * eine ruhige Woche.
 */
export async function findDashboardWeekOrders(
  db: D1Database,
  monday: string,
  sunday: string,
): Promise<readonly DashboardWeekOrder[]> {
  const [orderZeilen, itemZeilen] = await Promise.all([
    db.prepare(Q_ORDERS).bind(monday, sunday).all<DashboardWeekOrderRow>(),
    db.prepare(Q_ITEMS).bind(monday, sunday).all<DashboardWeekItemRow>(),
  ]);

  // Die Zuordnung Position → Bestellung in linearer Zeit — dieselbe Bauart
  // wie im Tagesüberblick. Die Reihenfolge spielt für eine Summe keine Rolle.
  const positionen = new Map<number, CostItem[]>();
  for (const zeile of itemZeilen.results) {
    const position: CostItem = {
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

  return orderZeilen.results.map((zeile) => toWeekOrder(zeile, positionen.get(zeile.id)));
}

/**
 * Ein gespeicherter Kostenwert — oder „unbekannt".
 *
 * WÖRTLICH DIESELBE REGEL WIE IM TAGESÜBERBLICK, und sie steht hier ein
 * zweites Mal, weil sie hier ein zweites Mal gilt: Ein Wert, der nicht sein
 * kann, wird zu „unbekannt" und nicht zu einer Zahl. Er macht die Woche
 * unvollständig, statt eine falsche Marge zu erzeugen — und er bringt keine
 * Ansicht zum Erliegen.
 */
function leseKosten(cents: number | null): number | null {
  if (cents === null || !Number.isInteger(cents) || cents < 0) {
    return null;
  }
  return cents;
}

/**
 * Wandelt eine Zeile — und PRÜFT dabei, was das Schema bereits prüft.
 *
 * Dieselbe Regel wie im Tagesüberblick: Ein Wert aus D1 ist für TypeScript
 * zunächst nur ein `string`. Ohne diese beiden Prüfungen wären die
 * Zuweisungen an OrderStatus und PaymentStatus Behauptungen. Ein unbekannter
 * Wert — nur über einen Weg an den CHECK-Bedingungen vorbei denkbar — führt
 * hier zu einem Fehler und nicht zu einer Woche, die ihn stillschweigend als
 * „nicht storniert, nicht bezahlt" mitzählt.
 */
function toWeekOrder(
  zeile: DashboardWeekOrderRow,
  items: readonly CostItem[] | undefined,
): DashboardWeekOrder {
  if (!isOrderStatus(zeile.status)) {
    throw new InvalidArgumentError('Der gespeicherte Status der Bestellung ist unbekannt.');
  }
  if (!isPaymentStatus(zeile.payment_status)) {
    throw new InvalidArgumentError('Der gespeicherte Zahlungsstatus der Bestellung ist unbekannt.');
  }

  return {
    day: zeile.fulfillment_date,
    status: zeile.status,
    paymentStatus: zeile.payment_status,
    totalCents: zeile.total_amount_cents,
    /**
     * Eine Bestellung ohne Positionen ist eine leere Liste und kein Grund zu
     * scheitern — dieselbe Entscheidung wie im Tagesüberblick. Sie zählt dann
     * als Bestellung ohne fehlende Kosten: Es fehlt nichts, wo nichts steht.
     */
    items: items ?? [],
  };
}
