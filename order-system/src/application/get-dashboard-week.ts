import { aggregateDashboardWeek, type DashboardWeek } from '../domain/dashboard-week';
import { plusDays } from '../domain/clock';
import { findDashboardWeekOrders } from '../infrastructure/d1/dashboard-week-repository';

/**
 * „Wie voll ist diese Woche?"
 *
 * Kurz, und das ist die Absicht — dieselbe wie bei getDashboardDay(): Die
 * Abfrage weiß, WELCHE Bestellungen in den Zeitraum fallen; die Aggregation
 * weiß, WIE gezählt wird. Stünde hier Logik, gäbe es eine dritte Stelle mit
 * Regeln.
 *
 * DER MONTAG WIRD ÜBERGEBEN UND NICHT ABGELEITET. Kein „diese Woche", kein
 * Date.now(): Ein Anwendungsfall, dessen Antwort davon abhängt, wann er
 * aufgerufen wird, wäre am Sonntag um 23:59 Uhr etwas anderes als am Montag um
 * 00:01 Uhr. Welche Woche gemeint ist, entscheidet die Oberfläche über
 * weekStart().
 *
 * DER SONNTAG WIRD HIER GEBILDET und nicht ein zweites Mal von der HTTP-Schicht
 * mitgegeben. Zwei Aufrufer, die beide selbst „Montag plus sechs" rechnen,
 * wären zwei Gelegenheiten, den Sonntag zu verlieren — und ein fehlender
 * Sonntag fällt in einer Wochenübersicht genau einmal pro Woche auf.
 *
 * READ ONLY.
 */
export async function getDashboardWeek(db: D1Database, monday: string): Promise<DashboardWeek> {
  const sunday = plusDays(monday, 6);
  const orders = await findDashboardWeekOrders(db, monday, sunday);

  return aggregateDashboardWeek(monday, orders);
}
