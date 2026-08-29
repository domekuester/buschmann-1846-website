import type { CatalogItemPrice, CatalogItemView } from '../application/catalog-view';
import type { FulfillmentType } from '../domain/fulfillment-type';
import { escapeHtml, formatEuro } from './format';

/**
 * Das Seitengerüst der Bestelloberfläche.
 *
 * Serverseitig gerendert, nicht im Browser aufgebaut. Ein Café soll das
 * Sortiment nach EINEM Roundtrip sehen; ein Gerüst, das anschließend erst
 * Produkte nachlädt, wäre ein zweiter — und in einem Betrieb mit schlechtem
 * Empfang ist das der Unterschied zwischen „sofort da" und „lädt".
 *
 * Die Funktion ist rein: Sie bekommt alles übergeben und liest weder Uhr noch
 * Zufall noch Datenbank. Deshalb können die UI-Tests genau dieses HTML in ein
 * DOM legen und das echte Client-Skript darauf loslassen — geprüft wird die
 * ausgelieferte Seite, nicht ein Testfragment.
 *
 * DER SITZUNGSTOKEN STEHT NICHT IM DOKUMENT. Er liegt HttpOnly im Cookie und
 * ist für JavaScript unsichtbar; ein Screenshot der Seite oder ein kopierter
 * Quelltext enthält ihn nicht.
 *
 * Was im Dokument steht, ist der CSRF-Token — und das MUSS so sein: Das
 * Client-Skript liest ihn und sendet ihn beim Absenden zurück. Er ist ein
 * anderer Wert mit einer anderen Aufgabe. Wer ihn kennt, kann damit nichts
 * anfangen, solange er nicht auch das Cookie hat.
 */
export interface OrderPageView {
  customerName: string;
  products: readonly CatalogItemView[];
  /** Serverseitig erzeugt, siehe migrations/0007. */
  submissionId: string;
  /** Der Synchronizer-Token der Sitzung. Steht bewusst lesbar im Dokument. */
  csrfToken: string;
  /**
   * Der früheste Tag, für den nach der Bestellrichtlinie noch bestellt werden
   * kann — die untere Grenze des Datumsfeldes.
   *
   * BIS PHASE 6F STAND HIER SCHLICHT „HEUTE". Seit es einen Bestellschluss
   * gibt, ist „heute" nicht mehr automatisch bestellbar: Um 14:00 Uhr mit
   * einem Bestellschluss von gestern 12:00 ist der früheste mögliche Tag
   * übermorgen. Das Feld nennt deshalb den Tag, den der Server auch annähme.
   *
   * Es ist eine BEQUEMLICHKEIT UND KEINE SICHERUNG: `min` hält niemanden auf,
   * der die Anfrage selbst baut. Die Regel gilt im Bestell-Endpunkt, und dort
   * wird sie unmittelbar vor dem Schreiben noch einmal geprüft.
   */
  earliestDate: string;
  /** Vorbelegung des Datumsfeldes: der nächste tatsächlich mögliche Tag. */
  defaultDate: string;
  /**
   * Welche Wochentage überhaupt gehen — oder null, wenn alle gehen.
   *
   * Ein Datumsfeld kann einzelne Wochentage nicht ausgrauen; ohne diesen Satz
   * wäre der einzige Hinweis darauf die Fehlermeldung NACH dem Absenden. Er
   * steht deshalb vorher da, und er kommt aus derselben Richtlinie.
   */
  orderDaysNotice: string | null;
  /** Der Bestellschluss im Klartext — oder null, wenn keiner gilt. */
  cutoffNotice: string | null;
  /**
   * Ob dem Kunden überhaupt eine gültige Preisgruppe zugeordnet ist.
   *
   * EIN BOOLESCHER WERT UND KEINE PREISLISTEN-ID: Die Seite muss wissen, OB
   * sie Preise zeigen kann, nicht WELCHE Liste dahintersteht. Der Code
   * „gastro" oder die Zahl 2 hätten auf dieser Seite nichts zu suchen — ein
   * Café erfährt nicht, in welche Schublade Buschmann es einsortiert hat.
   */
  hasPriceGroup: boolean;
  /** Rein informativer Kontokontext; niemals ein Formularwert. */
  priceContextLabel: string;
  /** Stammt aus dem angemeldeten Kundenkonto und ist nicht auswählbar. */
  fulfillmentType: FulfillmentType;
}

export function renderOrderPage(view: OrderPageView): string {
  const name = escapeHtml(view.customerName);
  const priceContext = escapeHtml(view.priceContextLabel);
  const fulfillment = view.fulfillmentType === 'delivery' ? 'Lieferung' : 'Abholung';
  const dateLabel = germanDate(view.defaultDate);
  const priceHint = view.hasPriceGroup
    ? `Es gelten Ihre ${priceContext}.`
    : 'Bestellungen sind erst nach Zuordnung einer Preisgruppe möglich.';

  return htmlDocument(
    `Bestellung — ${name}`,
    `
    <header class="kundenkopf">
      <div class="kundenkopf__innen">
        <p class="marke">Buschmann <span>1846</span></p>
        <div class="kundenkopf__konto">
          <p class="kundenkopf__kunde">${name}</p>
          <p class="kundenkopf__kontext">${priceContext} <span aria-hidden="true">·</span> ${fulfillment}</p>
          <form method="post" action="/logout" class="abmelden">
            <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
            <button type="submit" class="abmelden__taste">Abmelden</button>
          </form>
        </div>
      </div>
    </header>

    <main id="inhalt" class="bestellung">
      <header class="bestellung__intro">
        <p class="bestellung__schritt">Ihre Bestellung</p>
        <h1>Bestellung für ${name}</h1>
        <p>Produkte auswählen, Menge festlegen und anschließend in Ruhe prüfen.</p>
      </header>

      <div class="bestellung__layout" data-order-workspace>
        <form class="formular" id="bestellformular" data-order-form data-submission-id="${escapeHtml(view.submissionId)}" data-csrf="${escapeHtml(view.csrfToken)}" novalidate>
          ${view.hasPriceGroup ? '' : priceGroupNotice()}

          <section class="sortiment" aria-labelledby="titel-sortiment">
            <div class="abschnittskopf">
              <h2 id="titel-sortiment">Produkte auswählen</h2>
              <p>Menge direkt am Produkt einstellen.</p>
            </div>
            <p class="feldfehler sortiment__fehler" data-error-for="items" hidden></p>
            <ul class="produkte">
              ${view.products.map(productRow).join('\n')}
            </ul>
          </section>

          <section class="erfuellung" aria-labelledby="titel-liefertag">
            <div class="abschnittskopf">
              <h2 id="titel-liefertag">${fulfillment} planen</h2>
              <p>Die Art ist in Ihrem Kundenkonto hinterlegt.</p>
            </div>
            <div class="erfuellung__felder">
              <div class="erfuellung__konto">
                <span>Fulfillment</span>
                <strong>${fulfillment}</strong>
              </div>
              <div class="feld">
                <label for="liefertag">Datum</label>
                <input
                  type="date"
                  id="liefertag"
                  name="fulfillment_date"
                  value="${escapeHtml(view.defaultDate)}"
                  min="${escapeHtml(view.earliestDate)}"
                  required
                  aria-describedby="fehler-liefertag"
                >
                <p class="feldfehler" id="fehler-liefertag" data-error-for="fulfillment_date" hidden></p>
                ${bestellregeln(view)}
              </div>
            </div>
          </section>

          <section class="bestellnotiz" aria-labelledby="titel-notiz">
            <div class="abschnittskopf">
              <h2 id="titel-notiz">Hinweis zur Bestellung</h2>
              <p>Nur wenn wir etwas beachten sollen.</p>
            </div>
            <div class="feld">
              <label for="notiz">Notiz <span class="optional">(optional)</span></label>
              <textarea
                id="notiz"
                name="note"
                rows="3"
                maxlength="500"
                aria-describedby="fehler-notiz"
                placeholder="Zum Beispiel: bitte an der Rückseite anliefern"
              ></textarea>
              <p class="feldfehler" id="fehler-notiz" data-error-for="note" hidden></p>
            </div>
          </section>

          <noscript>
            <p class="banner banner--statisch">
              Für die Bestellung wird JavaScript gebraucht. Bitte aktiviere es —
              oder melde dich direkt bei Buschmann 1846.
            </p>
          </noscript>
        </form>

        <aside class="bestelluebersicht" data-summary-bar aria-labelledby="titel-uebersicht">
          <h2 id="titel-uebersicht">Ihre Auswahl</h2>
          <div class="bestelluebersicht__positionen">
            <p class="bestelluebersicht__leer" data-summary-empty>Noch keine Produkte ausgewählt.</p>
            <ul class="bestelluebersicht__liste" data-summary-items></ul>
          </div>
          <dl class="bestelluebersicht__details">
            <div><dt>${fulfillment}</dt><dd>${fulfillment}</dd></div>
            <div><dt>Datum</dt><dd><time datetime="${escapeHtml(view.defaultDate)}" data-summary-date>${escapeHtml(dateLabel)}</time></dd></div>
          </dl>
          <div class="bestelluebersicht__summe">
            <span><span data-summary-lines>Noch nichts ausgewählt</span><span>Gesamtsumme</span></span>
            <strong data-summary-total>0,00 €</strong>
          </div>
          <p class="banner" role="alert" data-form-error hidden></p>
          <button type="button" class="senden" data-review${view.hasPriceGroup ? '' : ' disabled'}>
            <span class="bestelluebersicht__aktion--mobil">Auswahl prüfen</span>
            <span class="bestelluebersicht__aktion--desktop">Bestellung prüfen</span>
          </button>
          <p class="bestelluebersicht__hinweis">${priceHint}</p>
        </aside>
      </div>

      <section class="pruefung" data-review-panel tabindex="-1" aria-labelledby="titel-pruefung" hidden>
        <p class="bestellung__schritt">Letzter Schritt</p>
        <h2 id="titel-pruefung">Bestellung prüfen</h2>
        <p class="pruefung__intro">Bitte prüfen Sie Produkte, Mengen und Termin vor dem verbindlichen Absenden.</p>
        <ul class="pruefung__positionen" data-review-items></ul>
        <dl class="pruefung__details">
          <div><dt>Fulfillment</dt><dd data-review-fulfillment>${fulfillment}</dd></div>
          <div><dt>Datum</dt><dd data-review-date>${escapeHtml(dateLabel)}</dd></div>
          <div class="pruefung__gesamt"><dt>Gesamtsumme</dt><dd data-review-total>—</dd></div>
        </dl>
        <p class="banner" role="alert" data-review-error hidden></p>
        <div class="pruefung__aktionen">
          <button type="submit" form="bestellformular" class="senden" data-submit>Verbindlich bestellen</button>
          <button type="button" class="sekundaertaste" data-edit-selection>Auswahl bearbeiten</button>
        </div>
      </section>

      <section class="bestaetigung" data-confirmation role="status" tabindex="-1" hidden></section>
    </main>

    <p class="hinweis" aria-live="polite" data-live-region></p>
    `,
  );
}

/**
 * Der Hinweis für einen Kunden ohne nutzbare Preisgruppe.
 *
 * Er steht ÜBER dem Sortiment und nicht darunter: Wer die Seite öffnet und
 * bei keinem Produkt einen Preis findet, soll den Grund lesen, bevor er
 * sucht.
 *
 * role="status" statt role="alert": Das ist kein Fehler des Cafés und keine
 * Warnung, sondern eine Auskunft über einen Verwaltungsstand. Ein alert
 * unterbricht Screenreader-Nutzer mitten im Vorlesen.
 *
 * Der Text nennt weder Preislisten-ID noch Code noch den Unterschied zwischen
 * „nicht zugeordnet" und „stillgelegt" — für das Café ist beides derselbe
 * Vorgang mit derselben Lösung.
 */
function priceGroupNotice(): string {
  return `
        <section class="banner banner--statisch" role="status" aria-labelledby="titel-preisgruppe" data-price-group-notice>
          <h2 id="titel-preisgruppe">Noch keine Preisgruppe hinterlegt</h2>
          <p>
            Für dein Kundenkonto ist noch keine Preisgruppe hinterlegt. Deshalb
            können wir hier gerade keine Preise anzeigen und keine Bestellung
            entgegennehmen. Bitte wende dich an Buschmann 1846 — wir tragen das
            kurz nach.
          </p>
        </section>`;
}

/**
 * Der Preis einer Zeile in deutscher Schreibweise.
 *
 * VIER FORMEN, WEIL DIE PREISLISTEN VIER FORMEN KENNEN. „ab 55,00 €" wird
 * NICHT zu „55,00 €", und eine Spanne wird nicht zu ihrem unteren Ende: Beides
 * wäre ein Betrag, den niemand vereinbart hat.
 *
 * Bei der Spanne entfällt das Eurozeichen der Untergrenze — „55,00–75,00 €"
 * statt „55,00 €–75,00 €". Dieselbe Schreibweise wie im Adminkatalog.
 */
function priceLabel(price: CatalogItemPrice): string {
  switch (price.kind) {
    case 'fixed':
      return formatEuro(price.priceCents);
    case 'from':
      return `ab ${formatEuro(price.minPriceCents)}`;
    case 'range':
      return `${formatEuro(price.minPriceCents).slice(0, -2)}–${formatEuro(price.maxPriceCents)}`;
    case 'on_request':
      return 'Preis auf Anfrage';
    default:
      /**
       * §38: NIEMALS „0,00 €".
       *
       * Ein fehlender Preis ist kein Preis von null. Ein Café, das „0,00 €"
       * liest, denkt an ein Geschenk und nicht an eine Lücke in der
       * Stammdatenpflege — und bestellt.
       */
      return 'Preis auf Anfrage';
  }
}

/**
 * Warum eine Zeile keine Mengenauswahl hat.
 *
 * Der Text ist nicht technisch und nennt keinen Preistyp: „price_type = from"
 * ist eine Datenbankangabe, kein Satz für einen Menschen.
 */
function unorderableHint(price: CatalogItemPrice): string {
  if (price.kind === 'unavailable') {
    return 'Für dieses Produkt können wir hier gerade keinen Preis anzeigen. Bitte sprich uns an.';
  }
  return 'Für dieses Produkt ist keine direkte Online-Preisberechnung möglich. Bitte sprich uns an.';
}

/**
 * Eine Produktzeile.
 *
 * Der Stepper ist die einzige Interaktion der Seite und deshalb der einzige
 * Ort, an dem Sorgfalt in die Bedienbarkeit geht: echte Buttons (kein div mit
 * Klick-Handler), ein echtes Zahlenfeld dazwischen (Tastatureingabe bleibt
 * möglich), und beide Buttons tragen den Produktnamen in ihrem aria-label —
 * „eins mehr" allein wäre in einer Liste von zwölf Produkten wertlos.
 *
 * ES GIBT IHN AB PHASE 5C NUR NOCH BEI EINEM FESTPREIS.
 *
 * Ein Produkt mit „ab", einer Spanne, „auf Anfrage" oder ganz ohne Preis für
 * diesen Kunden bekommt KEINE Mengenauswahl — kein deaktiviertes Feld,
 * sondern gar keines. Das ist der Unterschied zwischen „du darfst gerade
 * nicht" und „das gibt es hier nicht": Ein deaktiviertes Feld lässt sich im
 * Browser wieder aktivieren, ein fehlendes nicht.
 *
 * DAS IST TROTZDEM KEINE SICHERHEITSMASSNAHME. Der Server lehnt dieselbe
 * Bestellung auch dann ab, wenn jemand die Zeile von Hand ins Formular
 * schreibt — siehe Order.place(). Das Weglassen hier ist Bedienbarkeit, nicht
 * Schutz.
 *
 * data-price-cents steht ebenfalls nur an bepreisbaren Zeilen. Der Client
 * rechnet damit die Zwischensumme — und nur für die Anzeige. Verbindlich ist
 * ausschließlich, was der Server aus D1 nimmt.
 */
function productRow(product: CatalogItemView): string {
  const name = escapeHtml(product.name);
  const unit = escapeHtml(product.unit);
  const inputId = `menge-${product.id}`;
  const orderable = product.price.kind === 'fixed';
  const preis = priceLabel(product.price);

  return `
            <li class="produkt${orderable ? '' : ' produkt--ohne-preis'}" data-product-row${orderable ? '' : ' data-unorderable'}>
              <div class="produkt__text">
                <p class="produkt__name" id="produkt-${product.id}">${name}</p>
                ${product.description === null ? '' : `<p class="produkt__beschreibung">${escapeHtml(product.description)}</p>`}
                <p class="produkt__einheit">${unit}</p>
                <p class="produkt__preis">${escapeHtml(preis)}</p>
                ${orderable ? '' : `<p class="produkt__hinweis" id="hinweis-${product.id}">${escapeHtml(unorderableHint(product.price))}</p>`}
              </div>
              ${orderable ? stepper(product, inputId, name, unit) : ''}
            </li>`;
}

/** Die Mengenauswahl — nur für Zeilen mit exaktem Preis. */
function stepper(product: CatalogItemView, inputId: string, name: string, unit: string): string {
  // Nur der Zweig 'fixed' trägt einen Betrag; der Aufrufer stellt das sicher.
  const priceCents = product.price.kind === 'fixed' ? product.price.priceCents : 0;

  return `<div class="stepper">
                <button
                  type="button"
                  class="stepper__taste"
                  data-step="-1"
                  aria-label="${name}: eins weniger"
                  disabled
                >&minus;</button>
                <input
                  type="number"
                  class="stepper__zahl"
                  id="${inputId}"
                  inputmode="numeric"
                  min="0"
                  max="9999"
                  step="1"
                  value="0"
                  autocomplete="off"
                  data-quantity
                  data-product-id="${product.id}"
                  data-price-cents="${priceCents}"
                  data-product-name="${name}"
                  data-product-unit="${unit}"
                  aria-label="Menge ${name}"
                >
                <button
                  type="button"
                  class="stepper__taste"
                  data-step="1"
                  aria-label="${name}: eins mehr"
                >+</button>
              </div>`;
}

/**
 * Das gemeinsame Dokument.
 *
 * Kein Inline-Skript, kein Inline-Stil, kein Verweis auf einen fremden Host —
 * das ist keine Stilfrage, sondern die Voraussetzung für die CSP aus
 * src/http/security.ts UND dafür, dass der Token in der URL nirgendwohin als
 * Referer abfließen kann. Was nicht angefragt wird, kann nichts mitnehmen.
 */
function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css?v=8b2b-4">
<script type="module" src="/assets/app.js"></script>
</head>
<body class="kundenseite">
${body}
</body>
</html>
`;
}

function germanDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null ? value : `${match[3]}.${match[2]}.${match[1]}`;
}

/**
 * Was die Bestellrichtlinie dem Café über den Liefertag zu sagen hat.
 *
 * ZWEI SÄTZE HÖCHSTENS, UND MEISTENS KEINER. Solange alle Wochentage gehen
 * und kein Bestellschluss gilt, steht hier nichts — ein Hinweis, der nichts
 * einschränkt, ist Rauschen an einer Stelle, an der jemand gerade Mengen
 * einstellt.
 *
 * SIE STEHEN UNTER DEM DATUMSFELD UND NICHT IN EINEM BANNER OBEN. Dort werden
 * sie gelesen, wenn die Frage aufkommt — nämlich beim Wählen des Tages.
 *
 * KEIN SKRIPT UND KEINE RECHNUNG IM BROWSER: Beide Sätze kommen fertig vom
 * Server und aus derselben Richtlinie, die auch die Bestellung annimmt.
 */
function bestellregeln(view: OrderPageView): string {
  const saetze = [view.orderDaysNotice, view.cutoffNotice].filter(
    (satz): satz is string => satz !== null,
  );
  if (saetze.length === 0) {
    return '';
  }

  return `<p class="feldhinweis">${saetze.map(escapeHtml).join(' ')}</p>`;
}
