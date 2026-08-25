import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { linkProductToCatalog } from '../../src/application/link-product-to-catalog';
import { findProductLink } from '../../src/infrastructure/d1/product-catalog-link-repository';

/**
 * „Verknüpfe dieses bestellbare Produkt mit jenem Katalogprodukt."
 *
 * Der einzige schreibende Vorgang von Phase 5D — §24 des Auftrags. Er läuft
 * hier gegen eine echte D1, weil genau das geprüft werden soll, was nur eine
 * echte Datenbank sagen kann: Fremdschlüssel, der partielle UNIQUE-Index aus
 * 0014 und die Frage, welche Zeilen ein UPDATE tatsächlich anfasst.
 *
 * ALLE NAMEN UND WERTE SIND FREI ERFUNDEN.
 */

const NOW = '2026-08-25T07:00:00.000Z';
const JETZT = new Date('2026-08-25T09:30:00.000Z');

async function katalogprodukt(id: number, active = true): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, `fixture:${id}`, `Fiktives Katalogprodukt ${id}`, active ? 1 : 0, id * 10, NOW, NOW).run();
}

async function produkt(id: number, catalogProductId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order,
                           catalog_product_id, created_at, updated_at)
     VALUES (?, ?, 99999, 'Stück', 1, ?, ?, ?, ?)`,
  ).bind(id, `Fiktives Produkt ${id}`, id * 10, catalogProductId, NOW, NOW).run();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('linkProductToCatalog', () => {
  /** §24.1 */
  it('verknüpft ein unverknüpftes Produkt', async () => {
    await katalogprodukt(7);
    await produkt(1, null);

    const ergebnis = await linkProductToCatalog(env.DB, {
      productId: 1, catalogProductId: 7, now: JETZT,
    });

    expect(ergebnis).toEqual({ outcome: 'linked' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 7 });
  });

  /** §24.2 */
  it('hängt ein verknüpftes Produkt auf ein anderes Katalogprodukt um', async () => {
    await katalogprodukt(7);
    await katalogprodukt(8);
    await produkt(1, 7);

    const ergebnis = await linkProductToCatalog(env.DB, {
      productId: 1, catalogProductId: 8, now: JETZT,
    });

    expect(ergebnis).toEqual({ outcome: 'linked' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 8 });
  });

  /** §24.3 und §9 — „Nicht verknüpft" ist ein gültiges Ziel. */
  it('setzt eine Zuordnung ausdrücklich auf NULL zurück', async () => {
    await katalogprodukt(7);
    await produkt(1, 7);

    const ergebnis = await linkProductToCatalog(env.DB, {
      productId: 1, catalogProductId: null, now: JETZT,
    });

    expect(ergebnis).toEqual({ outcome: 'linked' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  it('nimmt die unveränderte Fortschreibung derselben Zuordnung an', async () => {
    await katalogprodukt(7);
    await produkt(1, 7);

    expect(await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'linked' });
  });

  /** §24.4 */
  it('lehnt ein unbekanntes Produkt ab, ohne etwas zu schreiben', async () => {
    await katalogprodukt(7);
    await produkt(1, null);

    expect(await linkProductToCatalog(env.DB, { productId: 999, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'unknown_product' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  it('lehnt ein unbekanntes Produkt auch beim Auflösen ab', async () => {
    expect(await linkProductToCatalog(env.DB, { productId: 999, catalogProductId: null, now: JETZT }))
      .toEqual({ outcome: 'unknown_product' });
  });

  /** §24.5 */
  it('lehnt ein unbekanntes Katalogprodukt ab, ohne etwas zu schreiben', async () => {
    await produkt(1, null);

    expect(await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 999, now: JETZT }))
      .toEqual({ outcome: 'unknown_catalog_product' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  /**
   * §10 — ein stillgelegtes Katalogprodukt wird nicht NEU vergeben.
   *
   * Dieselbe Regel wie bei der inaktiven Preisgruppe aus 5B, und aus
   * demselben Grund: Verboten ist die neue Vergabe, nicht die unveränderte
   * Fortschreibung.
   */
  it('vergibt ein stillgelegtes Katalogprodukt nicht neu', async () => {
    await katalogprodukt(7, false);
    await produkt(1, null);

    expect(await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'inactive_catalog_product' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  it('lässt eine bestehende Zuordnung auf ein stillgelegtes Katalogprodukt fortschreiben', async () => {
    await katalogprodukt(7, false);
    await produkt(1, 7);

    expect(await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'linked' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 7 });
  });

  it('meldet ein unbekanntes Produkt auch dann, wenn das Katalogprodukt stillgelegt ist', async () => {
    await katalogprodukt(7, false);

    expect(await linkProductToCatalog(env.DB, { productId: 999, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'unknown_product' });
  });

  /** §24.6 — der partielle UNIQUE-Index aus 0014, kontrolliert beantwortet. */
  it('lehnt ein bereits vergebenes Katalogprodukt kontrolliert ab', async () => {
    await katalogprodukt(7);
    await produkt(1, 7);
    await produkt(2, null);

    expect(await linkProductToCatalog(env.DB, { productId: 2, catalogProductId: 7, now: JETZT }))
      .toEqual({ outcome: 'catalog_product_taken' });
    expect(await findProductLink(env.DB, 2)).toEqual({ catalogProductId: null });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 7 });
  });

  /**
   * DIE ZUORDNUNG WIRD NICHT GERATEN — §3 und §30.A.
   *
   * Zwei Produkte und zwei Katalogprodukte mit exakt passenden Namen: Ein
   * Namensabgleich läge hier auf der Hand und wäre in dieser Funktion in drei
   * Zeilen zu haben. Sie tut es nicht. Ohne ausdrückliche Katalog-ID bleibt
   * jedes Produkt unverknüpft — auch das mit dem sprechendsten Namen.
   */
  it('leitet aus übereinstimmenden Namen KEINE Zuordnung ab', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
       VALUES (7, 'fixture:kaese', 'Käsekuchen', 1, 10, ?, ?)`,
    ).bind(NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Käsekuchen', 99999, 'Stück', 1, 10, ?, ?)`,
    ).bind(NOW, NOW).run();

    const ergebnis = await linkProductToCatalog(env.DB, {
      productId: 1, catalogProductId: null, now: JETZT,
    });

    expect(ergebnis).toEqual({ outcome: 'linked' });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  /** §11 — hier wird kein Preis kopiert, auch nicht in products.price_cents. */
  it('kopiert keinen Preis in das Produkt', async () => {
    await katalogprodukt(7);
    await env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (7, 1, 'fixed', 2100, ?, ?)`,
    ).bind(NOW, NOW).run();
    await produkt(1, null);

    await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 7, now: JETZT });

    const row = await env.DB.prepare('SELECT price_cents FROM products WHERE id = 1')
      .first<{ price_cents: number }>();
    expect(row?.price_cents).toBe(99999);
  });

  /** §24.10 — bereits gespeicherte Bestellungen bleiben unverändert. */
  it('rührt bestehende Bestellungen nicht an', async () => {
    await katalogprodukt(7);
    await produkt(1, null);
    await env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Fiktives Café', 1, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, status,
                           fulfillment_type, fulfillment_date, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café', 'new', 'pickup', '2026-08-26', 4200, ?, ?)`,
    ).bind(NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (1, 1, 1, 'Fiktives Produkt 1', 'Stück', 2100, 2, 4200)`,
    ).run();

    const vorher = await env.DB.prepare('SELECT * FROM order_items WHERE id = 1').first();
    const bestellungVorher = await env.DB.prepare('SELECT * FROM orders WHERE id = 1').first();

    await linkProductToCatalog(env.DB, { productId: 1, catalogProductId: 7, now: JETZT });

    expect(await env.DB.prepare('SELECT * FROM order_items WHERE id = 1').first()).toEqual(vorher);
    expect(await env.DB.prepare('SELECT * FROM orders WHERE id = 1').first()).toEqual(bestellungVorher);
  });
});
