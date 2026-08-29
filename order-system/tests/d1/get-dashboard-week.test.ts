import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDashboardWeek } from '../../src/application/get-dashboard-week';
import { DASHBOARD_WEEK_QUERIES } from '../../src/infrastructure/d1/dashboard-week-repository';

const MONTAG = '2026-08-24';
const NOW = '2026-08-20T07:00:00.000Z';

let laufendeNummer = 0;

async function seedOrder(overrides: {
  day: string;
  status?: string;
  paymentStatus?: string;
  totalCents?: number;
  /**
   * Die Positionen samt Kostenschnappschuss — seit Phase 7B.
   *
   * FEHLEN SIE GANZ, bekommt die Bestellung keine Position: Dann ist nichts
   * zu kalkulieren, und die älteren Tests dieser Datei bleiben von den
   * Kosten unberührt. `null` als Kostenwert ist der Altbestand.
   */
  items?: readonly { unitCostCents: number | null; quantity?: number }[];
}): Promise<void> {
  laufendeNummer += 1;
  const bezahlt = overrides.paymentStatus ?? 'unpaid';
  const bestellnummer = `BUS-2026-${String(laufendeNummer).padStart(6, '0')}`;

  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bestellnummer,
      overrides.day,
      overrides.status ?? 'new',
      overrides.totalCents ?? 1000,
      bezahlt,
      bezahlt === 'unpaid' ? null : NOW,
      NOW,
      NOW,
    )
    .run();

  /**
   * JE POSITION EIN ANDERES PRODUKT — order_items trägt
   * UNIQUE(order_id, product_id). Die Produkte legt das Setup an.
   */
  for (const [index, item] of (overrides.items ?? []).entries()) {
    const menge = item.quantity ?? 1;
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents,
                                unit_cost_cents_snapshot)
       VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, 'Stück', 500, ?, ?, ?)`,
    )
      .bind(
        bestellnummer,
        index + 1,
        `Fiktives Produkt ${index + 1}`,
        menge,
        500 * menge,
        item.unitCostCents,
      )
      .run();
  }
}

beforeEach(async () => {
  laufendeNummer = 0;
  await env.DB.prepare('DELETE FROM order_items').run();
  await env.DB.prepare('DELETE FROM orders').run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  )
    .bind(NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO products (id, name, price_cents, unit, is_active, sort_order,
                                     created_at, updated_at)
     VALUES (1, 'Fiktives Produkt 1', 500, 'Stück', 1, 10, ?1, ?1),
            (2, 'Fiktives Produkt 2', 500, 'Stück', 1, 20, ?1, ?1)`,
  )
    .bind(NOW)
    .run();
});

describe('getDashboardWeek', () => {
  it('liefert sieben Tage, auch wenn die Woche leer ist', async () => {
    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days).toHaveLength(7);
    expect(woche.total.orderCount).toBe(0);
  });

  it('ordnet die Bestellungen ihren Liefertagen zu', async () => {
    await seedOrder({ day: '2026-08-24', totalCents: 4350 });
    await seedOrder({ day: '2026-08-26', totalCents: 1290 });
    await seedOrder({ day: '2026-08-26', totalCents: 1000 });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days.map((tag) => tag.orderCount)).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(woche.days[2]?.revenueCents).toBe(2290);
    expect(woche.total.revenueCents).toBe(6640);
  });

  it('lässt den Tag VOR dem Montag außen vor', async () => {
    await seedOrder({ day: '2026-08-23', totalCents: 9999 });

    expect((await getDashboardWeek(env.DB, MONTAG)).total.revenueCents).toBe(0);
  });

  it('nimmt den SONNTAG noch mit', async () => {
    await seedOrder({ day: '2026-08-30', totalCents: 4350 });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[6]?.orderCount).toBe(1);
    expect(woche.total.revenueCents).toBe(4350);
  });

  it('lässt den Tag NACH dem Sonntag außen vor', async () => {
    await seedOrder({ day: '2026-08-31', totalCents: 8888 });

    expect((await getDashboardWeek(env.DB, MONTAG)).total.revenueCents).toBe(0);
  });

  it('lässt stornierte Bestellungen aus Umsatz und offenem Betrag heraus', async () => {
    await seedOrder({ day: MONTAG, totalCents: 4350 });
    await seedOrder({ day: MONTAG, totalCents: 9999, status: 'cancelled' });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]).toMatchObject({
      orderCount: 1,
      cancelledCount: 1,
      revenueCents: 4350,
      unpaidCents: 4350,
      unpaidCount: 1,
    });
  });

  it('zählt die offene Produktion nach der bestehenden Statusregel', async () => {
    await seedOrder({ day: MONTAG, status: 'new' });
    await seedOrder({ day: MONTAG, status: 'confirmed' });
    await seedOrder({ day: MONTAG, status: 'in_production' });
    await seedOrder({ day: MONTAG, status: 'completed' });

    expect((await getDashboardWeek(env.DB, MONTAG)).days[0]?.openCount).toBe(3);
  });

  it('summiert die offenen Zahlungen ohne die bezahlten', async () => {
    await seedOrder({ day: MONTAG, paymentStatus: 'paid_cash', totalCents: 4350 });
    await seedOrder({ day: MONTAG, paymentStatus: 'unpaid', totalCents: 3500 });

    expect((await getDashboardWeek(env.DB, MONTAG)).days[0]).toMatchObject({
      unpaidCents: 3500,
      unpaidCount: 1,
    });
  });

  it('scheitert an einem gespeicherten Status, den es nicht gibt', async () => {
    await seedOrder({ day: MONTAG });
    // An den CHECK-Bedingungen vorbei — nur so ist der Fall überhaupt herstellbar.
    await env.DB.prepare('PRAGMA ignore_check_constraints = ON').run();
    await env.DB.prepare('UPDATE orders SET status = ?').bind('erfunden').run();

    await expect(getDashboardWeek(env.DB, MONTAG)).rejects.toThrow();

    await env.DB.prepare('PRAGMA ignore_check_constraints = OFF').run();
  });
});

/**
 * DIE ABFRAGEZAHL IST VERTRAG UND KEINE MOMENTAUFNAHME.
 *
 * Sieben Tagesüberblicke nacheinander wären vierzehn Abfragen und eine Ansicht,
 * deren Kosten mit der Zahl der angezeigten Tage wachsen. Die Woche kostet
 * EINE — unabhängig davon, ob in ihr eine Bestellung steht oder vierhundert.
 */
describe('Abfragen der Woche', () => {
  /**
   * SEIT PHASE 7B SIND ES ZWEI — und das ist weiterhin eine FESTE Zahl.
   *
   * Die zweite Abfrage holt die Kostenzeilen der ganzen Woche in einem
   * Bereichsfilter. Sie kostet dasselbe bei einer Bestellung wie bei
   * vierhundert; sieben Tagesabfragen wären vierzehn gewesen.
   */
  it('braucht für eine ganze Woche genau zwei Abfragen', () => {
    expect(Object.keys(DASHBOARD_WEEK_QUERIES)).toEqual(['orders', 'items']);
  });

  it('liest weder Positionen noch Preise noch Kundendaten', () => {
    const sql = DASHBOARD_WEEK_QUERIES.orders;

    expect(sql).not.toContain('order_items');
    expect(sql).not.toContain('unit_price_cents');
    expect(sql).not.toContain('line_total_cents');
    expect(sql).not.toContain('customer_name_snapshot');
    expect(sql).not.toContain('delivery_address_snapshot');
    expect(sql).not.toContain('note');
  });

  it('bildet die Summen nicht in SQL', () => {
    const sql = DASHBOARD_WEEK_QUERIES.orders.toUpperCase();

    expect(sql).not.toContain('SUM(');
    expect(sql).not.toContain('GROUP BY');
  });

  it('findet die Woche über idx_orders_day', async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${DASHBOARD_WEEK_QUERIES.orders}`,
    )
      .bind(MONTAG, '2026-08-30')
      .all<{ detail: string }>();

    expect(results.map((zeile) => zeile.detail).join(' | ')).toContain('idx_orders_day');
  });
});

/**
 * PHASE 7B — DIE KOSTENZEILEN DER WOCHE.
 *
 * Geprüft wird die zweite Abfrage: dass sie denselben Zeitraum trifft, dass
 * sie ihre Zeilen der richtigen Bestellung zuordnet und dass sie nicht mit
 * der Zahl der Tage oder Bestellungen wächst.
 */
describe('getDashboardWeek — Herstellkosten und Marge', () => {
  it('rechnet die Marge eines Tages aus seinen Positionen', async () => {
    await seedOrder({ day: MONTAG, totalCents: 42_000, items: [{ unitCostCents: 18_900 }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]?.costs.knownCostCents).toBe(18_900);
    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(550);
  });

  it('ordnet die Kostenzeilen der richtigen Bestellung und damit dem richtigen Tag zu', async () => {
    await seedOrder({ day: MONTAG, totalCents: 10_000, items: [{ unitCostCents: 4000 }] });
    await seedOrder({ day: '2026-08-27', totalCents: 10_000, items: [{ unitCostCents: 1000 }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]?.costs.knownCostCents).toBe(4000);
    expect(woche.days[3]?.costs.knownCostCents).toBe(1000);
    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(600);
    expect(woche.days[3]?.costs.marginTenthsPercent).toBe(900);
  });

  it('rechnet die Menge ein', async () => {
    await seedOrder({
      day: MONTAG,
      totalCents: 10_000,
      items: [{ unitCostCents: 1000, quantity: 3 }],
    });

    expect((await getDashboardWeek(env.DB, MONTAG)).days[0]?.costs.knownCostCents).toBe(3000);
  });

  it('liest eine leere Kostenspalte als „unbekannt"', async () => {
    await seedOrder({ day: MONTAG, totalCents: 10_000, items: [{ unitCostCents: null }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]?.costs.complete).toBe(false);
    expect(woche.days[0]?.costs.marginTenthsPercent).toBeNull();
    expect(woche.total.costs.marginTenthsPercent).toBeNull();
  });

  it('lässt stornierte Bestellungen aus den Wochenkosten heraus', async () => {
    await seedOrder({ day: MONTAG, totalCents: 10_000, items: [{ unitCostCents: 4000 }] });
    await seedOrder({
      day: MONTAG,
      status: 'cancelled',
      totalCents: 99_900,
      items: [{ unitCostCents: null }],
    });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.total.costs.complete).toBe(true);
    expect(woche.total.costs.knownCostCents).toBe(4000);
    expect(woche.total.costs.marginTenthsPercent).toBe(600);
  });

  /** §20.27 — der Bereich gilt auch für die Kostenzeilen. */
  it('nimmt keine Position von außerhalb der Woche', async () => {
    await seedOrder({ day: MONTAG, totalCents: 10_000, items: [{ unitCostCents: 4000 }] });
    await seedOrder({ day: '2026-08-23', totalCents: 50_000, items: [{ unitCostCents: null }] });
    await seedOrder({ day: '2026-08-31', totalCents: 50_000, items: [{ unitCostCents: null }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.total.costs.orderCount).toBe(1);
    expect(woche.total.costs.itemCount).toBe(1);
    expect(woche.total.costs.complete).toBe(true);
  });

  it('bezieht den Sonntag in die Kostenabfrage ein', async () => {
    await seedOrder({ day: '2026-08-30', totalCents: 10_000, items: [{ unitCostCents: 4000 }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[6]?.costs.knownCostCents).toBe(4000);
    expect(woche.days[6]?.costs.marginTenthsPercent).toBe(600);
  });

  it('bildet die Wochenmarge aus den Summen und nicht aus den Tagesmargen', async () => {
    await seedOrder({ day: MONTAG, totalCents: 1000, items: [{ unitCostCents: 100 }] });
    await seedOrder({ day: '2026-08-29', totalCents: 10_000, items: [{ unitCostCents: 7000 }] });

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(900);
    expect(woche.days[5]?.costs.marginTenthsPercent).toBe(300);
    expect(woche.total.costs.marginTenthsPercent).toBe(355);
  });

  it('behandelt einen unmöglichen gespeicherten Kostenwert als unbekannt', async () => {
    await seedOrder({ day: MONTAG, totalCents: 10_000, items: [{ unitCostCents: 100 }] });

    await env.DB.prepare('PRAGMA ignore_check_constraints = ON').run();
    await env.DB.prepare('UPDATE order_items SET unit_cost_cents_snapshot = -5').run();

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.days[0]?.costs.complete).toBe(false);
    expect(woche.days[0]?.costs.knownCostCents).toBe(0);

    await env.DB.prepare('PRAGMA ignore_check_constraints = OFF').run();
  });
});

/**
 * §20.28 — KEIN N+1.
 *
 * Die Wochenansicht darf nicht teurer werden, wenn mehr in der Woche steht.
 * Geprüft wird der Vertrag (zwei Abfragen), sein Inhalt (Bereichsfilter statt
 * ID-Liste) und die Wirkung an einer vollen Woche.
 */
describe('Die Kostenabfrage der Woche', () => {
  it('liest drei Spalten und keinen Produktnamen', () => {
    const sql = DASHBOARD_WEEK_QUERIES.items;

    expect(sql).toContain('i.unit_cost_cents_snapshot');
    expect(sql).toContain('i.quantity');
    expect(sql).toContain('i.order_id');
    expect(sql).not.toContain('product_name_snapshot');
    expect(sql).not.toContain('product_unit_snapshot');
    expect(sql).not.toContain('unit_price_cents');
    expect(sql).not.toContain('line_total_cents');
    expect(sql).not.toContain('sort_order');
  });

  it('verbindet nicht auf den heutigen Katalog', () => {
    const sql = DASHBOARD_WEEK_QUERIES.items;

    expect(sql).not.toContain('catalog_products');
    expect(sql).not.toContain('JOIN products');
  });

  it('bildet auch die Kostensumme nicht in SQL', () => {
    const sql = DASHBOARD_WEEK_QUERIES.items.toUpperCase();

    expect(sql).not.toContain('SUM(');
    expect(sql).not.toContain('GROUP BY');
    expect(sql).not.toContain('COUNT(');
  });

  it('filtert über denselben Bereich wie die Bestellabfrage und nicht über eine ID-Liste', () => {
    const sql = DASHBOARD_WEEK_QUERIES.items;

    expect(sql).toContain('o.fulfillment_date >= ? AND o.fulfillment_date <= ?');
    expect(sql).not.toContain(' IN (');
  });

  it('kostet dieselben zwei Abfragen, egal wie voll die Woche ist', async () => {
    for (let versatz = 0; versatz < 7; versatz += 1) {
      const tag = `2026-08-${String(24 + versatz).padStart(2, '0')}`;
      for (let nummer = 0; nummer < 4; nummer += 1) {
        await seedOrder({
          day: tag,
          totalCents: 1000,
          items: [{ unitCostCents: 100 }, { unitCostCents: 200, quantity: 2 }],
        });
      }
    }

    const woche = await getDashboardWeek(env.DB, MONTAG);

    expect(woche.total.costs.orderCount).toBe(28);
    expect(woche.total.costs.itemCount).toBe(56);
    expect(woche.total.costs.knownCostCents).toBe(14_000);
    expect(Object.keys(DASHBOARD_WEEK_QUERIES)).toHaveLength(2);
  });

  it('findet auch die Kostenzeilen über den Tagesindex', async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${DASHBOARD_WEEK_QUERIES.items}`,
    )
      .bind(MONTAG, '2026-08-30')
      .all<{ detail: string }>();

    expect(results.map((zeile) => zeile.detail).join(' | ')).toContain('idx_orders_day');
  });
});
