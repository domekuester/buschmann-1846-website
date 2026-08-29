import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-29T08:00:00.000Z';

async function seedOrder(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Café Morgen', 1, 'pickup', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000123', 1, 'Café Morgen', 'pickup', '2026-09-02',
               'new', 1305, ?1, ?1)`,
    ).bind(NOW),
  ]);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM email_outbox').run();
  await env.DB.prepare('DELETE FROM email_operator_recipients').run();
  await env.DB.prepare('DELETE FROM orders').run();
  await env.DB.prepare('DELETE FROM customers').run();
});

describe('E-Mail-Migration', () => {
  it('legt Einstellungen, Empfänger und Outbox mit sicheren Voreinstellungen an', async () => {
    const settings = await env.DB.prepare(
      `SELECT operator_notifications_enabled, customer_confirmations_enabled, updated_at
         FROM email_notification_settings WHERE id = 1`,
    ).first<Record<string, unknown>>();
    const recipients = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM email_operator_recipients',
    ).first<{ count: number }>();

    expect(settings).toEqual({
      operator_notifications_enabled: 0,
      customer_confirmations_enabled: 0,
      updated_at: null,
    });
    expect(recipients?.count).toBe(0);
  });

  it('erzwingt Kind, Status, Versuche und die eindeutige Absicht', async () => {
    await seedOrder();
    const insert = (id: string, kind = 'operator_new_order', status = 'pending', attempts = 0) =>
      env.DB.prepare(
        `INSERT INTO email_outbox
           (notification_id, order_id, notification_kind, recipient, status, attempts, created_at)
         VALUES (?, 1, ?, 'betrieb@example.test', ?, ?, ?)`,
      ).bind(id, kind, status, attempts, NOW).run();

    await insert('n-1');
    await expect(insert('n-2')).rejects.toThrow(/UNIQUE constraint/i);
    await expect(insert('n-3', 'unbekannt')).rejects.toThrow(/CHECK constraint/i);
    await expect(insert('n-4', 'customer_order_confirmation', 'queued')).rejects.toThrow(/CHECK constraint/i);
    await expect(insert('n-5', 'customer_order_confirmation', 'pending', -1)).rejects.toThrow(/CHECK constraint/i);
  });

  it('hält sent_at und Status konsistent', async () => {
    await seedOrder();
    await expect(env.DB.prepare(
      `INSERT INTO email_outbox
         (notification_id, order_id, notification_kind, recipient, status, attempts, created_at, sent_at)
       VALUES ('n-1', 1, 'operator_new_order', 'betrieb@example.test', 'pending', 0, ?, ?)`,
    ).bind(NOW, NOW).run()).rejects.toThrow(/CHECK constraint/i);
  });

  it('indiziert die Abholung ausstehender Nachrichten und den Bestellstatus', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_email_%' ORDER BY name`,
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual([
      'idx_email_outbox_order',
      'idx_email_outbox_status_created',
    ]);
  });
});
