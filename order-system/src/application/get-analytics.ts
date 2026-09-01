import { aggregateAnalytics, type Analytics } from '../domain/analytics';
import type { ReportingPeriod } from '../domain/reporting-period';
import { findAnalyticsGroups } from '../infrastructure/d1/analytics-repository';

/**
 * „Wie ist es gelaufen?"
 *
 * Kurz, und das ist die Absicht — dieselbe wie bei getDashboardWeek(): Die
 * Abfragen wissen, WELCHE Zeilen in den Zeitraum fallen; die Aggregation
 * weiß, WIE gezählt wird. Stünde hier Logik, gäbe es eine dritte Stelle mit
 * Regeln.
 *
 * DER ZEITRAUM WIRD ÜBERGEBEN UND NICHT ABGELEITET. Kein „dieser Monat",
 * kein Date.now(): Ein Anwendungsfall, dessen Antwort davon abhängt, wann er
 * aufgerufen wird, wäre um 23:59 Uhr ein anderer als um 00:01 Uhr. Welcher
 * Zeitraum gemeint ist, entscheidet resolveReportingPeriod() aus dem
 * Geschäftstag der Serveruhr.
 *
 * DIE BEIDEN BEREICHE KOMMEN AUS DEM ZEITRAUM SELBST und werden hier nicht
 * ausgerechnet. `queryStart`/`queryEnd` decken Kurve und Vergleich mit ab,
 * `start`/`end` sind der gewählte Zeitraum — die Ranglisten und die
 * Aufteilungen dürfen ausdrücklich nur diesen sehen.
 *
 * READ ONLY.
 */
export async function getAnalytics(
  db: D1Database,
  period: ReportingPeriod,
): Promise<Analytics> {
  const groups = await findAnalyticsGroups(
    db,
    period.queryStart,
    period.queryEnd,
    period.start,
    period.end,
  );

  return aggregateAnalytics(period, groups);
}
