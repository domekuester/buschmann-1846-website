import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-30T08:00:00.000Z';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM customer_account_requests').run();
});

async function insert(email: string, status = 'pending'): Promise<D1Result> {
  return env.DB.prepare(
    `INSERT INTO customer_account_requests
       (name, email_normalized, email, phone, status, created_at, updated_at, processed_at)
     VALUES ('Fiktive Konditorei', ?, ?, '0211 123456', ?, ?, ?, ?)`,
  ).bind(email, email, status, NOW, NOW, status === 'pending' ? null : NOW).run();
}

describe('Migration Kundenkonto-Anfragen', () => {
  it('legt eine fokussierte Request-Tabelle mit nachvollziehbarem Zustand an', async () => {
    await insert('anfrage@example.test');
    expect(await env.DB.prepare(
      `SELECT name, email_normalized, status, processed_at, customer_id, rejection_note
         FROM customer_account_requests`,
    ).first()).toEqual({
      name: 'Fiktive Konditorei',
      email_normalized: 'anfrage@example.test',
      status: 'pending',
      processed_at: null,
      customer_id: null,
      rejection_note: null,
    });
  });

  it('erlaubt nur eine offene Anfrage je normalisierter E-Mail', async () => {
    await insert('anfrage@example.test');
    await expect(insert('anfrage@example.test')).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it('erlaubt nach einer bearbeiteten Anfrage eine neue offene Anfrage', async () => {
    await insert('anfrage@example.test', 'rejected');
    await expect(insert('anfrage@example.test')).resolves.toBeDefined();
  });

  it('weist unbekannte Statuswerte und unnormalisierte E-Mails ab', async () => {
    await expect(insert('anfrage@example.test', 'approved')).rejects.toThrow(/CHECK constraint failed/i);
    await expect(insert(' Anfrage@Example.Test ')).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('verknüpft Konvertierungen nur mit existierenden Kunden', async () => {
    await insert('anfrage@example.test');
    const request = await env.DB.prepare('SELECT id FROM customer_account_requests').first<{ id: number }>();
    await expect(env.DB.prepare(
      `UPDATE customer_account_requests
          SET status = 'converted', processed_at = ?, customer_id = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(NOW, 999999, NOW, request!.id).run()).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });
});
