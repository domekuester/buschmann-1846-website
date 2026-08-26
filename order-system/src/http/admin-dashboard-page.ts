import { getDashboardDay } from '../application/get-dashboard-day';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays } from '../domain/clock';
import { renderInvalidDatePage } from '../ui/admin-page-html';
import {
  renderAdminDashboardPage,
  renderDashboardUnavailablePage,
  type AdminDashboardPageView,
} from '../ui/admin-dashboard-html';
import { toDashboardView } from '../ui/dashboard-view';
import { readDayParam } from './day-param';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/dashboard — der Tagesüberblick.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE:
 *
 *   1. Rolle. Ohne gültige Adminsitzung wird nichts weiter getan — auch nicht
 *      der Parameter angeschaut.
 *   2. Datum.
 *   3. Abfrage.
 *
 * Schritt 1 vor Schritt 2 heißt: Wer keinen Zugang hat, bekommt 303 oder 403
 * und nicht 400. Auf dieser Seite wiegt das schwerer als auf der
 * Produktionsansicht — hier stehen Beträge, und eine Datumsfehlermeldung für
 * einen Fremden wäre die Auskunft „hier ist eine Seite mit Umsatzzahlen, und
 * sie will ein Datum".
 *
 * DER ANWENDUNGSFALL WIRD DIREKT AUFGERUFEN, nicht über einen eigenen
 * API-Endpunkt — und es gibt bewusst KEINEN. Die Produktionsansicht hat mit
 * GET /api/admin/production-day einen maschinenlesbaren Zwilling, weil es ihn
 * seit Phase 3B gab; für den Überblick würde ein solcher Endpunkt bedeuten,
 * die Umsatzzahlen eines Tages in einer zweiten, ebenfalls zu prüfenden Form
 * anzubieten, die niemand aufruft. Was es nicht gibt, muss nicht abgesichert
 * werden.
 *
 * READ ONLY. Diese Datei schreibt nichts. Der Zahlungseintrag ist ein eigener
 * Endpunkt mit eigener Origin- und CSRF-Prüfung; eine Seite, die nebenbei
 * speichert, wäre über einen vorgeladenen Link auslösbar.
 */
export async function adminDashboardPage(
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
    /**
     * KEIN STILLES ZURÜCKFALLEN auf den Standardtag — dieselbe Regel wie in
     * der Produktionsansicht, und hier aus einem zusätzlichen Grund: Ein
     * Lesezeichen mit einem Tippfehler zeigte sonst einen korrekt aussehenden
     * Umsatz für einen anderen Tag, ohne es zu sagen.
     *
     * Der Weg zurück führt auf DIESE Seite und nicht auf die Produktion — wer
     * das Dashboard gesucht hat, will das Dashboard.
     */
    return new Response(
      renderInvalidDatePage({ href: '/admin/dashboard', label: 'Zurück zum Dashboard' }),
      { status: 400, headers: pageHeaders() },
    );
  }

  /**
   * DER STANDARDTAG IST DER NÄCHSTE KALENDERTAG — dieselbe Vorauswahl wie in
   * der Produktionsansicht und auf der Bestellseite. Sie wird HIER gebildet
   * und nicht im Anwendungsfall: Ein Anwendungsfall, dessen Antwort davon
   * abhängt, wann er aufgerufen wird, wäre um 23:59 Uhr etwas anderes als um
   * 00:01 Uhr.
   *
   * DASS DAS DASHBOARD DENSELBEN STANDARDTAG WÄHLT WIE DIE PRODUKTION, ist
   * Absicht: Wer zwischen beiden Seiten wechselt, soll nicht plötzlich einen
   * anderen Tag ansehen. Ein „heute" für den Überblick und ein „morgen" für
   * die Produktion wären zwei Wahrheiten in einer Navigationsleiste.
   *
   * businessDay() liefert den Tag, der in Düsseldorf gilt — nicht den der
   * UTC-Uhr des Workers.
   */
  const tag = angefragt ?? plusDays(businessDay(now), 1);

  /**
   * DER LEERE TAG ALS GERÜST — er trägt die Navigation, falls die Abfrage
   * scheitert. Dieselbe Bauart wie in http/admin-page.ts: Wenn ein Tag nicht
   * lädt, ist der nächste Klick oft genau das, was hilft.
   */
  const geruest: AdminDashboardPageView = {
    loginIdentifier: wache.context.loginIdentifier,
    csrfToken: wache.context.csrfToken,
    day: toDashboardView({
      date: tag,
      orderCount: 0,
      cancelledCount: 0,
      revenueCents: 0,
      openCount: 0,
      customerCount: 0,
      totalUnits: 0,
      unpaidCents: 0,
      unpaidCount: 0,
      orders: [],
      topProducts: [],
    }),
    noticeCode: readNotice(request),
  };

  let ueberblick;
  try {
    ueberblick = await getDashboardDay(db, tag);
  } catch {
    /**
     * DER FEHLER WIRD NICHT ANGESEHEN. Er könnte ein SQL-Fragment, einen
     * Bindingnamen oder einen Dateipfad tragen; nichts davon wird gelesen,
     * protokolliert oder gerendert. Die Seite ist eine Konstante.
     *
     * Warum hier und nicht in error-boundary.ts: Die zentrale Grenze
     * antwortet mit JSON, und ein Admin bekäme {"error":"internal_error"} im
     * Browserfenster. Es bleibt bei 500.
     */
    return new Response(renderDashboardUnavailablePage(geruest), {
      status: 500,
      headers: pageHeaders(),
    });
  }

  return new Response(
    renderAdminDashboardPage({ ...geruest, day: toDashboardView(ueberblick) }),
    { status: 200, headers: pageHeaders() },
  );
}

/**
 * Der Rückmeldungscode aus der Weiterleitung nach dem Speichern.
 *
 * ER WIRD HIER NICHT GEPRÜFT UND NICHT ÜBERSETZT — nur weitergereicht. Die
 * Oberfläche schlägt ihn in einer festen Tabelle nach und zeigt für einen
 * unbekannten Code gar nichts an; damit kann in der Meldung nichts stehen,
 * was nicht im Quelltext steht — dieselbe Regel wie auf der Kundenseite.
 *
 * MEHRFACHE PARAMETER ERGEBEN KEINE MELDUNG, statt still den ersten zu
 * nehmen.
 */
function readNotice(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('notice');
  return werte.length === 1 ? (werte[0] ?? null) : null;
}
