import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Die EINE Relation, die Phase 5C hinzufügt: products.catalog_product_id.
 *
 * Sie ist die Preisidentität des Bestellsystems. Ohne sie gäbe es keinen
 * belastbaren Weg von einem bestellbaren Produkt zu einem Katalogpreis —
 * und die Alternative wäre ein Namensabgleich, also ein Preis, der sich beim
 * nächsten Tippfehler ändert.
 */

const NOW = '2026-08-25T07:00:00.000Z';

async function seedCatalogProduct(id: number, sourceKey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 1, 10, ?, ?)`,
  )
    .bind(id, sourceKey, `Katalogprodukt ${id}`, NOW, NOW)
    .run();
}

async function seedProduct(id: number, catalogProductId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order,
                           catalog_product_id, created_at, updated_at)
     VALUES (?, ?, 0, 'Stück', 1, 10, ?, ?, ?)`,
  )
    .bind(id, `Beispielprodukt ${id}`, catalogProductId, NOW, NOW)
    .run();
}

beforeEach(async () => {
  // Reihenfolge wegen der Fremdschlüssel: products hängt seit 0014 an
  // catalog_products und muss deshalb VOR ihm geleert werden.
  for (const table of ['order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('products.catalog_product_id', () => {
  it('ist nullable — ein unverknüpftes Produkt bleibt eintragbar', async () => {
    await seedProduct(1, null);

    const row = await env.DB.prepare(
      'SELECT catalog_product_id FROM products WHERE id = 1',
    ).first<{ catalog_product_id: number | null }>();

    expect(row?.catalog_product_id).toBeNull();
  });

  it('hat KEINEN Default und KEINEN Backfill — bestehende Produkte bleiben unverknüpft', async () => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(products)`).all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>();

    expect(results).toContainEqual(
      expect.objectContaining({ name: 'catalog_product_id', notnull: 0, dflt_value: null }),
    );
  });

  it('verweist auf ein existierendes Katalogprodukt', async () => {
    await seedCatalogProduct(7, 'kuchen-a');
    await seedProduct(1, 7);

    const row = await env.DB.prepare(
      `SELECT p.id, cp.source_key
         FROM products p JOIN catalog_products cp ON cp.id = p.catalog_product_id
        WHERE p.id = 1`,
    ).first<{ id: number; source_key: string }>();

    expect(row).toEqual({ id: 1, source_key: 'kuchen-a' });
  });

  it('lehnt eine erfundene Katalog-ID ab', async () => {
    await expect(seedProduct(1, 999)).rejects.toThrow();
  });

  it('lässt dasselbe Katalogprodukt kein zweites Mal zu', async () => {
    await seedCatalogProduct(7, 'kuchen-a');
    await seedProduct(1, 7);

    await expect(seedProduct(2, 7)).rejects.toThrow();
  });

  it('lässt beliebig viele unverknüpfte Produkte zu — NULL ist kein Wert', async () => {
    await seedProduct(1, null);
    await seedProduct(2, null);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  it('schützt ein verknüpftes Katalogprodukt vor dem Löschen', async () => {
    await seedCatalogProduct(7, 'kuchen-a');
    await seedProduct(1, 7);

    await expect(
      env.DB.prepare('DELETE FROM catalog_products WHERE id = 7').run(),
    ).rejects.toThrow();
  });
});
