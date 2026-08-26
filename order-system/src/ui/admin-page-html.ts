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
 * Host. Datumsnavigation, Datumswahl und seit Phase 4B auch der
 * Statuswechsel sind echte Links und echte Formulare — die Kernbedienung
 * funktioniert ohne JavaScript, und die CSP mit default-src 'none' wird nicht
 * einmal auf die Probe gestellt.
 *
 * SEIT PHASE 4B SCHREIBT DIESE SEITE. Sie tut es über POST-Formulare mit dem
 * CSRF-Token der Sitzung, und sie schreibt genau eine Spalte: den Status
 * einer Bestellung. Mengen, Notizen, Produkte, Kunden und Preise sind hier
 * weiterhin nicht änderbar — es gibt kein Feld dafür.
 */
export interface AdminPageView {
  /** Die Kennung des angemeldeten Admins — kein Geheimnis. */
  loginIdentifier: string;
  /**
   * Der Synchronizer-Token dieser Sitzung — für das Abmeldeformular und seit
   * Phase 4B für jedes Statusformular.
   *
   * Er kommt aus der Sitzungszeile in D1 und wird beim Rendern eingesetzt.
   * Damit trägt jedes schreibende Formular dieser Seite denselben geprüften
   * Wert, und es gibt keinen Weg, eines davon ohne ihn zu bauen.
   */
  csrfToken: string;
  /** Der aufbereitete Produktionstag. */
  day: ProductionDayView;
  readonly statusMessage?: string | null;
}

export function renderAdminPage(view: AdminPageView): string {
  return seitengeruest(
    `Produktion ${view.day.day} — Buschmann 1846`,
    view,
    `
      ${renderDayHeading(view.day)}
      ${renderDayNavigation(view.day)}
      <p class="seitenaktion">
        <a href="/admin/production-list?date=${escapeHtml(view.day.day)}">Produktionsliste drucken</a>
        <a href="/admin/abholliste?date=${escapeHtml(view.day.day)}">Abholliste</a>
      </p>
      ${view.statusMessage ? `<p class="banner statusmeldung" role="alert">${escapeHtml(view.statusMessage)}</p>` : ''}
      ${renderProductionSummary(view.day)}
      ${renderMetrics(view.day)}
      ${renderOrderBreakdown(view.day, view.csrfToken)}`,
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
 *
 * DER WEG ZURÜCK IST EIN PARAMETER, seit es zwei tagesbezogene Adminseiten
 * gibt. Er ist KEINE Zeichenkette aus der Anfrage, sondern eine von zwei
 * Konstanten, die der jeweilige Controller im Quelltext stehen hat — hier
 * einen Wunsch des Aufrufers zu lesen wäre genau die Bauart, die einen Open
 * Redirect ergibt. Der Standardwert erhält das Verhalten aus Phase 3C.
 */
export interface InvalidDateBackLink {
  readonly href: string;
  readonly label: string;
}

export function renderInvalidDatePage(
  back: InvalidDateBackLink = { href: '/admin', label: 'Zurück zur Produktionsansicht' },
): string {
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
  <p><a href="${escapeHtml(back.href)}">${escapeHtml(back.label)}</a></p>
</main>
</body>
</html>
`;
}

/**
 * WENN EIN STATUSWECHSEL NICHT DURCHGEGANGEN IST — Phase 4B.
 *
 * DER WICHTIGSTE SATZ DIESER SEITE IST „Der Status wurde nicht geändert."
 * Ohne ihn ist die Lage für einen Menschen nicht zu erkennen: Er hat geklickt,
 * die Seite hat sich verändert, und ob der Kuchen jetzt in Produktion ist oder
 * nicht, wäre Auslegungssache. Eine stille Weiterleitung auf den alten Stand
 * wäre noch schlimmer — sie sähe aus wie ein Anzeigefehler, und der nächste
 * Klick käme sofort.
 *
 * VIER LAGEN, VIER TEXTE, EINE SEITE. Für jede Fehlerart eine eigene
 * Oberfläche zu bauen wäre vierfacher Aufwand für dieselbe Aussage; ein
 * einziger Text für alle vier wäre dagegen unehrlich, weil „jemand war
 * schneller" und „diese Bestellung gibt es nicht" für den nächsten Schritt
 * etwas völlig anderes bedeuten.
 *
 * KEINE TECHNIK, KEINE STATUSNAMEN. Der Text nennt kein SQL, keinen
 * Fehlercode, keinen Tabellennamen und auch nicht, welcher Übergang
 * stattdessen erlaubt wäre: Die Übergangstabelle ist eine Eigenschaft des
 * Systems und gehört nicht in eine Fehlermeldung — dieselbe Regel, der die
 * JSON-Antwort aus Phase 4A folgt.
 *
 * DER WEG ZURÜCK IST EIN ECHTER LINK auf den Produktionstag der Bestellung.
 * Kein „zurück" per JavaScript: Der Browserverlauf zeigte die alte Seite mit
 * der alten Schaltfläche, und die ist genau das, was gerade nicht mehr
 * stimmt. Ist der Tag unbekannt, führt der Link auf /admin — eine Konstante.
 */
export type StatusChangeFailure =
  /** Jemand anderes war schneller. */
  | 'conflict'
  /** Von diesem Stand aus geht dieser Schritt nicht (mehr). */
  | 'invalid_transition'
  /** Diese Bestellnummer gibt es nicht. */
  | 'unknown_order'
  /** Die Anfrage passte nicht — oder es ging gerade technisch nicht. */
  | 'unavailable';

const FEHLERTEXTE: Readonly<
  Record<StatusChangeFailure, { readonly heading: string; readonly body: string }>
> = {
  conflict: {
    heading: 'Die Bestellung hat sich inzwischen geändert',
    body:
      'Jemand anderes hat diese Bestellung bearbeitet, während dein Bildschirm noch den alten Stand zeigte. ' +
      'Der Status wurde nicht geändert. Bitte lade den Produktionstag neu und sieh dir an, wo die Bestellung jetzt steht.',
  },
  invalid_transition: {
    heading: 'Dieser Schritt ist hier nicht möglich',
    body:
      'Die Bestellung steht nicht mehr dort, wo dieser Schritt beginnt. ' +
      'Der Status wurde nicht geändert. Bitte lade den Produktionstag neu.',
  },
  unknown_order: {
    heading: 'Diese Bestellung gibt es nicht',
    body:
      'Zu dieser Bestellnummer ist nichts gespeichert. ' +
      'Der Status wurde nicht geändert. Bitte gehe zurück zur Produktionsansicht.',
  },
  unavailable: {
    heading: 'Der Status konnte nicht geändert werden',
    body:
      'Die Änderung ist nicht durchgegangen. Der Status wurde nicht geändert. ' +
      'Bitte versuche es gleich noch einmal. Wenn es bleibt, melde dich bei Buschmann 1846.',
  },
};

/**
 * @param day Der Produktionstag der Bestellung — 'JJJJ-MM-TT' oder null.
 *            Er stammt aus der Bestellung in D1 und NIEMALS aus der Anfrage;
 *            der Aufrufer stellt das sicher (siehe http/admin-order-api.ts).
 */
export function renderStatusChangeFailurePage(
  reason: StatusChangeFailure,
  day: string | null,
): string {
  const text = FEHLERTEXTE[reason];
  const ziel = day === null ? '/admin' : `/admin?date=${escapeHtml(day)}`;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>${escapeHtml(text.heading)} — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
</header>

<main id="inhalt" class="anmeldung">
  <h1>${escapeHtml(text.heading)}</h1>
  <p class="banner" role="alert">${escapeHtml(text.body)}</p>
  <p><a href="${ziel}">Zurück zur Produktionsansicht</a></p>
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
 * KEINE SIDEBAR. Seit Phase 6F gibt es genau FÜNF echte Ziele: Dashboard,
 * Produktion, Sortiment & Preise, Kunden und Bestellregeln. Mehr Navigation
 * wäre weiterhin Attrappe — ein Menüpunkt „Finanzen", hinter dem keine Seite
 * liegt, ist kein Ausblick, sondern eine Unwahrheit im Kopf jeder Seite.
 * Jeder dieser fünf Einträge führt auf eine Seite, die es gibt und die etwas
 * tut.
 *
 * BESTELLREGELN STEHT ZULETZT, und das ist eine Aussage über den Tag: Es ist
 * die einzige Seite, die man EINMAL benutzt und dann monatelang nicht mehr.
 * Sie vorn zu führen hieße, den Blick jeden Morgen an einer Einstellung
 * vorbeizuführen, die sich nie ändert.
 *
 * DAS DASHBOARD BEKOMMT ALS EINZIGE SEITE EINE BREITERE SPALTE. Der Grund
 * kam aus dem Browser: Seine Bestelltabelle hat sechs Spalten — doppelt so
 * viele wie Kunden- und Katalogseite —, und in der 44rem-Spalte brach der
 * Browser Bestellnummern und Beträge Zeichen für Zeichen um. Die Alternative
 * wäre seitliches Scrollen in der Tabelle gewesen; auf einem Tresengerät ist
 * das die schlechtere von zwei Antworten. Es bleibt bei einer SPALTE — 60rem
 * statt 44rem, nicht die ganze Fensterbreite.
 *
 * DAS DASHBOARD STEHT VORN UND IST TROTZDEM NICHT DIE STARTSEITE. /admin
 * bleibt die Produktionsansicht: Wer sich als Admin anmeldet, landet weiter
 * dort, wo die Arbeit anfängt. Das Dashboard ist der Überblick über einen
 * Tag, nicht das Vorzimmer der übrigen Seiten — eine Zwischenseite mit vier
 * Kacheln wäre ein Klick ohne Entscheidung.
 */
export type AdminArea = 'dashboard' | 'production' | 'catalog' | 'customers' | 'rules';

export function renderAdminShell(
  title: string,
  view: Pick<AdminPageView, 'loginIdentifier' | 'csrfToken'>,
  activeArea: AdminArea,
  body: string,
): string {
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
<body class="adminseite${activeArea === 'dashboard' ? ' adminseite--breit' : ''}">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
  <nav class="adminnav" aria-label="Adminbereich">
    <a href="/admin/dashboard"${activeArea === 'dashboard' ? ' aria-current="page"' : ''}>Dashboard</a>
    <a href="/admin"${activeArea === 'production' ? ' aria-current="page"' : ''}>Produktion</a>
    <a href="/admin/catalog"${activeArea === 'catalog' ? ' aria-current="page"' : ''}>Sortiment &amp; Preise</a>
    <a href="/admin/customers"${activeArea === 'customers' ? ' aria-current="page"' : ''}>Kunden</a>
    <a href="/admin/bestellregeln"${activeArea === 'rules' ? ' aria-current="page"' : ''}>Bestellregeln</a>
  </nav>
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

function seitengeruest(title: string, view: AdminPageView, body: string): string {
  return renderAdminShell(title, view, 'production', body);
}
