import { renderAdminShell } from './admin-page-html';
import {
  PAYMENT_OPTIONS,
  type DashboardActionView,
  type DashboardDayView,
  type DashboardFinanceView,
  type DashboardOrderListView,
  type DashboardOrderRowView,
  type DonutView,
  type QuickDayView,
  type QuickDaysView,
} from './dashboard-view';
import { escapeHtml } from './format';

/**
 * Das Dashboard — die Seite, die ein Bäckereibesitzer morgens als Erstes
 * ansieht.
 *
 * SIE BEANTWORTET SIEBEN FRAGEN UND KEINE ACHTE:
 *
 *   Wie viele Bestellungen hat dieser Tag? Was bringt er ein? Wie viel ist
 *   noch zu tun? Wie viele Kunden? Wie viele Einheiten? Was ist davon noch
 *   nicht bezahlt? Und — seit Phase 7B — was BLEIBT davon?
 *
 * Was keine dieser Fragen beantwortet, steht nicht darauf: kein
 * Vortagesvergleich, keine Prognose, kein Liniendiagramm. Eine Kurve über
 * sieben Tage sähe nach Auswertung aus und wäre keine — bei drei bis vierzig
 * Bestellungen am Tag ist jede Kurve Rauschen. Die Zahlen stehen groß da,
 * weil sie groß dastehen sollen.
 *
 * DIE SIEBTE FRAGE IST ERST SEIT 7A BEANTWORTBAR. Bis dahin hätte jede Marge
 * die HEUTIGEN Herstellkosten auf eine Bestellung von letzter Woche
 * angewendet; seit es Kostenschnappschüsse gibt, ist sie eine Aussage über
 * den Tag. Wo die Schnappschüsse fehlen, bleibt sie deshalb aus — siehe
 * finanzen().
 *
 * DIE REIHENFOLGE IST DIE DES ARBEITSTAGS: Tag, Zahlen, Handlungsbedarf,
 * Finanzen, Verteilung, Bestellungen, Meistbestellt. Erst wie der Tag steht,
 * dann was zu tun ist, dann was er einbringt, dann wie er sich aufteilt,
 * zuletzt die Listen. „Meistbestellt" stand bis Phase 6A.3 zwischen den
 * Zahlen und den Bestellungen — und schob damit die einzige Liste, an der
 * etwas ZU TUN ist, unter eine Liste, die nur einordnet. Wer morgens auf
 * diese Seite kommt, sucht zuerst, was offen ist; wovon am meisten weggeht,
 * ist die Frage danach.
 *
 * SIE IST NICHT DIE PRODUKTIONSANSICHT. Dort steht, WAS zu backen ist; hier
 * steht, WIE der Tag steht. Beide zeigen denselben Tag, und ein Link führt
 * hinüber — aber keine der beiden ist die längere Fassung der anderen.
 *
 * SIE TRÄGT KEIN SKRIPT. Tageswechsel und Zahlungseintrag sind echte Links
 * und echte Formulare; die Kernbedienung funktioniert ohne JavaScript, und
 * die CSP mit default-src 'none' wird nicht einmal auf die Probe gestellt.
 *
 * SIE SCHREIBT GENAU EINE SPALTE: den Zahlungsstatus einer Bestellung. Es
 * gibt hier kein Feld für Betrag, Menge, Kunde, Produktionsstatus oder Preis
 * — nicht ausgeblendet, sondern nicht vorhanden.
 */

export interface AdminDashboardPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly day: DashboardDayView;
  /**
   * Die Rückmeldung des letzten Speicherversuchs, als CODE und nicht als
   * Text.
   *
   * Der Wert kommt aus der Adresszeile und ist damit vom Aufrufer bestimmt.
   * Er wird deshalb NIEMALS angezeigt, sondern ausschließlich in der festen
   * Tabelle unten nachgeschlagen; ein unbekannter Code führt zu gar keiner
   * Meldung. Damit kann in dieser Meldung nichts stehen, was nicht in dieser
   * Datei steht — dieselbe Regel wie auf der Kundenseite.
   */
  readonly noticeCode: string | null;
  /** Heute · Morgen · Woche — die drei Sprünge über der Seite. */
  readonly quickDays: QuickDaysView;
  /** Die Bestellliste in der Fassung, die angezeigt wird. */
  readonly orderList: DashboardOrderListView;
}

const MELDUNGEN: Readonly<Record<string, string>> = {
  payment_saved: 'Der Zahlungsstatus wurde gespeichert.',
  status_saved: 'Der Bestellstatus wurde gespeichert.',
  status_invalid_transition: 'Diese Statusänderung ist nicht mehr möglich. Es wurde nichts geändert.',
  status_conflict: 'Die Bestellung wurde zwischenzeitlich geändert. Bitte prüfe den aktuellen Stand.',
  status_not_found: 'Diese Bestellung gibt es nicht mehr. Es wurde nichts geändert.',
  status_internal: 'Der Bestellstatus wurde nicht gespeichert. Bitte versuche es gleich noch einmal.',
  email_retry_sent: 'Die E-Mail wurde erneut gesendet.',
  email_retry_failed: 'Die E-Mail konnte weiterhin nicht gesendet werden. Der Fehlerstand wurde gespeichert.',
  email_retry_unavailable: 'Der E-Mail-Versand ist in dieser Umgebung nicht verfügbar.',
  email_retry_not_available: 'Für diese Bestellung ist aktuell keine E-Mail zur Wiederholung verfügbar.',
  email_retry_reconciliation_required: 'Der Provider hat die E-Mail angenommen, aber der Versandstand muss geprüft werden.',
  unknown_order: 'Diese Bestellung gibt es nicht. Der Zahlungsstatus wurde nicht gespeichert.',
  invalid: 'Die Auswahl war nicht lesbar. Der Zahlungsstatus wurde nicht gespeichert.',
  internal:
    'Der Zahlungsstatus wurde nicht gespeichert. Bitte versuche es gleich noch einmal.',
  order_cancelled_by_items:
    'Die letzte Position wurde storniert. Die Bestellung ist damit vollständig storniert.',
  edit_not_editable:
    'Diese Bestellung kann nicht mehr bearbeitet werden. Es wurde nichts geändert.',
  edit_unknown_order: 'Diese Bestellung gibt es nicht. Es wurde nichts geändert.',
  edit_internal: 'Die Änderung wurde nicht gespeichert. Bitte versuche es gleich noch einmal.',
};

export function renderAdminDashboardPage(view: AdminDashboardPageView): string {
  return renderAdminShell(
    `Dashboard ${view.day.day} — Buschmann 1846`,
    view,
    'overview',
    `${kopf(view.day)}
    ${steuerung(view.day, view.quickDays)}
    ${meldung(view.noticeCode)}
    ${kennzahlen(view.day)}
    ${handlungsbedarf(view.day)}
    ${finanzen(view.day)}
    ${ringzone(view.day)}
    ${bestellliste(view)}
    ${topProdukte(view.day)}`,
  );
}

export function renderAdminOverviewPage(view: AdminDashboardPageView): string {
  return renderAdminShell(
    `Übersicht ${view.day.day} — Buschmann 1846`,
    view,
    'overview',
    `${kopf(view.day, true)}
    ${steuerung(view.day, view.quickDays, '/admin')}
    ${kennzahlen(view.day, true)}
    <div class="overview-arbeitsflaeche">
      ${handlungsbedarf(view.day, 'Als Nächstes')}
      ${topProdukte(view.day, 'Produktion heute')}
    </div>
    ${finanzen(view.day)}`,
  );
}

export function renderAdminOrdersPage(view: AdminDashboardPageView): string {
  return renderAdminShell(
    `Bestellungen ${view.day.day} — Buschmann 1846`,
    view,
    'orders',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Bestellungen</p>
      <h1>${escapeHtml(view.day.dayLabel)}</h1>
      <p class="bereichskopf__vorspann">Status, Zahlung, Betrag und Übergabe für diesen Produktionstag.</p>
    </header>
    ${steuerung(view.day, view.quickDays, '/admin/orders')}
    ${meldung(view.noticeCode)}
    ${bestellliste(view)}`,
  );
}

/**
 * Die Seite, auf der die Tagesdaten gerade nicht geladen werden konnten.
 *
 * DER ADMIN SIEHT KEINE TECHNIK. Kein SQL, kein D1_ERROR, kein Stacktrace,
 * kein Tabellenname — der Text ist eine Konstante und wird nicht aus dem
 * Fehler gebildet. Dieselbe Regel wie auf der Produktionsseite; sie steht
 * hier noch einmal, weil eine Seite eine Seite zurückgeben soll und kein
 * JSON.
 *
 * DIE NAVIGATION BLEIBT STEHEN. Wenn ein Tag scheitert, ist der nächste Klick
 * oft genau das, was hilft.
 */
export function renderDashboardUnavailablePage(
  view: Pick<AdminDashboardPageView, 'loginIdentifier' | 'csrfToken' | 'day' | 'quickDays'>,
): string {
  return renderAdminShell(
    `Dashboard ${view.day.day} — Buschmann 1846`,
    view,
    'overview',
    `${kopf(view.day)}
    ${steuerung(view.day, view.quickDays)}
    <p class="banner" role="alert">Die Tagesdaten konnten gerade nicht geladen werden.</p>
    <p class="leer">Bitte versuche es gleich noch einmal. Wenn es bleibt, melde dich bei Buschmann 1846.</p>`,
  );
}

/**
 * Der Seitenkopf — und die EINZIGE h1.
 *
 * Der TAG steht groß und ausgeschrieben, nicht das Wort „Dashboard": Wer
 * hier ankommt, weiß, auf welcher Seite er ist, und will wissen, welcher Tag
 * gemeint ist. „2026-08-28" wäre kürzer und zwänge zum Kopfrechnen des
 * Wochentags — in einem Betrieb ist der Wochentag die eigentliche
 * Information.
 *
 * DER KICKER SAGT, WELCHE ART SEITE DAS IST. „Dashboard · Tagesübersicht"
 * unterscheidet diese Seite in einem Wort von der Produktionsansicht: hier
 * der Überblick über einen Tag, dort die Liste, nach der gebacken wird.
 *
 * DER SATZ DARUNTER IST KEINE ZIERDE. Er sagt, worauf sich jede Zahl dieser
 * Seite bezieht: auf den PRODUKTIONSTAG und nicht auf den Bestelleingang.
 * Ohne ihn wäre „Umsatz 1.234 €" zweideutig — und zwar auf die Art, die
 * niemandem auffällt. Er WIEDERHOLT DAS DATUM NICHT mehr: Es steht eine
 * Zeile darüber in doppelter Größe, und ein zweites Mal genannt machte den
 * Satz lang, ohne ihn genauer zu machen.
 *
 * DER WEG ZUR PRODUKTION IST EINE NEBENAKTION. Er führt woandershin und tut
 * nichts — deshalb ein Textlink und keine Schaltfläche, und deshalb steht er
 * ab Tablet neben dem Kopf statt darunter: Was den Blick zuerst bekommt, ist
 * der Tag und nicht der Weg von ihm fort.
 */
function kopf(day: DashboardDayView, overview = false): string {
  return `<header class="dashkopf">
      <div class="dashkopf__text">
        <p class="dashkopf__kicker">${overview ? 'Betriebszentrale' : 'Dashboard · Tagesübersicht'}</p>
        <h1 class="dashkopf__tag">${escapeHtml(day.dayLabel)}</h1>
        <p class="dashkopf__vorspann">
          Alle Zahlen dieser Seite gehören zum Produktionstag — nicht dazu,
          wann bestellt wurde.
        </p>
      </div>
      <p class="dashkopf__aktion">
        <a href="/admin/production?date=${escapeHtml(day.day)}"
          >Produktionsansicht für diesen Tag<span aria-hidden="true"> &rarr;</span></a>
        <a href="/admin/production-list?date=${escapeHtml(day.day)}">Produktionsliste drucken</a>
        <a href="/admin/abholliste?date=${escapeHtml(day.day)}">Abholliste</a>
      </p>
    </header>`;
}

/**
 * Der Steuerbereich — die Tageswahl, und sonst nichts.
 *
 * SIE STEHT IN EINEM EIGENEN FELD und nicht frei im Fluss. Der Unterschied
 * ist keine Zierde: Alles unterhalb dieser Leiste ist ANZEIGE, alles darin
 * ist BEDIENUNG. Auf einer Seite, die sonst nur Zahlen zeigt, ist das die
 * einzige Stelle, an der etwas eingestellt wird — und sie soll als solche
 * erkennbar sein, ohne dass jemand es liest.
 *
 * DER INHALT IST UNVERÄNDERT die Bauart der Produktionsansicht: zwei <a> und
 * ein <form method="get">, kein Skript. Der Tag steht in der URL, also im
 * Lesezeichen, und der Browser-Zurückpfeil tut das Erwartete.
 *
 * DIE PFEILE NENNEN IHR ZIEL. „Zurück" allein sagt in einem Screenreader
 * nichts; „Vorheriger Tag, Donnerstag, 27. August 2026" sagt alles.
 *
 * DAS FORMULAR SENDET AN /admin/dashboard — eine Konstante im Quelltext. Ein
 * Formular, dessen action aus einem Parameter käme, wäre die Vorlage für eine
 * Weiterleitung nach draußen.
 */
function steuerung(day: DashboardDayView, quick: QuickDaysView, basePath = '/admin/dashboard'): string {
  return `<div class="tagleiste">
      ${schnellwahl(quick)}
      <nav class="tagnav tagnav--leiste" aria-label="Tag wechseln">
        <a
          class="tagnav__pfeil"
          href="${escapeHtml(basePath)}?date=${escapeHtml(day.previousDay)}"
          rel="prev"
          aria-label="Vorheriger Tag, ${escapeHtml(day.previousDayLabel)}"
        ><span aria-hidden="true">&larr;</span></a>

        <form class="tagnav__formular" method="get" action="${escapeHtml(basePath)}">
          <label for="dashboardtag">Tag wählen</label>
          <input type="date" id="dashboardtag" name="date" value="${escapeHtml(day.day)}" required>
          <button type="submit" class="senden tagnav__senden">Anzeigen</button>
        </form>

        <a
          class="tagnav__pfeil"
          href="${escapeHtml(basePath)}?date=${escapeHtml(day.nextDay)}"
          rel="next"
          aria-label="Nächster Tag, ${escapeHtml(day.nextDayLabel)}"
        ><span aria-hidden="true">&rarr;</span></a>
      </nav>
    </div>`;
}

/**
 * HEUTE · MORGEN · WOCHE.
 *
 * DREI SPRÜNGE UND KEINE VIERTE ZEILE. Sie beantworten die drei Fragen, mit
 * denen ein Betrieb morgens auf diese Seite kommt — „was ist heute?", „was
 * kommt morgen?", „wie voll ist die Woche?" — und sie ERSETZEN die freie
 * Datumswahl nicht: Pfeile und Datumsfeld stehen unverändert darunter. Wer
 * den 14. Oktober braucht, tippt ihn weiterhin ein.
 *
 * SIE STEHEN ÜBER DER DATUMSWAHL und nicht daneben. Der häufige Weg soll der
 * kurze sein; die freie Wahl ist der seltene und darf einen Blick mehr
 * kosten.
 *
 * DER AKTIVE ZUSTAND WIRD NICHT NUR GEFÄRBT. `aria-current="page"` sagt
 * dasselbe, was die Hervorhebung zeigt — dieselbe Regel wie in der
 * Hauptnavigation des Adminbereichs. Ein Betrieb, der die Seite auf einem
 * verwaschenen Tresenbildschirm liest, soll nicht an einem Farbton erkennen
 * müssen, welchen Tag er ansieht.
 *
 * DIE ZIELE SIND FERTIGE ZEICHENKETTEN aus dem Ansichtsmodell. In dieser
 * Datei wird kein Datum gerechnet und keine Adresse zusammengesetzt.
 */
function schnellwahl(quick: QuickDaysView): string {
  return `<nav class="schnellwahl" aria-label="Zeitraum wählen">
        ${[quick.today, quick.tomorrow, quick.week].map(schnellziel).join('\n        ')}
      </nav>`;
}

function schnellziel(ziel: QuickDayView): string {
  return `<a
          class="schnellwahl__ziel${ziel.isCurrent ? ' schnellwahl__ziel--aktiv' : ''}"
          href="${escapeHtml(ziel.href)}"${ziel.isCurrent ? ' aria-current="page"' : ''}
        >${escapeHtml(ziel.label)}</a>`;
}

/**
 * SECHS KARTEN, EINE ZAHL JE KARTE — ABER NICHT SECHS GLEICH LAUTE.
 *
 * VIER FRAGEN ZUERST, ZWEI DANACH. Bis Phase 6B standen alle sechs Karten
 * gleichberechtigt nebeneinander, und sechs gleich große Zahlen sind keine
 * Rangfolge, sondern eine Wand. Vorn stehen jetzt die vier, nach denen
 * morgens tatsächlich jemand sucht: wie viel ist los, was bringt es, was ist
 * noch zu tun, was ist noch nicht bezahlt. Kunden und Einheiten ordnen ein
 * und stehen dahinter — in derselben Tafel, aber leiser gesetzt. Sie sind
 * nicht unwichtig; sie sind nur nicht die Frage des Morgens.
 *
 * DER OFFENE BETRAG SCHLIESST DIE ERSTE REIHE UND WIRD HERVORGEHOBEN, solange
 * er nicht null ist. Er ist die einzige Zahl der Seite, die zu einer Handlung
 * auffordert — und die einzige, die bei null verschwinden dürfte, es aber
 * nicht tut: „0,00 € offen" ist eine gute Nachricht und soll lesbar sein.
 *
 * DIE WAND STEHT AUCH AN EINEM LEEREN TAG. Sechs Nullen sind keine schöne
 * Antwort, aber sie sind DIE Antwort — und eine Seite, die an einem ruhigen
 * Tag die Hälfte ihres Aufbaus verliert, sieht aus wie ein Ladefehler. Wer
 * den Tag wechselt, soll dieselbe Seite wiederfinden und nicht eine zweite.
 *
 * KEINE FARBEN ALS EINZIGE AUSSAGE. Was hervorgehoben ist, sagt es auch im
 * Text; ein Betrieb, der die Seite auf einem verwaschenen Tresenbildschirm
 * liest, soll nichts an einem Farbton erkennen müssen.
 */
function kennzahlen(day: DashboardDayView, overview = false): string {
  if (overview) {
    return `<section class="kennzahlwand kennzahlwand--fokus" aria-labelledby="kennzahlen-titel">
      <h2 id="kennzahlen-titel" class="nur-vorlesen">Die vier wichtigsten Signale des Tages</h2>
      <div class="kennzahlwand__gitter">
        ${karte('Bestellungen', String(day.orderCount), storniertHinweis(day), null, '#bestellungen')}
        ${karte('Einheiten', String(day.totalUnits), 'bestätigte Menge', null)}
        ${karte('Offen / in Arbeit', String(day.openCount), 'noch nicht abgeschlossen', null, `/admin/production?date=${day.day}`)}
        ${karte('Noch nicht bezahlt', day.unpaidLabel, `${day.unpaidCount} ${day.unpaidCount === 1 ? 'Bestellung' : 'Bestellungen'}`, day.unpaidCount > 0 ? 'betont' : null, `/admin/orders?date=${day.day}&orders=unpaid#bestellungen`)}
      </div>
    </section>`;
  }
  return `<section class="kennzahlwand" aria-labelledby="kennzahlen-titel">
      <h2 id="kennzahlen-titel" class="nur-vorlesen">Kennzahlen des Tages</h2>
      <div class="kennzahlwand__gitter">
        ${karte('Bestellungen', String(day.orderCount), storniertHinweis(day), null, '#bestellungen')}
        ${karte('Umsatz', day.revenueLabel, 'ohne stornierte', 'haupt')}
        ${karte(
          'Offen / in Arbeit',
          String(day.openCount),
          'noch nicht abgeschlossen',
          null,
          `/admin/production?date=${day.day}`,
        )}
        ${karte(
          'Noch nicht bezahlt',
          day.unpaidLabel,
          `${day.unpaidCount} ${day.unpaidCount === 1 ? 'Bestellung' : 'Bestellungen'}`,
          day.unpaidCount > 0 ? 'betont' : null,
          `/admin/orders?date=${day.day}&orders=unpaid#bestellungen`,
        )}
        ${karte('Kunden', String(day.customerCount), 'verschiedene Betriebe', 'zweit', '/admin/customers')}
        ${karte('Einheiten', String(day.totalUnits), 'bestätigte Menge', 'zweit')}
      </div>
    </section>`;
}

/**
 * Eine Zelle der Wand — und die einzige Stelle, an der eine Kennzahl ein
 * anderes Gewicht bekommt als ihre Nachbarn.
 *
 * ES GIBT GENAU DREI ABWEICHUNGEN, und jede ist begründet:
 *
 *   `haupt` (Umsatz) trägt die Zahl, nach der auf dieser Seite zuerst
 *   gesucht wird. Sie steht eine Stufe größer da — und sonst identisch:
 *   keine zweite Farbe, kein Rahmen, kein Symbol. Eine Rangfolge, die man
 *   sieht, ohne sie zu bemerken.
 *
 *   `betont` (Noch nicht bezahlt) ist die einzige Zahl der Seite, die zu
 *   einer Handlung auffordert — und nur, solange sie nicht null ist.
 *
 *   `zweit` (Kunden, Einheiten) sind die beiden Zahlen, die einordnen statt
 *   zu treiben. Sie stehen kleiner und auf gedecktem Grund in der zweiten
 *   Reihe derselben Tafel — nicht ausgelagert, nicht versteckt, nur leiser.
 *
 * Weitere Modifikatoren wären die Absage an die Aussage „das hier ist EIN
 * Block": Wenn jede Zelle anders aussieht, sieht man sechs Zellen und keine
 * Wand.
 */
function karte(
  label: string,
  wert: string,
  hinweis: string,
  variante: 'haupt' | 'betont' | 'zweit' | null = null,
  href: string | null = null,
): string {
  const klassen = `kennzahlkarte${variante === null ? '' : ` kennzahlkarte--${variante}`}${
    href === null ? '' : ' kennzahlkarte--weg'
  }`;
  const inhalt = `<span class="kennzahlkarte__label">${escapeHtml(label)}</span>
          <span class="kennzahlkarte__wert">${escapeHtml(wert)}</span>
          ${hinweis === '' ? '' : `<span class="kennzahlkarte__hinweis">${escapeHtml(hinweis)}</span>`}`;

  return href === null
    ? `<div class="${klassen}">
          ${inhalt}
        </div>`
    : `<a class="${klassen}" href="${escapeHtml(href)}">
          ${inhalt}
        </a>`;
}

/**
 * DER HANDLUNGSBEDARF — der Bereich, der sagt, was zu tun ist.
 *
 * ER STEHT ZWISCHEN DEN KENNZAHLEN UND DEN RINGEN, und die Stelle ist die
 * Aussage: Erst wie der Tag steht, dann was zu tun ist, dann wie er sich
 * aufteilt. Handeln ist wichtiger als Auswerten — ein Bereich, der unter den
 * Diagrammen stünde, käme nach der Analyse, und morgens um fünf liest niemand
 * so weit.
 *
 * ER IST KEIN ALARM. Kein rotes Feld, kein Warnzeichen, keine Stufen, keine
 * Zahl in einem Kreis. Ein Betrieb, der jeden Morgen dieselbe Warnfarbe sieht,
 * sieht sie nach einer Woche nicht mehr — und dann auch nicht, wenn einmal
 * wirklich etwas ist. Die Zeilen sind deshalb ruhig gesetzt: eine Ziffer,
 * zwei Zeilen Text, ein Weg.
 *
 * JEDE ZEILE IST GANZ EIN LINK und nicht ein Text mit einem kleinen „mehr"
 * daneben. Auf einem Telefon ist damit die ganze Zeile die Tippfläche; mit
 * der Tastatur ist es EIN Sprungziel je Aktion und nicht zwei.
 *
 * DER RUHIGE ZUSTAND IST EIN SATZ UND KEINE LEERE. Der Bereich verschwindet
 * nicht, wenn nichts offen ist: Eine Seite, die je nach Tag einen Abschnitt
 * mehr oder weniger hat, springt beim Tageswechsel — und wer sie zum ersten
 * Mal an einem ruhigen Tag sieht, weiß nicht, dass es diesen Bereich gibt.
 * Drei Karten mit einer 0 wären das andere Extrem und wären Rauschen an der
 * Stelle, an der etwas stehen soll, wenn etwas ist.
 */
function handlungsbedarf(day: DashboardDayView, title = 'Handlungsbedarf'): string {
  const inhalt =
    day.actions.length === 0
      ? `<p class="handlung__ruhe">Für diesen Produktionstag ist aktuell nichts offen.</p>
      <p class="handlung__ruhedetail">Neue Bestellungen, Produktion und Zahlungen sind erledigt.</p>`
      : `<ul class="handlung__liste">
        ${day.actions.map(handlungszeile).join('\n        ')}
      </ul>`;

  return `<section class="tafel handlung" aria-labelledby="handlung-titel">
      <div class="tafel__kopf">
      <h2 id="handlung-titel" class="tafel__titel">${escapeHtml(title)}</h2>
        ${
          day.actions.length === 0
            ? ''
            : `<p class="tafel__meta">${day.actions.length} ${
                day.actions.length === 1 ? 'Punkt' : 'Punkte'
              }</p>`
        }
      </div>
      ${inhalt}
    </section>`;
}

/**
 * Eine Zeile: Ziffer, Sache, Weg.
 *
 * DIE ZIFFER IST NICHT `aria-hidden`. Anders als die Rangziffer in
 * „Meistbestellt", die nur eine Reihenfolge sichtbar macht: Hier IST die Zahl
 * die Auskunft — wie viele es sind —, und sie steht nirgends sonst in der
 * Zeile. Vorgelesen ergibt sich „3 Neue Bestellungen warten auf Bestätigung
 * Zur Produktion", also genau der Satz, den ein Sehender liest.
 */
function handlungszeile(aktion: DashboardActionView): string {
  return `<li class="handlung__punkt">
          <a class="handlungszeile handlungszeile--${escapeHtml(
            aktion.key,
          )}" href="${escapeHtml(aktion.href)}">
            <span class="handlungszeile__zahl">${escapeHtml(aktion.countLabel)}</span>
            <span class="handlungszeile__text">
              <span class="handlungszeile__sache">${escapeHtml(aktion.title)}${
                aktion.amountLabel === ''
                  ? ''
                  : ` <span class="handlungszeile__betrag">${escapeHtml(
                      aktion.amountLabel,
                    )}</span>`
              }</span>
              <span class="handlungszeile__detail">${escapeHtml(aktion.detail)}</span>
            </span>
            <span class="handlungszeile__weg">${escapeHtml(
              aktion.linkLabel,
            )}<span aria-hidden="true"> &rarr;</span></span>
          </a>
        </li>`;
}

/**
 * DIE FINANZEN DES TAGES — vier Zeilen, kein Diagramm, keine vierte Karte.
 *
 * WARUM KEINE KENNZAHLENKARTEN. Herstellkosten, Rohertrag und Marge als drei
 * weitere Karten hätten die Wand oben von sechs auf neun Felder gebracht —
 * und eine Wand mit neun Feldern ist keine Wand mehr, sondern eine Tabelle
 * mit Rahmen. Sie hätten außerdem die falsche Rangfolge behauptet: Der Umsatz
 * treibt den Tag an, die Marge ordnet ihn ein. Was einordnet, steht nicht in
 * derselben Größe wie das, was antreibt.
 *
 * DER UMSATZ STEHT TROTZDEM NOCH EINMAL DA, und das ist kein Doppel: Er ist
 * die erste Zeile einer RECHNUNG. Ohne ihn stünden „Herstellkosten",
 * „Rohertrag" und „Marge" ohne ihre Bezugsgröße da, und man müsste zum
 * Nachrechnen zwei Abschnitte weiter oben schauen. Es ist dieselbe Zahl aus
 * derselben Quelle — das Ansichtsmodell formatiert sie zweimal und rechnet
 * sie nicht zweimal.
 *
 * DIE STELLE IST GEWÄHLT: nach dem Handlungsbedarf, vor den Ringen. Erst was
 * zu TUN ist, dann was der Tag EINBRINGT, dann wie er sich aufteilt. Ein
 * Finanzbereich ganz oben hätte eine Bäckerei morgens um fünf mit einer
 * Auswertung begrüßt, statt mit dem, was ansteht.
 *
 * ER IST KEIN ALARM, AUCH BEI UNVOLLSTÄNDIGER KOSTENBASIS. Kein rotes Feld,
 * kein Warnzeichen: Fehlende Herstellkosten sind kein Fehler, sondern etwas,
 * das noch nicht gepflegt ist — bei jeder Bestellung von vor Phase 7A ist es
 * der Normalzustand. Es steht ein Satz da und ein Weg dorthin, wo man es
 * ändern kann.
 *
 * ER TRÄGT KEINE LOGIK. Ob eine Marge erscheint, steht fertig im
 * Ansichtsmodell; diese Funktion setzt Zeichenketten. Eine Bedingung wie
 * `costs.complete ? … : '—'` in dieser Datei wäre eine fachliche Regel in
 * einer Zeichenkettenverkettung — prüfbar nur über HTML.
 */
function finanzen(day: DashboardDayView): string {
  const finanz: DashboardFinanceView = day.finance;

  return `<section class="tafel finanzen" aria-labelledby="finanzen-titel">
      <div class="tafel__kopf">
        <h2 id="finanzen-titel" class="tafel__titel">Finanzen</h2>
        <p class="tafel__meta finanzen__stand${
          finanz.isComplete ? '' : ' finanzen__stand--offen'
        }">${escapeHtml(finanz.statusLabel)}</p>
      </div>
      <dl class="finanzliste">
        ${finanzzeile('Umsatz', finanz.revenueLabel)}
        ${finanzzeile('Herstellkosten', finanz.costLabel)}
        ${finanzzeile('Rohertrag', finanz.grossProfitLabel, finanz.isNegative ? 'minus' : 'summe')}
        ${finanzzeile('Marge', finanz.marginLabel, finanz.isMarginNegative ? 'minus' : 'summe')}
      </dl>
      <p class="finanzen__hinweis">${escapeHtml(finanz.note)}${
        finanz.href === null
          ? ''
          : ` <a class="finanzen__weg" href="${escapeHtml(finanz.href)}">${escapeHtml(
              finanz.linkLabel,
            )}<span aria-hidden="true"> &rarr;</span></a>`
      }</p>
    </section>`;
}

/**
 * Eine Zeile der Rechnung: Bezeichnung links, Betrag rechts.
 *
 * ES IST EIN <dl> UND KEINE TABELLE. Vier Paare aus Begriff und Wert sind
 * genau das, wofür eine Beschreibungsliste da ist; eine Tabelle behauptete
 * Spalten, die es nicht gibt, und brächte auf dem Telefon die
 * Karten-Umschaltung der `.datentabelle` mit, die hier nichts zu tun hätte.
 *
 * ZWEI ABWEICHUNGEN UND KEINE DRITTE: `summe` setzt Rohertrag und Marge etwas
 * kräftiger — sie sind das ERGEBNIS der beiden Zeilen darüber. `minus`
 * kennzeichnet einen negativen Rohertrag, und zwar zusätzlich zum Minuszeichen,
 * das ohnehin im Text steht: Die Farbe ist nie die einzige Aussage.
 */
function finanzzeile(label: string, wert: string, variante: 'summe' | 'minus' | null = null): string {
  const klasse = `finanzzeile${variante === null ? '' : ` finanzzeile--${variante}`}`;
  return `<div class="${klasse}">
          <dt class="finanzzeile__label">${escapeHtml(label)}</dt>
          <dd class="finanzzeile__wert">${escapeHtml(wert)}</dd>
        </div>`;
}

/**
 * DIE VERTEILUNG DES TAGES — zwei Ringe und kein drittes Diagramm.
 *
 * WARUM ÜBERHAUPT EIN DIAGRAMM, wo diese Datei ein Liniendiagramm über sieben
 * Tage ausdrücklich ablehnt? Weil der Unterschied nicht „Diagramm ja/nein"
 * ist, sondern was gezeigt wird. Eine Kurve über sieben Tage BEHAUPTET einen
 * Verlauf, den drei bis vierzig Bestellungen am Tag nicht hergeben — sie
 * zeigt Rauschen und sieht nach Auswertung aus. Ein Ring über EINEN Tag
 * behauptet nichts: Er zeigt ein Verhältnis, das ohnehin feststeht, und zwar
 * schneller, als man zwei Zahlen im Kopf ins Verhältnis setzt. „Vier von
 * fünf sind bezahlt" ist auf einen Blick da; aus „Umsatz 130,50 €" und
 * „offen 69,60 €" muss man es rechnen.
 *
 * ZWEI RINGE UND NICHT FÜNF. Es gibt genau zwei Fragen, deren Antwort ein
 * Verhältnis ist: Wie viel vom Tag ist bezahlt, und wo stehen die
 * Bestellungen. Alles andere auf dieser Seite ist eine einzelne Zahl oder
 * eine Liste, und beides wird durch einen Kreis nicht besser.
 *
 * KEINE BIBLIOTHEK. Zwei Ringe sind zwei <circle> mit `stroke-dasharray` —
 * das ist der ganze Aufwand. Eine Diagrammbibliothek brächte JavaScript auf
 * eine Seite, die keines hat, und stünde damit gegen `script-src 'self'`
 * ebenso wie gegen den Grundsatz dieser Oberfläche, dass die Kernbedienung
 * ohne Skript funktioniert. Sie wäre zudem der erste fremde Code im
 * Auslieferungspfad einer Seite, die einen Bäckereibetrieb anmeldet.
 *
 * DIE GRAFIK TRÄGT KEINE INFORMATION, DIE NICHT DANEBEN STEHT. Das <svg> ist
 * `aria-hidden`; jede Zahl, jeder Anteil und jede Beschriftung steht als Text
 * in der Legende. Damit ist der Ring genau das, was er sein soll — eine
 * schnellere Lesart derselben Angaben — und niemals die einzige.
 */
function ringzone(day: DashboardDayView): string {
  return `<div class="ringzone">
      ${ringtafel('Zahlungen', 'zahlungsring', day.paymentDonut, 'Für diesen Tag ist noch keine Bestellung eingegangen. Sobald eine vorliegt, steht hier, wie viel davon bezahlt ist.')}
      ${ringtafel('Bestellstatus', 'statusring', day.statusDonut, 'Für diesen Tag ist noch keine Bestellung eingegangen. Sobald eine vorliegt, steht hier, wo sie steht.')}
    </div>`;
}

/**
 * Eine Ringtafel: Kopf, Ring, Legende.
 *
 * DER LEERE TAG BEKOMMT DENSELBEN RING, nur ohne Stücke — eine vollständige
 * Spur in der ruhigen Leinenfarbe, eine 0 in der Mitte und ein Satz statt der
 * Legende. Ein Diagramm, das an einem stillen Tag verschwindet, macht die
 * Seite an genau dem Tag unvollständig, an dem jemand zum ersten Mal
 * nachsieht, ob überhaupt etwas los ist.
 */
function ringtafel(titel: string, id: string, ring: DonutView, leerText: string): string {
  return `<section class="tafel ringtafel" aria-labelledby="${escapeHtml(id)}-titel">
        <div class="tafel__kopf">
          <h2 id="${escapeHtml(id)}-titel" class="tafel__titel">${escapeHtml(titel)}</h2>
          ${
            ring.isEmpty
              ? ''
              : `<p class="tafel__meta">${escapeHtml(ring.totalCountLabel)}</p>`
          }
        </div>
        <div class="ringtafel__inhalt">
          <div class="ring">
            ${ringGrafik(ring)}
            <p class="ring__mitte">
              <span class="ring__zahl">${escapeHtml(ring.totalLabel)}</span>
              <span class="ring__wort">${escapeHtml(ring.totalCaption)}</span>
            </p>
          </div>
          ${ring.isEmpty ? `<p class="ringlegende__leer">${escapeHtml(leerText)}</p>` : ringLegende(ring)}
        </div>
      </section>`;
}

/**
 * Der Ring als SVG.
 *
 * `aria-hidden` und `focusable="false"`: Die Grafik ist die Zweitfassung der
 * Legende und soll in keiner Vorlesereihenfolge und in keinem Tabulaturweg
 * auftauchen — der Internet Explorer machte SVGs sonst fokussierbar, und
 * einige Screenreader lesen sonst „Grafik" ohne jeden Inhalt vor.
 *
 * `stroke-dasharray` und `stroke-dashoffset` stehen als ATTRIBUTE da und
 * nicht als Stil. Die Begründung steht in dashboard-view.ts: Die CSP dieser
 * Anwendung kennt kein `'unsafe-inline'` für Stile, und ein `style="…"` am
 * Segment würde stillschweigend verworfen.
 */
function ringGrafik(ring: DonutView): string {
  const stuecke = ring.isEmpty
    ? ''
    : ring.segments
        .filter((segment) => segment.count > 0)
        .map(
          (segment) => `<circle
            class="ring__stueck ring__stueck--${escapeHtml(segment.key)}"
            cx="21" cy="21" r="15.9155"
            stroke-dasharray="${escapeHtml(segment.dashArray)}"
            stroke-dashoffset="${escapeHtml(segment.dashOffset)}"
          />`,
        )
        .join('\n          ');

  return `<svg class="ring__grafik" viewBox="0 0 42 42" aria-hidden="true" focusable="false">
              <g transform="rotate(-90 21 21)">
                <circle class="ring__spur" cx="21" cy="21" r="15.9155" />
                ${stuecke}
              </g>
            </svg>`;
}

/**
 * Die Legende — und der eigentliche Inhalt der Tafel.
 *
 * Jede Zeile nennt das Wort, die Anzahl und, wo es einen gibt, den Betrag.
 * Die Farbmarke davor ist `aria-hidden`: Sie ordnet dem Ring zu, sie sagt
 * nichts. Wer die Farben nicht unterscheiden kann — oder die Seite auf einem
 * verwaschenen Tresenbildschirm liest —, verliert damit keine Angabe.
 */
function ringLegende(ring: DonutView): string {
  return `<ul class="ringlegende">
            ${ring.segments
              .map(
                (segment) => `<li class="ringlegende__zeile">
              <span class="ringlegende__marke ringlegende__marke--${escapeHtml(
                segment.key,
              )}" aria-hidden="true"></span>
              <span class="ringlegende__wort">${escapeHtml(segment.label)}</span>
              <span class="ringlegende__zahl">${escapeHtml(segment.countLabel)}</span>
              ${
                segment.detailLabel === ''
                  ? ''
                  : `<span class="ringlegende__betrag">${escapeHtml(segment.detailLabel)}</span>`
              }
            </li>`,
              )
              .join('\n            ')}
            ${
              ring.footnote === ''
                ? ''
                : `<li class="ringlegende__fussnote">${escapeHtml(ring.footnote)}</li>`
            }
          </ul>`;
}

/**
 * „zusätzlich 1 storniert" — und nur dann, wenn es stimmt.
 *
 * „ZUSÄTZLICH" UND NICHT „DAVON": orderCount zählt die stornierten gar nicht
 * mit (siehe domain/dashboard-day.ts). „davon 1 storniert" unter einer 5
 * behauptete, es seien vier übrig — tatsächlich sind es fünf und eine sechste
 * ist zurückgezogen. Ein Wort, das die Summe falsch erklärt, ist schlimmer
 * als keines.
 *
 * Eine Zeile „zusätzlich 0 storniert" wäre Rauschen an der Stelle, an der ein
 * Betrieb eine Zahl sucht. Sie erscheint, solange die Antwort nicht null ist —
 * dieselbe Regel wie bei den offenen Zuordnungen auf der Kundenseite.
 */
function storniertHinweis(day: DashboardDayView): string {
  return day.cancelledCount === 0 ? '' : `zusätzlich ${day.cancelledCount} storniert`;
}

/**
 * „Meistbestellt" — nach MENGE, nicht nach Umsatz.
 *
 * Die Begründung steht in domain/dashboard-day.ts: Auf einer Seite, die ein
 * Betrieb morgens liest, ist „wovon geht am meisten weg" die brauchbare
 * Aussage; nach Umsatz sortiert stünde oben, was teuer ist. Weil man das der
 * Liste nicht ansieht, steht es als kleine Angabe im Kopf der Tafel — nicht
 * als Fußnote unter der Seite, wo es niemand mit der Liste verbindet.
 *
 * DIE RANGZIFFER STEHT SEIT PHASE 6B WIEDER DA — als Ziffer und nicht als
 * Medaille. Die frühere Fassung ließ die Nummerierung des <ol> ausblenden mit
 * der Begründung, ein „1." vor dem meistbestellten Kuchen lese sich wie eine
 * Platzierung in einem Wettbewerb. Das stimmt für ein fettes „1." am
 * Zeilenanfang; es stimmt nicht für eine schmale, gedeckte Ziffer in einer
 * eigenen Spalte. Die tut etwas anderes: Sie gibt fünf verschieden langen
 * Produktnamen eine gemeinsame linke Kante und macht die Liste als Reihenfolge
 * lesbar, statt sie wie eine zufällige Aufzählung aussehen zu lassen.
 *
 * Sie ist `aria-hidden`: Das <ol> trägt die Reihenfolge bereits, und ein
 * vorgelesenes „eins Beispiel Käsekuchen elf Stück" wäre eine Zahl zu viel.
 *
 * DER ABSCHNITT BLEIBT STEHEN, AUCH WENN ER LEER IST. Die frühere Fassung
 * ließ ihn verschwinden; das machte die Seite an einem ruhigen Tag kürzer und
 * unvollständiger, und wer sie zum ersten Mal an so einem Tag sah, wusste
 * nicht, dass es diesen Abschnitt gibt. Ein Satz sagt, was fehlt, und nimmt
 * denselben Platz ein wie die Liste, die morgen dort steht.
 */
function topProdukte(day: DashboardDayView, title = 'Meistbestellt'): string {
  const inhalt =
    day.topProducts.length === 0
      ? `<p class="tafel__leer">Für diesen Tag ist noch keine Bestellung bestätigt. Sobald eine Bestellung bestätigt ist, steht hier, wovon am meisten gebraucht wird.</p>`
      : `<ol class="topliste">
        ${day.topProducts
          .map(
            (line, index) => `<li class="topliste__zeile">
          <span class="topliste__rang" aria-hidden="true">${index + 1}</span>
          <span class="topliste__name">${escapeHtml(line.name)}</span>
          <span class="topliste__menge"><span class="topliste__zahl">${
            line.quantity
          }</span> <span class="topliste__einheit">${escapeHtml(line.unit)}</span></span>
        </li>`,
          )
          .join('\n        ')}
      </ol>`;

  return `<section class="tafel topprodukte" aria-labelledby="topprodukte-titel">
      <div class="tafel__kopf">
        <h2 id="topprodukte-titel" class="tafel__titel">${escapeHtml(title)}</h2>
        <p class="tafel__meta">nach Menge</p>
      </div>
      ${inhalt}
    </section>`;
}

/**
 * Die Bestellungen des Tages — als TABELLE, weil die Daten eine sind.
 *
 * Gleichartige Zeilen, benannte Spalten, eine Kopfzeile, die sie benennt.
 * Dieselbe `.datentabelle`, die Kunden- und Katalogseite benutzen: Auf
 * schmalen Geräten zerfällt sie in Karten mit Beschriftung je Zelle, auf
 * breiten wird sie zur Tabelle. Ein geschrumpfter Desktop-Tabellenkörper mit
 * seitlichem Scrollen wäre auf einem Tresengerät unbenutzbar.
 *
 * DIE TAFEL UM DIE TABELLE GILT ERST AB TABLET. Darunter ist die Tabelle
 * selbst schon eine Reihe von Karten; eine Karte in einer Karte ist ein
 * Rahmen zu viel. Der Kopf mit der Überschrift steht auf beiden Breiten —
 * er ist es, der den Abschnitt zum Abschnitt macht.
 *
 * DIE BESTELLNUMMER STEHT IN EINEM <th scope="row">: Sie benennt die Zeile.
 * Ein Screenreader liest damit bei jeder Zelle mit, um welche Bestellung es
 * geht.
 *
 * STORNIERTE BESTELLUNGEN BLEIBEN IN DER LISTE und tragen ein WORT, nicht nur
 * eine Farbe. Sie zu verstecken machte die Seite ruhiger und unehrlich: Wer
 * wissen will, warum der Tag dünn aussieht, muss die Stornierung sehen.
 *
 * SIE TRÄGT `id="bestellungen"` UND IST DAMIT EIN SPRUNGZIEL. Die Kennzahl
 * „Bestellungen" und die Aktion „Offene Zahlungen anzeigen" führen hierher;
 * ohne Anker landete man am Seitenanfang und müsste an der Kennzahlenwand
 * vorbeiscrollen, die man gerade angeklickt hat.
 *
 * DER FILTER IST EINE FASSUNG DERSELBEN LISTE und keine zweite Seite.
 * Überschrift, Anzahl und der Weg zurück kommen fertig aus dem
 * Ansichtsmodell; diese Datei entscheidet nicht, welche Zeile bleibt — was
 * „unbezahlt" heißt, steht in der Domäne. Dass gefiltert ist, sagt die
 * ÜBERSCHRIFT und nicht eine Farbe: „Offene Zahlungen" statt „Bestellungen".
 *
 * DIE KENNZAHLEN ÜBER DER LISTE BLEIBEN UNGEFILTERT. Ein Filter, der auch sie
 * änderte, wäre eine zweite Tagesansicht mit anderen Zahlen unter derselben
 * Adresse — und der Umsatz des Tages hinge daran, welchen Knopf jemand zuvor
 * gedrückt hat.
 *
 * DER LEERE FALL STEHT HIER UND NICHT IN EINER ZWEITEN FUNKTION. Vorher gab
 * es `leereBestellliste()` daneben; mit dem Filter hätte es davon zwei
 * gebraucht — eine für „an diesem Tag ist nichts bestellt" und eine für „an
 * diesem Tag ist nichts offen". Der Satz kommt jetzt aus dem Ansichtsmodell,
 * der Rahmen ist in beiden Fällen derselbe, und der Anker bleibt erreichbar
 * — auch das war vorher nicht so.
 */
function bestellliste(view: AdminDashboardPageView): string {
  const liste = view.orderList;

  return `<section
      class="tafel${liste.rows.length === 0 ? '' : ' tafel--tabelle'} bestellliste"
      id="bestellungen"
      aria-labelledby="bestellliste-titel"
    >
      <div class="tafel__kopf">
        <h2 id="bestellliste-titel" class="tafel__titel">${escapeHtml(liste.title)}</h2>
        <p class="tafel__meta">${escapeHtml(liste.meta)}</p>
        ${
          liste.isFiltered
            ? `<p class="tafel__weg"><a href="${escapeHtml(
                liste.allHref,
              )}">Alle Bestellungen</a></p>`
            : ''
        }
      </div>
      ${
        liste.rows.length === 0
          ? `<p class="tafel__leer">${escapeHtml(liste.emptyText)}</p>`
          : `<div class="datentabelle-wrap">
        <table class="datentabelle">
          <thead><tr>
            <th scope="col">Bestellung</th>
            <th scope="col">Kunde</th>
            <th scope="col">Produktion</th>
            <th scope="col">Status ändern</th>
            <th scope="col" class="spalte-betrag">Betrag</th>
            <th scope="col">Zahlung</th>
            <th scope="col">Zahlungsstatus ändern</th>
          </tr></thead>
          <tbody>${liste.rows
            .map((order) => bestellzeile(order, view.csrfToken))
            .join('')}</tbody>
        </table>
      </div>`
      }
    </section>`;
}

function bestellzeile(order: DashboardOrderRowView, csrfToken: string): string {
  return `<tr${order.isCancelled ? ' class="bestellzeile--storniert"' : ''}>
      <th scope="row" data-label="Bestellung">
        <span class="bestellzeile__nummer">${escapeHtml(order.orderNumber)}</span>
        <span class="bestellzeile__zeit">${escapeHtml(order.orderedAtLabel)}</span>
        ${order.emailStatusLabel === null ? '' : `<span class="bestellzeile__email">${escapeHtml(order.emailStatusLabel)}</span>`}
        ${emailRetryForm(order, csrfToken)}
      </th>
      <td data-label="Kunde"><span class="bestellzeile__kunde">${escapeHtml(
        order.customerName,
      )}</span><span class="bestellzeile__art">${escapeHtml(order.fulfillmentLabel)}</span></td>
      <td data-label="Produktion">${
        order.isCancelled
          ? `<span class="bestellzeile__storno">${escapeHtml(order.statusLabel)}</span>`
          : escapeHtml(order.statusLabel)
      }</td>
      <td data-label="Status ändern" class="statusaktionen">${statusaktionen(order, csrfToken)}${bearbeitenLink(
        order,
      )}</td>
      <td data-label="Betrag" class="bestellzeile__betrag">${escapeHtml(order.amountLabel)}</td>
      <td data-label="Zahlung">${
        order.isPaid
          ? `<span class="zahlstand zahlstand--bezahlt">${escapeHtml(order.paymentStatusLabel)}</span>`
          : `<span class="zahlstand zahlstand--offen">${escapeHtml(order.paymentStatusLabel)}</span>`
      }</td>
      <td data-label="Zahlungsstatus ändern" class="zahlungaktion">${zahlungsformular(
        order,
        csrfToken,
      )}</td>
    </tr>`;
}

/**
 * Der Weg zur Positionsbearbeitung — ein LINK und kein Formular.
 *
 * Er steht in derselben Spalte wie die Statusschaltflächen, weil er zur
 * selben Frage gehört: „was tue ich mit dieser Bestellung?". Er ist trotzdem
 * anders gebaut, und der Unterschied ist die Aussage — ein Statuswechsel
 * geschieht mit dem Klick, die Bearbeitung führt erst einmal auf eine Seite,
 * auf der man sieht, was drinsteht.
 *
 * ER ERSCHEINT NICHT, WENN ER NICHT DARF. Ob bearbeitet werden kann, hat
 * canEditOrderItems() im Ansichtsmodell entschieden; diese Datei prüft keinen
 * Status. Ein Knopf, den der Server ablehnt, ist schlimmer als kein Knopf.
 *
 * Die Bestellnummer steht im sichtbar unsichtbaren Zusatz, damit ein
 * Screenreader nicht zwanzigmal „Bestellung bearbeiten" ohne Bezug liest —
 * dieselbe Bauart wie bei den Statusschaltflächen daneben.
 */
function bearbeitenLink(order: DashboardOrderRowView): string {
  if (order.editHref === null) return '';

  return `<a class="statustaste statustaste--bearbeiten" href="${escapeHtml(
    order.editHref,
  )}">Bestellung bearbeiten<span class="hinweis"> — Bestellung ${escapeHtml(
    order.orderNumber,
  )}</span></a>`;
}

function emailRetryForm(order: DashboardOrderRowView, csrfToken: string): string {
  if (!order.emailRetryAvailable) return '';
  const orderNumber = escapeHtml(encodeURIComponent(order.orderNumber));
  return `<form class="emailretry" method="post" action="/api/admin/orders/${orderNumber}/email-retry">
          <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
          <button type="submit" class="statustaste">E-Mail erneut senden<span class="hinweis"> — Bestellung ${escapeHtml(order.orderNumber)}</span></button>
        </form>`;
}

function statusaktionen(order: DashboardOrderRowView, csrfToken: string): string {
  if (order.actions.length === 0) return '<span class="tafel__meta">Keine Aktion</span>';

  return order.actions
    .map((action) => {
      const orderNumber = escapeHtml(encodeURIComponent(order.orderNumber));
      const label = escapeHtml(action.label);
      const accessibleOrder = `<span class="hinweis"> — Bestellung ${escapeHtml(order.orderNumber)}</span>`;

      if (action.destructive) {
        return `<a class="statustaste statustaste--abbruch" href="/admin/orders/${orderNumber}/cancel?workspace=orders">${label}${accessibleOrder}</a>`;
      }

      return `<form class="statusaktion" method="post" action="/api/admin/orders/${orderNumber}/status?workspace=orders">
          <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
          <input type="hidden" name="status" value="${escapeHtml(action.target)}">
          <button type="submit" class="statustaste">${label}${accessibleOrder}</button>
        </form>`;
    })
    .join('');
}

/**
 * Das Zahlungsformular EINER Zeile.
 *
 * DIE BESTELLUNG STEHT IM PFAD und nicht im Körper. Damit gibt es kein Feld,
 * über das sich eine andere Bestellung unterschieben ließe — und der Server
 * prüft den Pfad ohnehin, bevor er irgendetwas schreibt.
 *
 * IM KÖRPER STEHEN GENAU ZWEI FELDER: der CSRF-Token der Sitzung und der
 * gewünschte Zahlungsstand. Kein Betrag, kein Kunde, kein Produktionsstatus,
 * kein Rückkehrziel. Was nicht im Formular steht, wird auch nicht gelesen —
 * und ein Betragsfeld an dieser Stelle wäre der Anfang eines Kassensystems.
 *
 * EIN AUSWAHLFELD UND EINE SCHALTFLÄCHE, nicht fünf Schaltflächen. Anders als
 * beim Statuswechsel, wo jede Aktion einen eigenen Knopf hat, weil sie einen
 * Schritt bedeutet: Hier wird kein Schritt getan, sondern ein Stand
 * eingetragen — und der bestehende Stand soll dabei sichtbar vorausgewählt
 * sein. Fünf Knöpfe zeigten nicht, wo die Bestellung gerade steht.
 *
 * DAS LABEL NENNT DIE BESTELLNUMMER. „Zahlungsstatus" allein käme in einem
 * Screenreader zwanzigmal gleich an; „Zahlungsstatus für Bestellung
 * BUS-2026-000001" sagt, worüber gerade entschieden wird. Sichtbar ist es
 * nicht — die Spaltenüberschrift sagt es Sehenden bereits.
 *
 * AUCH EINE STORNIERTE BESTELLUNG BEKOMMT EIN FORMULAR. Sie kann bezahlt
 * worden sein, bevor sie storniert wurde; das nachzutragen darf die Seite
 * nicht verhindern. Auf den Umsatz wirkt es weiterhin nicht.
 */
function zahlungsformular(order: DashboardOrderRowView, csrfToken: string): string {
  const feldId = `zahlung-${order.orderNumber}`;
  const ziel = encodeURIComponent(order.orderNumber);

  return `<form method="post" action="/api/admin/orders/${escapeHtml(ziel)}/payment" class="zahlung">
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
        <label class="nur-vorlesen" for="${escapeHtml(feldId)}">Zahlungsstatus für Bestellung ${escapeHtml(
          order.orderNumber,
        )}</label>
        <select id="${escapeHtml(feldId)}" name="payment_status" class="zahlung__wahl">
          ${PAYMENT_OPTIONS.map(
            (option) =>
              `<option value="${escapeHtml(option.value)}"${
                option.value === order.paymentStatus ? ' selected' : ''
              }>${escapeHtml(option.label)}</option>`,
          ).join('\n          ')}
        </select>
        <button type="submit" class="senden zahlung__senden">Speichern</button>
      </form>`;
}

/**
 * Die Rückmeldung nach dem Speichern.
 *
 * ERFOLG UND FEHLSCHLAG SEHEN NICHT GLEICH AUS. `.banner` ist im ganzen
 * System die FEHLERdarstellung — roter Grund, vorangestelltes Warnzeichen.
 * „Der Zahlungsstatus wurde gespeichert." mit einem Warndreieck davor wäre
 * eine Meldung, die ihrer eigenen Aussage widerspricht.
 *
 * role="status" und nicht role="alert": Der Vorgang ist abgeschlossen, die
 * Meldung unterbricht niemanden.
 */
function meldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(MELDUNGEN, code) ? MELDUNGEN[code] : null;
  if (text === undefined || text === null) return '';

  const istErfolg =
    code === 'payment_saved' || code === 'status_saved' || code === 'order_cancelled_by_items';
  const klasse = istErfolg ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}
