import { escapeHtml } from './format';

export interface CancelOrderPageView {
  readonly csrfToken: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly fulfillmentDate: string;
  readonly workspace: 'production' | 'orders';
}

export function renderCancelOrderPage(view: CancelOrderPageView): string {
  const orderNumber = escapeHtml(view.orderNumber);
  const encodedOrderNumber = escapeHtml(encodeURIComponent(view.orderNumber));
  const day = escapeHtml(view.fulfillmentDate);
  const back = view.workspace === 'orders' ? '/admin/orders' : '/admin/production';
  const backLabel = view.workspace === 'orders' ? 'Zurück zu Bestellungen' : 'Zurück zum Produktionstag';
  const workspace = view.workspace === 'orders' ? '?workspace=orders' : '';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Bestellung stornieren — Buschmann 1846</title>
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

<main id="inhalt" class="stornobestaetigung">
  <p class="stornobestaetigung__kicker">Stornierung bestätigen</p>
  <h1>Bestellung wirklich stornieren?</h1>
  <dl class="stornobestaetigung__daten">
    <div><dt>Bestellnummer</dt><dd>${orderNumber}</dd></div>
    <div><dt>Kunde</dt><dd>${escapeHtml(view.customerName)}</dd></div>
  </dl>
  <p class="stornobestaetigung__warnung" role="alert"><strong>Achtung:</strong> Diese Aktion kann nicht rückgängig gemacht werden.</p>
  <div class="stornobestaetigung__aktionen">
    <a class="stornobestaetigung__zurueck" href="${back}?date=${day}">${backLabel}</a>
    <form method="post" action="/api/admin/orders/${encodedOrderNumber}/status${workspace}">
      <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
      <input type="hidden" name="status" value="cancelled">
      <button type="submit" class="statustaste statustaste--final">Bestellung stornieren<span class="hinweis"> — ${orderNumber}</span></button>
    </form>
  </div>
</main>
</body>
</html>
`;
}
