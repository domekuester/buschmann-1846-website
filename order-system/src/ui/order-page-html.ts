import type { CatalogItemPrice, CatalogItemView } from '../application/catalog-view';
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
  /** Heute in Europe/Berlin — die untere Grenze des Datumsfeldes. */
  today: string;
  /** Vorbelegung des Datumsfeldes: in aller Regel morgen. */
  defaultDate: string;
  /**
   * Ob dem Kunden überhaupt eine gültige Preisgruppe zugeordnet ist.
   *
   * EIN BOOLESCHER WERT UND KEINE PREISLISTEN-ID: Die Seite muss wissen, OB
   * sie Preise zeigen kann, nicht WELCHE Liste dahintersteht. Der Code
   * „gastro" oder die Zahl 2 hätten auf dieser Seite nichts zu suchen — ein
   * Café erfährt nicht, in welche Schublade Buschmann es einsortiert hat.
   */
  hasPriceGroup: boolean;
}

export function renderOrderPage(view: OrderPageView): string {
  const name = escapeHtml(view.customerName);

  return htmlDocument(
    `Bestellung — ${name}`,
    `
    <header class="kopf">
      <p class="marke">Buschmann <span>1846</span></p>
      <h1>Bestellung für ${name}</h1>
      <p class="gruss">Schön, dass du da bist. Menge einstellen, Tag wählen, senden.</p>

      <form method="post" action="/logout" class="abmelden">
        <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
        <button type="submit" class="abmelden__taste">Abmelden</button>
      </form>
    </header>

    <main id="inhalt">
      <form class="formular" id="bestellformular" data-order-form data-submission-id="${escapeHtml(view.submissionId)}" data-csrf="${escapeHtml(view.csrfToken)}" novalidate>
        ${view.hasPriceGroup ? '' : priceGroupNotice()}

        <section aria-labelledby="titel-sortiment">
          <h2 id="titel-sortiment">Sortiment</h2>
          <ul class="produkte">
            ${view.products.map(productRow).join('\n')}
          </ul>
        </section>

        <section aria-labelledby="titel-liefertag">
          <h2 id="titel-liefertag">Liefertag</h2>
          <div class="feld">
            <label for="liefertag">Wann soll es da sein?</label>
            <input
              type="date"
              id="liefertag"
              name="fulfillment_date"
              value="${escapeHtml(view.defaultDate)}"
              min="${escapeHtml(view.today)}"
              required
              aria-describedby="fehler-liefertag"
            >
            <p class="feldfehler" id="fehler-liefertag" data-error-for="fulfillment_date" hidden></p>
          </div>
        </section>

        <section aria-labelledby="titel-notiz">
          <h2 id="titel-notiz">Noch etwas für uns?</h2>
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

      <section class="bestaetigung" data-confirmation role="status" tabindex="-1" hidden></section>
    </main>

    <footer class="leiste" data-summary-bar>
      <!--
        Die Fehlermeldung steht IN der Fußleiste, nicht im Formular.

        Im Formular stünde sie unter der Notiz — also außerhalb des sichtbaren
        Bereichs, während der Daumen unten auf „Bestellung senden" liegt. Eine
        Meldung, die man erst suchen muss, ist keine Meldung. Hier steht sie
        direkt über der Schaltfläche, die gerade nicht funktioniert hat.
      -->
      <p class="banner" role="alert" data-form-error hidden></p>

      <div class="leiste__zeile">
        <p class="summe">
          <span data-summary-lines>Noch nichts ausgewählt</span>
          <strong data-summary-total>0,00 €</strong>
        </p>
        <button type="submit" form="bestellformular" class="senden" data-submit>Bestellung senden</button>
      </div>
    </footer>

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
      return 'Auf Anfrage';
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
                <p class="produkt__preis">${escapeHtml(preis)}${orderable ? ` / ${unit}` : ''}</p>
                ${product.description === null ? '' : `<p class="produkt__beschreibung">${escapeHtml(product.description)}</p>`}
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
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
${body}
</body>
</html>
`;
}
