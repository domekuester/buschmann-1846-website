import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminProductInput } from '../../src/domain/admin-product';
import {
  createAdminProduct,
  loadAdminProducts,
  updateAdminProduct,
} from '../../src/infrastructure/d1/admin-product-repository';

const NOW = '2026-08-28T10:00:00.000Z';
const LATER = '2026-08-28T11:00:00.000Z';

const input = (overrides: Partial<AdminProductInput> = {}): AdminProductInput => ({
  name: 'Fiktiver Käsekuchen',
  unit: '26 cm Ring',
  isActive: true,
  gastroPrice: { type: 'fixed', priceCents: 2400 },
  privatePrice: { type: 'fixed', priceCents: 4200 },
  unitCostCents: 850,
  ...overrides,
});

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('Admin-Produktaggregat in D1', () => {
  it('legt Katalogprodukt, beide Preise, Bestellprodukt und eindeutige Relation atomar an', async () => {
    await createAdminProduct(env.DB, input(), NOW);

    const catalog = await env.DB.prepare(
      'SELECT id, name, unit, unit_cost_cents, is_active FROM catalog_products',
    ).first<{ id: number; name: string; unit: string; unit_cost_cents: number; is_active: number }>();
    const orderable = await env.DB.prepare(
      'SELECT name, unit, is_active, catalog_product_id FROM products',
    ).first<{ name: string; unit: string; is_active: number; catalog_product_id: number }>();
    const prices = await env.DB.prepare(
      `SELECT l.code, p.price_type, p.price_cents
         FROM catalog_product_prices p JOIN price_lists l ON l.id = p.price_list_id
        ORDER BY l.code`,
    ).all<{ code: string; price_type: string; price_cents: number }>();

    expect(catalog).toMatchObject({ name: 'Fiktiver Käsekuchen', unit: '26 cm Ring', unit_cost_cents: 850, is_active: 1 });
    expect(orderable).toMatchObject({ name: 'Fiktiver Käsekuchen', unit: '26 cm Ring', is_active: 1, catalog_product_id: catalog?.id });
    expect(prices.results).toEqual([
      { code: 'gastro', price_type: 'fixed', price_cents: 2400 },
      { code: 'private', price_type: 'fixed', price_cents: 4200 },
    ]);
  });

  it('lädt die vollständige Arbeitsansicht einschließlich inaktiver und nicht verknüpfter Produkte', async () => {
    await createAdminProduct(env.DB, input(), NOW);
    await env.DB.prepare(
      `INSERT INTO catalog_products
         (source_key, name, unit, is_active, sort_order, created_at, updated_at)
       VALUES ('fixture:solo', 'Fiktives Saisonprodukt', 'Stück', 0, 20, ?1, ?1)`,
    ).bind(NOW).run();

    const products = await loadAdminProducts(env.DB);
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ name: 'Fiktiver Käsekuchen', isActive: true, orderableProductId: expect.any(Number) });
    expect(products[1]).toMatchObject({ name: 'Fiktives Saisonprodukt', isActive: false, orderableProductId: null });
  });

  it('lädt einen alten Katalogeintrag ohne Einheit sicher zur Nachpflege', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products
         (source_key, name, unit, is_active, sort_order, created_at, updated_at)
       VALUES ('fixture:legacy', 'Fiktives Altprodukt', NULL, 0, 20, ?1, ?1)`,
    ).bind(NOW).run();

    expect((await loadAdminProducts(env.DB))[0]).toMatchObject({
      name: 'Fiktives Altprodukt', unit: '', isActive: false,
    });
  });

  it('ändert Name, Einheit, Preisformen, Kosten und Status in einem Save', async () => {
    await createAdminProduct(env.DB, input(), NOW);
    const [created] = await loadAdminProducts(env.DB);
    if (!created) throw new Error('Testprodukt fehlt');

    const result = await updateAdminProduct(env.DB, created.id, created.updatedAt, input({
      name: 'Fiktive Zitronentorte',
      unit: 'Torte',
      isActive: false,
      gastroPrice: { type: 'from', minPriceCents: 2600 },
      privatePrice: { type: 'range', minPriceCents: 4400, maxPriceCents: 5200 },
      unitCostCents: null,
    }), LATER);

    expect(result).toBe('updated');
    expect((await loadAdminProducts(env.DB))[0]).toMatchObject({
      name: 'Fiktive Zitronentorte', unit: 'Torte', isActive: false,
      gastroPrice: { type: 'from', minPriceCents: 2600 },
      privatePrice: { type: 'range', minPriceCents: 4400, maxPriceCents: 5200 },
      unitCostCents: null,
    });
  });

  it('reaktiviert ein Produkt und erzeugt eine fehlende interne Relation automatisch', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products
         (id, source_key, name, unit, is_active, sort_order, created_at, updated_at)
       VALUES (9, 'fixture:solo', 'Fiktives Saisonprodukt', 'Stück', 0, 20, ?1, ?1)`,
    ).bind(NOW).run();

    expect(await updateAdminProduct(env.DB, 9, NOW, input({ name: 'Fiktives Saisonprodukt', unit: 'Stück' }), LATER)).toBe('updated');
    const row = await env.DB.prepare('SELECT catalog_product_id, is_active FROM products').first<{ catalog_product_id: number; is_active: number }>();
    expect(row).toEqual({ catalog_product_id: 9, is_active: 1 });
  });

  it('weist einen veralteten Save ohne Teiländerung zurück', async () => {
    await createAdminProduct(env.DB, input(), NOW);
    const [created] = await loadAdminProducts(env.DB);
    if (!created) throw new Error('Testprodukt fehlt');
    await env.DB.prepare('UPDATE catalog_products SET name = ?, updated_at = ? WHERE id = ?')
      .bind('Jüngerer Name', LATER, created.id).run();

    expect(await updateAdminProduct(env.DB, created.id, created.updatedAt, input({ name: 'Alter Name' }), '2026-08-28T12:00:00.000Z')).toBe('conflict');
    const after = await env.DB.prepare(
      `SELECT cp.name, cp.unit_cost_cents, p.name AS orderable_name
         FROM catalog_products cp JOIN products p ON p.catalog_product_id = cp.id
        WHERE cp.id = ?`,
    ).bind(created.id).first<{ name: string; unit_cost_cents: number; orderable_name: string }>();
    expect(after).toEqual({ name: 'Jüngerer Name', unit_cost_cents: 850, orderable_name: 'Fiktiver Käsekuchen' });
  });

  it('verändert beim Stammdaten-Save keine historischen Bestell-Snapshots', async () => {
    await env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Fiktives Café', 1, 'pickup', ?1, ?1)`,
    ).bind(NOW).run();
    await createAdminProduct(env.DB, input(), NOW);
    const [created] = await loadAdminProducts(env.DB);
    if (!created?.orderableProductId) throw new Error('Testprodukt fehlt');
    await env.DB.prepare(
      `INSERT INTO orders
         (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
          fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café alt', 'pickup', '2026-08-29', 'new', 2400, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items
         (order_id, product_id, product_name_snapshot, product_unit_snapshot,
          unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
       VALUES (1, ?, 'Käsekuchen alt', 'Ring alt', 2200, 1, 2200, 700)`,
    ).bind(created.orderableProductId).run();

    await updateAdminProduct(env.DB, created.id, created.updatedAt, input({
      name: 'Neuer Name', unit: 'Neue Einheit', gastroPrice: { type: 'fixed', priceCents: 2600 }, unitCostCents: 900,
    }), LATER);

    const snapshot = await env.DB.prepare(
      'SELECT product_name_snapshot, product_unit_snapshot, unit_price_cents, unit_cost_cents_snapshot FROM order_items',
    ).first();
    expect(snapshot).toEqual({
      product_name_snapshot: 'Käsekuchen alt', product_unit_snapshot: 'Ring alt',
      unit_price_cents: 2200, unit_cost_cents_snapshot: 700,
    });
  });
});
