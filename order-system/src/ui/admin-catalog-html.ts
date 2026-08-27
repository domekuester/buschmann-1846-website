import type { AdminCatalogProduct, CatalogPrice } from '../domain/catalog-pricing';
import type { CatalogProductChoice, ProductLinkRow } from '../domain/product-catalog-link';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatAmountInput, formatEuro } from './format';

/**
 * Sortiment & Preise — und seit Phase 5D ein zweiter, klar getrennter Bereich
 * darunter: „Bestellprodukte verknüpfen".
 *
 * ZWEI FRAGEN AUF EINER SEITE, UND SIE BLEIBEN GETRENNT:
 *
 *   „Was kostet was?"       die quelltreuen Katalogpreise. LESEND, wie seit
 *                           5A — hier wird kein VERKAUFSPREIS geändert, kein
 *                           Preis angelegt und keiner gelöscht. Seit Phase 7A
 *                           steht daneben ein Feld für die internen
 *                           HERSTELLKOSTEN; es schreibt genau eine Spalte:
 *                           catalog_products.unit_cost_cents.
 *   „Was ist was?"          die Zuordnung eines BESTELLBAREN Produkts zu
 *                           seinem Katalogprodukt. Sie schreibt genau eine
 *                           Spalte: products.catalog_product_id.
 *
 * SIE GEHÖREN ZUSAMMEN AUF EINE SEITE, weil man die zweite Frage nur mit der
 * ersten vor Augen beantworten kann: Wer „Käsekuchen" verknüpft, muss sehen,
 * welche Käsekuchen der Katalog kennt. Eine eigene Adminseite hätte dieselben
 * Daten noch einmal geladen und den Blick zwischen zwei Tabs geteilt.
 *
 * DER ZUORDNUNGSBEREICH SETZT KEINEN PREIS. Es gibt in dieser Datei keine
 * Preisliste zur Auswahl und keine Zeile, die einen Katalogpreis in ein
 * Produkt überträgt. Was ein verknüpftes Produkt einen bestimmten Kunden
 * kostet, entscheidet unverändert der Resolver aus Phase 5C.
 *
 * DAS EINZIGE BETRAGSFELD DIESER SEITE SIND DIE HERSTELLKOSTEN, und sie sind
 * kein Verkaufspreis: Sie sind der interne Schätzwert, den KEIN Kunde je zu
 * sehen bekommt. Ein Eingabefeld für einen Verkaufspreis gibt es hier
 * weiterhin nicht — die Preise stammen aus den importierten Preislisten.
 *
 * SIE TRÄGT KEIN SKRIPT. Auswahl und Speichern sind ein echtes
 * `<form method="post">` je Zeile — dieselbe Bauart wie die Preisgruppen der
 * Kundenliste und die Statusschaltflächen der Produktionsansicht. Ohne
 * JavaScript bedienbar, ohne Ausnahme in der CSP.
 *
 * ES GIBT KEIN AUTOMATISCHES MATCHING. Kein Vorschlag, keine
 * Ähnlichkeitsmarkierung, kein „passt vermutlich zu". Diese Datei vergleicht
 * an keiner Stelle einen Produktnamen mit einem Katalognamen — §3.
 */

export interface AdminCatalogPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly products: readonly AdminCatalogProduct[];
  /** Die bestellbaren Produkte mit ihrer bestehenden Zuordnung. */
  readonly productLinks: readonly ProductLinkRow[];
  /** Die Katalogprodukte, die neu vergeben werden dürfen — mitsamt Halter. */
  readonly catalogChoices: readonly CatalogProductChoice[];
  /**
   * Die Rückmeldung des letzten Speicherversuchs, als CODE und nicht als Text.
   *
   * Der Wert kommt aus der Adresszeile und ist damit vom Aufrufer bestimmt.
   * Er wird deshalb NIEMALS angezeigt, sondern ausschließlich in einer festen
   * Tabelle nachgeschlagen; ein unbekannter Code führt zu gar keiner Meldung.
   * Damit kann in dieser Meldung nichts stehen, was nicht im Quelltext steht
   * — dieselbe Regel wie bei der Kundenliste aus 5B.
   */
  readonly noticeCode: string | null;
}

/**
 * Die Meldungen der ZUORDNUNG. Codes ohne Präfix.
 */
const MELDUNGEN: Readonly<Record<string, string>> = {
  saved: 'Die Zuordnung wurde gespeichert.',
  unknown_product:
    'Dieses Bestellprodukt gibt es nicht mehr. Die Zuordnung wurde nicht gespeichert.',
  unknown_catalog_product:
    'Dieses Katalogprodukt gibt es nicht. Die Zuordnung wurde nicht gespeichert.',
  inactive_catalog_product:
    'Dieses Katalogprodukt wird nicht mehr vergeben. Die Zuordnung wurde nicht gespeichert.',
  catalog_product_taken:
    'Dieses Katalogprodukt gehört bereits zu einem anderen Bestellprodukt. ' +
    'Bitte löse die Zuordnung dort zuerst auf. Die Zuordnung wurde nicht gespeichert.',
  invalid: 'Die Auswahl war nicht lesbar. Die Zuordnung wurde nicht gespeichert.',
  internal:
    'Die Zuordnung konnte gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.',
};

/**
 * Die Meldungen der HERSTELLKOSTEN. Codes mit dem Präfix `cost_`.
 *
 * ZWEI TABELLEN UND NICHT EINE, weil die Seite zwei Vorgänge hat und jeder
 * seine Antwort dort bekommen muss, wo er ausgelöst wurde. Eine gemeinsame
 * Tabelle hätte die Antwort auf ein Kostenformular unten bei der Zuordnung
 * erscheinen lassen — außerhalb des Bildschirms und neben einer Tabelle, um
 * die es nicht ging.
 *
 * KEINE MELDUNG NENNT EINEN BETRAG. „2,10 € gespeichert" wäre bequem und
 * hieße, einen Wert aus der Adresszeile anzuzeigen; was auf dieser Seite
 * steht, steht im Quelltext dieser Datei.
 */
const KOSTENMELDUNGEN: Readonly<Record<string, string>> = {
  cost_saved: 'Die Herstellkosten wurden gespeichert.',
  cost_cleared: 'Die Herstellkosten wurden entfernt. Für dieses Produkt ist nun nichts hinterlegt.',
  cost_unknown_product:
    'Dieses Katalogprodukt gibt es nicht mehr. Die Herstellkosten wurden nicht gespeichert.',
  cost_invalid:
    'Bitte einen Betrag wie 2,10 eingeben — höchstens zwei Nachkommastellen, nicht negativ. ' +
    'Die Herstellkosten wurden nicht gespeichert.',
  cost_internal:
    'Die Herstellkosten konnten gerade nicht gespeichert werden. ' +
    'Bitte versuche es gleich noch einmal.',
};

/** Das Wort, das im ganzen Zuordnungsbereich für „keine Verknüpfung" steht. */
const OHNE_ZUORDNUNG = 'Nicht verknüpft';

/** Das Wort, das für „noch keine Herstellkosten gepflegt" steht — und nie „0,00 €". */
const OHNE_KOSTEN = 'Nicht hinterlegt';

export function renderAdminCatalogPage(view: AdminCatalogPageView): string {
  return renderAdminShell(
    'Sortiment & Preise — Buschmann 1846',
    view,
    'catalog',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Katalog</p>
      <h1>Sortiment &amp; Preise</h1>
      <p class="bereichskopf__vorspann">Gastronomie- und Privatpreise im direkten Vergleich.</p>
    </header>
    ${preisbereich(view)}
    ${zuordnungsbereich(view)}`,
  );
}

/* ------------------------------------------------------------------ *
 * Bereich 1 — die quelltreuen Katalogpreise und die internen
 * Herstellkosten.
 * ------------------------------------------------------------------ */

/**
 * Bereich 1 — die Katalogpreise UND, seit Phase 7A, die Herstellkosten.
 *
 * SIE STEHEN IN DERSELBEN TABELLE, weil sie zusammen gelesen werden: „Der
 * Privatpreis ist 5,20 €, uns kostet es 2,10 €" ist EIN Blick. Zwei Tabellen
 * hätten dieselben Produktnamen zweimal aufgeführt und den Vergleich zu einer
 * Sache des Gedächtnisses gemacht.
 *
 * DER BEREICH TRÄGT `id="herstellkosten"`, und die Weiterleitung nach dem
 * Speichern zeigt darauf — dieselbe Bauart wie `#zuordnung` seit 5D. Der
 * Anker ist eine KONSTANTE im Quelltext des Endpunkts und kommt nicht aus der
 * Anfrage.
 */
function preisbereich(view: AdminCatalogPageView): string {
  return `<section id="herstellkosten" class="katalogbereich" aria-labelledby="preise-titel">
      <h2 id="preise-titel" class="katalogbereich__titel">Katalogpreise</h2>
      ${internHinweis()}
      ${kostenmeldung(view.noticeCode)}
      ${view.products.length === 0 ? emptyState() : catalogTable(view)}
    </section>`;
}

/**
 * Der Satz, der die Herstellkosten als INTERN kennzeichnet — §6.
 *
 * ER STEHT ÜBER DER TABELLE UND NICHT IN EINER FUSSNOTE. Wer eine Zahl in ein
 * Feld tippt, soll wissen, wer sie sehen kann, BEVOR er sie eintippt. Die
 * Spaltenüberschrift wiederholt den Hinweis in Kurzform, damit er auch beim
 * Scrollen nicht verlorengeht.
 *
 * ER IST EINE ZUSAGE, DIE DER CODE EINHÄLT und keine Beschriftung: Es gibt in
 * diesem System keine kundenseitige Ansicht, die den Kostenwert überhaupt
 * geladen bekommt (siehe catalog-view.ts und
 * customer-price-book-repository.ts).
 */
function internHinweis(): string {
  return `<p class="katalogbereich__intern">
      <strong>Herstellkosten sind nur intern sichtbar.</strong>
      Kundinnen und Kunden sehen diese Angabe nirgends — weder auf der
      Bestellseite noch in einer Bestätigung.
    </p>`;
}

/**
 * Die Rückmeldung nach dem Speichern der Herstellkosten.
 *
 * role="status" und nicht role="alert": Der Vorgang ist abgeschlossen, die
 * Meldung unterbricht niemanden. Ein unbekannter Code führt zu GAR KEINER
 * Meldung — damit kann hier nichts stehen, was nicht im Quelltext steht.
 */
function kostenmeldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(KOSTENMELDUNGEN, code)
    ? KOSTENMELDUNGEN[code]
    : null;
  if (text === undefined || text === null) return '';

  /**
   * ERFOLG UND FEHLSCHLAG SEHEN NICHT GLEICH AUS — dieselbe Entscheidung wie
   * im Zuordnungsbereich. `.banner` ist im ganzen System die FEHLERdarstellung
   * samt vorangestelltem ⚠; „Die Herstellkosten wurden gespeichert." mit
   * einem Warndreieck davor wäre eine Meldung, die ihrer eigenen Aussage
   * widerspricht. Das Entfernen eines Werts ist ebenfalls ein Erfolg: Es war
   * gewollt.
   */
  const erfolg = code === 'cost_saved' || code === 'cost_cleared';
  const klasse = erfolg
    ? 'zuordnungsmeldung zuordnungsmeldung--erfolg'
    : 'banner zuordnungsmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}

function catalogTable(view: AdminCatalogPageView): string {
  return `<div class="datentabelle-wrap">
    <table class="datentabelle">
      <thead><tr>
        <th scope="col">Produkt</th>
        <th scope="col">Variante</th>
        <th scope="col">Einheit</th>
        <th scope="col">Gastronomie</th>
        <th scope="col">Privatkunden</th>
        <th scope="col">Herstellkosten <span class="spaltenzusatz">nur intern</span></th>
      </tr></thead>
      <tbody>${view.products.map((product) => productRow(product, view)).join('')}</tbody>
    </table>
  </div>`;
}

function productRow(product: AdminCatalogProduct, view: AdminCatalogPageView): string {
  return `<tr>
    <th scope="row" data-label="Produkt">${escapeHtml(product.name)}</th>
    <td data-label="Variante">${product.variant === null ? missing('Keine Variante') : escapeHtml(product.variant)}</td>
    <td data-label="Einheit">${product.unit === null ? missing('Keine Einheit angegeben') : escapeHtml(product.unit)}</td>
    <td data-label="Gastronomie" class="katalogpreis">${formatCatalogPrice(product.gastroPrice)}</td>
    <td data-label="Privatkunden" class="katalogpreis">${formatCatalogPrice(product.privatePrice)}</td>
    <td data-label="Herstellkosten" class="kostenzelle">${kostenformular(product, view)}</td>
  </tr>`;
}

/**
 * Das Herstellkostenformular EINER Zeile.
 *
 * DAS KATALOGPRODUKT STEHT IM PFAD und nicht im Körper. Damit gibt es kein
 * Feld, über das sich ein anderes Produkt unterschieben ließe — und der
 * Server prüft den Pfad ohnehin, bevor er irgendetwas schreibt.
 *
 * IM KÖRPER STEHEN GENAU ZWEI FELDER: der CSRF-Token der Sitzung und der
 * Betrag. Keine Rolle, kein Kunde, kein Produktname, kein Verkaufspreis,
 * keine Preisliste, kein Rückkehrziel. Was nicht im Formular steht, wird auch
 * nicht gelesen.
 *
 * ES TRÄGT KEIN SKRIPT — ein echtes `<form method="post">` je Zeile, dieselbe
 * Bauart wie die Zuordnung darunter. Ohne JavaScript bedienbar, ohne Ausnahme
 * in der CSP.
 *
 * `type="text"` UND NICHT `type="number"`: Ein Zahlenfeld nimmt in vielen
 * Browsern kein deutsches Dezimalkomma an und macht aus „2,10" je nach
 * Gebietsschema nichts oder 210. `inputmode="decimal"` holt auf dem Handy
 * trotzdem die Zifferntastatur.
 *
 * DER LEERE WERT IST „NICHT HINTERLEGT". Ein Produkt ohne gepflegte Kosten
 * zeigt ein LEERES Feld und nicht „0,00" — 0 wäre eine Behauptung, die
 * niemand aufgestellt hat (§2).
 */
function kostenformular(product: AdminCatalogProduct, view: AdminCatalogPageView): string {
  const feldId = `herstellkosten-${product.id}`;
  const wert = product.unitCostCents === null ? '' : formatAmountInput(product.unitCostCents);

  return `<form method="post" action="/api/admin/catalog-products/${product.id}/cost" class="kosten">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <label class="nur-vorlesen" for="${feldId}">Herstellkosten für ${escapeHtml(product.name)} in Euro</label>
      <span class="kosten__eingabe">
        <input type="text" inputmode="decimal" id="${feldId}" name="unit_cost"
               value="${escapeHtml(wert)}" placeholder="${OHNE_KOSTEN}"
               autocomplete="off" maxlength="10" class="kosten__feld">
        <span class="kosten__waehrung" aria-hidden="true">€</span>
      </span>
      <button type="submit" class="senden kosten__senden">Speichern</button>
    </form>`;
}

function formatCatalogPrice(price: CatalogPrice | null): string {
  if (price === null) return missing('Kein Preis hinterlegt');
  if (price.type === 'fixed') return formatEuro(price.priceCents);
  if (price.type === 'from') return `ab ${formatEuro(price.minPriceCents)}`;
  if (price.type === 'range') {
    return `${formatEuro(price.minPriceCents).slice(0, -2)}–${formatEuro(price.maxPriceCents)}`;
  }
  return 'Auf Anfrage';
}

function missing(label: string): string {
  return `<span aria-label="${label}">—</span>`;
}

function emptyState(): string {
  return `<section class="leerzustand" aria-labelledby="leerzustand-titel">
    <h3 id="leerzustand-titel">Noch kein Sortiment importiert</h3>
    <p>Nach dem lokalen Import erscheinen Produkte und Preise hier automatisch.</p>
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Bereich 2 — die Zuordnung. Der einzige schreibende Teil der Seite.
 * ------------------------------------------------------------------ */

/**
 * Der Bereich trägt `id="zuordnung"`, und die Weiterleitung nach dem
 * Speichern zeigt darauf.
 *
 * Ohne den Sprungpunkt landete der Admin nach jedem Speichern wieder ganz
 * oben bei der Preistabelle — und die Meldung zu seinem Vorgang stünde
 * außerhalb des Bildschirms. Der Anker ist eine KONSTANTE im Quelltext des
 * Endpunkts und kommt nicht aus der Anfrage.
 */
function zuordnungsbereich(view: AdminCatalogPageView): string {
  return `<section id="zuordnung" class="katalogbereich" aria-labelledby="zuordnung-titel">
      <h2 id="zuordnung-titel" class="katalogbereich__titel">Bestellprodukte verknüpfen</h2>
      <p class="katalogbereich__vorspann">
        Welches Bestellprodukt zu welchem Katalogprodukt gehört. Die Zuordnung wird
        bewusst gesetzt — sie wird nie aus Namen abgeleitet.
      </p>
      ${meldung(view.noticeCode)}
      ${zuordnungsstand(view.productLinks)}
      ${view.productLinks.length === 0 ? leererZustand() : zuordnungstabelle(view)}
    </section>`;
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
   * ERFOLG UND FEHLSCHLAG SEHEN NICHT GLEICH AUS — dieselbe Entscheidung wie
   * auf der Kundenliste. `.banner` ist im ganzen System die FEHLERdarstellung
   * samt vorangestelltem ⚠; „Die Zuordnung wurde gespeichert." mit einem
   * Warndreieck davor wäre eine Meldung, die ihrer eigenen Aussage
   * widerspricht.
   *
   * Die Fehlerfälle behalten `.banner` — sie SIND Fehlschläge und sagen
   * jeweils dazu, dass nichts gespeichert wurde.
   */
  const klasse = code === 'saved'
    ? 'zuordnungsmeldung zuordnungsmeldung--erfolg'
    : 'banner zuordnungsmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}

/**
 * „6 Bestellprodukte · 4 verknüpft · 2 nicht verknüpft" — §20.
 *
 * Drei Zahlen aus einer bereits geladenen Liste, keine zusätzliche Abfrage und
 * kein Diagramm. Sie beantworten genau die Frage, mit der jemand hier ankommt:
 * Bin ich fertig? Bei leerer Liste erscheint gar nichts — „0 von 0" wäre
 * Rauschen.
 */
function zuordnungsstand(links: readonly ProductLinkRow[]): string {
  if (links.length === 0) return '';

  const verknuepft = links.filter((zeile) => zeile.catalogProduct !== null).length;
  const offen = links.length - verknuepft;

  return `<p class="zuordnungsstand">
      <strong>${links.length} ${links.length === 1 ? 'Bestellprodukt' : 'Bestellprodukte'}</strong>
      · ${verknuepft} verknüpft
      · ${offen} nicht verknüpft
    </p>`;
}

function zuordnungstabelle(view: AdminCatalogPageView): string {
  return `<div class="datentabelle-wrap">
    <table class="datentabelle">
      <thead><tr>
        <th scope="col">Bestellprodukt</th>
        <th scope="col">Katalogprodukt</th>
        <th scope="col">Zuordnung ändern</th>
      </tr></thead>
      <tbody>${view.productLinks.map((zeile) => zuordnungszeile(zeile, view)).join('')}</tbody>
    </table>
  </div>`;
}

function zuordnungszeile(zeile: ProductLinkRow, view: AdminCatalogPageView): string {
  return `<tr>
    <th scope="row" data-label="Bestellprodukt">
      ${escapeHtml(zeile.name)}${zeile.isActive ? '' : ' <span class="kundenzustand">Inaktiv</span>'}
    </th>
    <td data-label="Katalogprodukt" class="zuordnungsziel">${zielText(zeile)}</td>
    <td data-label="Zuordnung ändern" class="zuordnungaktion">${zuordnungsformular(zeile, view)}</td>
  </tr>`;
}

/**
 * Die bestehende Zuordnung im Klartext — §19.
 *
 * DER ZUSTAND STEHT ALS WORT DA und nicht nur als Farbe: „Verknüpft" bzw.
 * „Nicht verknüpft". Eine Ampel wäre für jemanden mit Farbsehschwäche eine
 * leere Zelle, und in einem Screenreader wäre sie gar nichts.
 *
 * EIN STILLGELEGTES KATALOGPRODUKT WIRD BENANNT UND NICHT ERSETZT. Es hier
 * still auf „Nicht verknüpft" zu setzen wäre eine Änderung der Preisidentität
 * hinter dem Rücken dessen, der sie einmal getroffen hat — dieselbe Regel wie
 * bei der deaktivierten Preisgruppe in 5B.
 */
function zielText(zeile: ProductLinkRow): string {
  const ziel = zeile.catalogProduct;
  if (ziel === null) {
    return `<span class="zuordnungsziel--offen">${OHNE_ZUORDNUNG}</span>`;
  }

  const hinweis = ziel.isActive ? '' : ' <span class="kundenzustand">nicht mehr aktiv</span>';
  return `<span class="zuordnungsziel--gesetzt">Verknüpft</span>
      <span class="zuordnungsziel__name">${escapeHtml(ziel.label)}</span>${hinweis}`;
}

/**
 * Das Änderungsformular EINER Zeile.
 *
 * DAS PRODUKT STEHT IM PFAD und nicht im Körper. Damit gibt es kein Feld,
 * über das sich ein anderes Produkt unterschieben ließe — und der Server
 * prüft den Pfad ohnehin, bevor er irgendetwas schreibt.
 *
 * IM KÖRPER STEHEN GENAU ZWEI FELDER: der CSRF-Token der Sitzung und die
 * gewünschte Katalogkennung. Keine Rolle, kein Kunde, kein Produktname, kein
 * Preis, keine Preisliste, kein Rückkehrziel. Was nicht im Formular steht,
 * wird auch nicht gelesen (§16).
 *
 * DAS AUSWAHLFELD HAT EIN EIGENES LABEL JE ZEILE. „Katalogprodukt" allein
 * käme in einem Screenreader zwanzigmal gleich an; „Katalogprodukt für
 * Käsekuchen" sagt, worüber gerade entschieden wird. Sichtbar ist es nicht —
 * die Spaltenüberschrift sagt es Sehenden bereits.
 */
function zuordnungsformular(zeile: ProductLinkRow, view: AdminCatalogPageView): string {
  const feldId = `katalogwahl-${zeile.id}`;

  return `<form method="post" action="/api/admin/products/${zeile.id}/catalog-link" class="zuordnung">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <label class="nur-vorlesen" for="${feldId}">Katalogprodukt für ${escapeHtml(zeile.name)}</label>
      <select id="${feldId}" name="catalog_product_id" class="zuordnung__wahl">
        ${optionen(zeile, view.catalogChoices)}
      </select>
      <button type="submit" class="senden zuordnung__senden">Speichern</button>
    </form>`;
}

/**
 * Die Auswahl: „Nicht verknüpft" plus die Katalogprodukte, die für DIESES
 * Produkt in Frage kommen.
 *
 * DER LEERE WERT IST „NICHT VERKNÜPFT" und kann mit keiner echten Kennung
 * kollidieren: Eine Zeilennummer ist nie leer. Damit unterscheidet der Server
 * zweifelsfrei zwischen „ausdrücklich nicht verknüpft" (leeres Feld) und „gar
 * kein Feld geschickt" (Fehler).
 *
 * EIN KATALOGPRODUKT, DAS EIN ANDERES PRODUKT HÄLT, STEHT NICHT IN DER LISTE
 * — §5. Die Oberfläche soll nichts anbieten, was der Server dann ablehnen
 * müsste; die Regel selbst liegt weiterhin im partiellen UNIQUE-Index aus
 * 0014 und wird im Endpunkt geprüft, nicht hier.
 *
 * EIN STILLGELEGTES KATALOGPRODUKT STEHT NUR DANN IN DER LISTE, WENN ES
 * BEREITS ZUGEORDNET IST — sonst zeigte das Feld für dieses Produkt etwas
 * anderes an als das, was gespeichert ist. Es ist damit die Fortschreibung
 * des Bestehenden und keine neue Wahlmöglichkeit.
 */
function optionen(
  zeile: ProductLinkRow,
  choices: readonly CatalogProductChoice[],
): string {
  const zugeordnet = zeile.catalogProduct;
  const auswahl: string[] = [
    `<option value=""${zugeordnet === null ? ' selected' : ''}>${OHNE_ZUORDNUNG}</option>`,
  ];

  for (const choice of choices) {
    if (choice.linkedProductId !== null && choice.linkedProductId !== zeile.id) {
      continue;
    }
    const gewaehlt = zugeordnet !== null && zugeordnet.id === choice.id;
    auswahl.push(
      `<option value="${choice.id}"${gewaehlt ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`,
    );
  }

  if (zugeordnet !== null && !choices.some((c) => c.id === zugeordnet.id)) {
    auswahl.push(
      `<option value="${zugeordnet.id}" selected>${escapeHtml(zugeordnet.label)} (nicht mehr aktiv)</option>`,
    );
  }

  return auswahl.join('\n        ');
}

function leererZustand(): string {
  return `<section class="leerzustand" aria-labelledby="zuordnungleer-titel">
    <h3 id="zuordnungleer-titel">Noch keine Bestellprodukte</h3>
    <p>Sobald bestellbare Produkte bestehen, erscheinen sie hier mit ihrer Zuordnung.</p>
  </section>`;
}
