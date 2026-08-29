import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-25T12:00:00.000Z';

/**
 * Migration 0015 — der Zahlungsstatus einer Bestellung.
 *
 * Geprüft wird ausschließlich das SCHEMA: dass eine bestehende Bestellung die
 * Migration als „noch nicht bezahlt" übersteht, dass nur die fünf
 * vorgesehenen Werte hineinkommen, und dass der Zeitpunkt der Zahlung nicht
 * unabhängig vom Status gesetzt oder vergessen werden kann.
 *
 * DIE KOPPLUNG DER BEIDEN SPALTEN IST DER KERN DIESER DATEI. „bezahlt, aber
 * ohne Zeitpunkt" und „unbezahlt, aber mit Zeitpunkt" sind beides
 * Zustände, aus denen später niemand mehr herauslesen kann, was gemeint war.
 * Die Datenbank lässt sie deshalb gar nicht erst zu — nicht der
 * Anwendungscode allein.
 */

async function seedCustomer(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
}

async function seedOrder(orderNumber = 'BUS-2026-000001'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', '2026-08-28', 'new', 4350, ?, ?)`,
  ).bind(orderNumber, NOW, NOW).run();
}

async function zahlung(orderNumber = 'BUS-2026-000001'): Promise<{
  payment_status: string;
  payment_recorded_at: string | null;
}> {
  const row = await env.DB.prepare(
    'SELECT payment_status, payment_recorded_at FROM orders WHERE order_number = ?',
  )
    .bind(orderNumber)
    .first<{ payment_status: string; payment_recorded_at: string | null }>();
  if (!row) throw new Error('Bestellung fehlt');
  return row;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM order_items').run();
  await env.DB.prepare('DELETE FROM orders').run();
  await env.DB.prepare('DELETE FROM customers').run();
  await seedCustomer();
});

describe('Migration 0015 — Zahlungsstatus je Bestellung', () => {
  it('legt eine neue Bestellung als unbezahlt und ohne Zahlungszeitpunkt an', async () => {
    await seedOrder();
    expect(await zahlung()).toEqual({ payment_status: 'unpaid', payment_recorded_at: null });
  });

  it('nimmt jeden der vier bezahlten Zustände mit Zeitpunkt an', async () => {
    for (const [index, status] of ['paid_cash', 'paid_card', 'paid_bank', 'paid_other'].entries()) {
      const nummer = `BUS-2026-00000${index + 1}`;
      await seedOrder(nummer);
      await env.DB.prepare(
        'UPDATE orders SET payment_status = ?, payment_recorded_at = ? WHERE order_number = ?',
      ).bind(status, NOW, nummer).run();

      expect(await zahlung(nummer)).toEqual({ payment_status: status, payment_recorded_at: NOW });
    }
  });

  it('lehnt einen erfundenen Zahlungsstatus ab', async () => {
    await seedOrder();
    await expect(
      env.DB.prepare(
        "UPDATE orders SET payment_status = 'paid_bitcoin', payment_recorded_at = ? WHERE order_number = 'BUS-2026-000001'",
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('lehnt einen bezahlten Zustand ohne Zahlungszeitpunkt ab', async () => {
    await seedOrder();
    await expect(
      env.DB.prepare(
        "UPDATE orders SET payment_status = 'paid_cash' WHERE order_number = 'BUS-2026-000001'",
      ).run(),
    ).rejects.toThrow();
  });

  it('lehnt einen Zahlungszeitpunkt ohne bezahlten Zustand ab', async () => {
    await seedOrder();
    await expect(
      env.DB.prepare(
        'UPDATE orders SET payment_recorded_at = ? WHERE order_number = ?',
      ).bind(NOW, 'BUS-2026-000001').run(),
    ).rejects.toThrow();
  });

  it('lässt eine bezahlte Bestellung wieder auf unbezahlt zurücksetzen', async () => {
    await seedOrder();
    await env.DB.prepare(
      "UPDATE orders SET payment_status = 'paid_cash', payment_recorded_at = ? WHERE order_number = 'BUS-2026-000001'",
    ).bind(NOW).run();
    await env.DB.prepare(
      "UPDATE orders SET payment_status = 'unpaid', payment_recorded_at = NULL WHERE order_number = 'BUS-2026-000001'",
    ).run();

    expect(await zahlung()).toEqual({ payment_status: 'unpaid', payment_recorded_at: null });
  });

  it('lässt eine abgeschlossene Bestellung unbezahlt bleiben', async () => {
    await seedOrder();
    await env.DB.prepare(
      "UPDATE orders SET status = 'completed' WHERE order_number = 'BUS-2026-000001'",
    ).run();

    const row = await env.DB.prepare(
      "SELECT status, payment_status FROM orders WHERE order_number = 'BUS-2026-000001'",
    ).first<{ status: string; payment_status: string }>();

    expect(row).toEqual({ status: 'completed', payment_status: 'unpaid' });
  });
});
