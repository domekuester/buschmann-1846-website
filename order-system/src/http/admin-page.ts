import { getProductionDay } from '../application/get-production-day';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays } from '../domain/clock';
import {
  renderAdminPage,
  renderDataUnavailablePage,
  renderInvalidDatePage,
  type AdminPageView,
} from '../ui/admin-page-html';
import { toProductionDayView } from '../ui/production-day-view';
import { readDayParam } from './day-param';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/production — die Produktions-Tagesansicht.
 *
 * DIE REIHENFOLGE IST ABSICHT, und sie ist dieselbe wie in
 * production-api.ts und order-api.ts:
 *
 *   1. Rolle. Ohne gültige Adminsitzung wird nichts weiter getan — auch nicht
 *      der Parameter angeschaut.
 *   2. Datum.
 *   3. Abfrage.
 *
 * Schritt 1 vor Schritt 2 heißt: Wer keinen Zugang hat, bekommt 401 oder 403
 * und nicht 400. Eine Datumsfehlermeldung für einen Fremden wäre die Auskunft
 * „hier ist eine Seite, und sie will ein Datum".
 *
 * DER ANWENDUNGSFALL WIRD DIREKT AUFGERUFEN, nicht über den eigenen
 * API-Endpunkt. Ein fetch() vom Worker auf sich selbst kostete einen zweiten
 * Roundtrip, müsste das Sitzungscookie weiterreichen, könnte an der
 * Origin-Prüfung scheitern und verwandelte einen Typfehler in einen
 * Laufzeitfehler. getProductionDay kennt weder Request noch Response und ist
 * genau für diesen Aufruf gebaut.
 *
 * GET /api/admin/production-day BLEIBT BESTEHEN. Es ist die maschinenlesbare
 * Fassung derselben Frage; Phase 3C löst es nicht ab.
 *
 * READ ONLY. Diese Datei schreibt nichts.
 */
export async function adminPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) {
    return wache.response;
  }

  const angefragt = readDayParam(request);
  if (angefragt === 'invalid') {
    return new Response(renderInvalidDatePage(), { status: 400, headers: pageHeaders() });
  }

  /**
   * DER STANDARDTAG IST DER NÄCHSTE KALENDERTAG — und er wird HIER gebildet,
   * nicht im Anwendungsfall.
   *
   * getProductionDay bleibt ausdrücklich datumsbasiert und leitet nichts ab:
   * Ein Anwendungsfall, dessen Antwort davon abhängt, wann er aufgerufen
   * wird, wäre um 23:59 Uhr etwas anderes als um 00:01 Uhr und nicht
   * deterministisch testbar. Die Vorauswahl ist eine Frage der Oberfläche,
   * und damit steht sie in der Oberfläche.
   *
   * businessDay() liefert den Tag, der in Düsseldorf gilt — nicht den der
   * UTC-Uhr des Workers. Zwischen Mitternacht und 02:00 Uhr Berliner Zeit ist
   * das ein Unterschied von einem Tag, und zwar genau in den Stunden, in
   * denen eine Backstube arbeitet.
   *
   * KEIN GESCHÄFTSTAG. Kein Überspringen von Sonntagen, keine Feiertage,
   * keine Öffnungszeiten: Eine solche Regel existiert in diesem System nicht,
   * und sie hier zum ersten Mal — in einem Controller — festzuschreiben wäre
   * der falsche Ort und die falsche Gelegenheit. Dieselbe Vorauswahl benutzt
   * die Bestellseite seit Phase 2.
   */
  const tag = angefragt ?? plusDays(businessDay(now), 1);
  const statusMessage = readStatusMessage(request);

  const seite: AdminPageView = {
    loginIdentifier: wache.context.loginIdentifier,
    csrfToken: wache.context.csrfToken,
    day: toProductionDayView({
      date: tag,
      orderCount: 0,
      totalUnits: 0,
      products: [],
      orders: [],
    }),
    statusMessage,
  };

  let produktionstag;
  try {
    produktionstag = await getProductionDay(db, tag);
  } catch {
    /**
     * DER FEHLER WIRD NICHT ANGESEHEN. Er könnte ein SQL-Fragment, einen
     * Bindingnamen oder einen Dateipfad tragen; nichts davon wird gelesen,
     * protokolliert oder gerendert. Die Seite ist eine Konstante.
     *
     * Warum hier und nicht in error-boundary.ts: Die zentrale Grenze
     * antwortet mit JSON, und das ist für eine API richtig. Ein Admin, der
     * auf einer Seite steht, bekäme dann {"error":"internal_error"} im
     * Browserfenster. Der Fang ist reine Darstellung — er unterscheidet
     * nicht nach Fehlerart und verändert die Semantik nicht: Es bleibt bei
     * 500, und die zentrale Grenze bleibt der Auffang für alles Übrige.
     *
     * Die Navigation bleibt stehen: Wenn ein Tag scheitert, ist der nächste
     * Klick oft genau das, was hilft.
     */
    return new Response(renderDataUnavailablePage(seite), {
      status: 500,
      headers: pageHeaders(),
    });
  }

  return new Response(
    renderAdminPage({ ...seite, day: toProductionDayView(produktionstag) }),
    { status: 200, headers: pageHeaders() },
  );
}

const STATUS_MESSAGES = {
  conflict: 'Der Status wurde zwischenzeitlich geändert. Bitte prüfe die Bestellung noch einmal.',
  invalid_transition: 'Diese Statusänderung ist nicht mehr möglich.',
  not_found: 'Die Bestellung konnte nicht gefunden werden.',
  internal: 'Die Änderung konnte gerade nicht gespeichert werden.',
} as const;

function readStatusMessage(request: Request): string | null {
  const values = new URL(request.url).searchParams.getAll('status_error');
  if (values.length !== 1) return null;
  const code = values[0] ?? '';
  return Object.prototype.hasOwnProperty.call(STATUS_MESSAGES, code)
    ? STATUS_MESSAGES[code as keyof typeof STATUS_MESSAGES]
    : null;
}
