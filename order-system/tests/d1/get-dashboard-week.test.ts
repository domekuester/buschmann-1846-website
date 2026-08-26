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
}): Promise<void> {
  laufendeNummer += 1;
  const bezahlt = overrides.paymentStatus ?? 'unpaid';

  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `BUS-2026-${String(laufendeNummer).padStart(6, '0')}`,
      overrides.day,
      overrides.status ?? 'new',
      overrides.totalCents ?? 1000,
      bezahlt,
      bezahlt === 'unpaid' ? null : NOW,
      NOW,
      NOW,
    )
    .run();
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
  it('braucht für eine ganze Woche genau eine Abfrage', () => {
    expect(Object.keys(DASHBOARD_WEEK_QUERIES)).toEqual(['orders']);
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
