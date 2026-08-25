import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-08-25T12:00:00.000Z';

/**
 * Migration 0013 — die Zuordnung Kunde → Preisgruppe.
 *
 * Geprüft wird ausschließlich das SCHEMA: dass ein bestehender Kunde die
 * Migration ohne Zuordnung übersteht, dass eine Zuordnung nur auf eine
 * wirklich vorhandene Preisliste zeigen kann, und dass kein Löschvorgang an
 * den Preislisten einen Kunden mitnimmt oder still entkoppelt.
 */

async function seedCustomer(id: number, name = 'Fiktives Café'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (?, ?, 1, 'pickup', ?, ?)`,
  ).bind(id, name, NOW, NOW).run();
}

async function priceListId(code: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM price_lists WHERE code = ?')
    .bind(code).first<{ id: number }>();
  if (!row) throw new Error(`Preisliste ${code} fehlt`);
  return row.id;
}

async function assignment(id: number): Promise<number | null> {
  const row = await env.DB.prepare('SELECT price_list_id FROM customers WHERE id = ?')
    .bind(id).first<{ price_list_id: number | null }>();
  if (!row) throw new Error('Kunde fehlt');
  return row.price_list_id;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM customers').run();
  // Eine für diese Datei zusätzlich angelegte, deaktivierte Preisliste wieder
  // entfernen — die beiden echten aus 0012 bleiben unangetastet.
  await env.DB.prepare("DELETE FROM price_lists WHERE code = 'fixture_inaktiv'").run();
});

describe('Migration 0013 — Kunde und Preisgruppe', () => {
  it('lässt einen bestehenden Kunden ohne Zuordnung zurück', async () => {
    await seedCustomer(1);
    expect(await assignment(1)).toBeNull();
  });

  it('erfindet für bestehende Kunden keine Preisgruppe', async () => {
    await seedCustomer(1, 'Café Beispiel');
    await seedCustomer(2, 'Privatkunde Beispiel');

    const { results } = await env.DB.prepare(
      'SELECT price_list_id FROM customers',
    ).all<{ price_list_id: number | null }>();

    expect(results).toEqual([{ price_list_id: null }, { price_list_id: null }]);
  });

  it('nimmt eine Zuordnung auf eine vorhandene Preisliste an', async () => {
    await seedCustomer(1);
    const gastro = await priceListId('gastro');
    await env.DB.prepare('UPDATE customers SET price_list_id = ? WHERE id = ?')
      .bind(gastro, 1).run();

    expect(await assignment(1)).toBe(gastro);
  });

  it('lässt eine Zuordnung wieder auf NULL zurücksetzen', async () => {
    await seedCustomer(1);
    await env.DB.prepare('UPDATE customers SET price_list_id = ? WHERE id = ?')
      .bind(await priceListId('gastro'), 1).run();
    await env.DB.prepare('UPDATE customers SET price_list_id = NULL WHERE id = ?')
      .bind(1).run();

    expect(await assignment(1)).toBeNull();
  });

  it('speichert keinen Verweis auf eine nicht existierende Preisliste', async () => {
    await seedCustomer(1);
    await expect(
      env.DB.prepare('UPDATE customers SET price_list_id = 987654 WHERE id = ?').bind(1).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint/i);

    expect(await assignment(1)).toBeNull();
  });

  it('lässt eine zugeordnete Preisliste nicht löschen und erhält den Kunden', async () => {
    await seedCustomer(1);
    const gastro = await priceListId('gastro');
    await env.DB.prepare('UPDATE customers SET price_list_id = ? WHERE id = ?')
      .bind(gastro, 1).run();

    await expect(
      env.DB.prepare('DELETE FROM price_lists WHERE id = ?').bind(gastro).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint/i);

    const kunde = await env.DB.prepare('SELECT name, price_list_id FROM customers WHERE id = ?')
      .bind(1).first<{ name: string; price_list_id: number | null }>();
    expect(kunde).toEqual({ name: 'Fiktives Café', price_list_id: gastro });
  });

  it('erhält den Kunden, wenn die Beziehung selbst entfernt wird', async () => {
    await seedCustomer(1);
    await env.DB.prepare('UPDATE customers SET price_list_id = ? WHERE id = ?')
      .bind(await priceListId('private'), 1).run();
    await env.DB.prepare('UPDATE customers SET price_list_id = NULL WHERE id = ?').bind(1).run();

    const kunde = await env.DB.prepare(
      `SELECT name, contact_person, email, phone, delivery_street, delivery_postal_code,
              delivery_city, is_active, default_fulfillment, internal_note, price_list_id
         FROM customers WHERE id = ?`,
    ).bind(1).first();

    expect(kunde).toEqual({
      name: 'Fiktives Café',
      contact_person: null,
      email: null,
      phone: null,
      delivery_street: null,
      delivery_postal_code: null,
      delivery_city: null,
      is_active: 1,
      default_fulfillment: 'pickup',
      internal_note: null,
      price_list_id: null,
    });
  });

  it('lässt die bestehenden Kundenbedingungen unverändert gelten', async () => {
    await expect(env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (9, '   ', 1, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run()).rejects.toThrow(/CHECK constraint/i);

    await expect(env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (10, 'Fiktives Café', 1, 'delivery', ?, ?)`,
    ).bind(NOW, NOW).run()).rejects.toThrow(/CHECK constraint/i);
  });

  it('erlaubt auch die Zuordnung zu einer deaktivierten Preisliste im Schema', async () => {
    // Das Schema kennt keine Aktivitätsregel: Eine Preisliste kann deaktiviert
    // werden, NACHDEM Kunden ihr zugeordnet wurden, und die bestehende
    // Zuordnung darf dabei nicht still verschwinden. Ob eine inaktive Liste
    // NEU gewählt werden darf, entscheidet die Anwendung — nicht SQLite.
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_inaktiv', 'Fiktive Altpreisliste', 1, 90)`,
    ).run();
    const alt = await priceListId('fixture_inaktiv');

    await seedCustomer(1);
    await env.DB.prepare('UPDATE customers SET price_list_id = ? WHERE id = ?').bind(alt, 1).run();
    await env.DB.prepare('UPDATE price_lists SET is_active = 0 WHERE id = ?').bind(alt).run();

    expect(await assignment(1)).toBe(alt);
  });
});
