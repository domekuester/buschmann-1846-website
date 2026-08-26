import type { DashboardWeekOrder } from '../../domain/dashboard-week';
import { InvalidArgumentError } from '../../domain/errors';
import { isOrderStatus } from '../../domain/order-status';
import { isPaymentStatus } from '../../domain/payment-status';
import type { DashboardWeekOrderRow } from './rows';

/**
 * Die Datenbasis der Wochenübersicht — EINE Abfrage über sieben Tage.
 *
 * DAS IST DER GANZE GRUND, WARUM ES DIESE DATEI GIBT. Die naheliegende
 * Fassung — getDashboardDay() siebenmal in einer Schleife — hätte 14 Abfragen
 * gekostet, jede davon mit allen Positionen und Produkten eines Tages, für
 * eine Ansicht, die weder Positionen noch Produkte zeigt. Eine Wochenansicht,
 * die siebenmal so teuer ist wie eine Tagesansicht, ist die Sorte Bequemlichkeit,
 * die man erst bemerkt, wenn der Betrieb Bestellungen hat.
 *
 * Hier steht stattdessen EIN Bereichsfilter über fulfillment_date. Er kostet
 * dasselbe, ob die Woche leer ist oder voll — es gibt keine Schleife, keine
 * Abfrage je Tag und keine je Bestellung.
 *
 * ES WERDEN VIER SPALTEN GELESEN und keine fünfte: Liefertag, Status,
 * Zahlungsstand, Betrag. Kein Kundenname, keine Bestellnummer, keine Adresse,
 * keine Notiz, keine Position. Die Wochenansicht zeigt Zahlen je Tag; was sie
 * nicht zeigt, lädt sie nicht. Ein späteres „zeig doch schnell den Kunden mit
 * an" muss hier vorbei und ist damit eine Entscheidung und kein Versehen.
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
  SELECT o.fulfillment_date, o.status, o.payment_status, o.total_amount_cents
    FROM orders o
   WHERE o.fulfillment_date >= ? AND o.fulfillment_date <= ?
`;

/**
 * Die Abfrage, nach außen sichtbar — damit ein Test DIESE prüft und nicht
 * eine Kopie. Dass es GENAU EINE ist, ist Vertrag.
 */
export const DASHBOARD_WEEK_QUERIES = {
  orders: Q_ORDERS,
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
  const { results } = await db
    .prepare(Q_ORDERS)
    .bind(monday, sunday)
    .all<DashboardWeekOrderRow>();

  return results.map(toWeekOrder);
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
function toWeekOrder(zeile: DashboardWeekOrderRow): DashboardWeekOrder {
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
  };
}
