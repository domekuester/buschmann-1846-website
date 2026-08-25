import type {
  AdminCustomerRow,
  AssignedPriceGroup,
  PriceGroupOption,
} from '../domain/customer-price-group';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml } from './format';

/**
 * Kunden & Preisgruppen — die Seite, auf der eine kaufmännische Entscheidung
 * getroffen wird.
 *
 * SIE BEANTWORTET GENAU EINE FRAGE: „Welche Preiswelt gehört zu welchem
 * Kunden?" Nicht, was ein Produkt kostet (das steht unter Sortiment &
 * Preise), nicht, was ein Kunde bestellt hat (das steht in der Produktion),
 * und nicht, wer sich wie anmeldet.
 *
 * SIE IST KEINE KUNDENVERWALTUNG. Es gibt hier kein Anlegen, kein Löschen,
 * kein Umbenennen, keine Adresse, keine E-Mail, kein Passwort und keine
 * Massenbearbeitung — nicht, weil das ausgeblendet wäre, sondern weil es die
 * Felder dafür nicht gibt. Was nicht gerendert wird, kann auch nicht
 * abgeschickt werden.
 *
 * SIE TRÄGT KEIN SKRIPT. Auswahl und Speichern sind ein echtes
 * `<form method="post">` je Zeile — dieselbe Bauart wie die
 * Statusschaltflächen der Produktionsansicht. Ohne JavaScript bedienbar,
 * ohne Ausnahme in der CSP.
 *
 * „NICHT ZUGEORDNET" IST EIN ZUSTAND UND KEIN FEHLER. Nach der Migration
 * steht jeder bestehende Kunde dort, weil niemand ihn zugeordnet hat. Die
 * Seite sagt das aus und rät nicht — weder aus dem Namen noch aus der
 * E-Mail-Domain.
 */

export interface AdminCustomersPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly customers: readonly AdminCustomerRow[];
  /** Die AKTIVEN Preisgruppen — und damit die einzigen wählbaren. */
  readonly priceGroups: readonly PriceGroupOption[];
  /**
   * Die Rückmeldung des letzten Speicherversuchs, als CODE und nicht als Text.
   *
   * Der Wert kommt aus der Adresszeile und ist damit vom Aufrufer bestimmt.
   * Er wird deshalb NIEMALS angezeigt, sondern ausschließlich in einer festen
   * Tabelle nachgeschlagen; ein unbekannter Code führt zu gar keiner Meldung.
   * Damit kann in dieser Meldung nichts stehen, was nicht im Quelltext steht
   * — dieselbe Regel wie bei den Statusmeldungen der Produktionsansicht.
   */
  readonly noticeCode: string | null;
}

const MELDUNGEN: Readonly<Record<string, string>> = {
  saved: 'Die Preisgruppe wurde gespeichert.',
  unknown_customer:
    'Diesen Kunden gibt es nicht mehr. Die Preisgruppe wurde nicht gespeichert.',
  unknown_price_group:
    'Diese Preisgruppe gibt es nicht. Die Zuordnung wurde nicht gespeichert.',
  inactive_price_group:
    'Diese Preisgruppe wird nicht mehr vergeben. Die Zuordnung wurde nicht gespeichert.',
  invalid: 'Die Auswahl war nicht lesbar. Die Zuordnung wurde nicht gespeichert.',
  internal:
    'Die Zuordnung konnte gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.',
};

/** Das Wort, das im ganzen System für „keine Preisgruppe" steht. */
const OHNE_ZUORDNUNG = 'Nicht zugeordnet';

export function renderAdminCustomersPage(view: AdminCustomersPageView): string {
  return renderAdminShell(
    'Kunden & Preisgruppen — Buschmann 1846',
    view,
    'customers',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Kunden</p>
      <h1>Kunden &amp; Preisgruppen</h1>
      <p class="bereichskopf__vorspann">Welche Preiswelt für welchen Kunden gilt.</p>
    </header>
    ${meldung(view.noticeCode)}
    ${offeneZuordnungen(view.customers)}
    ${view.customers.length === 0 ? leererZustand() : datentabelle(view)}`,
  );
}

/**
 * Die Rückmeldung nach dem Speichern.
 *
 * role="status" und nicht role="alert": Der Vorgang ist abgeschlossen, die
 * Meldung unterbricht niemanden. Sie steht ÜBER der Liste, weil dort der
 * Blick nach der Weiterleitung landet.
 */
function meldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(MELDUNGEN, code) ? MELDUNGEN[code] : null;
  if (text === undefined || text === null) return '';

  /**
   * ERFOLG UND FEHLSCHLAG SEHEN NICHT GLEICH AUS — und das ist keine
   * Kosmetik. `.banner` ist im ganzen System die FEHLERdarstellung: roter
   * Grund, roter Rahmen, ein vorangestelltes ⚠. „Die Preisgruppe wurde
   * gespeichert." mit einem Warndreieck davor wäre eine Meldung, die ihrer
   * eigenen Aussage widerspricht.
   *
   * Die Fehlerfälle behalten `.banner` — sie SIND Fehlschläge und sagen
   * jeweils dazu, dass nichts gespeichert wurde.
   */
  const klasse = code === 'saved'
    ? 'kundenmeldung kundenmeldung--erfolg'
    : 'banner kundenmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}

/**
 * „Noch nicht zugeordnet: 2 von 5 Kunden."
 *
 * Die einzige Zahl dieser Seite — und sie beantwortet genau die Frage, mit
 * der jemand hier ankommt: Bin ich fertig? Sie erscheint nur, solange die
 * Antwort „nein" lautet; eine Zeile „0 von 5 offen" wäre Rauschen.
 */
function offeneZuordnungen(customers: readonly AdminCustomerRow[]): string {
  const offen = customers.filter((c) => c.priceGroup === null).length;
  if (offen === 0) return '';

  return `<p class="kundenoffen">
      <strong>${offen} von ${customers.length} Kunden</strong>
      ${offen === 1 ? 'ist' : 'sind'} noch keiner Preisgruppe zugeordnet.
    </p>`;
}

function datentabelle(view: AdminCustomersPageView): string {
  return `<div class="datentabelle-wrap">
    <table class="datentabelle">
      <thead><tr>
        <th scope="col">Kunde</th>
        <th scope="col">Preisgruppe</th>
        <th scope="col">Zuordnung ändern</th>
      </tr></thead>
      <tbody>${view.customers.map((customer) => kundenzeile(customer, view)).join('')}</tbody>
    </table>
  </div>`;
}

function kundenzeile(customer: AdminCustomerRow, view: AdminCustomersPageView): string {
  return `<tr>
    <th scope="row" data-label="Kunde">
      ${escapeHtml(customer.name)}${customer.isActive ? '' : ' <span class="kundenzustand">Inaktiv</span>'}
    </th>
    <td data-label="Preisgruppe" class="kundengruppe">${gruppenText(customer.priceGroup)}</td>
    <td data-label="Zuordnung ändern" class="kundenaktion">${zuordnungsformular(customer, view)}</td>
  </tr>`;
}

/**
 * Die bestehende Zuordnung im Klartext.
 *
 * EINE DEAKTIVIERTE GRUPPE WIRD BENANNT UND NICHT ERSETZT. Sie hier still auf
 * „Nicht zugeordnet" oder auf eine andere Gruppe zu setzen wäre eine
 * kaufmännische Änderung hinter dem Rücken dessen, der sie einmal getroffen
 * hat. Der Hinweis steht als WORT da und nicht nur als Farbe.
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
 * Das Änderungsformular EINER Zeile.
 *
 * DER KUNDE STEHT IM PFAD und nicht im Körper. Damit gibt es kein Feld, über
 * das sich ein anderer Kunde unterschieben ließe — und der Server prüft den
 * Pfad ohnehin, bevor er irgendetwas schreibt.
 *
 * IM KÖRPER STEHEN GENAU ZWEI FELDER: der CSRF-Token der Sitzung und die
 * gewünschte Preisgruppe. Keine Rolle, kein Kundenname, keine Konto-ID, kein
 * Preis, kein Rückkehrziel. Was nicht im Formular steht, wird auch nicht
 * gelesen.
 *
 * DAS AUSWAHLFELD HAT EIN EIGENES LABEL JE ZEILE. „Preisgruppe" allein
 * käme in einem Screenreader zwanzigmal gleich an; „Preisgruppe für Fiktives
 * Café Nord" sagt, worüber gerade entschieden wird. Sichtbar ist es nicht —
 * die Spaltenüberschrift sagt es Sehenden bereits.
 */
function zuordnungsformular(customer: AdminCustomerRow, view: AdminCustomersPageView): string {
  const feldId = `preisgruppe-${customer.id}`;

  return `<form method="post" action="/api/admin/customers/${customer.id}/price-list" class="preisgruppe">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <label class="nur-vorlesen" for="${feldId}">Preisgruppe für ${escapeHtml(customer.name)}</label>
      <select id="${feldId}" name="price_list_code" class="preisgruppe__wahl">
        ${optionen(customer, view.priceGroups)}
      </select>
      <button type="submit" class="senden preisgruppe__senden">Speichern</button>
    </form>`;
}

/**
 * Die Auswahl: „Nicht zugeordnet" plus die aktiven Preisgruppen.
 *
 * DER LEERE WERT IST „NICHT ZUGEORDNET" und kann mit keinem echten Code
 * kollidieren: Ein Preislisten-Code darf laut Schema nicht leer sein. Damit
 * unterscheidet der Server zweifelsfrei zwischen „ausdrücklich nicht
 * zugeordnet" (leeres Feld) und „gar kein Feld geschickt" (Fehler).
 *
 * EINE INAKTIVE GRUPPE STEHT NUR DANN IN DER LISTE, WENN SIE BEREITS
 * ZUGEORDNET IST — sonst zeigte das Feld für diesen Kunden etwas anderes an
 * als das, was gespeichert ist. Sie ist damit die Fortschreibung des
 * Bestehenden und keine neue Wahlmöglichkeit: Für jeden anderen Kunden taucht
 * sie nirgends auf.
 */
function optionen(
  customer: AdminCustomerRow,
  priceGroups: readonly PriceGroupOption[],
): string {
  const zugeordnet = customer.priceGroup;
  const auswahl: string[] = [
    `<option value=""${zugeordnet === null ? ' selected' : ''}>${OHNE_ZUORDNUNG}</option>`,
  ];

  for (const group of priceGroups) {
    const gewaehlt = zugeordnet !== null && zugeordnet.code === group.code;
    auswahl.push(
      `<option value="${escapeHtml(group.code)}"${gewaehlt ? ' selected' : ''}>${escapeHtml(group.label)}</option>`,
    );
  }

  if (zugeordnet !== null && !priceGroups.some((g) => g.code === zugeordnet.code)) {
    auswahl.push(
      `<option value="${escapeHtml(zugeordnet.code)}" selected>${escapeHtml(zugeordnet.label)} (nicht mehr aktiv)</option>`,
    );
  }

  return auswahl.join('\n        ');
}

function leererZustand(): string {
  return `<section class="leerzustand" aria-labelledby="kundenleer-titel">
    <h2 id="kundenleer-titel">Noch keine Kunden angelegt</h2>
    <p>Sobald Kunden bestehen, erscheinen sie hier mit ihrer Preisgruppe.</p>
  </section>`;
}
