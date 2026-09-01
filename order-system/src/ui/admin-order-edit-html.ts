import { OrderItem } from '../domain/order-item';
import { escapeHtml, formatEuro, formatGermanDate } from './format';

/**
 * Die Seite, auf der Claudia eine Menge ändert.
 *
 * SIE KOMMT OHNE JAVASCRIPT AUS — wie der gesamte Adminbereich. Die
 * Content-Security-Policy dieser Anwendung lässt kein Inline-Skript zu, und
 * ein ausgeliefertes Skript wäre für zwei Formulare der falsche Aufwand. Die
 * Folgen sind sichtbar und beabsichtigt:
 *
 *   Der neue Gesamtbetrag wird nicht LIVE mitgerechnet. Die Seite zeigt den
 *   Betrag, der gilt; nach dem Speichern zeigt sie den neuen. Eine Zahl, die
 *   sich beim Tippen ändert, ohne dass sie irgendwo steht, wäre ohnehin die
 *   unehrlichere Auskunft.
 *
 *   Die Stornierung fragt über eine ZWEITE ANSICHT derselben Seite nach
 *   (?stornieren=<id>) und nicht über einen Dialog. Das ist dieselbe
 *   Entscheidung wie bei der vollständigen Stornierung seit Phase 4B, die
 *   dafür eine eigene Seite hat — nur ohne die zweite Route: Der Zustand
 *   „diese eine Position steht zur Bestätigung" ist eine Frage an dieselbe
 *   Bestellung.
 *
 * EINE MENGENÄNDERUNG WIRD NICHT BESTÄTIGT. Sie ist umkehrbar — wer sich
 * vertippt, tippt zurück, und die Historie hält beide Schritte fest. Eine
 * Rückfrage bei jeder Zahl wäre die Sorte Sicherheitsabfrage, die man nach
 * dem dritten Mal wegklickt, ohne sie zu lesen. Die STORNIERUNG bekommt eine,
 * weil sie nicht umkehrbar ist.
 */

export interface OrderEditItemView {
  readonly id: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly unitPriceLabel: string;
  readonly quantity: number;
  readonly lineTotalLabel: string;
  readonly cancelled: boolean;
}

export interface AdminOrderEditPageView {
  readonly csrfToken: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly fulfillmentDate: string;
  readonly statusLabel: string;
  readonly totalLabel: string;
  /**
   * Der Stand der Bestellung (orders.updated_at) — er reist als verstecktes
   * Feld mit und ist der optimistische Schutz gegen zwei gleichzeitige
   * Admins. Siehe application/edit-order-item.ts.
   */
  readonly version: string;
  readonly items: readonly OrderEditItemView[];
  /** Ob die Bestellung als bezahlt geführt wird — dann wird gewarnt. */
  readonly isPaid: boolean;
  /** Die Position, deren Stornierung gerade bestätigt werden soll. */
  readonly confirmingCancellation: OrderEditItemView | null;
  readonly noticeCode: string | null;
  /** Der Weg zurück in die Bestellliste, mit Tag. */
  readonly backHref: string;
}

/**
 * Die Rückmeldungen dieser Seite.
 *
 * Eine feste Tabelle und keine freien Zeichenketten: Was in der Adresszeile
 * steht, wird hier NACHGESCHLAGEN. In der angezeigten Meldung kann damit
 * nichts stehen, was nicht in dieser Datei im Quelltext steht — dieselbe
 * Bauart wie im Dashboard.
 */
const MELDUNGEN: Readonly<Record<string, string>> = {
  items_saved: 'Die Mengen wurden gespeichert.',
  items_unchanged: 'Es wurde nichts geändert.',
  items_invalid: 'Die eingegebene Menge ist keine gültige Menge. Es wurde nichts geändert.',
  items_conflict:
    'Die Bestellung wurde zwischenzeitlich an anderer Stelle geändert. Es wurde nichts geändert — bitte prüfe den aktuellen Stand.',
  items_internal: 'Die Änderung wurde nicht gespeichert. Bitte versuche es gleich noch einmal.',
  item_cancelled: 'Die Position wurde storniert.',
  item_already_cancelled: 'Diese Position war bereits storniert. Es wurde nichts geändert.',
  item_unknown: 'Diese Position gehört nicht zu dieser Bestellung. Es wurde nichts geändert.',
};

const ERFOLG = new Set(['items_saved', 'item_cancelled']);

export function renderAdminOrderEditPage(view: AdminOrderEditPageView): string {
  const orderNumber = escapeHtml(view.orderNumber);

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Bestellung ${orderNumber} bearbeiten — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="adminseite">
<header class="kopf kopf--schmal">
  <p class="marke">Buschmann <span>1846</span></p>
  <form method="post" action="/logout" class="abmelden">
    <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
    <button type="submit" class="abmelden__taste">Abmelden</button>
  </form>
</header>

<main id="inhalt" class="bearbeitung">
  <p class="bearbeitung__kicker">Bestellung bearbeiten</p>
  <h1>Bestellung ${orderNumber}</h1>

  <dl class="bearbeitung__daten">
    <div><dt>Kunde</dt><dd>${escapeHtml(view.customerName)}</dd></div>
    <div><dt>Liefertag</dt><dd>${escapeHtml(formatGermanDate(view.fulfillmentDate))}</dd></div>
    <div><dt>Status</dt><dd>${escapeHtml(view.statusLabel)}</dd></div>
  </dl>

  ${meldung(view.noticeCode)}
  ${zahlungswarnung(view.isPaid)}
  ${stornoBestaetigung(view)}
  ${mengenformular(view)}

  <p class="bearbeitung__weg"><a href="${escapeHtml(view.backHref)}">Zurück zu Bestellungen</a></p>
</main>
</body>
</html>
`;
}

/**
 * DIE WARNUNG BEI EINER BEZAHLTEN BESTELLUNG.
 *
 * Sie steht VOR dem Formular und nicht daneben: Wer eine Menge ändert, soll
 * gelesen haben, dass sich damit der Betrag einer bereits beglichenen
 * Bestellung verschiebt — vorher, nicht nachher.
 *
 * SIE VERHINDERT NICHTS. Die Änderung ist erlaubt; der Anruf des Cafés ist
 * echt, und ein System, das ihn ablehnt, zwingt zum Storno der ganzen
 * Bestellung. Was hier ausdrücklich NICHT geschieht, ist eine automatische
 * Verrechnung: keine Erstattung, keine Nachforderung, kein zurückgesetzter
 * Zahlungsstand. Das System weiß nicht, wie das Geld geflossen ist, und eine
 * Zahl, die so tut, wäre schlimmer als ein Satz, der um Prüfung bittet.
 *
 * role="alert": Sie erscheint erst, wenn die Lage eintritt, und ein
 * Screenreader soll sie nicht überlesen.
 */
function zahlungswarnung(isPaid: boolean): string {
  if (!isPaid) return '';

  return `<p class="bearbeitung__zahlwarnung" role="alert"><strong>Diese Bestellung ist bereits als bezahlt markiert.</strong>
    Durch die Änderung verändert sich der Bestellbetrag.
    Bitte die Zahlung bzw. Erstattung separat prüfen.</p>`;
}

/**
 * Die Rückfrage vor einer Stornierung.
 *
 * Sie ist ein EIGENES Formular und steht deshalb über dem Mengenformular:
 * Formulare lassen sich nicht ineinander schachteln, und die Stornierung ist
 * ein anderer Vorgang mit einem anderen Ziel.
 */
function stornoBestaetigung(view: AdminOrderEditPageView): string {
  const position = view.confirmingCancellation;
  if (position === null) return '';

  const orderNumber = escapeHtml(encodeURIComponent(view.orderNumber));

  return `<section class="bearbeitung__storno" role="alert" aria-labelledby="storno-titel">
    <h2 id="storno-titel">Position wirklich stornieren?</h2>
    <p class="bearbeitung__storno-position"><strong>${escapeHtml(position.productName)}</strong> —
      ${position.quantity} ${escapeHtml(position.productUnit)}, ${escapeHtml(position.lineTotalLabel)}</p>
    <p class="bearbeitung__storno-hinweis">Die Position bleibt zur Nachvollziehbarkeit sichtbar,
      zählt aber nicht mehr zu Produktion und Bestellbetrag. Diese Aktion kann nicht rückgängig
      gemacht werden.</p>
    <div class="bearbeitung__storno-aktionen">
      <a class="bearbeitung__abbrechen" href="/admin/orders/${orderNumber}/bearbeiten">Abbrechen</a>
      <form method="post" action="/api/admin/orders/${orderNumber}/items/${position.id}/cancel">
        <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
        <button type="submit" class="statustaste statustaste--final">Position stornieren<span class="hinweis"> — ${escapeHtml(
          position.productName,
        )}</span></button>
      </form>
    </div>
  </section>`;
}

/**
 * EIN Formular über ALLE Positionen — und genau eine Schaltfläche darunter.
 *
 * Ein Formular je Zeile wäre der einfachere Bau und die schlechtere Bedienung:
 * Wer zwei Mengen ändert, müsste zweimal speichern und bekäme zwei
 * Bestätigungen, zwei Spuren und dazwischen einen Zustand, den er nicht
 * gemeint hat. So ist eine Änderung EIN Vorgang — und im Server auch ein
 * einziger Schreibvorgang.
 *
 * JEDE ZEILE TRÄGT IHRE MENGE IM FELDNAMEN (quantity_<id>) und nichts sonst.
 * Es gibt kein verstecktes Feld für Preis, Produkt oder Positionsbetrag: Der
 * Server liest ausschließlich die Menge, und was nicht im Formular steht,
 * kann nicht unterschoben werden.
 */
function mengenformular(view: AdminOrderEditPageView): string {
  const orderNumber = escapeHtml(encodeURIComponent(view.orderNumber));
  const aktive = view.items.filter((item) => !item.cancelled);

  return `<form class="bearbeitung__formular" method="post" action="/api/admin/orders/${orderNumber}/items">
    <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
    <input type="hidden" name="version" value="${escapeHtml(view.version)}">

    <div class="datentabelle-wrap">
      <table class="datentabelle bearbeitung__tabelle">
        <thead><tr>
          <th scope="col">Position</th>
          <th scope="col" class="spalte-betrag">Stückpreis</th>
          <th scope="col">Menge</th>
          <th scope="col" class="spalte-betrag">Betrag</th>
          <th scope="col">Aktion</th>
        </tr></thead>
        <tbody>${view.items.map((item) => zeile(item, view.orderNumber)).join('')}</tbody>
      </table>
    </div>

    <div class="bearbeitung__fuss">
      <p class="bearbeitung__summe">
        <span class="bearbeitung__summe-wort">Gesamtbetrag</span>
        <strong class="bearbeitung__summe-zahl">${escapeHtml(view.totalLabel)}</strong>
      </p>
      ${
        aktive.length === 0
          ? '<p class="bearbeitung__leer">Alle Positionen dieser Bestellung sind storniert.</p>'
          : '<button type="submit" class="senden">Änderungen speichern</button>'
      }
    </div>
  </form>`;
}

function zeile(item: OrderEditItemView, orderNumber: string): string {
  const feldId = `menge-${item.id}`;

  return `<tr${item.cancelled ? ' class="bearbeitung__zeile--storniert"' : ''}>
    <th scope="row" data-label="Position">
      <span class="bearbeitung__produkt">${escapeHtml(item.productName)}</span>
      <span class="bearbeitung__einheit">${escapeHtml(item.productUnit)}</span>
    </th>
    <td data-label="Stückpreis" class="bearbeitung__betrag">${escapeHtml(item.unitPriceLabel)}</td>
    <td data-label="Menge">${
      item.cancelled
        ? `<span class="bearbeitung__storniert">Storniert</span><span class="bearbeitung__urmenge">ursprünglich ${
            item.quantity
          } ${escapeHtml(item.productUnit)}</span>`
        : `<label class="nur-vorlesen" for="${escapeHtml(feldId)}">Menge für ${escapeHtml(
            item.productName,
          )}</label>
        <input class="bearbeitung__menge" type="number" inputmode="numeric"
               id="${escapeHtml(feldId)}" name="quantity_${item.id}" value="${item.quantity}"
               min="1" max="${OrderItem.MAX_QUANTITY}" step="1" required>`
    }</td>
    <td data-label="Positionsbetrag" class="bearbeitung__betrag">${escapeHtml(item.lineTotalLabel)}</td>
    <td data-label="Aktion">${
      item.cancelled
        ? '<span class="tafel__meta">Keine Aktion</span>'
        : `<a class="bearbeitung__stornolink" href="/admin/orders/${escapeHtml(
            encodeURIComponent(orderNumber),
          )}/bearbeiten?stornieren=${item.id}">Position stornieren<span class="hinweis"> — ${escapeHtml(
            item.productName,
          )}</span></a>`
    }</td>
  </tr>`;
}

/**
 * Erfolg und Fehlschlag sehen nicht gleich aus — dieselbe Regel wie im
 * Dashboard. `.banner` ist im ganzen System die Fehlerdarstellung; „Die
 * Mengen wurden gespeichert." mit einem Warndreieck davor wäre eine Meldung,
 * die ihrer eigenen Aussage widerspricht.
 */
function meldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(MELDUNGEN, code) ? MELDUNGEN[code] : null;
  if (text === undefined || text === null) return '';

  const klasse = ERFOLG.has(code) ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung';
  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}

/** Die Positionszeile als Ansichtswert — Beträge fertig formatiert. */
export function toOrderEditItemView(item: {
  id: number;
  productName: string;
  productUnit: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  cancelledAt: string | null;
}): OrderEditItemView {
  return {
    id: item.id,
    productName: item.productName,
    productUnit: item.productUnit,
    unitPriceLabel: formatEuro(item.unitPriceCents),
    quantity: item.quantity,
    lineTotalLabel: formatEuro(item.lineTotalCents),
    cancelled: item.cancelledAt !== null,
  };
}
