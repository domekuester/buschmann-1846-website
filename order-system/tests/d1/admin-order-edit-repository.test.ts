import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { findEditableOrder } from '../../src/infrastructure/d1/admin-order-edit-repository';

const NOW = '2026-09-01T06:00:00.000Z';
const SPAETER = '2026-09-01T09:30:00.000Z';
const TAG = '2026-09-04';
const NUMMER = 'BUS-2026-000001';

/**
 * Die Datenbasis der Bearbeitungsansicht.
 *
 * SIE IST DER EINE LESER, DER STORNIERTE POSITIONEN SIEHT. Jede andere
 * Abfrage auf order_items filtert sie weg, weil sie den GÜLTIGEN Stand
 * meint; diese hier beantwortet eine andere Frage — „was steht in dieser
 * Bestellung, und was stand einmal darin?".
 */

async function seed(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();

  for (const [id, name, sort] of [[1, 'New York Cheesecake Classic', 20], [2, 'Brownie', 10]] as const) {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, 2200, 'Stück', ?, 1, ?, ?)`,
    ).bind(id, name, sort, NOW, NOW).run();
  }

  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (1, ?, 1, 'Fiktives Café Nord', 'pickup', ?, 'confirmed', 11000, 'paid_cash', ?, ?, ?)`,
  ).bind(NUMMER, TAG, NOW, NOW, NOW).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, cancelled_at)
     VALUES (1, 1, 1, 'New York Cheesecake Classic', 'Stück', 2200, 5, 11000, NULL)`,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, cancelled_at)
     VALUES (2, 1, 2, 'Brownie', 'Stück', 400, 3, 1200, ?)`,
  ).bind(SPAETER).run();
}

beforeEach(async () => {
  for (const table of ['order_item_changes', 'order_items', 'orders', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seed();
});

describe('findEditableOrder', () => {
  it('liefert die Kopfdaten der Bestellung', async () => {
    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order).toMatchObject({
      id: 1,
      orderNumber: NUMMER,
      customerName: 'Fiktives Café Nord',
      fulfillmentDate: TAG,
      status: 'confirmed',
      paymentStatus: 'paid_cash',
      totalCents: 11000,
    });
  });

  it('liefert AKTIVE und STORNIERTE Positionen', async () => {
    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order?.items).toEqual([
      {
        id: 2,
        productId: 2,
        productName: 'Brownie',
        productUnit: 'Stück',
        unitPriceCents: 400,
        quantity: 3,
        lineTotalCents: 1200,
        cancelledAt: SPAETER,
      },
      {
        id: 1,
        productId: 1,
        productName: 'New York Cheesecake Classic',
        productUnit: 'Stück',
        unitPriceCents: 2200,
        quantity: 5,
        lineTotalCents: 11000,
        cancelledAt: null,
      },
    ]);
  });

  /**
   * Die Reihenfolge ist die des Sortiments (products.sort_order) — dieselbe
   * wie auf der Backliste und im Tagesüberblick. Eine Bearbeitungsansicht,
   * die die Positionen anders ordnet als jede andere Ansicht, zwingt zum
   * Suchen.
   */
  it('ordnet die Positionen nach der Sortierung des Sortiments', async () => {
    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order?.items.map((i) => i.productName)).toEqual([
      'Brownie',
      'New York Cheesecake Classic',
    ]);
  });

  /**
   * Der Name kommt aus dem SNAPSHOT der Position und nicht aus products —
   * dieselbe Regel wie überall sonst. Eine Umbenennung im Sortiment darf eine
   * bestehende Bestellung nicht rückwirkend anders aussehen lassen.
   */
  it('zeigt den Namen aus dem Snapshot, nicht den heutigen Produktnamen', async () => {
    await env.DB.prepare("UPDATE products SET name = 'Käsekuchen NEU' WHERE id = 1").run();

    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order?.items.map((i) => i.productName)).toContain('New York Cheesecake Classic');
    expect(order?.items.map((i) => i.productName)).not.toContain('Käsekuchen NEU');
  });

  /**
   * Ebenso der Preis: Steigt der Katalogpreis morgen, bleibt der
   * Positionspreis dieser Bestellung, was er war.
   */
  it('zeigt den Preis aus dem Snapshot, nicht den heutigen Katalogpreis', async () => {
    await env.DB.prepare('UPDATE products SET price_cents = 9999 WHERE id = 1').run();

    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order?.items.find((i) => i.id === 1)?.unitPriceCents).toBe(2200);
  });

  it('liefert null für eine unbekannte Bestellnummer', async () => {
    expect(await findEditableOrder(env.DB, 'BUS-2026-999999')).toBeNull();
  });

  it('liefert eine vollständig stornierte Bestellung mit ihren Positionen', async () => {
    await env.DB.prepare('UPDATE order_items SET cancelled_at = ? WHERE id = 1').bind(SPAETER).run();
    await env.DB.prepare(
      "UPDATE orders SET status = 'cancelled', total_amount_cents = 0 WHERE id = 1",
    ).run();

    const order = await findEditableOrder(env.DB, NUMMER);

    expect(order?.status).toBe('cancelled');
    expect(order?.totalCents).toBe(0);
    expect(order?.items).toHaveLength(2);
    expect(order?.items.every((i) => i.cancelledAt !== null)).toBe(true);
  });
});
