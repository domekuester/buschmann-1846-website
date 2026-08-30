import type { ProductionDay, ProductionOrder } from '../domain/production-day';
import { escapeHtml, formatGermanDate } from './format';

export interface PickupListPageView {
  readonly day: ProductionDay;
}

export function renderPickupListPage(view: PickupListPageView): string {
  const dayLabel = formatGermanDate(view.day.date);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Abholliste ${escapeHtml(view.day.date)} — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="druckseite">
<main id="inhalt" class="druckseite__inhalt">
  <article class="produktionsliste abholliste">
    <header class="produktionsliste__kopf">
      <p class="produktionsliste__marke">Buschmann 1846</p>
      <h1>Abholliste</h1>
      <p class="produktionsliste__datum">${escapeHtml(dayLabel)}</p>
      <div class="druckkopf screen-only">
        <a href="/admin/production?date=${escapeHtml(view.day.date)}">&larr; Zurück zur Produktion</a>
        <button type="button" class="drucktaste" data-print-trigger>Drucken</button>
      </div>
    </header>
    ${orders(view.day)}
  </article>
</main>
<script type="module" src="/assets/print.js"></script>
</body>
</html>
`;
}

function orders(day: ProductionDay): string {
  if (day.orders.length === 0) {
    return '<p class="produktionsliste__leer">Für diesen Produktionstag gibt es aktuell keine bestätigten Abholbestellungen.</p>';
  }

  const blocks = day.orders.map(orderBlock).join('');
  return `<div class="abholliste__bestellungen">${blocks}</div>
    <p class="abholliste__summe">${day.orderCount} ${plural(day.orderCount, 'Bestellung', 'Bestellungen')} <span aria-hidden="true">·</span> ${day.totalUnits} ${plural(day.totalUnits, 'Einheit', 'Einheiten')}</p>`;
}

function orderBlock(order: ProductionOrder): string {
  const items = order.items.map((item) => `<li>${item.quantity} <span aria-hidden="true">×</span> ${escapeHtml(item.productName)} <span aria-hidden="true">·</span> ${escapeHtml(item.productUnit)}</li>`).join('');
  const note = order.note?.trim();
  return `<section class="abholliste__bestellung">
      <header class="abholliste__bestellkopf">
        <h2>${escapeHtml(order.customerName)}</h2>
        <p>${escapeHtml(order.orderNumber)}</p>
      </header>
      <ul class="abholliste__artikel">${items}</ul>
      ${note ? `<p class="abholliste__hinweis"><strong>Hinweis:</strong> ${escapeHtml(note)}</p>` : ''}
    </section>`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
