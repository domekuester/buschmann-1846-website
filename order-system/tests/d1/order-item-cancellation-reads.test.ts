import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { findDashboardOrders } from '../../src/infrastructure/d1/dashboard-day-repository';
import { findDashboardWeekOrders } from '../../src/infrastructure/d1/dashboard-week-repository';
import { findOrderByNumber } from '../../src/infrastructure/d1/order-repository';
import { findProductionOrders } from '../../src/infrastructure/d1/production-day-repository';

const NOW = '2026-09-01T06:00:00.000Z';
const TAG = '2026-09-04';
const NUMMER = 'BUS-2026-000001';

/**
 * Eine stornierte Position verschwindet aus JEDER Sicht auf den gültigen
 * Stand — und aus keiner Zeile der Datenbank.
 *
 * Das ist die Regel, deren Verletzung echten Schaden anrichtet: Eine
 * Position, die noch auf der Backliste steht, obwohl sie storniert wurde,
 * kostet Zutaten und Arbeitszeit. Eine, die noch im Umsatz steht, macht den
 * Tag reicher, als er war.
 *
 * Geprüft werden ALLE VIER Leser von order_items in einer Datei — nicht,
 * weil sie zusammengehören, sondern weil das die Frage ist: Gibt es einen
 * Weg, auf dem eine stornierte Position doch noch herauskommt?
 */

async function seed(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();

  for (const [id, name, sort] of [[1, 'New York Cheesecake Classic', 10], [2, 'Brownie', 20]] as const) {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, 2200, 'Stück', ?, 1, ?, ?)`,
    ).bind(id, name, sort, NOW, NOW).run();
  }

  // 5 × 22,00 € + 3 × 4,00 € = 122,00 €. Nach der Stornierung des Brownies
  // bleiben 110,00 € — und der gespeicherte Gesamtbetrag sagt das bereits.
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (1, ?, 1, 'Fiktives Café Nord', 'pickup', ?, 'confirmed', 11000, ?, ?)`,
  ).bind(NUMMER, TAG, NOW, NOW).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot,
                              cancelled_at)
     VALUES (1, 1, 1, 'New York Cheesecake Classic', 'Stück', 2200, 5, 11000, 900, NULL)`,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot,
                              cancelled_at)
     VALUES (2, 1, 2, 'Brownie', 'Stück', 400, 3, 1200, 150, ?)`,
  ).bind(NOW).run();
}

beforeEach(async () => {
  for (const table of ['order_item_changes', 'order_items', 'orders', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seed();
});

describe('stornierte Positionen im Bestelldokument', () => {
  it('liest nur die aktive Position', async () => {
    const order = await findOrderByNumber(env.DB, NUMMER);

    expect(order?.items.map((i) => i.productNameSnapshot)).toEqual([
      'New York Cheesecake Classic',
    ]);
  });

  it('rechnet den Gesamtbetrag ohne die stornierte Position', async () => {
    const order = await findOrderByNumber(env.DB, NUMMER);

    expect(order?.total().cents).toBe(11000);
  });
});

describe('stornierte Positionen in der Produktion', () => {
  it('erzeugt keinen Produktionsbedarf', async () => {
    const [order] = await findProductionOrders(env.DB, TAG);

    expect(order?.items.map((i) => [i.productName, i.quantity])).toEqual([
      ['New York Cheesecake Classic', 5],
    ]);
  });

  it('nimmt eine geänderte Menge unmittelbar auf', async () => {
    await env.DB.prepare(
      'UPDATE order_items SET quantity = 3, line_total_cents = 6600 WHERE id = 1',
    ).run();

    const [order] = await findProductionOrders(env.DB, TAG);

    expect(order?.items.map((i) => i.quantity)).toEqual([3]);
  });

  /**
   * Die bereits abgesicherte Regel aus früheren Phasen — hier noch einmal
   * gegen die Bearbeitung geprüft: Eine BEARBEITETE Bestellung im Status
   * „Neu" wird davon nicht produktionsrelevant.
   */
  it('lässt eine bearbeitete Bestellung im Status „Neu" weiterhin aus', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'new' WHERE id = 1").run();
    await env.DB.prepare('UPDATE order_items SET quantity = 3, line_total_cents = 6600 WHERE id = 1').run();

    expect(await findProductionOrders(env.DB, TAG)).toEqual([]);
  });
});

describe('stornierte Positionen im Tagesüberblick', () => {
  it('zählt die stornierte Position nicht mit', async () => {
    const [order] = await findDashboardOrders(env.DB, TAG);

    expect(order?.items.map((i) => [i.productName, i.quantity])).toEqual([
      ['New York Cheesecake Classic', 5],
    ]);
  });
});

describe('stornierte Positionen in der Wochenübersicht', () => {
  it('zählt weder ihre Menge noch ihre Herstellkosten mit', async () => {
    const [order] = await findDashboardWeekOrders(env.DB, '2026-08-31', '2026-09-06');

    expect(order?.items).toEqual([{ quantity: 5, unitCostCents: 900 }]);
  });
});
