import type { CustomerOrderLine } from '../domain/customer-history';
import type { AdminCustomerRow, AssignedPriceGroup } from '../domain/customer-price-group';
import { orderStatusLabel } from '../domain/order-status';
import { isPaid, paymentStatusLabel } from '../domain/payment-status';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatEuro, formatGermanNumericDate } from './format';

/**
 * Die Kundendetailansicht — die letzte reguläre Seite des Systems.
 *
 * SIE BEANTWORTET FÜNF FRAGEN UND KEINE SECHSTE:
 *
 *   Welcher Kunde ist das?
 *   Welche Preisgruppe hat er?
 *   Ist sein Konto aktiv?
 *   Was hat er zuletzt bestellt?
 *   Wo stehen diese Bestellungen?
 *
 * SIE IST KEIN CRM. Es gibt hier keine Notiz, keinen Ansprechpartner, keine
 * Telefonnummer, keine Adresse, keine Umsatzkurve, keinen Kundenwert und
 * keine Wiedervorlage — nicht, weil das ausgeblendet wäre, sondern weil die
 * Seite diese Felder nicht lädt. Was nicht gerendert wird, kann nicht
 * abfließen.
 *
 * SIE SCHREIBT NICHTS. Kein Formular, kein Knopf, kein CSRF-Feld außerhalb
 * der Abmeldung im Kopf. Wer die Preisgruppe ändern will, geht über den
 * ruhigen Link zurück auf die Kundenliste — dort steht der Vorgang, der es
 * seit Phase 5B kann, mit seiner eigenen Origin- und CSRF-Prüfung. Zwei
 * Stellen, die dasselbe schreiben, wären zwei Stellen, die abgesichert
 * werden müssen.
 *
 * SIE ÜBERSETZT NICHTS ZUM ZWEITEN MAL. Produktionsstand und Zahlungsstand
 * kommen aus orderStatusLabel() und paymentStatusLabel() — denselben
 * Funktionen, die Dashboard und Produktionsansicht benutzen. Eine eigene
 * Tabelle deutscher Wörter an dieser Stelle wäre die Vorlage dafür, dass
 * dieselbe Bestellung auf zwei Seiten verschieden heißt.
 *
 * SIE ZEIGT KEINE FINANZINTERNA. Kein Herstellkostenwert, kein Rohertrag,
 * keine Marge — die Zahlen aus Phase 7A und 7B sind Controlling und stehen
 * im Dashboard. Eine Bestellhistorie ist Betrieb: Was hat der Kunde bestellt,
 * was hat es gekostet, ist es bezahlt.
 */

export interface AdminCustomerDetailView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly customer: AdminCustomerRow;
  /** Die jüngsten Bestellungen — höchstens `orderLimit` Stück. */
  readonly orders: readonly CustomerOrderLine[];
  /**
   * Wie viele Bestellungen die Seite HÖCHSTENS zeigt.
   *
   * Er steht in der Überschrift und ist damit eine Zusage an den Leser: „Die
   * letzten 10 Bestellungen" sagt zugleich, dass es mehr geben KANN. Eine
   * Überschrift „Bestellungen" über einer abgeschnittenen Liste wäre die
   * stille Behauptung einer vollständigen Historie.
   */
  readonly orderLimit: number;
}

/** Dasselbe Wort wie in der Kundenliste — und aus derselben Konstante. */
const OHNE_ZUORDNUNG = 'Nicht zugeordnet';

export function renderAdminCustomerDetailPage(view: AdminCustomerDetailView): string {
  return renderAdminShell(
    `${view.customer.name} — Buschmann 1846`,
    view,
    'customers',
    `${kopf(view.customer)}
    ${stammdaten(view.customer)}
    ${bestellungen(view)}`,
  );
}

/**
 * Der Kopf: wer das ist.
 *
 * DER NAME IST DIE h1 UND SONST NICHTS. Kein „Kundendetail: Café Nord",
 * keine Kennung in Klammern, keine E-Mail darunter. Wer diese Seite öffnet,
 * hat den Kunden gerade angeklickt; die Überschrift bestätigt ihn, statt ihn
 * zu wiederholen.
 *
 * DIE INTERNE KENNUNG STEHT NICHT AUF DER SEITE. Sie steht in der Adresszeile,
 * weil sie den Kunden adressiert — sichtbar gesetzt wäre sie eine Zahl, die
 * niemand im Betrieb benutzt und die aussieht, als müsste man sie kennen.
 */
function kopf(customer: AdminCustomerRow): string {
  return `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Kunde</p>
      <h1>${escapeHtml(customer.name)}</h1>
    </header>`;
}

/**
 * Zwei Angaben, nebeneinander — und ausdrücklich keine sechs Kacheln.
 *
 * Preisgruppe und Kontostand sind die beiden Dinge, die im Gespräch am Tresen
 * vorkommen. Alles Weitere, was in der Kundentabelle steht, ist entweder
 * personenbezogen (E-Mail, Telefon, Adresse) oder betriebsintern (Notiz) und
 * wird auf dieser Seite nicht gebraucht — es wird deshalb gar nicht erst
 * geladen (§4, §18).
 *
 * EINE DEFINITIONSLISTE UND KEINE TABELLE: Es sind Begriffspaare, keine
 * Datensätze. Ein Screenreader liest „Preisgruppe: Gastronomie" statt
 * „Spalte 1, Zeile 1".
 */
function stammdaten(customer: AdminCustomerRow): string {
  return `<section class="kundenstamm" aria-labelledby="stamm-titel">
      <h2 id="stamm-titel" class="nur-vorlesen">Stammangaben</h2>
      <dl class="kundenstamm__liste">
        <div class="kundenstamm__paar">
          <dt>Preisgruppe</dt>
          <dd>${gruppenText(customer.priceGroup)}</dd>
        </div>
        <div class="kundenstamm__paar">
          <dt>Status</dt>
          <dd>${kontostand(customer.isActive)}</dd>
        </div>
      </dl>
      <p class="kundenstamm__weg"><a href="/admin/customers">Preisgruppe verwalten</a></p>
    </section>`;
}

/**
 * Die Preisgruppe im Klartext — WORTGLEICH mit der Kundenliste.
 *
 * Eine deaktivierte Gruppe wird benannt und nicht ersetzt, und „nicht
 * zugeordnet" ist ein Zustand und kein Fehler. Beides ist die Regel aus Phase
 * 5B; sie hier anders zu fassen hieße, dass dieselbe Zuordnung auf zwei
 * Seiten verschieden aussieht.
 */
function gruppenText(group: AssignedPriceGroup | null): string {
  if (group === null) {
    return `<span class="kundengruppe--offen">${OHNE_ZUORDNUNG}</span>`;
  }
  if (group.isActive) {
    return escapeHtml(group.label);
  }
  return `${escapeHtml(group.label)} <span class="kundenzustand">nicht mehr aktiv</span>`;
}

/**
 * „Aktiv" oder „Inaktiv" — als WORT und nicht als Farbe.
 *
 * Ein deaktivierter Kunde bekommt zusätzlich die Marke, die die Kundenliste
 * seit Phase 5B benutzt. Das Wort allein genügte; die Marke macht es auf
 * einen Blick auffindbar, ohne die Aussage in die Farbe zu verlegen.
 */
function kontostand(isActive: boolean): string {
  return isActive ? 'Aktiv' : '<span class="kundenzustand">Inaktiv</span>';
}

/**
 * Die Bestellhistorie.
 *
 * DIE ÜBERSCHRIFT NENNT DIE ZAHL. „Letzte 10 Bestellungen" ist ehrlich über
 * das, was hier steht — und darüber, was nicht. Es gibt bewusst keine
 * Blätterfunktion (§17): Die Frage „was war zuletzt?" ist mit zehn Zeilen
 * beantwortet, und eine Seitennavigation über eine Historie, die niemand
 * durchblättert, wäre Bedienung ohne Zweck.
 */
function bestellungen(view: AdminCustomerDetailView): string {
  const hat = view.orders.length > 0;

  return `<section
      class="tafel${hat ? ' tafel--tabelle' : ''} kundenhistorie"
      aria-labelledby="historie-titel"
    >
      <div class="tafel__kopf">
        <h2 id="historie-titel" class="tafel__titel">Letzte Bestellungen</h2>
        <p class="tafel__meta">${escapeHtml(umfang(view))}</p>
      </div>
      ${hat ? historientabelle(view.orders) : leererZustand()}
    </section>`;
}

/**
 * Was in der Zeile unter der Überschrift steht — und es ist eine AUSSAGE
 * über die Vollständigkeit, keine Zierde.
 *
 * ZWEI LAGEN, UND SIE BEDEUTEN VERSCHIEDENES:
 *
 *   weniger als das Limit   Dann ist die Liste VOLLSTÄNDIG, und zwar
 *                           beweisbar: Es wurde mit LIMIT 10 gefragt und es
 *                           kamen weniger zurück — mehr gibt es nicht. „Alle
 *                           4 Bestellungen" ist an dieser Stelle die
 *                           nützlichere Auskunft, weil sie eine Frage
 *                           abschließt.
 *   genau das Limit         Dann KANN es mehr geben, und die Seite behauptet
 *                           deshalb nichts über den Rest: „die letzten 10".
 *
 * Beides zugleich zu schreiben („die letzten 10 von höchstens 10") sagt
 * dasselbe zweimal und liest sich wie eine Entschuldigung.
 */
function umfang(view: AdminCustomerDetailView): string {
  const anzahl = view.orders.length;
  if (anzahl === 0) return 'noch keine';
  if (anzahl >= view.orderLimit) return `die letzten ${view.orderLimit}`;
  return anzahl === 1 ? 'eine Bestellung' : `alle ${anzahl} Bestellungen`;
}

/**
 * KEIN LEERER TABELLENRAHMEN (§10).
 *
 * Ein Kunde ohne Bestellung ist kein Fehler und keine halbe Seite: Er hat
 * seine Preisgruppe, sein Konto und alles, was diese Seite sonst zeigt. Der
 * Satz sagt, was fehlt, und behauptet nicht, dass etwas kaputt ist.
 */
function leererZustand(): string {
  return `<p class="tafel__leer">Noch keine Bestellung vorhanden.</p>`;
}

/**
 * Die Tabelle — dieselbe `.datentabelle` wie in Kundenliste und Katalog.
 *
 * AUF DEM TELEFON WIRD SIE ZU KARTEN, und zwar ohne eine einzige Zeile CSS in
 * dieser Phase: Die bestehende Regel macht Zeilen zu Blöcken und setzt die
 * Spaltenüberschrift über `data-label` vor den Wert. Deshalb trägt hier jede
 * Zelle ihr `data-label` — fehlt es, steht auf dem Telefon ein Wert ohne
 * Beschriftung.
 *
 * DER PRODUKTIONSTAG IST DIE ZEILENÜBERSCHRIFT (`th scope="row"`), weil man
 * eine Historie nach Tagen liest. Er wird damit auf dem Telefon zur
 * Kartenüberschrift — genau die Angabe, nach der jemand sucht.
 *
 * DIE BESTELLNUMMER IST KEIN LINK. Es gibt in diesem System keine
 * Adminansicht EINER Bestellung — nur die Tagesansichten und die
 * Stornoseite, und die ist ein Vorgang und keine Auskunft. Einen Link auf
 * eine Seite zu legen, die es nicht gibt, wäre eine Unwahrheit; eine
 * Detailseite dafür zu erfinden, war für 7C nicht verlangt (§8).
 */
function historientabelle(orders: readonly CustomerOrderLine[]): string {
  return `<div class="datentabelle-wrap">
        <table class="datentabelle">
          <thead><tr>
            <th scope="col">Produktionstag</th>
            <th scope="col">Bestellnummer</th>
            <th scope="col">Status</th>
            <th scope="col" class="spalte-betrag">Betrag</th>
            <th scope="col">Zahlung</th>
          </tr></thead>
          <tbody>${orders.map(historienzeile).join('')}</tbody>
        </table>
      </div>`;
}

function historienzeile(order: CustomerOrderLine): string {
  const storniert = order.status === 'cancelled';

  return `<tr${storniert ? ' class="bestellzeile--storniert"' : ''}>
        <th scope="row" data-label="Produktionstag">${escapeHtml(
          formatGermanNumericDate(order.fulfillmentDate),
        )}</th>
        <td data-label="Bestellnummer"><span class="bestellzeile__nummer">${escapeHtml(
          order.orderNumber,
        )}</span></td>
        <td data-label="Status">${
          storniert
            ? `<span class="bestellzeile__storno">${escapeHtml(orderStatusLabel(order.status))}</span>`
            : escapeHtml(orderStatusLabel(order.status))
        }</td>
        <td data-label="Betrag" class="bestellzeile__betrag">${escapeHtml(
          formatEuro(order.totalCents),
        )}</td>
        <td data-label="Zahlung">${zahlstand(order)}</td>
      </tr>`;
}

/**
 * Der Zahlungsstand — GELESEN und nicht änderbar.
 *
 * Auf dem Dashboard steht an dieser Stelle ein Formular; hier steht ein Wort.
 * Der Zahlungseintrag gehört an den Tag, an dem gezahlt wurde, und nicht in
 * eine Historie, in der zehn Bestellungen aus zehn Wochen untereinander
 * stehen — dort wäre der falsche Klick zu leicht.
 */
function zahlstand(order: CustomerOrderLine): string {
  const klasse = isPaid(order.paymentStatus) ? 'zahlstand--bezahlt' : 'zahlstand--offen';
  return `<span class="zahlstand ${klasse}">${escapeHtml(
    paymentStatusLabel(order.paymentStatus),
  )}</span>`;
}
