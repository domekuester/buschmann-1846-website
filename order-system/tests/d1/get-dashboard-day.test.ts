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
  readonly items?: readonly {
    productId: number;
    quantity: number;
    name?: string;
    /**
     * Der Kostenschnappschuss aus Phase 7A. FEHLT ER, wird NULL gespeichert
     * — also genau der Altbestand, den es vor 0017 gab.
     */
    unitCostCents?: number | null;
  }[];
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
                                unit_price_cents, quantity, line_total_cents,
                                unit_cost_cents_snapshot)
       VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, 'Stück', 500, ?, ?, ?)`,
    ).bind(
      seed.orderNumber,
      item.productId,
      item.name ?? `Fiktives Produkt ${item.productId}`,
      item.quantity,
      500 * item.quantity,
      item.unitCostCents ?? null,
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

/**
 * PHASE 7B — DER KOSTENSCHNAPPSCHUSS AUS DER ECHTEN SPALTE.
 *
 * Die Rechenregeln stehen in der Domäne. Hier wird geprüft, dass die ABFRAGE
 * die Spalte tatsächlich liest, dass NULL als NULL ankommt und dass die
 * spätere Änderung eines Katalogwerts eine bestehende Auswertung nicht
 * verändert.
 */
describe('getDashboardDay — Herstellkosten aus dem Snapshot', () => {
  it('liest den gespeicherten Kostenwert der Position', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 2, unitCostCents: 2000 }],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders[0]?.items[0]?.unitCostCents).toBe(2000);
    expect(tag.costs.knownCostCents).toBe(4000);
    expect(tag.costs.complete).toBe(true);
    expect(tag.costs.grossProfitCents).toBe(6000);
  });

  it('liest eine leere Spalte als „unbekannt" und nicht als 0', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 2 }],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders[0]?.items[0]?.unitCostCents).toBeNull();
    expect(tag.costs.complete).toBe(false);
    expect(tag.costs.grossProfitCents).toBeNull();
    expect(tag.costs.marginTenthsPercent).toBeNull();
  });

  it('unterscheidet einen gepflegten Nullwert von einem fehlenden', async () => {
    /**
     * 0 € Herstellkosten sind eine ENTSCHEIDUNG des Betreibers und werden
     * gespeichert; NULL ist die Abwesenheit einer Entscheidung. Genau
     * deshalb hat parseUnitCost() drei Zustände und nicht zwei.
     */
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 1, unitCostCents: 0 }],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders[0]?.items[0]?.unitCostCents).toBe(0);
    expect(tag.costs.complete).toBe(true);
    expect(tag.costs.marginTenthsPercent).toBe(1000);
  });

  it('mischt gepflegte und fehlende Werte in einer Bestellung', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [
        { productId: 1, quantity: 2, unitCostCents: 300 },
        { productId: 2, quantity: 1 },
      ],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.costs.knownCostCents).toBe(600);
    expect(tag.costs.itemCount).toBe(2);
    expect(tag.costs.missingItemCount).toBe(1);
    expect(tag.costs.missingOrderCount).toBe(1);
    expect(tag.costs.complete).toBe(false);
  });

  it('lässt stornierte Bestellungen aus der Kostensumme heraus', async () => {
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 1, unitCostCents: 4000 }],
    });
    await seedOrder({
      orderNumber: 'BUS-2026-000002',
      status: 'cancelled',
      totalCents: 99_900,
      items: [{ productId: 1, quantity: 10, unitCostCents: 9000 }],
    });

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.costs.knownCostCents).toBe(4000);
    expect(tag.costs.marginTenthsPercent).toBe(600);
  });

  /**
   * §18.14 UND §22.C — DIE ENTSCHEIDENDE PRÜFUNG.
   *
   * Wird der Kostenwert des Katalogprodukts später geändert, darf sich an
   * der Auswertung eines vergangenen Tages NICHTS ändern. Ohne diese
   * Zusicherung wäre jede Marge eine Aussage über den heutigen Katalog.
   */
  it('bleibt unverändert, wenn sich die Katalogkosten später ändern', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order,
                                     unit_cost_cents, created_at, updated_at)
       VALUES (900, 'test-900', 'Fiktives Katalogprodukt', 1, 10, 2000, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare('UPDATE products SET catalog_product_id = 900 WHERE id = 1').run();

    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 1, unitCostCents: 2000 }],
    });

    const vorher = await getDashboardDay(env.DB, TAG);
    expect(vorher.costs.knownCostCents).toBe(2000);
    expect(vorher.costs.marginTenthsPercent).toBe(800);

    // Der Katalogwert verdreifacht sich — die Bestellung von damals nicht.
    await env.DB.prepare('UPDATE catalog_products SET unit_cost_cents = 6000 WHERE id = 900').run();

    const nachher = await getDashboardDay(env.DB, TAG);
    expect(nachher.costs.knownCostCents).toBe(2000);
    expect(nachher.costs.marginTenthsPercent).toBe(800);

    await env.DB.prepare('UPDATE products SET catalog_product_id = NULL WHERE id = 1').run();
    await env.DB.prepare('DELETE FROM catalog_products WHERE id = 900').run();
  });

  it('behandelt einen unmöglichen gespeicherten Kostenwert als unbekannt', async () => {
    /**
     * Ein negativer Wert kommt an der CHECK-Bedingung aus 0017 nur mit
     * Gewalt vorbei. Träfe er die Ansicht, wäre „unbekannt" die sichere
     * Antwort: Der Tag verliert seine Marge, statt eine falsche zu zeigen —
     * und die Seite lädt weiterhin.
     */
    await seedOrder({
      orderNumber: 'BUS-2026-000001',
      totalCents: 10_000,
      items: [{ productId: 1, quantity: 1, unitCostCents: 100 }],
    });

    await env.DB.prepare('PRAGMA ignore_check_constraints = ON').run();
    await env.DB.prepare('UPDATE order_items SET unit_cost_cents_snapshot = -5').run();

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.orders[0]?.items[0]?.unitCostCents).toBeNull();
    expect(tag.costs.complete).toBe(false);
    expect(tag.costs.knownCostCents).toBe(0);

    await env.DB.prepare('PRAGMA ignore_check_constraints = OFF').run();
  });

  /** §12 — die Kosten kosten keine zusätzliche Abfrage. */
  it('braucht mit Kosten weiterhin genau zwei Abfragen', () => {
    expect(Object.keys(DASHBOARD_DAY_QUERIES)).toEqual(['orders', 'items']);
  });

  it('liest den Kostenwert aus der Position und nicht aus dem Katalog', () => {
    const sql = `${DASHBOARD_DAY_QUERIES.orders} ${DASHBOARD_DAY_QUERIES.items}`;

    expect(sql).toContain('i.unit_cost_cents_snapshot');
    expect(sql).not.toContain('catalog_products');
    expect(sql).not.toContain('unit_cost_cents ');
  });

  it('bildet die Kostensumme nicht in SQL', () => {
    const sql = DASHBOARD_DAY_QUERIES.items.toUpperCase();

    expect(sql).not.toContain('SUM(');
    expect(sql).not.toContain('GROUP BY');
  });

  it('kostet dieselben zwei Abfragen, egal wie viele Positionen der Tag hat', async () => {
    for (let nummer = 1; nummer <= 6; nummer += 1) {
      await seedOrder({
        orderNumber: `BUS-2026-00000${nummer}`,
        totalCents: 1000,
        items: [
          { productId: 1, quantity: 1, unitCostCents: 100 },
          { productId: 2, quantity: 2, unitCostCents: 200 },
        ],
      });
    }

    const tag = await getDashboardDay(env.DB, TAG);

    expect(tag.costs.itemCount).toBe(12);
    expect(tag.costs.knownCostCents).toBe(3000);
    expect(Object.keys(DASHBOARD_DAY_QUERIES)).toHaveLength(2);
  });
});
