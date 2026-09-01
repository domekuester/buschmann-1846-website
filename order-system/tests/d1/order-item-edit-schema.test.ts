import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-09-01T12:00:00.000Z';

/**
 * Migration 0022 — die Bearbeitung einzelner Bestellpositionen.
 *
 * Geprüft wird ausschließlich das SCHEMA: dass eine Position storniert werden
 * kann, ohne gelöscht zu werden, dass jede Änderung eine Spur hinterlässt, und
 * dass die Datenbank eine Spur ohne Aussage gar nicht erst annimmt.
 *
 * DIE HISTORIE IST DER KERN DIESER DATEI. „5 → 3" darf nicht so aussehen, als
 * habe der Kunde von Anfang an 3 bestellt. Die Regel steht deshalb nicht nur
 * im Anwendungscode, sondern in den CHECK-Bedingungen — sie gilt auch für die
 * Konsole und für jedes Wartungsskript.
 */

async function seedCustomer(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
}

async function seedProduct(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, sort_order, is_active, created_at, updated_at)
     VALUES (1, 'New York Cheesecake Classic', 2200, 'Stück', 10, 1, ?, ?)`,
  ).bind(NOW, NOW).run();
}

async function seedOrderWithItem(): Promise<number> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café Nord', 'pickup', '2026-09-04', 'confirmed', 11000, ?, ?)`,
  ).bind(NOW, NOW).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (1, 1, 1, 'New York Cheesecake Classic', 'Stück', 2200, 5, 11000)`,
  ).run();

  return 1;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM order_item_changes').run();
  await env.DB.prepare('DELETE FROM order_items').run();
  await env.DB.prepare('DELETE FROM orders').run();
  await env.DB.prepare('DELETE FROM products').run();
  await env.DB.prepare('DELETE FROM customers').run();
  await seedCustomer();
  await seedProduct();
});

describe('Migration 0022 — Positionen bearbeiten und stornieren', () => {
  it('legt jede bestehende Position als AKTIV an', async () => {
    await seedOrderWithItem();

    const row = await env.DB.prepare('SELECT cancelled_at FROM order_items WHERE id = 1')
      .first<{ cancelled_at: string | null }>();

    expect(row?.cancelled_at).toBeNull();
  });

  it('storniert eine Position, ohne sie zu löschen', async () => {
    await seedOrderWithItem();

    await env.DB.prepare('UPDATE order_items SET cancelled_at = ? WHERE id = 1').bind(NOW).run();

    const row = await env.DB.prepare(
      'SELECT quantity, unit_price_cents, line_total_cents, cancelled_at FROM order_items WHERE id = 1',
    ).first<{
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
      cancelled_at: string | null;
    }>();

    // Menge, Preis und Betrag der stornierten Position bleiben unverändert
    // stehen — sie sind die Auskunft darüber, was einmal bestellt war.
    expect(row).toEqual({
      quantity: 5,
      unit_price_cents: 2200,
      line_total_cents: 11000,
      cancelled_at: NOW,
    });
  });

  it('nimmt eine Mengenänderung mit vorheriger und neuer Menge an', async () => {
    await seedOrderWithItem();

    await env.DB.prepare(
      `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                       new_quantity, changed_at, changed_by_account_id)
       VALUES (1, 1, 'quantity_changed', 5, 3, ?, NULL)`,
    ).bind(NOW).run();

    const row = await env.DB.prepare(
      'SELECT previous_quantity, new_quantity, change_type FROM order_item_changes WHERE order_item_id = 1',
    ).first<{ previous_quantity: number; new_quantity: number | null; change_type: string }>();

    expect(row).toEqual({ previous_quantity: 5, new_quantity: 3, change_type: 'quantity_changed' });
  });

  it('nimmt eine Stornierung ohne neue Menge an', async () => {
    await seedOrderWithItem();

    await env.DB.prepare(
      `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                       new_quantity, changed_at, changed_by_account_id)
       VALUES (1, 1, 'item_cancelled', 5, NULL, ?, NULL)`,
    ).bind(NOW).run();

    const row = await env.DB.prepare(
      'SELECT previous_quantity, new_quantity FROM order_item_changes WHERE order_item_id = 1',
    ).first<{ previous_quantity: number; new_quantity: number | null }>();

    expect(row).toEqual({ previous_quantity: 5, new_quantity: null });
  });

  it('lehnt eine Mengenänderung OHNE neue Menge ab', async () => {
    await seedOrderWithItem();

    await expect(
      env.DB.prepare(
        `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                         new_quantity, changed_at, changed_by_account_id)
         VALUES (1, 1, 'quantity_changed', 5, NULL, ?, NULL)`,
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('lehnt eine Stornierung MIT neuer Menge ab', async () => {
    await seedOrderWithItem();

    await expect(
      env.DB.prepare(
        `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                         new_quantity, changed_at, changed_by_account_id)
         VALUES (1, 1, 'item_cancelled', 5, 3, ?, NULL)`,
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('lehnt eine Mengenänderung ab, die nichts ändert', async () => {
    await seedOrderWithItem();

    await expect(
      env.DB.prepare(
        `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                         new_quantity, changed_at, changed_by_account_id)
         VALUES (1, 1, 'quantity_changed', 5, 5, ?, NULL)`,
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('lehnt eine erfundene Änderungsart ab', async () => {
    await seedOrderWithItem();

    await expect(
      env.DB.prepare(
        `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                         new_quantity, changed_at, changed_by_account_id)
         VALUES (1, 1, 'product_swapped', 5, 3, ?, NULL)`,
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('lehnt eine nicht positive oder gebrochene Menge ab', async () => {
    await seedOrderWithItem();

    for (const [vorher, neu] of [[0, 3], [5, 0], [5, -1], [5, 2.5]]) {
      await expect(
        env.DB.prepare(
          `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                           new_quantity, changed_at, changed_by_account_id)
           VALUES (1, 1, 'quantity_changed', ?, ?, ?, NULL)`,
        ).bind(vorher, neu, NOW).run(),
      ).rejects.toThrow();
    }
  });

  it('lehnt eine Spur zu einer Position ab, die es nicht gibt', async () => {
    await seedOrderWithItem();

    await expect(
      env.DB.prepare(
        `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                         new_quantity, changed_at, changed_by_account_id)
         VALUES (1, 4711, 'quantity_changed', 5, 3, ?, NULL)`,
      ).bind(NOW).run(),
    ).rejects.toThrow();
  });

  it('behält die Spur, wenn das auslösende Konto gelöscht wird', async () => {
    await seedOrderWithItem();
    await env.DB.prepare(
      `INSERT INTO auth_accounts (id, role, login_identifier_normalized, credential_algorithm,
                                  credential_iterations, credential_salt, credential_verifier,
                                  is_active, created_at, updated_at)
       VALUES (7, 'admin', 'claudia', 'pbkdf2-sha256', 600000, ?, ?, 1, ?, ?)`,
    ).bind('a'.repeat(32), 'b'.repeat(64), NOW, NOW).run();

    await env.DB.prepare(
      `INSERT INTO order_item_changes (order_id, order_item_id, change_type, previous_quantity,
                                       new_quantity, changed_at, changed_by_account_id)
       VALUES (1, 1, 'quantity_changed', 5, 3, ?, 7)`,
    ).bind(NOW).run();

    await env.DB.prepare('DELETE FROM auth_accounts WHERE id = 7').run();

    const row = await env.DB.prepare(
      'SELECT previous_quantity, new_quantity, changed_by_account_id FROM order_item_changes WHERE order_item_id = 1',
    ).first<{ previous_quantity: number; new_quantity: number; changed_by_account_id: number | null }>();

    // Wer es war, ist verloren. WAS geschah, bleibt.
    expect(row).toEqual({ previous_quantity: 5, new_quantity: 3, changed_by_account_id: null });
  });
});
