import { escapeHtml } from './format';
import { renderOrderBreakdown, renderProductionSummary } from './production-day-html';
import type { ProductionDayView } from './production-day-view';

/**
 * Die Produktions-Tagesansicht — der Adminbereich von Phase 3C.
 *
 * PHASE 3A HATTE HIER EINE LEERE SCHALE mit dem Satz „Adminbereich ist
 * bereit." Sie hatte genau einen Zweck: zu beweisen, dass die Auth-Grenze
 * trägt. Dieser Beweis ist erbracht und steht weiterhin in den Tests; die
 * Schale selbst hat ihn überlebt und wird jetzt durch das ersetzt, wofür sie
 * Platz gehalten hat.
 *
 * ES GIBT KEINE DASHBOARD-ZWISCHENSEITE. Kein „Willkommen — bitte Funktion
 * auswählen". Das System hat genau eine Adminfunktion; eine Auswahlseite mit
 * einem Eintrag wäre ein Klick ohne Entscheidung. Wer sich als Admin
 * anmeldet, sieht sofort, was zu produzieren ist.
 *
 * DIE SEITE TRÄGT KEIN SKRIPT. Kein <script>, nichts Inline, kein fremder
 * Host. Datumsnavigation und Datumswahl sind echte Links und ein echtes
 * GET-Formular — die Kernbedienung funktioniert ohne JavaScript, und die CSP
 * mit default-src 'none' wird nicht einmal auf die Probe gestellt.
 *
 * READ ONLY. Es gibt auf dieser Seite genau ein Formular, das etwas
 * verändert, und das ist die Abmeldung.
 */
export interface AdminPageView {
  /** Die Kennung des angemeldeten Admins — kein Geheimnis. */
  loginIdentifier: string;
  /** Der Synchronizer-Token dieser Sitzung, für das Abmeldeformular. */
  csrfToken: string;
  /** Der aufbereitete Produktionstag. */
  day: ProductionDayView;
}

export function renderAdminPage(view: AdminPageView): string {
  return seitengeruest(
    `Produktion ${view.day.day} — Buschmann 1846`,
    view,
    `
      ${renderDayHeading(view.day)}
      ${renderDayNavigation(view.day)}
      ${renderProductionSummary(view.day)}
      ${renderMetrics(view.day)}
      ${renderOrderBreakdown(view.day)}`,
  );
}

/**
 * Die Überschrift der Seite — und die EINZIGE h1.
 *
 * Sie trägt beides: wofür die Seite da ist und welcher Tag gemeint ist. Ein
 * Screenreader liest „Produktion, Dienstag, 25. August 2026" — genau die
 * Antwort auf die Frage, mit der jemand hier ankommt.
 *
 * Das Datum steht groß und ausgeschrieben. „2026-08-25" wäre kürzer und
 * zwänge den Leser, den Wochentag selbst auszurechnen; in einer Backstube ist
 * der Wochentag die eigentliche Information.
 */
function renderDayHeading(day: ProductionDayView): string {
  return `<h1 class="tag">
        <span class="tag__label">Produktion</span>
        <span class="tag__datum">${escapeHtml(day.dayLabel)}</span>
      </h1>`;
}

/**
 * Die Datumsnavigation — der einzige Bedienvorgang dieser Seite.
 *
 * DREI ECHTE HTML-ELEMENTE, KEIN SKRIPT: zwei <a> und ein <form method="get">.
 * Damit funktioniert die Navigation ohne JavaScript, der Browser-Zurückpfeil
 * tut das Erwartete, und der Tag steht in der URL — also im Lesezeichen.
 *
 * DIE PFEILE NENNEN IHR ZIEL. „Zurück" allein sagt in einem Screenreader
 * nichts; „Vorheriger Tag, Montag, 24. August 2026" sagt alles. Der Pfeil
 * selbst ist aria-hidden, sonst käme er als „Pfeil nach links" noch einmal
 * hinterher.
 *
 * DIE PFEILE MEINEN KALENDERTAGE. Kein Überspringen von Sonntagen, keine
 * Feiertage — das System kennt keine solche Regel, und sie hier zum ersten
 * Mal einzuführen wäre der falsche Ort.
 *
 * DAS FORMULAR SENDET AN /admin, ohne verstecktes Feld und ohne Ziel aus der
 * Anfrage. Ein Formular, dessen action aus einem Parameter käme, wäre die
 * Vorlage für eine Weiterleitung nach draußen; hier steht das Ziel als
 * Konstante im Quelltext.
 */
function renderDayNavigation(day: ProductionDayView): string {
  return `<nav class="tagnav" aria-label="Produktionstag wechseln">
        <a
          class="tagnav__pfeil"
          href="/admin?date=${escapeHtml(day.previousDay)}"
          rel="prev"
          aria-label="Vorheriger Tag, ${escapeHtml(day.previousDayLabel)}"
        ><span aria-hidden="true">&larr;</span></a>

        <form class="tagnav__formular" method="get" action="/admin">
          <label for="tagwahl">Tag wählen</label>
          <input type="date" id="tagwahl" name="date" value="${escapeHtml(day.day)}" required>
          <button type="submit" class="senden tagnav__senden">Anzeigen</button>
        </form>

        <a
          class="tagnav__pfeil"
          href="/admin?date=${escapeHtml(day.nextDay)}"
          rel="next"
          aria-label="Nächster Tag, ${escapeHtml(day.nextDayLabel)}"
        ><span aria-hidden="true">&rarr;</span></a>
      </nav>`;
}

/**
 * Zwei Zahlen zur Einordnung — und ausdrücklich nicht mehr.
 *
 * Bestellungen und Einheiten. KEIN Umsatz, kein Bestellwert, keine Marge,
 * keine Kosten: Produktion ist bewusst finanzfrei, und die Zahlen dafür
 * existieren in dieser Ansicht gar nicht.
 *
 * Sie stehen UNTER der Backliste, nicht darüber. Oben wären sie das Erste,
 * was auffällt — und „24 Einheiten" beantwortet keine einzige Frage der
 * Backstube. Sie leiten stattdessen zu den Bestellungen über, zu denen sie
 * gehören.
 *
 * Die Zahlen kommen aus der Aggregation und werden hier nicht neu gebildet.
 * Eine zweite Summe könnte der ersten widersprechen.
 */
function renderMetrics(day: ProductionDayView): string {
  return `<p class="kennzahlen">
        <span class="kennzahl"><strong>${day.orderCount}</strong> ${plural(day.orderCount, 'Bestellung', 'Bestellungen')}</span>
        <span class="kennzahl"><strong>${day.totalUnits}</strong> ${plural(day.totalUnits, 'Einheit', 'Einheiten')}</span>
      </p>`;
}

/**
 * „1 Bestellung", nicht „1 Bestellungen".
 *
 * Eine Kleinigkeit, die genau dann auffällt, wenn sie fehlt — und die auf
 * einer Seite, die ein Betrieb täglich sieht, den Unterschied zwischen
 * gepflegter und hingestellter Software ausmacht.
 */
function plural(count: number, einzahl: string, mehrzahl: string): string {
  return count === 1 ? einzahl : mehrzahl;
}

/**
 * Die Seite, auf der die Produktionsdaten gerade nicht geladen werden konnten.
 *
 * DER ADMIN SIEHT KEINE TECHNIK. Kein SQL, kein D1_ERROR, kein Stacktrace,
 * kein Bindingname, kein Dateipfad, kein Tabellenname — der Text ist eine
 * Konstante und wird nicht aus dem Fehler gebildet. Das ist dieselbe Regel,
 * der error-boundary.ts folgt; hier steht sie noch einmal, weil eine Seite
 * eine Seite zurückgeben soll und kein JSON.
 *
 * DIE NAVIGATION BLEIBT. Wenn die Abfrage für einen Tag scheitert, ist der
 * nächste Klick oft genau das, was hilft — und ein Kopf ohne Abmeldung wäre
 * eine Sackgasse.
 */
export function renderDataUnavailablePage(view: AdminPageView): string {
  return seitengeruest(
    `Produktion ${view.day.day} — Buschmann 1846`,
    view,
    `
      ${renderDayHeading(view.day)}
      ${renderDayNavigation(view.day)}
      <p class="banner" role="alert">Die Produktionsdaten konnten gerade nicht geladen werden.</p>
      <p class="leer">Bitte versuche es gleich noch einmal. Wenn es bleibt, melde dich bei Buschmann 1846.</p>`,
  );
}

/**
 * Die Antwort auf ein Datum, das es nicht gibt.
 *
 * KEIN STILLES ZURÜCKFALLEN auf den Standardtag. Ein Lesezeichen mit einem
 * Tippfehler zeigte sonst eine korrekt aussehende Backliste für einen
 * anderen Tag, ohne es zu sagen — und jemand backt nach der falschen Liste.
 * Lieber eine Seite, die stehen bleibt und den Weg zurück anbietet.
 *
 * DER FEHLERHAFTE WERT WIRD NICHT ZURÜCKGESPIEGELT. Er stammt aus der
 * Adresszeile und ist damit vom Aufrufer bestimmt; ihn gar nicht erst
 * aufzunehmen ist die Schicht vor dem Escapen. Sichtbar wäre er ohnehin
 * nutzlos — wer ihn getippt hat, sieht ihn oben im Browser stehen.
 *
 * Diese Seite kennt weder Sitzung noch Produktionstag: Sie wird gebraucht,
 * BEVOR ein Tag feststeht.
 */
export function renderInvalidDatePage(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Kein gültiges Datum — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
</header>

<main id="inhalt" class="anmeldung">
  <h1>Diesen Tag gibt es nicht</h1>
  <p class="anmeldung__vorspann">
    Das angefragte Datum ist kein gültiger Kalendertag. Bitte wähle einen Tag
    im Format JJJJ-MM-TT.
  </p>
  <p><a href="/admin">Zurück zur Produktionsansicht</a></p>
</main>
</body>
</html>
`;
}

/**
 * Das gemeinsame Gerüst aller Adminseiten mit Produktionsbezug.
 *
 * Kopf, Marke, Kennung und Abmeldung stehen hier EINMAL. Zwei Fassungen wären
 * zwei Gelegenheiten, bei einer davon das CSRF-Token im Abmeldeformular zu
 * vergessen.
 *
 * DIE KENNUNG STEHT DEZENT IM KOPF. Auf einem Gerät, das sich mehrere Leute
 * teilen, ist sie der Unterschied zwischen „ich arbeite als ich" und „ich
 * arbeite als irgendwer".
 *
 * DAS ABMELDEFORMULAR IST EIN ECHTES <form method="post"> mit dem CSRF-Token
 * der Sitzung. Kein Link: Ein GET-Logout wird von Link-Prefetch, Bildvorschau
 * und Virenscannern ausgelöst und meldet dann jemanden ab, der nichts getan
 * hat.
 *
 * KEINE SIDEBAR, KEINE NAVIGATION. Es gibt genau eine Adminfunktion; eine
 * Leiste mit „Dashboard / Bestellungen / Kunden / Produkte / Auswertung /
 * Einstellungen" wäre Attrappe.
 */
function seitengeruest(title: string, view: AdminPageView, body: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="adminseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
  <p class="kopf__kennung">Angemeldet als ${escapeHtml(view.loginIdentifier)}</p>

  <form method="post" action="/logout" class="abmelden">
    <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
    <button type="submit" class="abmelden__taste">Abmelden</button>
  </form>
</header>

<main id="inhalt" class="admin">${body}
</main>
</body>
</html>
`;
}
