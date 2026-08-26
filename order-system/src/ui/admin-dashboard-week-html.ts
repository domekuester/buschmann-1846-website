import { renderAdminShell } from './admin-page-html';
import type { QuickDayView, QuickDaysView } from './dashboard-view';
import type {
  DashboardWeekDayView,
  DashboardWeekTotalView,
  DashboardWeekView,
} from './dashboard-week-view';
import { escapeHtml } from './format';

/**
 * DIE WOCHENÜBERSICHT — sieben Zeilen und eine Summe.
 *
 * SIE IST DIE ANTWORT AUF EINE FRAGE: „Wie voll ist diese Woche?" Nicht „wie
 * lief sie", nicht „wie im Vergleich zur letzten", nicht „wohin geht der
 * Trend". Wer einen einzelnen Tag genauer wissen will, klickt ihn an — die
 * Tagesansicht steht bereits und beantwortet ihn vollständig.
 *
 * SIE IST DESHALB KEINE ZWEITE STARTSEITE. Keine Kennzahlenwand, keine Ringe,
 * kein Handlungsbedarf, keine Bestellliste, kein Meistbestellt. Alles davon
 * gäbe es siebenfach, und siebenfach ist es keine Übersicht mehr.
 *
 * SIE IST DIESELBE SEITE WIE DIE TAGESANSICHT — dieselbe Adresse mit
 * `view=week`, dieselbe Hauptnavigation, derselbe Kopf, dieselbe Schnellwahl.
 * Es gibt bewusst keinen Menüpunkt „Wochenanalyse": Die Woche ist eine
 * Blickweite auf denselben Gegenstand und kein zweiter Bereich.
 *
 * SIE TRÄGT KEIN SKRIPT und keine Grafik. Sieben Zeilen mit vier Zahlen sind
 * eine Tabelle, und eine Tabelle ist hier die genauere Darstellung als jedes
 * Balkendiagramm: Man liest Beträge ab, statt Höhen zu schätzen.
 */

export interface AdminDashboardWeekPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly week: DashboardWeekView;
}

export function renderAdminDashboardWeekPage(view: AdminDashboardWeekPageView): string {
  return renderAdminShell(
    `Woche ${view.week.monday} — Buschmann 1846`,
    view,
    'dashboard',
    `${kopf(view.week)}
    ${steuerung(view.week)}
    ${wochentabelle(view.week)}`,
  );
}

/**
 * Die Seite, auf der die Wochendaten gerade nicht geladen werden konnten.
 *
 * DERSELBE UMGANG WIE BEI DER TAGESANSICHT: kein SQL, kein Fehlertext, keine
 * Technik — und die Navigation bleibt stehen, weil der nächste Klick oft
 * genau das ist, was hilft.
 */
export function renderWeekUnavailablePage(view: AdminDashboardWeekPageView): string {
  return renderAdminShell(
    `Woche ${view.week.monday} — Buschmann 1846`,
    view,
    'dashboard',
    `${kopf(view.week)}
    ${steuerung(view.week)}
    <p class="banner" role="alert">Die Wochendaten konnten gerade nicht geladen werden.</p>
    <p class="leer">Bitte versuche es gleich noch einmal. Wenn es bleibt, melde dich bei Buschmann 1846.</p>`,
  );
}

/**
 * Der Kopf — und die EINZIGE h1.
 *
 * Der ZEITRAUM steht groß, nicht das Wort „Woche": Wer hier ankommt, weiß,
 * dass er eine Woche ansieht, und will wissen, welche. Der Kicker sagt in
 * einem Wort, welche Art Seite das ist — „Dashboard · Wochenübersicht"
 * gegenüber „Dashboard · Tagesübersicht".
 */
function kopf(week: DashboardWeekView): string {
  return `<header class="dashkopf">
      <div class="dashkopf__text">
        <p class="dashkopf__kicker">Dashboard <span aria-hidden="true">·</span> Wochenübersicht</p>
        <h1 class="dashkopf__tag">${escapeHtml(week.rangeLabel)}</h1>
        <p class="dashkopf__vorspann">
          Montag bis Sonntag. Alle Zahlen gehören zum Produktionstag — nicht
          dazu, wann bestellt wurde.
        </p>
      </div>
    </header>`;
}

/**
 * Der Steuerbereich — dieselbe Leiste wie auf der Tagesansicht.
 *
 * OBEN DIE SCHNELLWAHL, darunter die Wochenpfeile. Es gibt hier KEIN
 * Datumsfeld: Ein Feld, in das man einen Tag tippt, um eine Woche zu
 * bekommen, erklärt sich nicht — wer einen bestimmten Tag sucht, geht über
 * „Heute" oder über eine Zeile der Tabelle in die Tagesansicht, und dort
 * steht das Feld.
 *
 * DIE PFEILE NENNEN IHR ZIEL im `aria-label`; „zurück" allein sagt in einem
 * Screenreader nichts.
 */
function steuerung(week: DashboardWeekView): string {
  return `<div class="tagleiste">
      ${schnellwahl(week.quickDays)}
      <nav class="wochennav" aria-label="Woche wechseln">
        ${wochenpfeil(week.previousWeek, '&larr;', 'prev')}
        <p class="wochennav__zeitraum">${escapeHtml(week.compactRangeLabel)}</p>
        ${wochenpfeil(week.nextWeek, '&rarr;', 'next')}
      </nav>
    </div>`;
}

function wochenpfeil(ziel: QuickDayView, zeichen: string, rel: string): string {
  return `<a
          class="tagnav__pfeil"
          href="${escapeHtml(ziel.href)}"
          rel="${escapeHtml(rel)}"
          aria-label="${escapeHtml(ziel.label)}"
        ><span aria-hidden="true">${zeichen}</span></a>`;
}

/**
 * HEUTE · MORGEN · WOCHE — wörtlich dieselbe Bauart wie auf der Tagesansicht.
 *
 * Sie steht hier ein zweites Mal als MARKUP, aber nicht ein zweites Mal als
 * ENTSCHEIDUNG: Beschriftungen, Ziele und der aktive Zustand kommen aus
 * demselben toQuickDaysView(). Was doppelt ist, sind drei Zeilen HTML; was
 * einfach bleibt, ist die Frage, was „morgen" ist.
 */
function schnellwahl(quick: QuickDaysView): string {
  return `<nav class="schnellwahl" aria-label="Zeitraum wählen">
        ${[quick.today, quick.tomorrow, quick.week]
          .map(
            (ziel) => `<a
          class="schnellwahl__ziel${ziel.isCurrent ? ' schnellwahl__ziel--aktiv' : ''}"
          href="${escapeHtml(ziel.href)}"${ziel.isCurrent ? ' aria-current="page"' : ''}
        >${escapeHtml(ziel.label)}</a>`,
          )
          .join('\n        ')}
      </nav>`;
}

/**
 * Die sieben Tage als TABELLE, weil die Daten eine sind.
 *
 * ES IST DIESELBE `.datentabelle`, die Kunden-, Katalog- und Bestellliste
 * benutzen — und das ist der Grund, warum die Wochenansicht auf einem Telefon
 * keine gequetschte Fünfspaltentabelle wird: Unterhalb von Tablet zerfällt
 * sie in Karten mit einer Beschriftung je Zelle, oberhalb wird sie zur
 * Tabelle. Es gibt keinen waagerechten Scrollzwang und keine eigene
 * Mobilfassung, die getrennt gepflegt werden müsste.
 *
 * DER WOCHENTAG STEHT IN EINEM <th scope="row"> und ist der Link: Er benennt
 * die Zeile, und er ist das, was man anklickt. Ein Screenreader liest bei
 * jeder Zelle mit, um welchen Tag es geht.
 *
 * DIE SUMME STEHT IM <tfoot> und nicht als eigene Tafel darüber. Sie gehört
 * zu dieser Tabelle und zu keiner anderen Aussage; ein Kasten darüber wäre
 * eine zweite Stelle mit Zahlen, die man mit den sieben Zeilen abgleichen
 * müsste.
 */
function wochentabelle(week: DashboardWeekView): string {
  return `<section class="tafel tafel--tabelle wochenliste" aria-labelledby="wochenliste-titel">
      <div class="tafel__kopf">
        <h2 id="wochenliste-titel" class="tafel__titel">Die Woche im Überblick</h2>
        <p class="tafel__meta">Montag bis Sonntag</p>
      </div>
      <div class="datentabelle-wrap">
        <table class="datentabelle datentabelle--woche">
          <thead><tr>
            <th scope="col">Tag</th>
            <th scope="col">Bestellungen</th>
            <th scope="col" class="spalte-betrag">Umsatz</th>
            <th scope="col">Produktion</th>
            <th scope="col">Zahlung</th>
          </tr></thead>
          <tbody>${week.days.map(wochenzeile).join('')}</tbody>
          <tfoot>${summenzeile(week.total)}</tfoot>
        </table>
      </div>
    </section>`;
}

/**
 * Eine Tageszeile.
 *
 * DER HEUTIGE TAG IST MARKIERT — und zwar mit einem WORT und nicht nur mit
 * einem Farbton. „heute" steht als kleine Angabe unter dem Datum; wer die
 * Seite auf einem verwaschenen Tresenbildschirm liest, findet den Tag
 * trotzdem.
 *
 * EIN LEERER TAG WIRD GEDÄMPFT UND NICHT WEGGELASSEN. Sieben Zeilen sind der
 * Sinn der Ansicht: Dass am Donnerstag nichts ist, ist eine Auskunft.
 */
function wochenzeile(tag: DashboardWeekDayView): string {
  const klassen = [
    tag.isEmpty ? 'wochenzeile--leer' : '',
    tag.isToday ? 'wochenzeile--heute' : '',
  ]
    .filter((klasse) => klasse !== '')
    .join(' ');

  return `<tr${klassen === '' ? '' : ` class="${klassen}"`}>
      <th scope="row" data-label="Tag">
        <a class="wochenzeile__tag" href="${escapeHtml(tag.href)}"
          ><span class="wochenzeile__wochentag">${escapeHtml(tag.weekdayLabel)}</span
          ><span class="wochenzeile__datum">${escapeHtml(tag.dateLabel)}</span></a>
        ${tag.isToday ? '<span class="wochenzeile__heute">heute</span>' : ''}
      </th>
      <td data-label="Bestellungen">${escapeHtml(tag.ordersLabel)}${
        tag.cancelledLabel === ''
          ? ''
          : `<span class="wochenzeile__storno">${escapeHtml(tag.cancelledLabel)}</span>`
      }</td>
      <td data-label="Umsatz" class="bestellzeile__betrag">${escapeHtml(tag.revenueLabel)}</td>
      <td data-label="Produktion">${escapeHtml(tag.openLabel)}</td>
      <td data-label="Zahlung">${escapeHtml(tag.unpaidLabel)}</td>
    </tr>`;
}

function summenzeile(total: DashboardWeekTotalView): string {
  return `<tr class="wochenzeile--summe">
      <th scope="row" data-label="Tag">Ganze Woche</th>
      <td data-label="Bestellungen">${escapeHtml(total.ordersLabel)}${
        total.cancelledLabel === ''
          ? ''
          : `<span class="wochenzeile__storno">${escapeHtml(total.cancelledLabel)}</span>`
      }</td>
      <td data-label="Umsatz" class="bestellzeile__betrag">${escapeHtml(total.revenueLabel)}</td>
      <td data-label="Produktion">${escapeHtml(total.openLabel)}</td>
      <td data-label="Zahlung">${escapeHtml(total.unpaidLabel)}</td>
    </tr>`;
}
