import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { placeOrder } from '../../src/application/place-order';
import { findOrderByNumber } from '../../src/infrastructure/d1/order-repository';
import { ValidationError } from '../../src/domain/errors';
import { GASTRO, PRICING_TABLES, changeCatalogPrice, assignPriceGroup, priceProduct, resetPriceLists } from '../support/pricing';

const NOW = new Date('2026-08-23T07:00:00Z');

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);
  const ts = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Beispielcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Ehemaliges Beispielcafé', 0, 'pickup', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispielkuchen A', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Beispielkuchen B', 280, 'Blech', 1, 20, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (9, 'Saisonartikel E', 350, 'Stück', 0, 50, ?1, ?1)`,
    ).bind(ts),
  ]);

  // Phase 5C: Preise stehen in der Preisliste des Kunden, nicht am Produkt.
  await priceProduct(env.DB, { productId: 1, gastro: 435 });
  await priceProduct(env.DB, { productId: 2, gastro: 280 });
  await priceProduct(env.DB, { productId: 9, gastro: 350 });
  const { results } = await env.DB.prepare('SELECT id FROM customers').all<{ id: number }>();
  for (const row of results) {
    await assignPriceGroup(env.DB, row.id, GASTRO);
  }
});

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fulfillment_type: 'delivery',
    fulfillment_date: '2026-08-28',
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
}

describe('placeOrder', () => {
  it('legt eine Bestellung an und speichert sie', async () => {
    const order = await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });

    expect(order.orderNumber.value).toBe('BUS-2026-000001');
    expect(order.total().cents).toBe(1305);

    const stored = await findOrderByNumber(env.DB, 'BUS-2026-000001');
    expect(stored?.total().cents).toBe(1305);
    expect(stored?.customerNameSnapshot).toBe('Beispielcafé Nord');
  });

  it('vergibt fortlaufende Bestellnummern', async () => {
    const first = await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });
    const second = await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });
    expect(first.orderNumber.value).toBe('BUS-2026-000001');
    expect(second.orderNumber.value).toBe('BUS-2026-000002');
  });

  /**
   * Regel 7 und 11 gegen eine echte Datenbank. Der Client sendet Preise mit,
   * die um den Faktor 435 zu niedrig sind. Was gespeichert wird, ist der
   * Preis aus der products-Tabelle — nicht, weil die Werte verworfen würden,
   * sondern weil sie nie gelesen werden.
   */
  it('ignoriert vom Client mitgesendete Preise vollständig', async () => {
    await placeOrder(env.DB, {
      customerId: 1,
      input: request({
        items: [{ product_id: 1, quantity: 3, unit_price_cents: 1, line_total_cents: 3, price: '0.01' }],
        total_amount_cents: 3,
        total: '0.03',
      }),
      now: NOW,
    });

    const row = await env.DB.prepare(
      `SELECT o.total_amount_cents, i.unit_price_cents, i.line_total_cents
         FROM orders o JOIN order_items i ON i.order_id = o.id`,
    ).first<{ total_amount_cents: number; unit_price_cents: number; line_total_cents: number }>();

    expect(row).toEqual({ total_amount_cents: 1305, unit_price_cents: 435, line_total_cents: 1305 });
  });

  /** Ein eingeschleuster Status oder eine eingeschleuste Bestellnummer wirken nicht. */
  it('lässt Status und Bestellnummer nicht einschleusen', async () => {
    const order = await placeOrder(env.DB, {
      customerId: 1,
      input: request({ status: 'completed', order_number: 'BUS-2099-999999', customer_id: 2 }),
      now: NOW,
    });

    expect(order.status).toBe('new');
    expect(order.orderNumber.value).toBe('BUS-2026-000001');
    expect(order.customerId).toBe(1);
  });

  it('lehnt inaktive Produkte ab und speichert nichts', async () => {
    await expect(
      placeOrder(env.DB, { customerId: 1, input: request({ items: [{ product_id: 9, quantity: 1 }] }), now: NOW }),
    ).rejects.toThrow(ValidationError);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('lehnt inaktive Kunden ab', async () => {
    await expect(
      placeOrder(env.DB, { customerId: 2, input: request({ fulfillment_type: 'pickup' }), now: NOW }),
    ).rejects.toThrow(ValidationError);
  });

  it('lehnt unbekannte Kunden ab', async () => {
    await expect(placeOrder(env.DB, { customerId: 999, input: request(), now: NOW })).rejects.toThrow(
      ValidationError,
    );
  });

  it('meldet fehlerhafte Eingaben mit Feldzuordnung', async () => {
    try {
      await placeOrder(env.DB, {
        customerId: 1,
        input: { fulfillment_type: 'versand', fulfillment_date: '2020-01-01', items: [] },
        now: NOW,
      });
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const errors = (e as ValidationError).errors;
      expect(errors).toHaveProperty('fulfillment_type');
      expect(errors).toHaveProperty('fulfillment_date');
      expect(errors).toHaveProperty('items');
    }
  });

  /** Regel 8 vollständig durchgespielt: bestellen, Preis ändern, erneut bestellen. */
  it('lässt eine Preisänderung nicht rückwirkend wirken', async () => {
    await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });
    await changeCatalogPrice(env.DB, 1001, GASTRO, 520);
    await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });

    const { results } = await env.DB.prepare(
      'SELECT order_number, total_amount_cents FROM orders ORDER BY order_number',
    ).all<{ order_number: string; total_amount_cents: number }>();

    expect(results).toEqual([
      { order_number: 'BUS-2026-000001', total_amount_cents: 1305 },
      { order_number: 'BUS-2026-000002', total_amount_cents: 1560 },
    ]);
  });
});

describe('Bestellnummernvergabe bei Fehlern', () => {
  /**
   * Bewusst festgehaltenes Verhalten, kein Versehen: Eine fachlich
   * abgelehnte Bestellung verbraucht ihre Nummer. Lückenlosigkeit ist eine
   * Anforderung an Rechnungsnummern, nicht an Bestellnummern.
   */
  it('verbraucht eine Nummer, wenn die fachliche Prüfung scheitert', async () => {
    await expect(
      placeOrder(env.DB, { customerId: 1, input: request({ items: [{ product_id: 9, quantity: 1 }] }), now: NOW }),
    ).rejects.toThrow(ValidationError);

    const order = await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });
    expect(order.orderNumber.value).toBe('BUS-2026-000002');
  });

  /** Eine an der EINGABE gescheiterte Bestellung fasst die Datenbank gar nicht an. */
  it('verbraucht keine Nummer, wenn schon die Eingabe fehlerhaft ist', async () => {
    await expect(
      placeOrder(env.DB, { customerId: 1, input: request({ fulfillment_date: '2020-01-01' }), now: NOW }),
    ).rejects.toThrow(ValidationError);

    const sequences = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_number_sequences').first<{ n: number }>();
    expect(sequences?.n).toBe(0);

    const order = await placeOrder(env.DB, { customerId: 1, input: request(), now: NOW });
    expect(order.orderNumber.value).toBe('BUS-2026-000001');
  });
});
