import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANALYTICS_QUERIES,
  findAnalyticsGroups,
} from '../../src/infrastructure/d1/analytics-repository';

const NOW = '2026-09-01T07:00:00.000Z';

let laufendeNummer = 0;

interface SeedItem {
  readonly productId: number;
  readonly quantity: number;
  readonly unitPriceCents?: number;
  readonly unitCostCents?: number | null;
  readonly cancelled?: boolean;
}

async function seedOrder(o: {
  day: string;
  status?: string;
  paymentStatus?: string;
  customerId?: number;
  fulfillment?: string;
  items?: readonly SeedItem[];
}): Promise<void> {
  laufendeNummer += 1;
  const nummer = `BUS-2026-${String(laufendeNummer).padStart(6, '0')}`;
  const bezahlt = o.paymentStatus ?? 'unpaid';
  const items = o.items ?? [];
  const gesamt = items
    .filter((i) => !i.cancelled)
    .reduce((s, i) => s + (i.unitPriceCents ?? 1_000) * i.quantity, 0);

  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, status,
                         total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      nummer,
      o.customerId ?? 1,
      o.customerId === 2 ? 'Fiktive Konditorei Süd' : 'Fiktives Café Nord',
      o.fulfillment ?? 'pickup',
      o.day,
      o.fulfillment === 'delivery' ? 'Fiktive Straße 1, 40213 Düsseldorf' : null,
      o.status ?? 'completed',
      gesamt,
      bezahlt,
      bezahlt === 'unpaid' ? null : NOW,
      NOW,
      NOW,
    )
    .run();

  for (const item of items) {
    const preis = item.unitPriceCents ?? 1_000;
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents,
                                unit_cost_cents_snapshot, cancelled_at)
       VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, 'Stück', ?, ?, ?, ?, ?)`,
    )
      .bind(
        nummer,
        item.productId,
        `Fiktives Produkt ${item.productId}`,
        preis,
        item.quantity,
        preis * item.quantity,
        item.unitCostCents === undefined ? 400 : item.unitCostCents,
        item.cancelled === true ? NOW : null,
      )
      .run();
  }
}

beforeEach(async () => {
  laufendeNummer = 0;
  await env.DB.prepare('DELETE FROM order_items').run();
  await env.DB.prepare('DELETE FROM orders').run();
  await env.DB.prepare('DELETE FROM customers').run();
  await env.DB.prepare('DELETE FROM price_lists').run();
  await env.DB.prepare(
    `INSERT INTO price_lists (id, code, label, is_active, sort_order)
     VALUES (1, 'gastro', 'Gastronomie', 1, 10),
            (2, 'private', 'Privatkunden', 1, 20)`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, price_list_id, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', 1, ?1, ?1),
            (2, 'Fiktive Konditorei Süd', 1, 'pickup', 2, ?1, ?1),
            (3, 'Fiktiver Kunde ohne Gruppe', 1, 'pickup', NULL, ?1, ?1)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktives Produkt 1', 1000, 'Stück', 1, 10, ?1, ?1),
            (2, 'Fiktives Produkt 2', 1000, 'Stück', 1, 20, ?1, ?1)`,
  )
    .bind(NOW)
    .run();
});

describe('Abfragen', () => {
  it('sind genau fünf', () => {
    expect(Object.keys(ANALYTICS_QUERIES)).toEqual([
      'orders',
      'items',
      'products',
      'customers',
      'segments',
    ]);
  });

  it('enthalten keinen Statusfilter — die Umsatzregel bleibt in der Domäne', () => {
    for (const sql of Object.values(ANALYTICS_QUERIES)) {
      expect(sql).not.toMatch(/status\s*(<>|!=|=)\s*'/);
      expect(sql).not.toContain('cancelled\'');
    }
  });

  it('lesen die Änderungshistorie nirgends', () => {
    for (const sql of Object.values(ANALYTICS_QUERIES)) {
      expect(sql).not.toContain('order_item_changes');
    }
  });

  it('greifen für den Bereichsfilter auf den Tagesindex zu', async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${ANALYTICS_QUERIES.orders}`)
      .bind('2026-09-01', '2026-09-16')
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(' ')).toContain('idx_orders_day');
  });
});

describe('Bestellzeilen', () => {
  it('gruppiert nach Tag, Status und Zahlungsstand', async () => {
    await seedOrder({ day: '2026-09-02', status: 'completed', paymentStatus: 'paid_cash', items: [{ productId: 1, quantity: 2 }] });
    await seedOrder({ day: '2026-09-02', status: 'completed', paymentStatus: 'paid_cash', items: [{ productId: 1, quantity: 3 }] });
    await seedOrder({ day: '2026-09-02', status: 'new', paymentStatus: 'unpaid', items: [{ productId: 1, quantity: 1 }] });

    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    const bezahlt = gruppen.orders.find((g) => g.paymentStatus === 'paid_cash');
    expect(bezahlt).toMatchObject({ day: '2026-09-02', status: 'completed', orderCount: 2, revenueCents: 5_000 });
    expect(gruppen.orders.find((g) => g.status === 'new')).toMatchObject({ orderCount: 1, revenueCents: 1_000 });
  });

  it('liefert stornierte Bestellungen mit — die Domäne entscheidet über sie', async () => {
    await seedOrder({ day: '2026-09-02', status: 'cancelled', items: [{ productId: 1, quantity: 2 }] });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.orders.map((g) => g.status)).toEqual(['cancelled']);
  });

  it('nimmt den ersten Tag mit und den Endtag nicht', async () => {
    await seedOrder({ day: '2026-09-01', items: [{ productId: 1, quantity: 1 }] });
    await seedOrder({ day: '2026-09-15', items: [{ productId: 1, quantity: 1 }] });
    await seedOrder({ day: '2026-09-16', items: [{ productId: 1, quantity: 1 }] });

    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.orders.map((g) => g.day).sort()).toEqual(['2026-09-01', '2026-09-15']);
  });
});

describe('Positionszeilen', () => {
  it('summiert Mengen und bekannte Kosten je Tag und Status', async () => {
    await seedOrder({
      day: '2026-09-02',
      items: [
        { productId: 1, quantity: 4, unitCostCents: 300 },
        { productId: 2, quantity: 2, unitCostCents: 500 },
      ],
    });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.items).toHaveLength(1);
    expect(gruppen.items[0]).toMatchObject({
      day: '2026-09-02',
      status: 'completed',
      units: 6,
      knownCostCents: 4 * 300 + 2 * 500,
      itemCount: 2,
      missingItemCount: 0,
      orderCount: 1,
      missingOrderCount: 0,
    });
  });

  it('lässt stornierte Positionen ganz weg', async () => {
    await seedOrder({
      day: '2026-09-02',
      items: [
        { productId: 1, quantity: 4 },
        { productId: 2, quantity: 9, cancelled: true },
      ],
    });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.items[0]).toMatchObject({ units: 4, itemCount: 1 });
  });

  it('zählt eine fehlende Kostenangabe als Lücke und nicht als null Cent', async () => {
    await seedOrder({
      day: '2026-09-02',
      items: [
        { productId: 1, quantity: 2, unitCostCents: 300 },
        { productId: 2, quantity: 5, unitCostCents: null },
      ],
    });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.items[0]).toMatchObject({
      knownCostCents: 600,
      missingItemCount: 1,
      missingOrderCount: 1,
      orderCount: 1,
    });
  });

  it('meldet eine Bestellung ohne Lücke getrennt von einer mit Lücke', async () => {
    await seedOrder({ day: '2026-09-02', items: [{ productId: 1, quantity: 1, unitCostCents: 100 }] });
    await seedOrder({ day: '2026-09-02', items: [{ productId: 1, quantity: 1, unitCostCents: null }] });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.items[0]).toMatchObject({ orderCount: 2, missingOrderCount: 1, missingItemCount: 1 });
  });
});

describe('Toplisten', () => {
  it('liefert Produkte mit Schnappschussnamen, Menge und Umsatz', async () => {
    await seedOrder({
      day: '2026-09-02',
      items: [{ productId: 1, quantity: 3, unitPriceCents: 2_200 }],
    });
    await seedOrder({
      day: '2026-09-03',
      items: [{ productId: 1, quantity: 1, unitPriceCents: 2_200 }],
    });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.products).toHaveLength(1);
    expect(gruppen.products[0]).toMatchObject({
      productId: 1,
      name: 'Fiktives Produkt 1',
      unit: 'Stück',
      status: 'completed',
      units: 4,
      revenueCents: 8_800,
    });
  });

  it('lässt stornierte Positionen aus der Produktliste', async () => {
    await seedOrder({
      day: '2026-09-02',
      items: [{ productId: 1, quantity: 3, cancelled: true }],
    });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.products).toEqual([]);
  });

  it('liefert Kunden mit Schnappschussnamen, Anzahl und Umsatz', async () => {
    await seedOrder({ day: '2026-09-02', customerId: 2, items: [{ productId: 1, quantity: 1, unitPriceCents: 5_000 }] });
    await seedOrder({ day: '2026-09-04', customerId: 2, items: [{ productId: 1, quantity: 1, unitPriceCents: 3_000 }] });
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.customers).toHaveLength(1);
    expect(gruppen.customers[0]).toMatchObject({
      customerId: 2,
      name: 'Fiktive Konditorei Süd',
      orderCount: 2,
      revenueCents: 8_000,
    });
    expect(gruppen.customers[0]?.latestOrderId).toBeGreaterThan(0);
  });
});

describe('Aufteilungen', () => {
  it('gruppiert nach Zustellart und Preisgruppe', async () => {
    await seedOrder({ day: '2026-09-02', customerId: 1, fulfillment: 'delivery', items: [{ productId: 1, quantity: 1, unitPriceCents: 1_000 }] });
    await seedOrder({ day: '2026-09-03', customerId: 2, fulfillment: 'pickup', items: [{ productId: 1, quantity: 1, unitPriceCents: 2_000 }] });
    await seedOrder({ day: '2026-09-04', customerId: 3, fulfillment: 'pickup', items: [{ productId: 1, quantity: 1, unitPriceCents: 3_000 }] });

    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.segments).toHaveLength(3);
    expect(gruppen.segments.find((s) => s.fulfillmentType === 'delivery')).toMatchObject({
      priceGroupCode: 'gastro',
      orderCount: 1,
      revenueCents: 1_000,
    });
    expect(gruppen.segments.find((s) => s.priceGroupCode === 'private')).toMatchObject({
      fulfillmentType: 'pickup',
      revenueCents: 2_000,
    });
    expect(gruppen.segments.find((s) => s.priceGroupCode === null)).toMatchObject({
      revenueCents: 3_000,
    });
  });
});

describe('Bereiche', () => {
  it('liest Kurve und Vergleich in EINEM Bereich, die Listen nur im Zeitraum', async () => {
    await seedOrder({ day: '2026-08-05', items: [{ productId: 1, quantity: 1 }] });
    await seedOrder({ day: '2026-09-05', items: [{ productId: 2, quantity: 1 }] });

    const gruppen = await findAnalyticsGroups(env.DB, '2026-08-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen.orders.map((g) => g.day).sort()).toEqual(['2026-08-05', '2026-09-05']);
    expect(gruppen.products.map((p) => p.productId)).toEqual([2]);
    expect(gruppen.segments).toHaveLength(1);
  });

  it('bleibt bei einem leeren Bereich leer', async () => {
    const gruppen = await findAnalyticsGroups(env.DB, '2026-09-01', '2026-09-16', '2026-09-01', '2026-09-16');
    expect(gruppen).toEqual({ orders: [], items: [], products: [], customers: [], segments: [] });
  });
});
