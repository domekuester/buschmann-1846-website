import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { assignCustomerPriceGroup } from '../../src/application/assign-customer-price-group';
import {
  loadAdminCustomers,
  loadAssignablePriceGroups,
} from '../../src/infrastructure/d1/customer-price-group-repository';

const NOW = '2026-08-25T12:00:00.000Z';
const LATER = new Date('2026-08-26T09:30:00.000Z');

async function seedCustomer(id: number, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, contact_person, email, phone, is_active,
                            default_fulfillment, internal_note, created_at, updated_at)
     VALUES (?, ?, 'Beispielperson', 'kontakt@beispiel.test', '0211 1234567', 1,
             'pickup', 'Fiktiver Betriebshinweis', ?, ?)`,
  ).bind(id, name, NOW, NOW).run();
}

async function assignedCode(customerId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT l.code AS code
       FROM customers c LEFT JOIN price_lists l ON l.id = c.price_list_id
      WHERE c.id = ?`,
  ).bind(customerId).first<{ code: string | null }>();
  if (!row) throw new Error('Kunde fehlt');
  return row.code;
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare("DELETE FROM price_lists WHERE code = 'fixture_alt'").run();
  await env.DB.prepare("UPDATE price_lists SET is_active = 1 WHERE code IN ('gastro', 'private')").run();

  await seedCustomer(1, 'Fiktives Café Nord');
  await seedCustomer(2, 'Fiktiver Privatkunde');
});

describe('assignCustomerPriceGroup', () => {
  it('ordnet einen Kunden einer aktiven Preisgruppe zu', async () => {
    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 1,
      priceListCode: 'gastro',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('assigned');
    expect(await assignedCode(1)).toBe('gastro');
  });

  it('setzt eine Zuordnung wieder auf „nicht zugeordnet"', async () => {
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'gastro', now: LATER });
    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 1,
      priceListCode: null,
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('assigned');
    expect(await assignedCode(1)).toBeNull();
  });

  it('speichert keine unbekannte Preisgruppe', async () => {
    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 1,
      priceListCode: 'gibt-es-nicht',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('unknown_price_group');
    expect(await assignedCode(1)).toBeNull();
  });

  it('nimmt eine deaktivierte Preisgruppe nicht als neue Zuordnung an', async () => {
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_alt', 'Fiktive Altpreisliste', 0, 90)`,
    ).run();

    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 1,
      priceListCode: 'fixture_alt',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('inactive_price_group');
    expect(await assignedCode(1)).toBeNull();
  });

  it('lässt eine bestehende Zuordnung stehen, wenn ihre Preisgruppe später deaktiviert wird', async () => {
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_alt', 'Fiktive Altpreisliste', 1, 90)`,
    ).run();
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'fixture_alt', now: LATER });
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'fixture_alt'").run();

    // Keine automatische Ersatzpreisgruppe, kein stilles Zurücksetzen.
    expect(await assignedCode(1)).toBe('fixture_alt');
    const zeilen = await loadAdminCustomers(env.DB);
    expect(zeilen.find((z) => z.id === 1)?.priceGroup).toEqual({
      code: 'fixture_alt',
      label: 'Fiktive Altpreisliste',
      isActive: false,
    });
  });

  it('lässt eine bestehende inaktive Zuordnung unverändert erneut speichern', async () => {
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_alt', 'Fiktive Altpreisliste', 1, 90)`,
    ).run();
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'fixture_alt', now: LATER });
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'fixture_alt'").run();

    // Dasselbe noch einmal zu schicken ist keine NEUE Zuordnung, sondern die
    // unveränderte Fortschreibung der bestehenden — die Kundenseite zeigt sie
    // als ausgewählt an, und ihr eigenes Formular darf nicht fehlschlagen.
    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 1,
      priceListCode: 'fixture_alt',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('assigned');
    expect(await assignedCode(1)).toBe('fixture_alt');
  });

  it('vergibt eine inaktive Preisgruppe auch dann nicht an einen anderen Kunden', async () => {
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_alt', 'Fiktive Altpreisliste', 1, 90)`,
    ).run();
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'fixture_alt', now: LATER });
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'fixture_alt'").run();

    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 2,
      priceListCode: 'fixture_alt',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('inactive_price_group');
    expect(await assignedCode(2)).toBeNull();
  });

  it('meldet einen unbekannten Kunden auch bei inaktiver Preisgruppe', async () => {
    await env.DB.prepare(
      `INSERT INTO price_lists (code, label, is_active, sort_order)
       VALUES ('fixture_alt', 'Fiktive Altpreisliste', 0, 90)`,
    ).run();

    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 987654,
      priceListCode: 'fixture_alt',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('unknown_customer');
  });

  it('meldet einen unbekannten Kunden, ohne irgendetwas zu schreiben', async () => {
    const ergebnis = await assignCustomerPriceGroup(env.DB, {
      customerId: 987654,
      priceListCode: 'gastro',
      now: LATER,
    });

    expect(ergebnis.outcome).toBe('unknown_customer');
    expect(await assignedCode(1)).toBeNull();
    expect(await assignedCode(2)).toBeNull();
  });

  it('betrifft ausschließlich den adressierten Kunden', async () => {
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'gastro', now: LATER });

    expect(await assignedCode(1)).toBe('gastro');
    expect(await assignedCode(2)).toBeNull();
  });

  it('lässt alle übrigen Kundenfelder unverändert und führt updated_at nach', async () => {
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'gastro', now: LATER });

    const kunde = await env.DB.prepare(
      `SELECT name, contact_person, email, phone, is_active, default_fulfillment,
              internal_note, created_at, updated_at
         FROM customers WHERE id = 1`,
    ).first();

    expect(kunde).toEqual({
      name: 'Fiktives Café Nord',
      contact_person: 'Beispielperson',
      email: 'kontakt@beispiel.test',
      phone: '0211 1234567',
      is_active: 1,
      default_fulfillment: 'pickup',
      internal_note: 'Fiktiver Betriebshinweis',
      created_at: NOW,
      updated_at: LATER.toISOString(),
    });
  });

  it('rührt weder Bestellungen noch Katalogpreise an', async () => {
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café Nord', 'pickup', '2026-08-27', 'new', 2100, ?, ?)`,
    ).bind(NOW, NOW).run();

    const vorher = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM orders) AS orders,
              (SELECT total_amount_cents FROM orders WHERE id = 1) AS summe,
              (SELECT COUNT(*) FROM catalog_product_prices) AS preise`,
    ).first();

    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'gastro', now: LATER });

    const nachher = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM orders) AS orders,
              (SELECT total_amount_cents FROM orders WHERE id = 1) AS summe,
              (SELECT COUNT(*) FROM catalog_product_prices) AS preise`,
    ).first();

    expect(nachher).toEqual(vorher);
  });

  it('leitet aus dem Kundennamen keine Preisgruppe ab', async () => {
    await seedCustomer(3, 'Café Beispiel Gastronomie');
    const zeilen = await loadAdminCustomers(env.DB);

    expect(zeilen.map((z) => z.priceGroup)).toEqual([null, null, null]);
  });
});

describe('loadAdminCustomers', () => {
  it('nennt Kunde, Zuordnung und sonst nichts', async () => {
    await assignCustomerPriceGroup(env.DB, { customerId: 1, priceListCode: 'gastro', now: LATER });
    const zeilen = await loadAdminCustomers(env.DB);

    // Alphabetisch: 'Fiktiver …' steht vor 'Fiktives …'.
    expect(zeilen).toEqual([
      { id: 2, name: 'Fiktiver Privatkunde', isActive: true, priceGroup: null },
      {
        id: 1,
        name: 'Fiktives Café Nord',
        isActive: true,
        priceGroup: { code: 'gastro', label: 'Gastronomie', isActive: true },
      },
    ]);
  });

  it('sortiert alphabetisch nach Kundenname', async () => {
    await seedCustomer(3, 'Aachener Fiktivcafé');
    const namen = (await loadAdminCustomers(env.DB)).map((z) => z.name);

    expect(namen).toEqual(['Aachener Fiktivcafé', 'Fiktiver Privatkunde', 'Fiktives Café Nord']);
  });

  it('zeigt auch deaktivierte Kunden, damit ihre Zuordnung pflegbar bleibt', async () => {
    await env.DB.prepare('UPDATE customers SET is_active = 0 WHERE id = 2').run();
    const zeilen = await loadAdminCustomers(env.DB);

    expect(zeilen.find((z) => z.id === 2)?.isActive).toBe(false);
  });
});

describe('loadAssignablePriceGroups', () => {
  it('bietet die aktiven Preisgruppen in ihrer fachlichen Reihenfolge an', async () => {
    expect(await loadAssignablePriceGroups(env.DB)).toEqual([
      { code: 'gastro', label: 'Gastronomie' },
      { code: 'private', label: 'Privatkunden' },
    ]);
  });

  it('bietet eine deaktivierte Preisgruppe nicht zur Auswahl an', async () => {
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'private'").run();

    expect(await loadAssignablePriceGroups(env.DB)).toEqual([
      { code: 'gastro', label: 'Gastronomie' },
    ]);
  });
});
