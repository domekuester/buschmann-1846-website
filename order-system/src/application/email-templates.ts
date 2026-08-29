import { normalizeEmailAddress } from '../domain/email-notification-settings';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import type { Order } from '../domain/order';
import type { EmailMessage } from '../infrastructure/email/email-sender';
import { escapeHtml, formatEuro, formatGermanNumericDate } from '../ui/format';

export function renderOperatorNewOrderEmail(
  order: Order,
  recipient: string,
  appOrigin?: string,
): EmailMessage {
  const link = adminLink(appOrigin, order);
  const subject = safeSubject(
    `Neue Bestellung ${order.orderNumber.value} – ${order.customerNameSnapshot}`,
  );
  const textLines = [
    'Neue Bestellung',
    '',
    `Kunde: ${order.customerNameSnapshot}`,
    `Bestellnummer: ${order.orderNumber.value}`,
    `Art: ${fulfillmentLabel(order.fulfillmentType)}`,
    `Gewünschter Termin: ${formatGermanNumericDate(order.fulfillmentDate.value)}`,
    '',
    'Bestellte Produkte:',
    ...order.items.map((item) =>
      `${item.quantity} × ${item.productNameSnapshot} · ${item.productUnitSnapshot}`),
    '',
    `Gesamt: ${formatEuro(order.total().cents)}`,
    ...(link === null ? [] : ['', `Bestellung im Adminbereich: ${link}`]),
  ];

  const rows = order.items.map((item) => `<tr>
      <td>${item.quantity} ×</td>
      <td>${escapeHtml(item.productNameSnapshot)}</td>
      <td>${escapeHtml(item.productUnitSnapshot)}</td>
    </tr>`).join('');

  return {
    to: normalizeEmailAddress(recipient),
    subject,
    text: textLines.join('\n'),
    html: documentHtml(`
      <h1>Neue Bestellung</h1>
      <dl>
        <dt>Kunde</dt><dd>${escapeHtml(order.customerNameSnapshot)}</dd>
        <dt>Bestellnummer</dt><dd>${escapeHtml(order.orderNumber.value)}</dd>
        <dt>Art</dt><dd>${escapeHtml(fulfillmentLabel(order.fulfillmentType))}</dd>
        <dt>Gewünschter Termin</dt><dd>${escapeHtml(formatGermanNumericDate(order.fulfillmentDate.value))}</dd>
      </dl>
      <h2>Bestellte Produkte</h2>
      <table><tbody>${rows}</tbody></table>
      <p><strong>Gesamt: ${escapeHtml(formatEuro(order.total().cents))}</strong></p>
      ${link === null ? '' : `<p><a href="${escapeHtml(link)}">Bestellung im Adminbereich ansehen</a></p>`}`),
  };
}

export function renderCustomerOrderConfirmationEmail(
  order: Order,
  recipient: string,
): EmailMessage {
  const textLines = [
    'Ihre Bestellung ist bei uns eingegangen.',
    '',
    `Bestellnummer: ${order.orderNumber.value}`,
    `${fulfillmentLabel(order.fulfillmentType)}: ${formatGermanNumericDate(order.fulfillmentDate.value)}`,
    ...(order.deliveryAddressSnapshot === null
      ? []
      : [`Lieferadresse: ${order.deliveryAddressSnapshot}`]),
    '',
    'Ihre Bestellung:',
    ...order.items.map((item) =>
      `${item.quantity} × ${item.productNameSnapshot} · ${formatEuro(item.unitPrice.cents)} · ${formatEuro(item.lineTotal.cents)}`),
    '',
    `Gesamt: ${formatEuro(order.total().cents)}`,
    ...(order.note === null ? [] : ['', `Ihr Hinweis: ${order.note}`]),
    '',
    'Vielen Dank für Ihre Bestellung bei Buschmann 1846.',
  ];

  const rows = order.items.map((item) => `<tr>
      <td>${item.quantity} ×</td>
      <td>${escapeHtml(item.productNameSnapshot)}</td>
      <td>${escapeHtml(formatEuro(item.unitPrice.cents))}</td>
      <td>${escapeHtml(formatEuro(item.lineTotal.cents))}</td>
    </tr>`).join('');

  return {
    to: normalizeEmailAddress(recipient),
    subject: 'Ihre Bestellung bei Buschmann ist eingegangen',
    text: textLines.join('\n'),
    html: documentHtml(`
      <h1>Ihre Bestellung ist eingegangen</h1>
      <p>Ihre Bestellung ist bei uns eingegangen.</p>
      <dl>
        <dt>Bestellnummer</dt><dd>${escapeHtml(order.orderNumber.value)}</dd>
        <dt>${escapeHtml(fulfillmentLabel(order.fulfillmentType))}</dt>
        <dd>${escapeHtml(formatGermanNumericDate(order.fulfillmentDate.value))}</dd>
        ${order.deliveryAddressSnapshot === null
          ? ''
          : `<dt>Lieferadresse</dt><dd>${escapeHtml(order.deliveryAddressSnapshot)}</dd>`}
      </dl>
      <h2>Ihre Bestellung</h2>
      <table><tbody>${rows}</tbody></table>
      <p><strong>Gesamt: ${escapeHtml(formatEuro(order.total().cents))}</strong></p>
      ${order.note === null ? '' : `<p><strong>Ihr Hinweis:</strong> ${escapeHtml(order.note)}</p>`}
      <p>Vielen Dank für Ihre Bestellung bei Buschmann 1846.</p>`),
  };
}

function documentHtml(content: string): string {
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body>${content}</body>
</html>`;
}

function safeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 190);
}

function adminLink(appOrigin: string | undefined, order: Order): string | null {
  if (appOrigin === undefined) return null;
  try {
    const url = new URL(appOrigin);
    if (
      url.origin !== appOrigin
      || (url.protocol !== 'https:' && url.protocol !== 'http:')
    ) return null;
    return `${url.origin}/admin/orders?date=${encodeURIComponent(order.fulfillmentDate.value)}#bestellungen`;
  } catch {
    return null;
  }
}
