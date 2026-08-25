import type { AdminCatalogProduct, CatalogPrice } from '../domain/catalog-pricing';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatEuro } from './format';

export interface AdminCatalogPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly products: readonly AdminCatalogProduct[];
}

export function renderAdminCatalogPage(view: AdminCatalogPageView): string {
  return renderAdminShell(
    'Sortiment & Preise — Buschmann 1846',
    view,
    'catalog',
    `<header class="katalogkopf">
      <p class="katalogkopf__kicker">Katalog</p>
      <h1>Sortiment &amp; Preise</h1>
      <p class="katalogkopf__vorspann">Gastronomie- und Privatpreise im direkten Vergleich.</p>
    </header>
    ${view.products.length === 0 ? emptyState() : catalogTable(view.products)}`,
  );
}

function catalogTable(products: readonly AdminCatalogProduct[]): string {
  return `<div class="katalogtabelle-wrap">
    <table class="katalogtabelle">
      <thead><tr>
        <th scope="col">Produkt</th>
        <th scope="col">Variante</th>
        <th scope="col">Einheit</th>
        <th scope="col">Gastronomie</th>
        <th scope="col">Privatkunden</th>
      </tr></thead>
      <tbody>${products.map(productRow).join('')}</tbody>
    </table>
  </div>`;
}

function productRow(product: AdminCatalogProduct): string {
  return `<tr>
    <th scope="row" data-label="Produkt">${escapeHtml(product.name)}</th>
    <td data-label="Variante">${product.variant === null ? missing('Keine Variante') : escapeHtml(product.variant)}</td>
    <td data-label="Einheit">${escapeHtml(product.unit)}</td>
    <td data-label="Gastronomie" class="katalogpreis">${formatCatalogPrice(product.gastroPrice)}</td>
    <td data-label="Privatkunden" class="katalogpreis">${formatCatalogPrice(product.privatePrice)}</td>
  </tr>`;
}

function formatCatalogPrice(price: CatalogPrice | null): string {
  if (price === null) return missing('Kein Preis hinterlegt');
  if (price.type === 'fixed') return formatEuro(price.priceCents);
  if (price.type === 'from') return `ab ${formatEuro(price.minPriceCents)}`;
  if (price.type === 'range') {
    return `${formatEuro(price.minPriceCents).slice(0, -2)}–${formatEuro(price.maxPriceCents)}`;
  }
  return 'Auf Anfrage';
}

function missing(label: string): string {
  return `<span aria-label="${label}">—</span>`;
}

function emptyState(): string {
  return `<section class="katalogleer" aria-labelledby="katalogleer-titel">
    <h2 id="katalogleer-titel">Noch kein Sortiment importiert</h2>
    <p>Nach dem lokalen Import erscheinen Produkte und Preise hier automatisch.</p>
  </section>`;
}
