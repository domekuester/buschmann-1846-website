import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalogImportStatements, validateCatalogPricing } from '../../scripts/catalog-pricing.mjs';

const NOW = '2026-08-25T12:00:00.000Z';
const FIXTURE = {
  schema_version: 1,
  price_lists: [
    { code: 'gastro', label: 'Gastronomie' },
    { code: 'private', label: 'Privatkunden' },
  ],
  products: [
    {
      source_key: 'fixture:kuchen:ring',
      name: 'Fiktiver Ringkuchen',
      variant: 'Ring',
      unit: '26 cm Ring',
      category: 'Kuchen',
      sort_order: 10,
      prices: {
        gastro: { type: 'fixed', price_cents: 2100 },
        private: { type: 'range', min_price_cents: 3900, max_price_cents: 4500 },
      },
    },
    {
      source_key: 'fixture:kuchen:kasten',
      name: 'Fiktiver Kastenkuchen',
      variant: 'Kasten',
      unit: '30 cm Kasten',
      category: 'Kuchen',
      sort_order: 20,
      prices: { private: { type: 'on_request' } },
    },
  ],
};

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM catalog_product_prices').run();
  await env.DB.prepare('DELETE FROM catalog_products').run();
});

async function importFixture(): Promise<void> {
  const statements = buildCatalogImportStatements(validateCatalogPricing(FIXTURE), NOW);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
}

describe('lokaler Katalogimport', () => {
  it('schreibt alle validierten Produkte und Preise', async () => {
    await importFixture();
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM catalog_products) AS products,
              (SELECT COUNT(*) FROM catalog_product_prices) AS prices`,
    ).first();
    expect(counts).toEqual({ products: 2, prices: 3 });
  });

  it('erzeugt beim zweiten Lauf weder Produkt- noch Preisduplikate', async () => {
    await importFixture();
    await importFixture();
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM catalog_products) AS products,
              (SELECT COUNT(*) FROM catalog_product_prices) AS prices`,
    ).first();
    expect(counts).toEqual({ products: 2, prices: 3 });
  });

  it('speichert fehlende Preise nicht als Null- oder Null-Euro-Zeile', async () => {
    await importFixture();
    const { results } = await env.DB.prepare(
      `SELECT p.source_key, l.code
         FROM catalog_product_prices pp
         JOIN catalog_products p ON p.id = pp.product_id
         JOIN price_lists l ON l.id = pp.price_list_id
        ORDER BY p.source_key, l.code`,
    ).all();
    expect(results).toEqual([
      { source_key: 'fixture:kuchen:kasten', code: 'private' },
      { source_key: 'fixture:kuchen:ring', code: 'gastro' },
      { source_key: 'fixture:kuchen:ring', code: 'private' },
    ]);
  });

  it('lässt bei einem SQL-Fehler keinen halben Import zurück', async () => {
    const statements = buildCatalogImportStatements(validateCatalogPricing(FIXTURE), NOW)
      .map((sql) => sql.replace("'Fiktiver Kastenkuchen'", 'NULL'));
    await expect(env.DB.batch(statements.map((sql) => env.DB.prepare(sql)))).rejects.toThrow();
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_products').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
