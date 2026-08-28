import type { AdminCustomerView } from '../domain/admin-customer';
import type { PriceGroupOption } from '../domain/customer-price-group';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml } from './format';

export interface AdminCustomersPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly customers: readonly AdminCustomerView[];
  readonly priceGroups: readonly PriceGroupOption[];
  readonly noticeCode: string | null;
}

const NOTICES: Readonly<Record<string, string>> = {
  customer_created: 'Der Kunde wurde angelegt.',
  customer_duplicate_code: 'Dieser Kundencode ist bereits vergeben. Es wurde nichts gespeichert.',
  customer_invalid: 'Der Kunde wurde nicht gespeichert. Bitte prüfe die Angaben.',
  customer_unknown: 'Diesen Kunden gibt es nicht mehr.',
  customer_internal: 'Der Kunde konnte gerade nicht gespeichert werden. Bitte versuche es erneut.',
};

export function renderAdminCustomersPage(view: AdminCustomersPageView): string {
  return renderAdminShell(
    'Kunden — Buschmann 1846',
    view,
    'customers',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Kunden</p>
      <h1>Kunden</h1>
      <p class="bereichskopf__vorspann">Kundenzugänge, Preisgruppen und Lieferung an einer Stelle pflegen.</p>
    </header>
    ${notice(view.noticeCode)}
    ${createForm(view.csrfToken, view.priceGroups)}
    ${view.customers.length === 0 ? emptyState() : customerTable(view.customers)}`,
  );
}

function createForm(csrfToken: string, priceGroups: readonly PriceGroupOption[]): string {
  return `<details class="operator-editor operator-editor--create">
    <summary>Neuer Kunde</summary>
    <form method="post" action="/api/admin/customers" class="operator-formular operator-formular--kunden">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
      ${identityFields()}
      ${contactFields()}
      ${addressFields()}
      ${businessFields(priceGroups, 'gastro', 'delivery', true)}
      <label class="operator-feld operator-feld--breit">Betriebliche Notiz
        <textarea name="internal_note" maxlength="1000"></textarea>
      </label>
      <label class="operator-feld">PIN
        <input name="pin" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="new-password" required>
        <span class="operator-hilfe">Genau acht Ziffern. Die PIN wird später nie angezeigt.</span>
      </label>
      <div class="operator-aktionen"><button class="senden" type="submit">Kunde speichern</button></div>
    </form>
  </details>`;
}

function identityFields(): string {
  return `<label class="operator-feld">Name
      <input name="name" maxlength="120" required>
    </label>
    <label class="operator-feld">Kundencode
      <input name="customer_code" maxlength="190" autocomplete="username" required>
    </label>`;
}

function contactFields(): string {
  return `<label class="operator-feld">Ansprechpartner
      <input name="contact_person" maxlength="120">
    </label>
    <label class="operator-feld">E-Mail
      <input name="email" type="email" maxlength="190">
    </label>
    <label class="operator-feld">Telefon
      <input name="phone" type="tel" maxlength="40">
    </label>`;
}

function addressFields(): string {
  return `<label class="operator-feld operator-feld--breit">Lieferadresse
      <input name="delivery_street" maxlength="160" placeholder="Straße und Hausnummer">
    </label>
    <label class="operator-feld">Postleitzahl
      <input name="delivery_postal_code" maxlength="10" inputmode="numeric">
    </label>
    <label class="operator-feld">Ort
      <input name="delivery_city" maxlength="100">
    </label>`;
}

function businessFields(
  priceGroups: readonly PriceGroupOption[],
  priceGroup: 'gastro' | 'private',
  fulfillment: 'delivery' | 'pickup',
  active: boolean,
): string {
  return `<label class="operator-feld">Preisgruppe
      <select name="price_group" required>${priceGroups.map((group) => `<option value="${escapeHtml(group.code)}"${group.code === priceGroup ? ' selected' : ''}>${escapeHtml(group.label)}</option>`).join('')}</select>
    </label>
    <label class="operator-feld">Erfüllung
      <select name="fulfillment" required>
        <option value="delivery"${fulfillment === 'delivery' ? ' selected' : ''}>Lieferung</option>
        <option value="pickup"${fulfillment === 'pickup' ? ' selected' : ''}>Abholung</option>
      </select>
    </label>
    <label class="operator-check"><input type="checkbox" name="is_active" value="1"${active ? ' checked' : ''}> Aktiv</label>`;
}

function customerTable(customers: readonly AdminCustomerView[]): string {
  return `<div class="datentabelle-wrap">
    <table class="datentabelle">
      <thead><tr><th scope="col">Kunde</th><th scope="col">Kundencode</th><th scope="col">Preisgruppe</th><th scope="col">Erfüllung</th><th scope="col">Status</th></tr></thead>
      <tbody>${customers.map(customerRow).join('')}</tbody>
    </table>
  </div>`;
}

function customerRow(customer: AdminCustomerView): string {
  return `<tr>
    <th scope="row" data-label="Kunde"><a class="kundenname" href="/admin/customers/${customer.id}">${escapeHtml(customer.name)}</a></th>
    <td data-label="Kundencode">${customer.customerCode === '' ? '<span class="kundenzustand">Kein Kundencode</span>' : escapeHtml(customer.customerCode.toUpperCase())}</td>
    <td data-label="Preisgruppe">${priceGroupLabel(customer.priceGroupCode)}</td>
    <td data-label="Erfüllung">${customer.defaultFulfillment === 'delivery' ? 'Lieferung' : 'Abholung'}</td>
    <td data-label="Status">${customer.isActive ? 'Aktiv' : '<span class="kundenzustand">Inaktiv</span>'}</td>
  </tr>`;
}

function priceGroupLabel(code: AdminCustomerView['priceGroupCode']): string {
  if (code === 'gastro') return 'Gastronomie';
  if (code === 'private') return 'Privatkunden';
  return '<span class="kundenzustand">Nicht zugeordnet</span>';
}

function notice(code: string | null): string {
  if (code === null || !Object.prototype.hasOwnProperty.call(NOTICES, code)) return '';
  const success = code === 'customer_created';
  return `<p class="${success ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung'}" role="status">${escapeHtml(NOTICES[code] ?? '')}</p>`;
}

function emptyState(): string {
  return `<section class="leerzustand" aria-labelledby="kundenleer-titel">
    <h2 id="kundenleer-titel">Noch keine Kunden angelegt</h2>
    <p>Lege den ersten Kunden über „Neuer Kunde“ an.</p>
  </section>`;
}
