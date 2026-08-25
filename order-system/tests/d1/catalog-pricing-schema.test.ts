import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-25T12:00:00.000Z';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM catalog_product_prices').run();
  await env.DB.prepare('DELETE FROM catalog_products').run();
});

async function seedProduct(sourceKey = 'fixture:kuchen', variant: string | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products
       (source_key, name, variant, unit, sort_order, created_at, updated_at)
     VALUES (?, 'Fiktiver Kuchen', ?, '26 cm Ring', 10, ?, ?)`,
  ).bind(sourceKey, variant, NOW, NOW).run();
}

async function productId(): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM catalog_products').first<{ id: number }>();
  if (!row) throw new Error('Testprodukt fehlt');
  return row.id;
}

describe('Migration 0012 — Katalog und Preislisten', () => {
  it('legt die beiden bestätigten Preislisten ohne echte Preise an', async () => {
    const { results } = await env.DB.prepare(
      'SELECT code, label FROM price_lists ORDER BY sort_order',
    ).all<{ code: string; label: string }>();

    expect(results).toEqual([
      { code: 'gastro', label: 'Gastronomie' },
      { code: 'private', label: 'Privatkunden' },
    ]);
  });

  it('hält ein Produkt mit Gastro- und Privatpreis als eine Produktidentität', async () => {
    await seedProduct();
    const id = await productId();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO catalog_product_prices
           (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at)
         SELECT ?, id, 'fixed', 2100, NULL, NULL, ?, ? FROM price_lists WHERE code = 'gastro'`,
      ).bind(id, NOW, NOW),
      env.DB.prepare(
        `INSERT INTO catalog_product_prices
           (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at)
         SELECT ?, id, 'fixed', 3900, NULL, NULL, ?, ? FROM price_lists WHERE code = 'private'`,
      ).bind(id, NOW, NOW),
    ]);

    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM catalog_products) AS products,
              (SELECT COUNT(*) FROM catalog_product_prices) AS prices`,
    ).first<{ products: number; prices: number }>();
    expect(counts).toEqual({ products: 1, prices: 2 });
  });

  it('erhält Einheit und fachlich getrennte Variante', async () => {
    await seedProduct('fixture:kuchen:ring', 'Ring');
    await seedProduct('fixture:kuchen:kasten', 'Kasten');
    const { results } = await env.DB.prepare(
      'SELECT source_key, variant, unit FROM catalog_products ORDER BY source_key',
    ).all<{ source_key: string; variant: string | null; unit: string }>();

    expect(results).toEqual([
      { source_key: 'fixture:kuchen:kasten', variant: 'Kasten', unit: '26 cm Ring' },
      { source_key: 'fixture:kuchen:ring', variant: 'Ring', unit: '26 cm Ring' },
    ]);
  });

  it('erzwingt stabile eindeutige source_keys', async () => {
    await seedProduct();
    await expect(seedProduct()).rejects.toThrow(/UNIQUE constraint/i);
    await expect(seedProduct('   ')).rejects.toThrow(/CHECK constraint/i);
  });

  it.each([
    ['fixed', 2100, null, null],
    ['from', null, 5500, null],
    ['range', null, 300, 450],
    ['on_request', null, null, null],
  ] as const)('akzeptiert %s ausschließlich in seiner quelltreuen Form', async (type, fixed, min, max) => {
    await seedProduct();
    await env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ? FROM price_lists WHERE code = 'private'`,
    ).bind(await productId(), type, fixed, min, max, NOW, NOW).run();

    const row = await env.DB.prepare(
      'SELECT price_type, price_cents, min_price_cents, max_price_cents FROM catalog_product_prices',
    ).first();
    expect(row).toEqual({
      price_type: type,
      price_cents: fixed,
      min_price_cents: min,
      max_price_cents: max,
    });
  });

  it.each([
    ['fixed', null, 2100, null],
    ['from', 5500, null, null],
    ['range', null, 450, 300],
    ['on_request', 0, null, null],
  ] as const)('lehnt eine verfälschte %s-Preisform ab', async (type, fixed, min, max) => {
    await seedProduct();
    await expect(env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ? FROM price_lists WHERE code = 'private'`,
    ).bind(await productId(), type, fixed, min, max, NOW, NOW).run()).rejects.toThrow(/CHECK constraint/i);
  });

  it.each([-1, 4.35])('lehnt ungültige Centwerte %s ab', async (cents) => {
    await seedProduct();
    await expect(env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       SELECT ?, id, 'fixed', ?, ?, ? FROM price_lists WHERE code = 'private'`,
    ).bind(await productId(), cents, NOW, NOW).run()).rejects.toThrow(/CHECK constraint/i);
  });

  it('verhindert doppelte Preise je Produkt und Preisliste', async () => {
    await seedProduct();
    const id = await productId();
    const statement = () => env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       SELECT ?, id, 'fixed', 2100, ?, ? FROM price_lists WHERE code = 'gastro'`,
    ).bind(id, NOW, NOW).run();
    await statement();
    await expect(statement()).rejects.toThrow(/UNIQUE constraint/i);
  });
});
