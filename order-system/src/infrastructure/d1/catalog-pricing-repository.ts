import type { AdminCatalogProduct, CatalogPrice } from '../../domain/catalog-pricing';

interface CatalogPriceRow {
  product_id: number;
  name: string;
  unit_cost_cents: number | null;
  variant: string | null;
  unit: string | null;
  price_list_code: 'gastro' | 'private';
  price_type: CatalogPrice['type'] | null;
  price_cents: number | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
}

/**
 * Liest nur die Felder, die /admin/catalog tatsächlich anzeigt.
 *
 * SEIT PHASE 7A GEHÖRT unit_cost_cents DAZU — und ausschließlich hier. Es
 * gibt im gesamten System keine zweite Abfrage, die diese Spalte in eine
 * Ansicht lädt; der Bestellfluss liest sie in
 * customer-price-book-repository.ts, gibt sie aber nur an das Kostenbuch
 * weiter und niemals an eine Kundenansicht.
 */
export async function loadAdminCatalog(db: D1Database): Promise<AdminCatalogProduct[]> {
  const { results } = await db.prepare(
    `SELECT p.id AS product_id, p.name, p.variant, p.unit, p.unit_cost_cents,
            l.code AS price_list_code, pp.price_type, pp.price_cents,
            pp.min_price_cents, pp.max_price_cents
       FROM catalog_products p
       CROSS JOIN price_lists l
       LEFT JOIN catalog_product_prices pp
         ON pp.product_id = p.id AND pp.price_list_id = l.id
      WHERE p.is_active = 1 AND l.is_active = 1
        AND l.code IN ('gastro', 'private')
      ORDER BY p.sort_order, p.id, l.sort_order`,
  ).all<CatalogPriceRow>();

  const products = new Map<number, AdminCatalogProduct>();
  for (const row of results) {
    const current = products.get(row.product_id) ?? {
      id: row.product_id,
      name: row.name,
      variant: row.variant,
      unit: row.unit,
      gastroPrice: null,
      privatePrice: null,
      /**
       * Die Herstellkosten stehen an catalog_products und damit einmal je
       * Produkt — nicht je Preisliste. Sie werden deshalb beim ERSTEN
       * Auftreten einer Produktzeile übernommen; die zweite Zeile desselben
       * Produkts (die andere Preisliste) trägt denselben Wert und ändert
       * nichts.
       */
      unitCostCents: row.unit_cost_cents,
    };
    const value = toPrice(row);
    products.set(row.product_id, row.price_list_code === 'gastro'
      ? { ...current, gastroPrice: value }
      : { ...current, privatePrice: value });
  }
  return [...products.values()];
}

function toPrice(row: CatalogPriceRow): CatalogPrice | null {
  if (row.price_type === null) return null;
  if (row.price_type === 'fixed') return { type: 'fixed', priceCents: required(row.price_cents) };
  if (row.price_type === 'from') return { type: 'from', minPriceCents: required(row.min_price_cents) };
  if (row.price_type === 'range') return {
    type: 'range',
    minPriceCents: required(row.min_price_cents),
    maxPriceCents: required(row.max_price_cents),
  };
  return { type: 'on_request' };
}

function required(value: number | null): number {
  if (value === null) throw new Error('Ungültige Katalogpreiszeile.');
  return value;
}
