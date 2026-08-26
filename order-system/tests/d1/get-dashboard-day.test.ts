import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDashboardDay } from '../../src/application/get-dashboard-day';
import { DASHBOARD_DAY_QUERIES } from '../../src/infrastructure/d1/dashboard-day-repository';

const NOW = '2026-08-25T12:00:00.000Z';
const TAG = '2026-08-28';

/**
 * Der Tagesüberblick gegen eine echte D1.
 *
 * Die Aggregationsregeln selbst sind ohne Datenbank geprüft
 * (tests/domain/dashboard-day.test.ts). Hier steht die andere Hälfte: dass
 * die ABFRAGE die richtigen Zeilen holt — den richtigen Tag, alle Status
 * einschließlich storniert, den Zahlungsstatus aus der Zeile und die
 * Positionen der richtigen Bestellung.
 */

async function seedProduct(id: number, name: string, unit = 'Stück', sortOrder = 0): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, 500, ?, 1, ?, ?, ?)`,
  ).bind(id, name, unit, sortOrder, NOW, NOW).run();
}

interface OrderSeed {
  readonly orderNumber: string;
  readonly customerId?: number;
  readonly day?: string;
  readonly status?: string;
  readonly paymentStatus?: string;
  readonly totalCents?: number;
  readonly createdAt?: string;
  readonly items?: readonly { productId: number; quantity: number; name?: string }[];
}

async function seedOrder(seed: OrderSeed): Promise<void> {
  const bezahlt = seed.paymentStatus ?? 'unpaid';
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    seed.orderNumber,
    seed.customerId ?? 1,
    seed.customerId === 2 ? 'Fiktiver Privatkunde' : 'Fiktives Café Nord',
    seed.day ?? TAG,
    seed.status ?? 'new',
    seed.totalCents ?? 1000,
    bezahlt,
    bezahlt === 'unpaid' ? null : NOW,
    seed.createdAt ?? NOW,
    NOW,
  ).run();

  for (const item of seed.items ?? [{ productId: 1, quantity: 2 }]) {
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, 'Stück', 500, ?, ?)`,
    ).bind(
      seed.orderNumber,
      item.productId,
      item.name ?? `Fiktives Produkt ${item.productId}`,
      item.quantity,
      500 * item.quantity,
    ).run();
  }
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?),
            (2, 'Fiktiver Privatkunde', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();
  await seedProduct(1, 'Fiktiver Käsekuchen', 'Stück', 10);
  await seedProduct(2, 'Fiktive Tarte', 'Stück', 20);
});

describe('getDashboardDay', () => {
  it('liefert für einen Tag ohne Bestellungen einen leeren Überblick', async () => {
    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.date).toBe(TAG);
    expect(tag.orders).toEqual([]);
    expect(tag.orderCount).toBe(0);
    expect(tag.revenueCents).toBe(0);
  });

  it('liest ausschließlich Bestellungen des angefragten Liefertages', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', day: TAG, totalCents: 4350 });
    await seedOrder({ orderNumber: 'BUS-2026-000002', day: '2026-08-29', totalCents: 9999 });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders.map((o) => o.orderNumber)).toEqual(['BUS-2026-000001']);
    expect(tag.revenueCents).toBe(4350);
  });

  it('bezieht den Tag auf fulfillment_date und nicht auf created_at', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      day: TAG,
      createdAt: '2026-08-20T06:00:00.000Z',
      totalCents: 4350,
    });

    expect((await getDashboardDay(env.DB, TAG)).orderCount).toBe(1);
    expect((await getDashboardDay(env.DB, '2026-08-20')).orderCount).toBe(0);
  });

  it('zeigt Bestellungen jedes Produktionsstatus, auch abgeschlossene', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', status: 'new' });
    await seedOrder({ orderNumber: 'BUS-2026-000002', status: 'confirmed' });
    await seedOrder({ orderNumber: 'BUS-2026-000003', status: 'in_production' });
    await seedOrder({ orderNumber: 'BUS-2026-000004', status: 'completed' });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders).toHaveLength(4);
    expect(tag.orderCount).toBe(4);
    expect(tag.openCount).toBe(3);
  });

  it('zeigt eine stornierte Bestellung, ohne sie mitzuzählen', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', totalCents: 4350 });
    await seedOrder({ orderNumber: 'BUS-2026-000002', status: 'cancelled', totalCents: 9999 });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders).toHaveLength(2);
    expect(tag.orderCount).toBe(1);
    expect(tag.cancelledCount).toBe(1);
    expect(tag.revenueCents).toBe(4350);
  });

  it('liest den gespeicherten Zahlungsstatus jeder Bestellung', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', paymentStatus: 'paid_cash', totalCents: 1000 });
    await seedOrder({ orderNumber: 'BUS-2026-000002', paymentStatus: 'unpaid', totalCents: 2000 });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders.map((o) => o.paymentStatus)).toEqual(['paid_cash', 'unpaid']);
    expect(tag.unpaidCents).toBe(2000);
    expect(tag.unpaidCount).toBe(1);
  });

  it('ordnet die Positionen ihrer eigenen Bestellung zu', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      items: [{ productId: 1, quantity: 3 }],
    });
    await seedOrder({
      orderNumber: 'BUS-2026-000002',
      items: [{ productId: 2, quantity: 4 }],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders[0]?.items.map((i) => i.quantity)).toEqual([3]);
    expect(tag.orders[1]?.items.map((i) => i.quantity)).toEqual([4]);
    expect(tag.totalUnits).toBe(7);
  });

  it('zählt verschiedene Kunden über ihre Kennung', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', customerId: 1 });
    await seedOrder({ orderNumber: 'BUS-2026-000002', customerId: 1 });
    await seedOrder({ orderNumber: 'BUS-2026-000003', customerId: 2 });

    expect((await getDashboardDay(env.DB, TAG)).customerCount).toBe(2);
  });

  it('bildet die Top-Produkte aus den Positionen des Tages', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      items: [
        { productId: 1, quantity: 2, name: 'Fiktiver Käsekuchen' },
        { productId: 2, quantity: 7, name: 'Fiktive Tarte' },
      ],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.topProducts.map((p) => p.productName)).toEqual([
      'Fiktive Tarte',
      'Fiktiver Käsekuchen',
    ]);
  });

  it('sortiert die Bestellungen nach Bestellzeitpunkt', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000002', createdAt: '2026-08-25T09:00:00.000Z' });
    await seedOrder({ orderNumber: 'BUS-2026-000001', createdAt: '2026-08-25T07:00:00.000Z' });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders.map((o) => o.orderNumber)).toEqual([
      'BUS-2026-000001',
      'BUS-2026-000002',
    ]);
  });

  it('behält eine Bestellung ohne Positionen in der Liste', async () => {
    await seedOrder({ orderNumber: 'BUS-2026-000001', items: [], totalCents: 0 });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders).toHaveLength(1);
    expect(tag.orders[0]?.items).toEqual([]);
  });

  it('braucht für einen Tag genau zwei Abfragen', () => {
    expect(Object.keys(DASHBOARD_DAY_QUERIES)).toEqual(['orders', 'items']);
  });

  it('liest weder Lieferadresse noch Notiz noch Positionspreise', () => {
    const sql = `${DASHBOARD_DAY_QUERIES.orders} ${DASHBOARD_DAY_QUERIES.items}`;

    expect(sql).not.toContain('delivery_address_snapshot');
    expect(sql).not.toContain('note');
    expect(sql).not.toContain('unit_price_cents');
    expect(sql).not.toContain('line_total_cents');
  });
});
