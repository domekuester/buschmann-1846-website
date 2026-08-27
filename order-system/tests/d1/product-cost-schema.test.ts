import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-26T09:00:00.000Z';

/**
 * Migration 0017 — Herstellkosten am Katalogprodukt und ihr Snapshot an der
 * Bestellposition.
 *
 * GEPRÜFT WIRD DIE DATENBANK UND NICHT DER ANWENDUNGSCODE. Der wichtigste
 * Test dieser Datei ist der erste: Nach der Migration behauptet niemand
 * etwas über die Vergangenheit. Kein Katalogprodukt bekommt geschätzte
 * Kosten, keine bestehende Position bekommt einen errechneten Snapshot —
 * beides bleibt NULL, und NULL heißt „nicht bekannt" und nicht „0 €".
 *
 * ALLE NAMEN UND WERTE SIND FREI ERFUNDEN.
 */

async function seedKatalogprodukt(id: number, kosten: number | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products
       (id, source_key, name, unit, is_active, sort_order, unit_cost_cents, created_at, updated_at)
     VALUES (?, ?, ?, 'Stück', 1, 10, ?, ?, ?)`,
  ).bind(id, `fixture:${id}`, `Fiktives Katalogprodukt ${id}`, kosten, NOW, NOW).run();
}

async function seedBestellung(kostenSnapshot: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktiver Kuchen', 500, 'Stück', 1, 10, ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café', 'pickup', '2026-08-28', 'new', 1500, ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
     VALUES (1, 1, 'Fiktiver Kuchen', 'Stück', 500, 3, 1500, ?)`,
  ).bind(kostenSnapshot).run();
}

async function kostenVon(id: number): Promise<number | null> {
  const row = await env.DB.prepare('SELECT unit_cost_cents FROM catalog_products WHERE id = ?')
    .bind(id).first<{ unit_cost_cents: number | null }>();
  if (!row) throw new Error('Katalogprodukt fehlt');
  return row.unit_cost_cents;
}

async function snapshotDerPosition(): Promise<number | null> {
  const row = await env.DB.prepare('SELECT unit_cost_cents_snapshot FROM order_items LIMIT 1')
    .first<{ unit_cost_cents_snapshot: number | null }>();
  if (!row) throw new Error('Position fehlt');
  return row.unit_cost_cents_snapshot;
}

beforeEach(async () => {
  for (const table of [
    'order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products', 'customers',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('Migration 0017 — kein Backfill, keine Erfindung', () => {
  /** §2 und §4 — NULL ist der Ausgangszustand und keine Zahl. */
  it('lässt ein neues Katalogprodukt ohne Herstellkosten zurück', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'fixture:ohne', 'Fiktiver Kuchen', 1, 10, ?1, ?1)`,
    ).bind(NOW).run();

    expect(await kostenVon(1)).toBeNull();
  });

  /** §4 — eine Bestellposition ohne Kostenangabe bleibt ehrlich leer. */
  it('lässt eine Bestellposition ohne Kostenschnappschuss zurück', async () => {
    await seedBestellung(null);
    expect(await snapshotDerPosition()).toBeNull();
  });

  /**
   * §2 — DER UNTERSCHIED, UM DEN ES IN DIESER PHASE GEHT.
   *
   * NULL und 0 sind in SQLite verschiedene Werte und dürfen es bleiben:
   * „noch nicht gepflegt" gegenüber „kostet uns tatsächlich nichts".
   */
  it('unterscheidet NULL von 0', async () => {
    await seedKatalogprodukt(1, null);
    await seedKatalogprodukt(2, 0);

    expect(await kostenVon(1)).toBeNull();
    expect(await kostenVon(2)).toBe(0);

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS anzahl FROM catalog_products WHERE unit_cost_cents IS NULL',
    ).first<{ anzahl: number }>();
    expect(row?.anzahl).toBe(1);
  });
});

describe('Migration 0017 — CHECK am Katalogprodukt', () => {
  /** §15.3 — ein positiver Centwert geht durch. */
  it('nimmt einen positiven Centwert an', async () => {
    await seedKatalogprodukt(1, 210);
    expect(await kostenVon(1)).toBe(210);
  });

  /** §15.2 — 0 ist ausdrücklich erlaubt. */
  it('nimmt 0 an', async () => {
    await seedKatalogprodukt(1, 0);
    expect(await kostenVon(1)).toBe(0);
  });

  /** §15.4 und §15.5 — negative Herstellkosten scheitern an der Datenbank. */
  it('weist negative Herstellkosten ab', async () => {
    await expect(seedKatalogprodukt(1, -1)).rejects.toThrow();
  });

  /** Ein Text in einer Centspalte ist kein Betrag, auch wenn er wie einer aussieht. */
  it('weist einen nicht ganzzahligen Wert ab', async () => {
    await seedKatalogprodukt(1, null);

    for (const wert of ['2,10', 2.5]) {
      await expect(
        env.DB.prepare('UPDATE catalog_products SET unit_cost_cents = ? WHERE id = 1')
          .bind(wert).run(),
      ).rejects.toThrow();
    }
    expect(await kostenVon(1)).toBeNull();
  });
});

describe('Migration 0017 — CHECK an der Bestellposition', () => {
  it('nimmt einen positiven Snapshot an', async () => {
    await seedBestellung(210);
    expect(await snapshotDerPosition()).toBe(210);
  });

  it('nimmt 0 als Snapshot an', async () => {
    await seedBestellung(0);
    expect(await snapshotDerPosition()).toBe(0);
  });

  it('weist einen negativen Snapshot ab', async () => {
    await expect(seedBestellung(-5)).rejects.toThrow();
  });

  /**
   * DER SNAPSHOT HÄNGT AN KEINER FREMDSCHLÜSSELBEDINGUNG ZUM KATALOG — und
   * das ist Absicht: Er ist eine ZAHL aus der Vergangenheit und kein Verweis
   * auf eine Zeile, die heute noch stimmen müsste. Genau deshalb überlebt er
   * jede spätere Änderung am Katalogprodukt.
   */
  it('bleibt unverändert, wenn die Kosten des Katalogprodukts danach geändert werden', async () => {
    await seedBestellung(210);
    await seedKatalogprodukt(7, 210);

    await env.DB.prepare('UPDATE catalog_products SET unit_cost_cents = 999 WHERE id = 7').run();

    expect(await snapshotDerPosition()).toBe(210);
  });
});

describe('Migration 0017 — additiv', () => {
  /**
   * Die Migration legt KEINE neue Tabelle an. Zwei Spalten sind die kleinste
   * Form, in der sich die Frage beantworten lässt; eine Kostentabelle mit
   * eigener Zeile je Produkt wäre eine zweite Wahrheit über dasselbe Produkt.
   */
  it('legt weder eine Kostentabelle noch eine Kostenhistorie an', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%cost%'`,
    ).all<{ name: string }>();

    expect(results).toEqual([]);
  });

  /** Die bestehende Preis-Snapshot-Spalte bleibt, was sie war — §16.14. */
  it('lässt unit_price_cents unverändert bestehen', async () => {
    await seedBestellung(210);
    const row = await env.DB.prepare(
      'SELECT unit_price_cents, line_total_cents FROM order_items LIMIT 1',
    ).first<{ unit_price_cents: number; line_total_cents: number }>();

    expect(row?.unit_price_cents).toBe(500);
    expect(row?.line_total_cents).toBe(1500);
  });

  /**
   * KEIN line_cost_cents. Der Positionskostenbetrag wird gerechnet und nicht
   * gespeichert — sonst gäbe es zwei Zahlen für dieselbe Sache.
   */
  it('legt keine zweite Kostenspalte an der Position an', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(order_items)')
      .all<{ name: string }>();
    const kostenspalten = results.map((r) => r.name).filter((n) => n.includes('cost'));

    expect(kostenspalten).toEqual(['unit_cost_cents_snapshot']);
  });
});
