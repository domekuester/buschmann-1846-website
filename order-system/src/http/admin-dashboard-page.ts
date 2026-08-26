import { getDashboardDay } from '../application/get-dashboard-day';
import { getDashboardWeek } from '../application/get-dashboard-week';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays, weekStart } from '../domain/clock';
import { aggregateDashboardDay } from '../domain/dashboard-day';
import { aggregateDashboardWeek } from '../domain/dashboard-week';
import { renderInvalidDatePage } from '../ui/admin-page-html';
import {
  renderAdminDashboardPage,
  renderDashboardUnavailablePage,
  type AdminDashboardPageView,
} from '../ui/admin-dashboard-html';
import {
  renderAdminDashboardWeekPage,
  renderWeekUnavailablePage,
  type AdminDashboardWeekPageView,
} from '../ui/admin-dashboard-week-html';
import { toDashboardView, toOrderListView, toQuickDaysView } from '../ui/dashboard-view';
import { toDashboardWeekView } from '../ui/dashboard-week-view';
import { readDayParam, readOrderFilterParam, readViewParam } from './day-param';
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

  /**
   * DREI PARAMETER, EINE PRÜFUNG, EINE ANTWORT.
   *
   * Datum, Blickweite und Bestellfilter werden ZUSAMMEN geprüft, bevor
   * irgendetwas geladen wird. Ein ungültiger Wert in einem von ihnen führt
   * zur selben 400-Seite; keiner fällt still auf einen Standard zurück.
   *
   * Der Grund ist überall derselbe: Eine Seite, die etwas anderes zeigt als
   * das Angefragte, ohne es zu sagen, wird für das Angefragte gehalten.
   */
  const angefragt = readDayParam(request);
  const blickweite = readViewParam(request);
  const filter = readOrderFilterParam(request);

  if (angefragt === 'invalid' || blickweite === 'invalid' || filter === 'invalid') {
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
   * DAS GESCHÄFTSDATUM WIRD HIER GEBILDET — einmal, aus der Serveruhr, in
   * Europe/Berlin. Es geht als fertige Zeichenkette in die Oberfläche.
   *
   * Weder das Ansichtsmodell noch der Renderer noch der Browser des
   * Betrachters bestimmen, was „heute" ist. Ein „heute" aus dem Browser wäre
   * auf einem Tresengerät mit falsch gestellter Uhr ein anderer Tag als der,
   * für den gebacken wurde — und diese Seite trägt ohnehin kein Skript.
   */
  const heute = businessDay(now);

  if (blickweite === 'week') {
    return wochenansicht(db, wache.context, weekStart(tag), heute);
  }

  /**
   * DER LEERE TAG ALS GERÜST — er trägt die Navigation, falls die Abfrage
   * scheitert. Dieselbe Bauart wie in http/admin-page.ts: Wenn ein Tag nicht
   * lädt, ist der nächste Klick oft genau das, was hilft.
   */
  const leererTag = toDashboardView(aggregateDashboardDay(tag, []));

  const geruest: AdminDashboardPageView = {
    loginIdentifier: wache.context.loginIdentifier,
    csrfToken: wache.context.csrfToken,
    /**
     * DER LEERE TAG WIRD AGGREGIERT UND NICHT ABGESCHRIEBEN.
     *
     * Vorher stand hier eine Literalfassung mit neun Nullen. Sie war eine
     * zweite Stelle, an der die Form eines Tages festgelegt ist — und beim
     * ersten neuen Feld in DashboardDay fiel sie auseinander. Ein leerer Tag
     * IST das Ergebnis der Aggregation über keine Bestellung; es gibt keinen
     * Grund, das noch einmal von Hand hinzuschreiben.
     */
    day: leererTag,
    noticeCode: readNotice(request),
    quickDays: toQuickDaysView(heute, tag, 'day'),
    orderList: toOrderListView(leererTag, filter ?? 'all'),
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

  const day = toDashboardView(ueberblick);

  return new Response(
    renderAdminDashboardPage({
      ...geruest,
      day,
      orderList: toOrderListView(day, filter ?? 'all'),
    }),
    { status: 200, headers: pageHeaders() },
  );
}

/**
 * GET /admin/dashboard?view=week — dieselbe Seite, eine Blickweite weiter.
 *
 * SIE IST KEINE EIGENE ROUTE UND KEIN EIGENER BEREICH. Der Wächter ist
 * derselbe, der Tag ist derselbe Parameter, und die Hauptnavigation bekommt
 * keinen fünften Punkt: Ein Menüpunkt „Wochenanalyse" hätte die Woche zu
 * etwas anderem gemacht als dem, was sie ist — dieselbe Frage über einen
 * längeren Zeitraum.
 *
 * DER MONTAG WIRD HIER GEBILDET, nicht in der Ansicht und nicht im
 * Anwendungsfall: über weekStart() aus dem bereits geprüften Tag. Damit ist
 * `?date=2026-08-28&view=week` und `?date=2026-08-24&view=week` dieselbe
 * Woche, und ein Tag, den jemand von Hand eintippt, landet in der Woche, in
 * der er liegt.
 *
 * ES GIBT KEINEN BESTELLFILTER IN DER WOCHE. Sie zeigt keine Bestellungen,
 * sondern Zahlen je Tag; ein Filter hätte hier nichts zu filtern. Der
 * Parameter wird trotzdem geprüft — ein unsinniger Wert soll auch hier eine
 * Antwort bekommen und nicht stillschweigend wirkungslos bleiben.
 */
async function wochenansicht(
  db: D1Database,
  context: { loginIdentifier: string; csrfToken: string },
  monday: string,
  heute: string,
): Promise<Response> {
  /**
   * DIE LEERE WOCHE ALS GERÜST — sie trägt die Navigation, falls die Abfrage
   * scheitert, und wird AGGREGIERT statt abgeschrieben: Eine Literalfassung
   * mit sieben Nullreihen wäre eine zweite Stelle, an der die Form einer
   * Woche festgelegt ist.
   */
  const geruest: AdminDashboardWeekPageView = {
    loginIdentifier: context.loginIdentifier,
    csrfToken: context.csrfToken,
    week: toDashboardWeekView(aggregateDashboardWeek(monday, []), heute),
  };

  let woche;
  try {
    woche = await getDashboardWeek(db, monday);
  } catch {
    // Der Fehler wird nicht angesehen — dieselbe Regel wie in der Tagesansicht.
    return new Response(renderWeekUnavailablePage(geruest), {
      status: 500,
      headers: pageHeaders(),
    });
  }

  return new Response(
    renderAdminDashboardWeekPage({
      ...geruest,
      week: toDashboardWeekView(woche, heute),
    }),
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
