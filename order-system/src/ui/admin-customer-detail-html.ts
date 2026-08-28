import type { AdminCustomerView } from '../domain/admin-customer';
import type { CustomerOrderLine } from '../domain/customer-history';
import type { PriceGroupOption } from '../domain/customer-price-group';
import { orderStatusLabel } from '../domain/order-status';
import { isPaid, paymentStatusLabel } from '../domain/payment-status';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatEuro, formatGermanNumericDate } from './format';

export interface AdminCustomerDetailView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly customer: AdminCustomerView;
  readonly orders: readonly CustomerOrderLine[];
  readonly orderLimit: number;
  readonly noticeCode: string | null;
  readonly priceGroups: readonly PriceGroupOption[];
}

const NOTICES: Readonly<Record<string, string>> = {
  customer_saved: 'Der Kunde wurde gespeichert.',
  customer_conflict: 'Der Kunde wurde zwischenzeitlich geändert. Bitte lade die Seite neu und prüfe die Angaben.',
  customer_duplicate_code: 'Dieser Kundencode ist bereits vergeben. Es wurde nichts gespeichert.',
  customer_invalid: 'Der Kunde wurde nicht gespeichert. Bitte prüfe die Angaben.',
  pin_saved: 'Die PIN wurde neu vergeben.',
  pin_invalid: 'Die PIN wurde nicht geändert. Bitte gib acht Ziffern ein und bestätige den Vorgang.',
  customer_unknown: 'Diesen Kunden gibt es nicht mehr.',
  customer_internal: 'Die Änderung konnte gerade nicht gespeichert werden. Bitte versuche es erneut.',
};

export function renderAdminCustomerDetailPage(view: AdminCustomerDetailView): string {
  return renderAdminShell(
    `${view.customer.name} — Buschmann 1846`,
    view,
    'customers',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker"><a href="/admin/customers">Kunden</a></p>
      <h1>${escapeHtml(view.customer.name)}</h1>
      <p class="bereichskopf__vorspann">Stammdaten, Zugang und letzte Bestellungen.</p>
    </header>
    ${notice(view.noticeCode)}
    ${editForm(view.customer, view.csrfToken, view.priceGroups)}
    ${pinForm(view.customer, view.csrfToken)}
    ${orders(view)}`,
  );
}

function editForm(
  customer: AdminCustomerView,
  csrfToken: string,
  priceGroups: readonly PriceGroupOption[],
): string {
  const address = customer.deliveryAddress;
  return `<section class="tafel" aria-labelledby="kundendaten-titel">
    <div class="tafel__kopf"><h2 id="kundendaten-titel" class="tafel__titel">Kundendaten</h2><p class="tafel__meta">${customer.isActive ? 'Aktiv' : 'Inaktiv'}</p></div>
    <form method="post" action="/api/admin/customers/${customer.id}" class="operator-formular operator-formular--kunden">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="expected_updated_at" value="${escapeHtml(customer.updatedAt)}">
      <label class="operator-feld">Name<input name="name" maxlength="120" value="${escapeHtml(customer.name)}" required></label>
      <label class="operator-feld">Kundencode<input name="customer_code" maxlength="190" autocomplete="username" value="${escapeHtml(customer.customerCode)}" required></label>
      <label class="operator-feld">Ansprechpartner<input name="contact_person" maxlength="120" value="${escapeHtml(customer.contactPerson ?? '')}"></label>
      <label class="operator-feld">E-Mail<input name="email" type="email" maxlength="190" value="${escapeHtml(customer.email ?? '')}"></label>
      <label class="operator-feld">Telefon<input name="phone" type="tel" maxlength="40" value="${escapeHtml(customer.phone ?? '')}"></label>
      <label class="operator-feld operator-feld--breit">Lieferadresse<input name="delivery_street" maxlength="160" value="${escapeHtml(address?.street ?? '')}" placeholder="Straße und Hausnummer"></label>
      <label class="operator-feld">Postleitzahl<input name="delivery_postal_code" maxlength="10" value="${escapeHtml(address?.postalCode ?? '')}"></label>
      <label class="operator-feld">Ort<input name="delivery_city" maxlength="100" value="${escapeHtml(address?.city ?? '')}"></label>
      <label class="operator-feld">Preisgruppe${priceGroupState(customer.priceGroupCode, priceGroups)}<select name="price_group" required>${priceOptions(customer.priceGroupCode, priceGroups)}</select></label>
      <label class="operator-feld">Erfüllung<select name="fulfillment" required>
        <option value="delivery"${customer.defaultFulfillment === 'delivery' ? ' selected' : ''}>Lieferung</option>
        <option value="pickup"${customer.defaultFulfillment === 'pickup' ? ' selected' : ''}>Abholung</option>
      </select></label>
      <label class="operator-check"><input type="checkbox" name="is_active" value="1"${customer.isActive ? ' checked' : ''}> Aktiv</label>
      <label class="operator-feld operator-feld--breit">Betriebliche Notiz<textarea name="internal_note" maxlength="1000">${escapeHtml(customer.internalNote ?? '')}</textarea></label>
      <div class="operator-aktionen"><button class="senden" type="submit">Änderungen speichern</button></div>
    </form>
  </section>`;
}

function pinForm(customer: AdminCustomerView, csrfToken: string): string {
  return `<details class="operator-editor">
    <summary>Neue PIN vergeben</summary>
    <form method="post" action="/api/admin/customers/${customer.id}/pin" class="operator-formular operator-formular--pin">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
      <label class="operator-feld">Kundencode<input name="customer_code" maxlength="190" autocomplete="username" value="${escapeHtml(customer.customerCode)}" required></label>
      <label class="operator-feld">Neue PIN<input name="pin" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="new-password" required><span class="operator-hilfe">Die bisherige PIN wird nie angezeigt.</span></label>
      <label class="operator-check operator-feld--breit"><input type="checkbox" name="confirm_pin" value="1" required> Ich möchte die bisherige PIN ungültig machen.</label>
      <div class="operator-aktionen"><button class="senden" type="submit">PIN neu vergeben</button></div>
    </form>
  </details>`;
}

function priceOptions(
  current: AdminCustomerView['priceGroupCode'],
  groups: readonly PriceGroupOption[],
): string {
  const options = current === null ? ['<option value="" selected disabled>Bitte auswählen</option>'] : [];
  if (current !== null && !groups.some((group) => group.code === current)) {
    options.push(`<option value="${escapeHtml(current)}" selected disabled>${current === 'gastro' ? 'Gastronomie' : 'Privatkunden'} (nicht mehr aktiv)</option>`);
  }
  options.push(...groups.map((group) => `<option value="${escapeHtml(group.code)}"${group.code === current ? ' selected' : ''}>${escapeHtml(group.label)}</option>`));
  return options.join('');
}

function priceGroupState(
  current: AdminCustomerView['priceGroupCode'],
  groups: readonly PriceGroupOption[],
): string {
  if (current === null) return '<span class="operator-hilfe">Nicht zugeordnet</span>';
  return groups.some((group) => group.code === current)
    ? ''
    : '<span class="operator-hilfe">Diese Preisgruppe ist nicht mehr aktiv.</span>';
}

function notice(code: string | null): string {
  if (code === null || !Object.prototype.hasOwnProperty.call(NOTICES, code)) return '';
  const success = code === 'customer_saved' || code === 'pin_saved';
  return `<p class="${success ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung'}" role="status">${escapeHtml(NOTICES[code] ?? '')}</p>`;
}

function orders(view: AdminCustomerDetailView): string {
  const hasOrders = view.orders.length > 0;
  return `<section class="tafel${hasOrders ? ' tafel--tabelle' : ''} kundenhistorie" aria-labelledby="historie-titel">
    <div class="tafel__kopf"><h2 id="historie-titel" class="tafel__titel">Letzte Bestellungen</h2><p class="tafel__meta">${escapeHtml(historyExtent(view))}</p></div>
    ${hasOrders ? historyTable(view.orders) : '<p class="tafel__leer">Noch keine Bestellung vorhanden.</p>'}
  </section>`;
}

function historyExtent(view: AdminCustomerDetailView): string {
  if (view.orders.length === 0) return 'noch keine';
  if (view.orders.length >= view.orderLimit) return `die letzten ${view.orderLimit}`;
  return view.orders.length === 1 ? 'eine Bestellung' : `alle ${view.orders.length} Bestellungen`;
}

function historyTable(items: readonly CustomerOrderLine[]): string {
  return `<div class="datentabelle-wrap"><table class="datentabelle">
    <thead><tr><th scope="col">Produktionstag</th><th scope="col">Bestellnummer</th><th scope="col">Status</th><th scope="col" class="spalte-betrag">Betrag</th><th scope="col">Zahlung</th></tr></thead>
    <tbody>${items.map(historyRow).join('')}</tbody>
  </table></div>`;
}

function historyRow(order: CustomerOrderLine): string {
  const cancelled = order.status === 'cancelled';
  return `<tr${cancelled ? ' class="bestellzeile--storniert"' : ''}>
    <th scope="row" data-label="Produktionstag">${escapeHtml(formatGermanNumericDate(order.fulfillmentDate))}</th>
    <td data-label="Bestellnummer"><span class="bestellzeile__nummer">${escapeHtml(order.orderNumber)}</span></td>
    <td data-label="Status">${cancelled ? `<span class="bestellzeile__storno">${escapeHtml(orderStatusLabel(order.status))}</span>` : escapeHtml(orderStatusLabel(order.status))}</td>
    <td data-label="Betrag" class="bestellzeile__betrag">${escapeHtml(formatEuro(order.totalCents))}</td>
    <td data-label="Zahlung"><span class="zahlstand ${isPaid(order.paymentStatus) ? 'zahlstand--bezahlt' : 'zahlstand--offen'}">${escapeHtml(paymentStatusLabel(order.paymentStatus))}</span></td>
  </tr>`;
}
