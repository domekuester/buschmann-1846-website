import { renderAdminShell } from './admin-page-html';
import type {
  AnalyticsBreakdownView,
  AnalyticsComparisonCardView,
  AnalyticsDeltaView,
  AnalyticsKpiView,
  AnalyticsTrendView,
  AnalyticsView,
  TopCustomerView,
  TopProductView,
} from './analytics-view';
import { escapeHtml } from './format';

/**
 * Die Auswertung — der siebte Adminbereich.
 *
 * SIE IST KEINE BUCHHALTUNG. Kein Konto, keine Steuer, keine Rechnung, kein
 * Export. Die Seite beantwortet acht Fragen, die ein Betrieb einmal in der
 * Woche stellt — wie viel verkauft, mehr oder weniger als vorher, wie viele
 * Bestellungen, was geht am besten, wer bestellt am meisten, wie viel ist
 * offen, sind die Kosten vollständig, was bleibt übrig — und keine neunte.
 *
 * SIE TRÄGT KEIN SKRIPT. Zeitraumwahl, Reihenumschalter und die freie Spanne
 * sind echte Links und ein echtes <form method="get">. Damit funktioniert
 * die ganze Seite ohne JavaScript, der Zurückpfeil des Browsers tut das
 * Erwartete, der Zeitraum steht in der Adresszeile — also im Lesezeichen —
 * und die CSP mit `default-src 'none'` wird nicht auf die Probe gestellt.
 *
 * SIE SCHREIBT NICHTS. Kein POST, kein Formular mit Nebenwirkung, kein
 * CSRF-Token außerhalb der Abmeldung im Kopf. Eine Auswertung liest.
 *
 * DIE DIAGRAMME SIND SVG UND KEINE BIBLIOTHEK. Ein Balken ist ein <rect>;
 * das ist der ganze Aufwand. Die Geometrie steht als ATTRIBUT und nicht als
 * Stil — `style-src 'self'` kennt kein `'unsafe-inline'`, und ein
 * `style="height: 42%"` würde stillschweigend verworfen. Dieselbe
 * Entscheidung wie bei den Ringen des Tagesüberblicks, und aus demselben
 * Grund: Die Grafik trägt keine Angabe, die nicht als Text danebensteht.
 */
export interface AdminAnalyticsPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly analytics: AnalyticsView;
}

export function renderAdminAnalyticsPage(view: AdminAnalyticsPageView): string {
  const a = view.analytics;

  return renderAdminShell(
    `Auswertung ${a.rangeLabel} — Buschmann 1846`,
    view,
    'analytics',
    `
      ${kopf(a)}
      ${zeitleiste(a)}
      ${a.isEmpty ? `<p class="auswertleer" role="status">${escapeHtml(a.emptyText)}</p>` : ''}
      ${kennzahlwand(a)}
      ${kurventafel(a.trend, a.isEmpty)}
      <div class="auswertpaar">
        ${produkttafel(a.topProducts)}
        ${kundentafel(a.topCustomers)}
      </div>
      ${vergleichstafel(a.comparisonCards)}
      <div class="auswertpaar auswertpaar--leise">
        ${anteiltafel('Gastronomie und Privatkunden', 'gastro-privat', a.customerGroups, 'Für diesen Zeitraum ist noch keine Bestellung eingegangen.')}
        ${anteiltafel('Lieferung und Abholung', 'lieferung-abholung', a.fulfillment, 'Für diesen Zeitraum ist noch keine Bestellung eingegangen.')}
      </div>`,
  );
}

/**
 * Der Kopf — und die EINZIGE h1 der Seite.
 *
 * Sie trägt den ZEITRAUM und nicht das Wort „Auswertung". Wer hier ankommt,
 * weiß aus der Navigation, wo er ist; was er nicht weiß, ist, worüber die
 * Zahlen darunter sprechen. „September 2026 (bis heute)" beantwortet genau
 * das, und der Zusatz in Klammern verhindert die Fehldeutung, die eine
 * Monatszahl mitten im Monat sonst hätte.
 *
 * DER VERGLEICHSZEITRAUM STEHT IM KOPF UND NICHT ERST UNTEN. Jede
 * Pfeilangabe der Seite bezieht sich auf ihn; ihn erst im Abschnitt
 * „Vergleich" zu nennen hieße, die halbe Seite ohne Bezugsgröße zu lesen.
 */
function kopf(a: AnalyticsView): string {
  return `<header class="auswertkopf">
        <p class="auswertkopf__kicker">Auswertung</p>
        <h1 class="auswertkopf__titel">${escapeHtml(a.rangeLabel)}</h1>
        <p class="auswertkopf__vorspann">
          Gezählt wird nach Liefer- und Abholtag. Verglichen mit: ${escapeHtml(a.previousLabel)}.
        </p>
      </header>`;
}

/**
 * Die Zeitraumleiste — alles, was man einstellt, in EINEM Feld.
 *
 * Dieselbe Rolle und derselbe beige Grund wie die Tagesleiste der Übersicht:
 * Was darin steht, ist Bedienung; was darunter steht, ist Anzeige.
 *
 * FÜNF ECHTE LINKS UND EIN ECHTES FORMULAR. Keine Registerkarten aus
 * <button>, kein Skript, kein Zustand im Browser. `aria-current="page"`
 * markiert die Wahl für den Screenreader; die dunkle Fläche ist die zweite
 * Auskunft und nicht die einzige.
 *
 * DIE FREIE SPANNE STEHT IMMER DA und klappt nicht auf. Ein Feld, das erst
 * nach einem Klick erscheint, braucht dafür ein Skript — und ohne Skript
 * wäre die freie Spanne unerreichbar. Sie ist stattdessen die zweite Zeile
 * derselben Leiste: sichtbar, ruhig, mit den Grenzen des gerade gewählten
 * Zeitraums vorbelegt.
 */
function zeitleiste(a: AnalyticsView): string {
  return `<div class="zeitleiste">
        <nav class="zeitwahl" aria-label="Zeitraum wählen">
          ${a.tabs
            .map(
              (tab) => `<a
            class="zeitwahl__ziel${tab.isActive ? ' zeitwahl__ziel--aktiv' : ''}"
            href="${escapeHtml(tab.href)}"${tab.isActive ? ' aria-current="page"' : ''}
          >${escapeHtml(tab.label)}</a>`,
            )
            .join('\n          ')}
        </nav>

        <form class="zeitwahl__spanne" method="get" action="/admin/auswertung">
          <input type="hidden" name="period" value="zeitraum">
          <div class="zeitwahl__feld">
            <label for="zeitraum-von">Von</label>
            <input type="date" id="zeitraum-von" name="from" value="${escapeHtml(a.custom.from)}" required>
          </div>
          <div class="zeitwahl__feld">
            <label for="zeitraum-bis">Bis</label>
            <input type="date" id="zeitraum-bis" name="to" value="${escapeHtml(a.custom.to)}" required>
          </div>
          <button type="submit" class="senden zeitwahl__senden">Anwenden</button>
        </form>
      </div>`;
}

/**
 * Die sechs Zahlen — eine Tafel mit Haarlinien, keine sechs Karten.
 *
 * Dieselbe Bauart wie die Kennzahlenwand der Übersicht: Das GITTER trägt
 * Rand, Radius und Schatten, die Zellen sind weiß, und der eine Pixel
 * zwischen ihnen ist die Trennlinie. Sechs freistehende Kästchen lasen sich
 * dort wie sechs Formularfelder; hier gilt derselbe Befund.
 *
 * SECHS UND KEINE SIEBTE. Jede weitere Zahl kostet die erste Bildschirmhöhe
 * — und die Frage, die eine siebte beantwortete, stellt niemand, solange die
 * ersten sechs unbeantwortet sind.
 */
function kennzahlwand(a: AnalyticsView): string {
  return `<section class="auswertwand" aria-labelledby="auswertwand-titel">
        <h2 id="auswertwand-titel" class="nur-vorlesen">Die Zahlen des Zeitraums</h2>
        <div class="auswertwand__gitter">
          ${a.kpis.map(kennzahl).join('\n          ')}
        </div>
      </section>`;
}

function kennzahl(kpi: AnalyticsKpiView): string {
  const klassen = [
    'auswertkarte',
    kpi.isPrimary ? 'auswertkarte--haupt' : '',
    kpi.isEmphasised ? 'auswertkarte--betont' : '',
    kpi.isMissing ? 'auswertkarte--offen' : '',
  ]
    .filter((klasse) => klasse !== '')
    .join(' ');

  return `<div class="${klassen}">
            <p class="auswertlabel">${escapeHtml(kpi.label)}</p>
            <p class="auswertwert">${escapeHtml(kpi.value)}</p>
            ${kpi.delta === null ? '' : unterschied(kpi.delta)}
            <p class="auswerthinweis">${escapeHtml(kpi.hint)}</p>
          </div>`;
}

/**
 * Der Unterschied zum Vorzeitraum.
 *
 * DER PFEIL IST aria-hidden UND STEHT NIE ALLEIN. „↑" allein sagt einem
 * Screenreader „Pfeil nach oben" und einem verwaschenen Tresenbildschirm gar
 * nichts; daneben steht deshalb immer der ganze Satz — „19,2 % mehr als im
 * Vormonat". Die Farbe ist die dritte Auskunft und niemals die erste.
 */
function unterschied(delta: AnalyticsDeltaView): string {
  return `<p class="auswertdelta auswertdelta--${escapeHtml(delta.tone)}">
              ${delta.arrow === '' ? '' : `<span class="auswertdelta__pfeil" aria-hidden="true">${escapeHtml(delta.arrow)}</span>`}
              <span class="auswertdelta__wort">${escapeHtml(delta.label)}</span>
            </p>`;
}

/**
 * Die Kurve.
 *
 * EIN SVG JE BALKEN UND NICHT EINES FÜR ALLE. Der Grund ist die Achse: Ein
 * einziges SVG müsste seine Beschriftungen selbst zeichnen, und die
 * schrumpfen mit der Grafik — auf 375px wären sie unlesbar. Hier ist jede
 * Spalte eine Rasterzelle aus Wert, Balken und Marke; die Texte sind echtes
 * HTML in echter Schriftgröße, und nur das Rechteck skaliert.
 *
 * `preserveAspectRatio="none"` IST DER TRICK DAHINTER. Der Kasten ist
 * 10 × 100 groß und wird auf die Zellenbreite gezogen; ein Rechteck verzerrt
 * dabei nicht sichtbar, weil es keine Rundung und keinen Strich hat. Genau
 * deshalb sind die Balken eckig — eine Ecke mit `rx` würde zum Ei.
 *
 * DIE GRAFIK IST aria-hidden, DIE TABELLE IST DIE ANSICHT FÜR SCREENREADER.
 * Sie trägt BEIDE Reihen, nicht nur die gerade gezeigte: Wer sie liest, soll
 * nicht erst umschalten müssen, um die zweite Zahl zu bekommen. Nichts an
 * dieser Kurve hängt an einem Zeiger, der über eine Fläche fährt.
 */
function kurventafel(trend: AnalyticsTrendView, seiteLeer: boolean): string {
  return `<section class="tafel kurventafel" aria-labelledby="kurve-titel">
        <div class="tafel__kopf">
          <h2 id="kurve-titel" class="tafel__titel">So hat es sich entwickelt</h2>
          <nav class="metrikwahl" aria-label="Reihe wählen">
            ${trend.metricTabs
              .map(
                (tab) => `<a
              class="metrikwahl__ziel${tab.isActive ? ' metrikwahl__ziel--aktiv' : ''}"
              href="${escapeHtml(tab.href)}"${tab.isActive ? ' aria-current="true"' : ''}
            >${escapeHtml(tab.label)}</a>`,
              )
              .join('\n            ')}
          </nav>
        </div>
        ${
          trend.isEmpty
            ? `<p class="tafel__leer">${escapeHtml(
                seiteLeer
                  ? 'Für diesen Zeitraum gibt es noch keine Kurve.'
                  : 'In diesem Zeitraum wurde nichts umgesetzt.',
              )}</p>`
            : kurve(trend)
        }
        ${kurventabelle(trend)}
      </section>`;
}

function kurve(trend: AnalyticsTrendView): string {
  return `<div class="kurve${trend.showValues ? ' kurve--mitwerten' : ''}">
          <p class="kurve__skala">
            <span class="kurve__skala-wert">${escapeHtml(trend.maxLabel)}</span>
            <span class="kurve__skala-wort">${escapeHtml(trend.caption)}</span>
          </p>
          <div class="kurve__flaeche" aria-hidden="true">
            <div class="kurve__saeulen">
              ${trend.bars
                .map(
                  (bar) => `<div class="kurve__spalte">
                ${
                  /**
                   * KEINE ZAHL ÜBER EINEM BALKEN, DEN ES NICHT GIBT. Sieben
                   * „0,00 €" über sieben leeren Monaten waren ein Befund aus
                   * dem Browser: Sie lasen sich als Daten, wo in Wahrheit
                   * nichts war, und drängten die zwei echten Beträge an den
                   * Rand. Die Null steht weiterhin in der Tabelle darunter.
                   */
                  trend.showValues && bar.heightPercent > 0
                    ? `<span class="kurve__wert">${escapeHtml(bar.valueLabel)}</span>`
                    : ''
                }
                <svg class="kurve__saeule" viewBox="0 0 10 100" preserveAspectRatio="none" focusable="false">
                  <rect class="kurve__balken" x="0" y="${bar.barY}" width="10" height="${bar.heightPercent}" />
                </svg>
              </div>`,
                )
                .join('\n              ')}
            </div>
            <ol class="kurve__achse">
              ${trend.bars
                .map(
                  (bar) => `<li class="kurve__marke${bar.axisEmphasis ? '' : ' kurve__marke--leise'}"><span class="kurve__markentext">${escapeHtml(bar.axisLabel)}</span></li>`,
                )
                .join('\n              ')}
            </ol>
          </div>
        </div>`;
}

/**
 * Die Kurve als Tabelle — die Fassung, die ein Screenreader vorliest.
 *
 * SIE STECKT IN EINEM <div class="nur-vorlesen"> UND TRÄGT DIE KLASSE NICHT
 * SELBST. Ein Befund aus dem Browser: Eine Tabelle richtet sich nach ihrem
 * Inhalt und ignoriert `width: 1px`; die versteckte Tabelle war 445px breit
 * und schob das Dokument auf 375px um 86px über den Rand hinaus. Sichtbar
 * war davon nichts — `overflow-x: hidden` auf dem Body fängt es ab —, aber
 * ein Dokument, das breiter ist als sein Fenster, ist ein Fehler, auch wenn
 * man ihn nicht sieht. Der umschließende Block hat kein solches
 * Eigenleben und schneidet sie sauber weg; die Tabellensemantik bleibt der
 * Tabelle.
 */
function kurventabelle(trend: AnalyticsTrendView): string {
  return `<div class="nur-vorlesen">
        <table class="kurve__tabelle">
          <caption>${escapeHtml(trend.caption)}</caption>
          <thead>
            <tr>
              <th scope="col">Zeitraum</th>
              <th scope="col">Bestellumsatz</th>
              <th scope="col">Bestellungen</th>
            </tr>
          </thead>
          <tbody>
            ${trend.bars
              .map(
                (bar) => `<tr>
              <th scope="row">${escapeHtml(bar.rangeLabel)}</th>
              <td>${escapeHtml(bar.revenueLabel)}</td>
              <td>${escapeHtml(bar.ordersLabel)}</td>
            </tr>`,
              )
              .join('\n            ')}
          </tbody>
        </table>
      </div>`;
}

/**
 * Die Toplisten.
 *
 * DREI SPALTEN: Rang, Name, Zahl — dieselbe Anatomie wie „Meistbestellt" auf
 * der Übersicht. Die Rangspalte gibt fünf verschieden langen Namen eine
 * gemeinsame linke Kante; ohne sie ist die Reihenfolge zwar da, aber nicht
 * lesbar.
 *
 * `<ol>`, WEIL DIE ORDNUNG DIE AUSSAGE IST. Die Zahlen der Liste selbst sind
 * ausgeblendet und durch die eigene Rangziffer ersetzt — ein „1." vor dem
 * meistverkauften Kuchen liest sich sonst wie eine Platzierung in einem
 * Wettbewerb.
 */
function produkttafel(produkte: readonly TopProductView[]): string {
  return `<section class="tafel toptafel" aria-labelledby="topprodukte-titel">
          <div class="tafel__kopf">
            <h2 id="topprodukte-titel" class="tafel__titel">Das verkauft sich am besten</h2>
            <p class="tafel__meta">nach Bestellumsatz</p>
          </div>
          ${
            produkte.length === 0
              ? '<p class="tafel__leer">In diesem Zeitraum wurde noch nichts verkauft.</p>'
              : `<ol class="topliste">
            ${produkte
              .map(
                (produkt) => `<li class="topliste__zeile topliste__zeile--zwei">
              <span class="topliste__rang" aria-hidden="true">${produkt.rank}</span>
              <span class="topliste__name">
                ${escapeHtml(produkt.name)}
                <span class="topliste__zusatz">${escapeHtml(produkt.unit)}</span>
              </span>
              <span class="topliste__menge">
                <span class="topliste__zahl">${escapeHtml(produkt.unitsLabel)}</span>
                <span class="topliste__einheit">Stück</span>
              </span>
              <span class="topliste__betrag">${escapeHtml(produkt.revenueLabel)}</span>
            </li>`,
              )
              .join('\n            ')}
          </ol>`
          }
        </section>`;
}

function kundentafel(kunden: readonly TopCustomerView[]): string {
  return `<section class="tafel toptafel" aria-labelledby="topkunden-titel">
          <div class="tafel__kopf">
            <h2 id="topkunden-titel" class="tafel__titel">Diese Kunden bestellen am meisten</h2>
            <p class="tafel__meta">nach Bestellumsatz</p>
          </div>
          ${
            kunden.length === 0
              ? '<p class="tafel__leer">In diesem Zeitraum hat noch niemand bestellt.</p>'
              : `<ol class="topliste">
            ${kunden
              .map(
                (kunde) => `<li class="topliste__zeile topliste__zeile--zwei">
              <span class="topliste__rang" aria-hidden="true">${kunde.rank}</span>
              <span class="topliste__name">
                ${escapeHtml(kunde.name)}
                <span class="topliste__zusatz">${escapeHtml(kunde.ordersLabel)}</span>
              </span>
              <span class="topliste__betrag">${escapeHtml(kunde.revenueLabel)}</span>
            </li>`,
              )
              .join('\n            ')}
          </ol>`
          }
        </section>`;
}

/**
 * Der Vergleich — drei Karten, die dieselbe Frage dreimal beantworten:
 * besser oder schlechter als vorher?
 *
 * BEIDE ZEITRÄUME STEHEN MIT NAMEN DA. „12.480 €" gegen „11.510 €" ohne
 * Beschriftung wären zwei Zahlen ohne Aussage; „September 2026 (bis heute)"
 * über der einen und „August 2026, gleicher Zeitraum" über der anderen sagen
 * auch demjenigen, was verglichen wird, der die Seite zum ersten Mal sieht.
 *
 * ES WERDEN NICHT ALLE SECHS KENNZAHLEN WIEDERHOLT. Umsatz, Bestellungen,
 * Stück — die drei, die sich über Zeiträume überhaupt sinnvoll vergleichen
 * lassen. Ein Vergleich des offenen Betrags wäre ein Vergleich zweier
 * Zahlungsstände und keine Entwicklung.
 */
function vergleichstafel(karten: readonly AnalyticsComparisonCardView[]): string {
  return `<section class="tafel vergleichstafel" aria-labelledby="vergleich-titel">
        <div class="tafel__kopf">
          <h2 id="vergleich-titel" class="tafel__titel">Vergleich</h2>
          <p class="tafel__meta">besser oder schlechter als vorher</p>
        </div>
        <div class="vergleich">
          ${karten
            .map(
              (karte) => `<div class="vergleich__karte">
            <p class="vergleich__titel">${escapeHtml(karte.title)}</p>
            <p class="vergleich__zeile">
              <span class="vergleich__wert">${escapeHtml(karte.currentValue)}</span>
              <span class="vergleich__wann">${escapeHtml(karte.currentLabel)}</span>
            </p>
            <p class="vergleich__zeile vergleich__zeile--vorher">
              <span class="vergleich__wert">${escapeHtml(karte.previousValue)}</span>
              <span class="vergleich__wann">${escapeHtml(karte.previousLabel)}</span>
            </p>
            <p class="vergleich__unterschied vergleich__unterschied--${escapeHtml(karte.tone)}">
              ${karte.arrow === '' ? '' : `<span aria-hidden="true">${escapeHtml(karte.arrow)}</span>`}
              <span class="vergleich__delta">${escapeHtml(karte.deltaLabel)}</span>
              ${karte.percentLabel === '' ? '' : `<span class="vergleich__prozent">${escapeHtml(karte.percentLabel)}</span>`}
            </p>
          </div>`,
            )
            .join('\n          ')}
        </div>
      </section>`;
}

/**
 * Die beiden leisen Aufteilungen.
 *
 * WAAGERECHTE BALKEN UND KEINE RINGE. Zwei Ringe stehen bereits auf der
 * Übersicht; ein drittes und viertes Kreisdiagramm auf derselben Oberfläche
 * wären Zierrat. Ein liegender Balken sagt dasselbe auf einem Achtel der
 * Höhe und lässt sich zudem in der Breite eines Telefons zu Ende lesen.
 *
 * DER ANTEIL STEHT ALS PROZENTZAHL DANEBEN. Der Balken ist die schnellere
 * Lesart derselben Angabe und niemals die einzige — deshalb ist das SVG
 * aria-hidden und die Zeile trägt Betrag, Anteil und Bestellzahl als Text.
 */
function anteiltafel(
  titel: string,
  id: string,
  breakdown: AnalyticsBreakdownView,
  leerText: string,
): string {
  return `<section class="tafel anteiltafel" aria-labelledby="${escapeHtml(id)}-titel">
          <div class="tafel__kopf">
            <h2 id="${escapeHtml(id)}-titel" class="tafel__titel">${escapeHtml(titel)}</h2>
          </div>
          ${
            breakdown.isEmpty
              ? `<p class="tafel__leer">${escapeHtml(leerText)}</p>`
              : `<ul class="anteile">
            ${breakdown.entries
              .map(
                (eintrag) => `<li class="anteil">
              <p class="anteil__kopf">
                <span class="anteil__name">${escapeHtml(eintrag.label)}</span>
                <span class="anteil__wert">${escapeHtml(eintrag.valueLabel)}</span>
              </p>
              <svg class="anteil__grafik" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <rect class="anteil__spur" x="0" y="0" width="100" height="10" />
                <rect class="anteil__balken" x="0" y="0" width="${eintrag.widthPercent}" height="10" />
              </svg>
              <p class="anteil__fuss">
                <span class="anteil__quote">${escapeHtml(eintrag.shareLabel)}</span>
                <span class="anteil__anzahl">${escapeHtml(eintrag.ordersLabel)}</span>
              </p>
            </li>`,
              )
              .join('\n            ')}
          </ul>`
          }
        </section>`;
}

/**
 * Die Seite, auf der die Auswertung gerade nicht geladen werden konnte.
 *
 * DER ADMIN SIEHT KEINE TECHNIK. Kein SQL, kein D1_ERROR, kein Bindingname,
 * kein Tabellenname — der Text ist eine Konstante und wird nicht aus dem
 * Fehler gebildet. Dieselbe Regel wie in der Produktions- und der
 * Tagesansicht.
 *
 * DIE NAVIGATION BLEIBT. Wenn eine Abfrage scheitert, ist der nächste Klick
 * oft genau das, was hilft — und ein Kopf ohne Abmeldung wäre eine
 * Sackgasse. Die Zeitraumleiste bleibt aus demselben Grund stehen: Ein
 * anderer Zeitraum ist die naheliegende zweite Frage.
 */
export function renderAnalyticsUnavailablePage(view: AdminAnalyticsPageView): string {
  return renderAdminShell(
    'Auswertung — Buschmann 1846',
    view,
    'analytics',
    `
      ${kopf(view.analytics)}
      ${zeitleiste(view.analytics)}
      <p class="banner" role="alert">Die Zahlen für diesen Zeitraum konnten gerade nicht geladen werden.</p>
      <p class="leer">
        Bitte versuche es gleich noch einmal oder wähle einen anderen Zeitraum. Wenn es bleibt,
        melde dich bei Buschmann 1846. Die <a href="/admin/production">Produktionsansicht</a>
        ist davon nicht betroffen.
      </p>`,
  );
}

/**
 * Die Antwort auf einen Zeitraum, den es nicht gibt.
 *
 * KEIN STILLES ZURÜCKFALLEN auf den laufenden Monat — dieselbe Regel wie bei
 * einem ungültigen Datum in der Produktionsansicht, und hier aus einem
 * zusätzlichen Grund: Ein Lesezeichen mit einem Tippfehler zeigte sonst
 * einen korrekt aussehenden Umsatz für einen anderen Zeitraum, ohne es zu
 * sagen. Das ist die Zahl, die jemand in eine Besprechung mitnimmt.
 *
 * DER FEHLERHAFTE WERT WIRD NICHT ZURÜCKGESPIEGELT. Er stammt aus der
 * Adresszeile; ihn gar nicht erst aufzunehmen ist die Schicht vor dem
 * Escapen. Sichtbar wäre er ohnehin nutzlos — wer ihn getippt hat, sieht ihn
 * oben im Browser stehen.
 *
 * Diese Seite kennt weder Sitzung noch Zeitraum: Sie wird gebraucht, BEVOR
 * ein Zeitraum feststeht.
 */
export function renderInvalidPeriodPage(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Kein gültiger Zeitraum — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="anmeldeseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
</header>

<main id="inhalt" class="anmeldung">
  <h1>Diesen Zeitraum gibt es nicht</h1>
  <p class="anmeldung__vorspann">
    Der angefragte Zeitraum ist nicht gültig. Wähle oben Heute, Woche, Monat oder Jahr —
    oder gib bei „Zeitraum" einen Von- und einen Bis-Tag an, bei dem „bis" nicht vor „von" liegt.
  </p>
  <p><a href="/admin/auswertung">Zurück zur Auswertung</a></p>
</main>
</body>
</html>
`;
}
