import {
  ADMIN_PRICE_TYPES,
  ADMIN_PRICE_TYPE_LABELS,
  type AdminPriceType,
  type AdminProductView,
} from '../domain/admin-product';
import type { CatalogPrice } from '../domain/catalog-pricing';
import { renderAdminShell } from './admin-page-html';
import { escapeHtml, formatAmountInput, formatEuro } from './format';

export interface AdminCatalogPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly products: readonly AdminProductView[];
  readonly noticeCode: string | null;
}

const NOTICES: Readonly<Record<string, { text: string; success: boolean }>> = {
  product_created: { text: 'Das Produkt wurde angelegt und intern vollständig verknüpft.', success: true },
  product_saved: { text: 'Das Produkt wurde gespeichert.', success: true },
  product_invalid: {
    text: 'Das Produkt wurde nicht gespeichert. Bitte prüfe Name, Einheit, Preisform und Beträge.',
    success: false,
  },
  product_unknown: { text: 'Dieses Produkt gibt es nicht mehr. Es wurde nichts gespeichert.', success: false },
  product_conflict: {
    text: 'Das Produkt wurde inzwischen von jemand anderem geändert. Bitte lade die Seite neu und prüfe den aktuellen Stand.',
    success: false,
  },
  product_internal: {
    text: 'Das Produkt konnte gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.',
    success: false,
  },
};

export function renderAdminCatalogPage(view: AdminCatalogPageView): string {
  return renderAdminShell(
    'Angebot — Buschmann 1846',
    view,
    'catalog',
    `<header class="bereichskopf">
      <p class="bereichskopf__kicker">Angebot</p>
      <h1>Produkte und Preise</h1>
      <p class="bereichskopf__vorspann">Das aktuelle Angebot für Gastronomie- und Privatkunden.</p>
    </header>
    ${notice(view.noticeCode)}
    ${createSection(view)}
    <section id="angebot" class="katalogbereich" aria-labelledby="angebot-titel">
      <div class="katalogbereich__kopf">
        <h2 id="angebot-titel" class="katalogbereich__titel">Bestehende Produkte</h2>
        <p>${view.products.length} ${view.products.length === 1 ? 'Produkt' : 'Produkte'}</p>
      </div>
      <p id="herstellkosten" class="katalogbereich__intern"><strong>Herstellkosten bleiben intern.</strong> Kundinnen und Kunden sehen sie nirgends.</p>
      ${view.products.length === 0 ? emptyState() : productList(view)}
    </section>`,
  );
}

function createSection(view: AdminCatalogPageView): string {
  return `<details class="operator-neu" open>
    <summary>Neues Produkt</summary>
    <p>Alle internen Datensätze und die Produktverknüpfung entstehen automatisch.</p>
    ${productForm(view, null)}
  </details>`;
}

function productList(view: AdminCatalogPageView): string {
  return `<div class="operator-liste">${view.products.map((product) => `
    <details class="operator-eintrag">
      <summary>
        <span><strong>${escapeHtml(product.name)}</strong><small>${product.unit === '' ? 'Einheit nicht gepflegt' : escapeHtml(product.unit)}</small></span>
        <span class="${product.isActive ? 'operator-status operator-status--aktiv' : 'operator-status'}">${product.isActive ? 'Aktiv' : 'Inaktiv'}</span>
      </summary>
      <dl class="operator-kurzwerte">
        <div><dt>Gastronomie</dt><dd>${formatPrice(product.gastroPrice)}</dd></div>
        <div><dt>Privatkunden</dt><dd>${formatPrice(product.privatePrice)}</dd></div>
        <div><dt>Herstellkosten</dt><dd>${product.unitCostCents === null ? 'Nicht gepflegt' : formatEuro(product.unitCostCents)}</dd></div>
      </dl>
      ${productForm(view, product)}
    </details>`).join('')}</div>`;
}

function productForm(view: AdminCatalogPageView, product: AdminProductView | null): string {
  const prefix = product === null ? 'neu' : `produkt-${product.id}`;
  const action = product === null ? '/api/admin/products' : `/api/admin/products/${product.id}`;

  return `<form method="post" action="${action}" class="operator-formular">
    <input type="hidden" name="csrf_token" value="${escapeHtml(view.csrfToken)}">
    ${product === null ? '' : `<input type="hidden" name="expected_updated_at" value="${escapeHtml(product.updatedAt)}">`}
    <div class="operator-felder">
      ${textField(`${prefix}-name`, 'Produktname', 'name', product?.name ?? '', 120, true)}
      ${textField(`${prefix}-unit`, 'Einheit / Format', 'unit', product?.unit ?? '', 120, true)}
    </div>
    <div class="operator-preise">
      ${priceFields(prefix, 'Gastronomiepreis', 'gastro', product?.gastroPrice ?? null)}
      ${priceFields(prefix, 'Privatkundenpreis', 'private', product?.privatePrice ?? null)}
    </div>
    <div class="operator-felder operator-felder--abschluss">
      ${textField(
        `${prefix}-cost`,
        'Herstellkosten',
        'unit_cost',
        product?.unitCostCents === null || product?.unitCostCents === undefined
          ? ''
          : formatAmountInput(product.unitCostCents),
        10,
        false,
        'decimal',
        'Leer bedeutet: nicht gepflegt.',
      )}
      <label class="operator-schalter" for="${prefix}-active">
        <input type="checkbox" id="${prefix}-active" name="is_active" value="1"${product === null || product.isActive ? ' checked' : ''}>
        <span>Produkt ist aktiv</span>
      </label>
    </div>
    <p class="operator-hinweis">Ohne mindestens einen Festpreis bleibt das Produkt sicherheitshalber inaktiv.</p>
    <button type="submit" class="senden">Speichern</button>
  </form>`;
}

function priceFields(
  prefix: string,
  legend: string,
  namePrefix: 'gastro' | 'private',
  price: CatalogPrice | null,
): string {
  const type = price?.type ?? 'none';
  const values = priceValues(price);
  return `<fieldset class="operator-preisgruppe">
    <legend>${legend}</legend>
    <label for="${prefix}-${namePrefix}-type">Preisform</label>
    <select id="${prefix}-${namePrefix}-type" name="${namePrefix}_price_type">
      ${ADMIN_PRICE_TYPES.map((option) => priceOption(option, type)).join('')}
    </select>
    <label for="${prefix}-${namePrefix}-price">Preis / Untergrenze in Euro</label>
    <input type="text" inputmode="decimal" id="${prefix}-${namePrefix}-price" name="${namePrefix}_price" value="${escapeHtml(values.lower)}" maxlength="10" autocomplete="off">
    <label for="${prefix}-${namePrefix}-max">Obergrenze bei Preisspanne</label>
    <input type="text" inputmode="decimal" id="${prefix}-${namePrefix}-max" name="${namePrefix}_max_price" value="${escapeHtml(values.upper)}" maxlength="10" autocomplete="off">
  </fieldset>`;
}

function priceOption(option: AdminPriceType, selected: AdminPriceType): string {
  return `<option value="${option}"${option === selected ? ' selected' : ''}>${escapeHtml(ADMIN_PRICE_TYPE_LABELS[option])}</option>`;
}

function priceValues(price: CatalogPrice | null): { lower: string; upper: string } {
  if (price === null || price.type === 'on_request') return { lower: '', upper: '' };
  if (price.type === 'fixed') return { lower: formatAmountInput(price.priceCents), upper: '' };
  if (price.type === 'from') return { lower: formatAmountInput(price.minPriceCents), upper: '' };
  return { lower: formatAmountInput(price.minPriceCents), upper: formatAmountInput(price.maxPriceCents) };
}

function textField(
  id: string,
  label: string,
  name: string,
  value: string,
  maxlength: number,
  required: boolean,
  inputmode: 'text' | 'decimal' = 'text',
  hint: string | null = null,
): string {
  return `<div class="feld">
    <label for="${id}">${label}</label>
    <input type="text" inputmode="${inputmode}" id="${id}" name="${name}" value="${escapeHtml(value)}" maxlength="${maxlength}" autocomplete="off"${required ? ' required' : ''}>
    ${hint === null ? '' : `<small>${escapeHtml(hint)}</small>`}
  </div>`;
}

function formatPrice(price: CatalogPrice | null): string {
  if (price === null) return 'Nicht hinterlegt';
  if (price.type === 'fixed') return formatEuro(price.priceCents);
  if (price.type === 'from') return `ab ${formatEuro(price.minPriceCents)}`;
  if (price.type === 'range') return `${formatEuro(price.minPriceCents)}–${formatEuro(price.maxPriceCents)}`;
  return 'Preis auf Anfrage';
}

function notice(code: string | null): string {
  if (code === null || !Object.prototype.hasOwnProperty.call(NOTICES, code)) return '';
  const value = NOTICES[code];
  if (value === undefined) return '';
  return `<p class="${value.success ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung'}" role="status">${escapeHtml(value.text)}</p>`;
}

function emptyState(): string {
  return `<section class="leerzustand"><h3>Noch keine Produkte</h3><p>Lege das erste Produkt oben an.</p></section>`;
}
