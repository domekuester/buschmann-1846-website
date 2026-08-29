import type { ProductionDay, ProductionOrder } from '../domain/production-day';
import { escapeHtml, formatGermanDate } from './format';

export interface ProductionListPageView {
  readonly day: ProductionDay;
}

export function renderProductionListPage(view: ProductionListPageView): string {
  const dayLabel = formatGermanDate(view.day.date);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>Produktionsliste ${escapeHtml(view.day.date)} — Buschmann 1846</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="druckseite">
<main id="inhalt" class="druckseite__inhalt">
    <article class="produktionsliste">
      <header class="produktionsliste__kopf">
        <p class="produktionsliste__marke">Buschmann 1846</p>
        <h1>Produktionsliste</h1>
        <p class="produktionsliste__datum">${escapeHtml(dayLabel)}</p>
        <div class="druckkopf screen-only">
          <a href="/admin/production?date=${escapeHtml(view.day.date)}">&larr; Zurück zur Produktion</a>
          <button type="button" class="drucktaste" data-print-trigger>Drucken</button>
        </div>
      </header>
      ${production(view.day)}
      ${notes(view.day.orders)}
    </article>
</main>
<script type="module" src="/assets/print.js"></script>
</body>
</html>
`;
}

function production(day: ProductionDay): string {
  if (day.products.length === 0) return '<p class="produktionsliste__leer">Für diesen Produktionstag ist aktuell nichts mehr zu produzieren.</p>';
  const rows = day.products.map((product) => `<tr>
          <td class="produktionsliste__produkt">${escapeHtml(product.productName)}</td>
          <td class="produktionsliste__einheit">${escapeHtml(product.productUnit)}</td>
          <td class="produktionsliste__menge">${product.quantity}</td>
        </tr>`).join('');
  return `<table class="produktionsliste__tabelle">
      <caption class="visually-hidden">Zu produzierende Produkte für ${escapeHtml(formatGermanDate(day.date))}</caption>
      <thead><tr><th scope="col">Produkt</th><th scope="col">Variante / Einheit</th><th scope="col">Menge</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">${day.products.length} ${plural(day.products.length, 'Produktart', 'Produktarten')} <span aria-hidden="true">·</span> ${day.totalUnits} ${plural(day.totalUnits, 'Einheit', 'Einheiten')}</td></tr></tfoot>
    </table>`;
}

function notes(orders: readonly ProductionOrder[]): string {
  const withNotes = orders.filter((order) => order.note?.trim());
  if (withNotes.length === 0) return '';
  return `<section class="produktionsliste__hinweise" aria-labelledby="besondere-hinweise">
      <h2 id="besondere-hinweise">Besondere Hinweise</h2>
      <ul>${withNotes.map((order) => `<li>
        <p class="produktionsliste__hinweis-kopf"><strong>${escapeHtml(order.orderNumber)}</strong> <span aria-hidden="true">·</span> ${escapeHtml(order.customerName)}</p>
        <p class="produktionsliste__hinweis-text">${escapeHtml(order.note!.trim())}</p>
      </li>`).join('')}</ul>
    </section>`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
