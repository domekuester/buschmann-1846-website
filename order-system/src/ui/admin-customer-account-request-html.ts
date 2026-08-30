import type { CustomerAccountRequestView } from '../domain/customer-account-request';
import type { PriceGroupOption } from '../domain/customer-price-group';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatGermanTimestamp } from './format';

interface ShellView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
}

export interface AdminCustomerAccountRequestsPageView extends ShellView {
  readonly requests: readonly CustomerAccountRequestView[];
  readonly pendingCount: number;
  readonly noticeCode: string | null;
}

export interface AdminCustomerAccountRequestDetailPageView extends ShellView {
  readonly request: CustomerAccountRequestView;
  readonly priceGroups: readonly PriceGroupOption[];
  readonly noticeCode: string | null;
}

const NOTICES: Readonly<Record<string, string>> = {
  request_rejected: 'Die Anfrage wurde abgelehnt und bleibt in der Historie erhalten.',
  request_converted: 'Die Anfrage wurde als Kunde übernommen.',
  request_invalid: 'Die Anfrage wurde nicht bearbeitet. Bitte prüfe die Angaben.',
  request_duplicate_code: 'Dieser Kundencode ist bereits vergeben. Es wurde kein Kunde angelegt.',
  request_unavailable: 'Die Anfrage ist nicht mehr offen. Es wurde nichts geändert.',
  request_internal: 'Die Anfrage konnte gerade nicht bearbeitet werden. Bitte versuche es erneut.',
};

export function renderCustomerWorkspaceNav(
  active: 'customers' | 'requests',
  pendingCount: number,
): string {
  return `<nav class="kundenbereich-nav" aria-label="Kundenbereich">
    <a href="/admin/customers"${active === 'customers' ? ' aria-current="page"' : ''}>Bestandskunden</a>
    <a href="/admin/customers/requests"${active === 'requests' ? ' aria-current="page"' : ''}>Anfragen <span class="kundenbereich-nav__zahl" aria-label="${pendingCount} offene Anfragen">${pendingCount}</span></a>
  </nav>`;
}

export function renderAdminCustomerAccountRequestsPage(
  view: AdminCustomerAccountRequestsPageView,
): string {
  return renderAdminShell(
    'Kundenanfragen — Buschmann 1846',
    view,
    'customers',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Kunden</p>
      <h1>Anfragen</h1>
      <p class="bereichskopf__vorspann">Neue Kundenkontakte prüfen und bewusst als Kunden übernehmen.</p>
    </header>
    ${renderCustomerWorkspaceNav('requests', view.pendingCount)}
    ${notice(view.noticeCode)}
    <section class="kundenliste anfragenliste" aria-labelledby="anfragenliste-titel">
      <div class="operator-liste__kopf">
        <h2 id="anfragenliste-titel">Kundenanfragen</h2>
        <p><strong>${view.pendingCount}</strong> ${view.pendingCount === 1 ? 'offen' : 'offen'}</p>
      </div>
      ${view.requests.length === 0 ? '<p class="tafel__leer">Noch keine Kundenanfrage vorhanden.</p>' : requestTable(view.requests)}
    </section>`,
  );
}

export function renderAdminCustomerAccountRequestDetailPage(
  view: AdminCustomerAccountRequestDetailPageView,
): string {
  const request = view.request;
  return renderAdminShell(
    `${request.name} — Kundenanfrage — Buschmann 1846`,
    view,
    'customers',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker"><a href="/admin/customers/requests">Kunden · Anfragen</a></p>
      <h1>${escapeHtml(request.name)}</h1>
      <p class="bereichskopf__vorspann">Eingegangen am ${escapeHtml(formatGermanTimestamp(request.createdAt))} Uhr · ${statusLabel(request.status)}</p>
    </header>
    ${notice(view.noticeCode)}
    ${requestDetails(request)}
    ${request.status === 'pending' ? pendingActions(view) : processedState(request)}`,
  );
}

function requestTable(requests: readonly CustomerAccountRequestView[]): string {
  return `<div class="datentabelle-wrap"><table class="datentabelle">
    <thead><tr><th scope="col">Name / Firma</th><th scope="col">Ansprechpartner</th><th scope="col">E-Mail</th><th scope="col">Telefon</th><th scope="col">Ort</th><th scope="col">Eingang</th><th scope="col">Status</th></tr></thead>
    <tbody>${requests.map(requestRow).join('')}</tbody>
  </table></div>`;
}

function requestRow(request: CustomerAccountRequestView): string {
  return `<tr>
    <th scope="row" data-label="Name / Firma"><a class="kundenname" href="/admin/customers/requests/${request.id}">${escapeHtml(request.name)}</a></th>
    <td data-label="Ansprechpartner">${escapeHtml(request.contactPerson ?? '—')}</td>
    <td data-label="E-Mail"><a href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.email)}</a></td>
    <td data-label="Telefon">${escapeHtml(request.phone)}</td>
    <td data-label="Ort">${escapeHtml(request.city ?? '—')}</td>
    <td data-label="Eingang">${escapeHtml(formatGermanTimestamp(request.createdAt))} Uhr</td>
    <td data-label="Status">${statusLabel(request.status)}</td>
  </tr>`;
}

function requestDetails(request: CustomerAccountRequestView): string {
  const address = [request.street, request.postalCode, request.city].filter((part) => part !== null).join(', ');
  return `<section class="tafel anfragedetail" aria-labelledby="anfragedaten-titel">
    <div class="tafel__kopf"><h2 id="anfragedaten-titel" class="tafel__titel">Eingereichte Angaben</h2><p class="tafel__meta">${statusLabel(request.status)}</p></div>
    <dl class="anfragedaten">
      ${detail('Name / Firma', request.name)}
      ${detail('Ansprechpartner', request.contactPerson ?? '—')}
      ${detail('E-Mail', request.email)}
      ${detail('Telefon', request.phone)}
      ${detail('Adresse', address === '' ? '—' : address)}
      ${detail('Nachricht', request.message ?? '—', true)}
    </dl>
  </section>`;
}

function detail(label: string, value: string, wide = false): string {
  return `<div${wide ? ' class="anfragedaten__breit"' : ''}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function pendingActions(view: AdminCustomerAccountRequestDetailPageView): string {
  const request = view.request;
  return `<section class="tafel" aria-labelledby="uebernahme-titel">
    <div class="tafel__kopf"><h2 id="uebernahme-titel" class="tafel__titel">Als Kunde übernehmen</h2><p class="tafel__meta">bewusste Zuordnung</p></div>
    <p class="operator-hinweis">Preisgruppe, Erfüllung, Kundencode und PIN werden nicht aus der Anfrage abgeleitet. Bitte ausdrücklich festlegen.</p>
    <form method="post" action="/api/admin/customer-account-requests/${request.id}/convert" class="operator-formular operator-formular--kunden">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <input type="hidden" name="expected_updated_at" value="${escapeHtml(request.updatedAt)}">
      <label class="operator-feld">Name<input name="name" maxlength="120" value="${escapeHtml(request.name)}" required></label>
      <label class="operator-feld">Kundencode<input name="customer_code" maxlength="190" autocomplete="username" required></label>
      <label class="operator-feld">Ansprechpartner<input name="contact_person" maxlength="120" value="${escapeHtml(request.contactPerson ?? '')}"></label>
      <label class="operator-feld">E-Mail<input name="email" type="email" maxlength="190" value="${escapeHtml(request.email)}"></label>
      <label class="operator-feld">Telefon<input name="phone" type="tel" maxlength="40" value="${escapeHtml(request.phone)}"></label>
      <label class="operator-feld operator-feld--breit">Lieferadresse<input name="delivery_street" maxlength="160" value="${escapeHtml(request.street ?? '')}"></label>
      <label class="operator-feld">Postleitzahl<input name="delivery_postal_code" maxlength="10" value="${escapeHtml(request.postalCode ?? '')}"></label>
      <label class="operator-feld">Ort<input name="delivery_city" maxlength="100" value="${escapeHtml(request.city ?? '')}"></label>
      <label class="operator-feld">Preisgruppe<select name="price_group" required>
        <option value="" selected disabled>Bitte auswählen</option>
        ${view.priceGroups.map((group) => `<option value="${escapeHtml(group.code)}">${escapeHtml(group.label)}</option>`).join('')}
      </select></label>
      <label class="operator-feld">Erfüllung<select name="fulfillment" required>
        <option value="" selected disabled>Bitte auswählen</option>
        <option value="delivery">Lieferung</option>
        <option value="pickup">Abholung</option>
      </select></label>
      <label class="operator-check"><input type="checkbox" name="is_active" value="1" checked> Aktiv</label>
      <label class="operator-feld operator-feld--breit">Betriebliche Notiz<textarea name="internal_note" maxlength="1000"></textarea></label>
      <label class="operator-feld">PIN<input name="pin" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="new-password" required><span class="operator-hilfe">Genau acht Ziffern. Die PIN wird später nie angezeigt.</span></label>
      <div class="operator-aktionen"><button class="senden" type="submit">Als Kunde übernehmen</button></div>
    </form>
  </section>
  <details class="operator-editor anfrage-ablehnen">
    <summary>Ablehnen</summary>
    <form method="post" action="/api/admin/customer-account-requests/${request.id}/reject" class="operator-formular">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <input type="hidden" name="expected_updated_at" value="${escapeHtml(request.updatedAt)}">
      <label class="operator-feld">Interne Notiz<textarea name="rejection_note" maxlength="500"></textarea><span class="operator-hilfe">Optional. Wird nicht an den Anfragenden gesendet.</span></label>
      <button class="senden senden--zweit" type="submit">Anfrage ablehnen</button>
    </form>
  </details>`;
}

function processedState(request: CustomerAccountRequestView): string {
  const text = request.status === 'converted'
    ? `Als Kunde übernommen${request.linkedCustomerName === null ? '.' : `: ${request.linkedCustomerName}.`}`
    : `Abgelehnt${request.rejectionNote === null ? '.' : ` · Interne Notiz: ${request.rejectionNote}`}`;
  return `<p class="kundenmeldung kundenmeldung--erfolg anfrage-bearbeitet" role="status">${escapeHtml(text)}</p>`;
}

function statusLabel(status: CustomerAccountRequestView['status']): string {
  if (status === 'pending') return '<span class="kundenzustand kundenzustand--offen">Offen</span>';
  if (status === 'converted') return '<span class="kundenzustand">Übernommen</span>';
  return '<span class="kundenzustand">Abgelehnt</span>';
}

function notice(code: string | null): string {
  if (code === null || !Object.prototype.hasOwnProperty.call(NOTICES, code)) return '';
  const success = code === 'request_rejected' || code === 'request_converted';
  return `<p class="${success ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung'}" role="status">${escapeHtml(NOTICES[code] ?? '')}</p>`;
}
