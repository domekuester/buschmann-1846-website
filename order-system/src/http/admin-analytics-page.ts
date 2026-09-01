import { getAnalytics } from '../application/get-analytics';
import type { AppConfig } from '../config/app-config';
import { aggregateAnalytics } from '../domain/analytics';
import { businessDay } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import {
  isReportingPeriodKind,
  resolveReportingPeriod,
  type ReportingPeriod,
} from '../domain/reporting-period';
import {
  renderAdminAnalyticsPage,
  renderAnalyticsUnavailablePage,
  renderInvalidPeriodPage,
  type AdminAnalyticsPageView,
} from '../ui/admin-analytics-html';
import { isTrendMetric, toAnalyticsView } from '../ui/analytics-view';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/auswertung — der siebte Adminbereich.
 *
 * VIER PARAMETER, EINE PRÜFUNG, EINE ANTWORT. Zeitraumart, Von, Bis und
 * Reihe werden ZUSAMMEN geprüft, bevor irgendetwas geladen wird; ein
 * ungültiger Wert in einem von ihnen führt zur selben 400-Seite.
 *
 * KEIN STILLES ZURÜCKFALLEN auf den Standardzeitraum — dieselbe Regel wie in
 * der Produktions- und der Tagesansicht, und hier mit demselben Gewicht: Ein
 * Lesezeichen mit einem Tippfehler zeigte sonst einen korrekt aussehenden
 * Umsatz für einen anderen Zeitraum, ohne es zu sagen. Genau das ist die
 * Zahl, die jemand in eine Besprechung mitnimmt.
 *
 * DER FEHLERHAFTE WERT WIRD NICHT ZURÜCKGESPIEGELT. Er stammt aus der
 * Adresszeile und ist damit vom Aufrufer bestimmt; ihn gar nicht erst
 * aufzunehmen ist die Schicht vor dem Escapen.
 *
 * DER GESCHÄFTSTAG WIRD HIER GEBILDET — einmal, aus der Serveruhr, in
 * Europe/Berlin. Weder Domäne noch Oberfläche noch der Browser des
 * Betrachters bestimmen, was „heute" ist: Ein „heute" aus dem Browser wäre
 * auf einem Tresengerät mit falsch gestellter Uhr ein anderer Tag als der,
 * für den gebacken wurde — und diese Seite trägt ohnehin kein Skript.
 *
 * READ ONLY. Kein POST, kein Schreibpfad, kein Formular mit Nebenwirkung.
 */
export async function adminAnalyticsPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) {
    return wache.response;
  }

  const art = leseParameter(request, 'period');
  const von = leseParameter(request, 'from');
  const bis = leseParameter(request, 'to');
  const reihe = leseParameter(request, 'metric');

  if (art === 'invalid' || von === 'invalid' || bis === 'invalid' || reihe === 'invalid') {
    return ungueltig();
  }
  // Ohne Angabe der Monat: die Frage, die ein Betrieb am häufigsten stellt.
  const kind = art === null ? 'monat' : art;
  if (!isReportingPeriodKind(kind)) {
    return ungueltig();
  }
  const metric = reihe === null ? 'umsatz' : reihe;
  if (!isTrendMetric(metric)) {
    return ungueltig();
  }

  let period: ReportingPeriod;
  try {
    period = resolveReportingPeriod(kind, businessDay(now), von, bis);
  } catch (fehler) {
    /**
     * NUR EINGABEFEHLER WERDEN HIER ZU EINER 400. Ein anderer Fehler wäre
     * ein Fehler dieser Anwendung und gehört an die Fehlergrenze, nicht in
     * eine Seite, die dem Admin sagt, er habe sich vertippt.
     */
    if (fehler instanceof ValidationError) {
      return ungueltig();
    }
    throw fehler;
  }

  /**
   * DER LEERE ZEITRAUM ALS GERÜST — er trägt Kopf und Zeitraumleiste, falls
   * die Abfragen scheitern. Dieselbe Bauart wie in der Tagesansicht: Wenn
   * ein Zeitraum nicht lädt, ist der nächste Klick oft genau das, was hilft.
   *
   * ER WIRD AGGREGIERT UND NICHT ABGESCHRIEBEN. Eine Literalfassung mit
   * lauter Nullen wäre eine zweite Stelle, an der die Form einer Auswertung
   * festgelegt ist — und beim ersten neuen Feld fiele sie auseinander.
   */
  const geruest: AdminAnalyticsPageView = {
    loginIdentifier: wache.context.loginIdentifier,
    csrfToken: wache.context.csrfToken,
    analytics: toAnalyticsView(
      aggregateAnalytics(period, { orders: [], items: [], products: [], customers: [], segments: [] }),
      metric,
    ),
  };

  let auswertung;
  try {
    auswertung = await getAnalytics(db, period);
  } catch {
    /**
     * DER FEHLER WIRD NICHT ANGESEHEN. Er könnte ein SQL-Fragment, einen
     * Bindingnamen oder einen Dateipfad tragen; nichts davon wird gelesen,
     * protokolliert oder gerendert. Die Seite ist eine Konstante.
     */
    return new Response(renderAnalyticsUnavailablePage(geruest), {
      status: 500,
      headers: pageHeaders(),
    });
  }

  return new Response(
    renderAdminAnalyticsPage({ ...geruest, analytics: toAnalyticsView(auswertung, metric) }),
    { status: 200, headers: pageHeaders() },
  );
}

/**
 * Ein Parameter — oder 'invalid'.
 *
 * MEHRFACH ANGEGEBEN IST UNGÜLTIG und nicht „der letzte gewinnt". Dieselbe
 * Regel wie bei readDayParam(): `?period=monat&period=jahr` ist keine Frage,
 * auf die es eine richtige Antwort gibt, und eine Seite, die sich für eine
 * davon entscheidet, behauptet, sie habe verstanden.
 *
 * DER WERT WIRD NICHT GETRIMMT und nicht kleingeschrieben. Aus einer
 * beliebigen Zeichenkette hier einen gültigen Wert zu machen hieße, die
 * Menge der gültigen Werte an der Außengrenze zu erweitern.
 */
function leseParameter(request: Request, name: string): string | null | 'invalid' {
  const werte = new URL(request.url).searchParams.getAll(name);
  if (werte.length === 0) return null;
  if (werte.length > 1) return 'invalid';
  return werte[0] ?? null;
}

function ungueltig(): Response {
  return new Response(renderInvalidPeriodPage(), { status: 400, headers: pageHeaders() });
}
