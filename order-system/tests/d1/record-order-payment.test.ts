import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordOrderPayment } from '../../src/application/record-order-payment';
import { OrderNumber } from '../../src/domain/order-number';

const NOW = '2026-08-25T12:00:00.000Z';
const SPAETER = new Date('2026-08-25T16:45:00.000Z');
const TAG = '2026-08-28';
const NUMMER = 'BUS-2026-000001';

async function seedOrder(orderNumber = NUMMER, status = 'new'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, 4350, ?, ?)`,
  ).bind(orderNumber, TAG, status, NOW, NOW).run();
}

async function zeile(orderNumber = NUMMER): Promise<{
  payment_status: string;
  payment_recorded_at: string | null;
  status: string;
  updated_at: string;
  total_amount_cents: number;
}> {
  const row = await env.DB.prepare(
    `SELECT payment_status, payment_recorded_at, status, updated_at, total_amount_cents
       FROM orders WHERE order_number = ?`,
  ).bind(orderNumber).first<{
    payment_status: string;
    payment_recorded_at: string | null;
    status: string;
    updated_at: string;
    total_amount_cents: number;
  }>();
  if (!row) throw new Error('Bestellung fehlt');
  return row;
}

function nummer(value = NUMMER): OrderNumber {
  const parsed = OrderNumber.parse(value);
  if (parsed === null) throw new Error('Testbestellnummer ungültig');
  return parsed;
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
});

describe('recordOrderPayment', () => {
  it('trägt eine Barzahlung mit Zeitpunkt ein', async () => {
    await seedOrder();

    const ergebnis = await recordOrderPayment(env.DB, {
      orderNumber: nummer(),
      target: 'paid_cash',
      now: SPAETER,
    });

    expect(ergebnis).toEqual({ outcome: 'recorded', fulfillmentDate: TAG });
    const row = await zeile();
    expect(row.payment_status).toBe('paid_cash');
    expect(row.payment_recorded_at).toBe('2026-08-25T16:45:00.000Z');
  });

  it('nimmt für jede Zahlart denselben Weg', async () => {
    for (const [index, zahlart] of (['paid_cash', 'paid_card', 'paid_bank', 'paid_other'] as const).entries()) {
      const n = `BUS-2026-00000${index + 1}`;
      await seedOrder(n);
      const ergebnis = await recordOrderPayment(env.DB, {
        orderNumber: nummer(n),
        target: zahlart,
        now: SPAETER,
      });

      expect(ergebnis.outcome).toBe('recorded');
      expect((await zeile(n)).payment_status).toBe(zahlart);
    }
  });

  it('löscht den Zeitpunkt beim Zurücksetzen auf offen', async () => {
    await seedOrder();
    await recordOrderPayment(env.DB, { orderNumber: nummer(), target: 'paid_card', now: SPAETER });

    await recordOrderPayment(env.DB, { orderNumber: nummer(), target: 'unpaid', now: SPAETER });

    expect(await zeile()).toMatchObject({ payment_status: 'unpaid', payment_recorded_at: null });
  });

  it('aktualisiert den Zeitpunkt beim Wechsel der Zahlart', async () => {
    await seedOrder();
    await recordOrderPayment(env.DB, {
      orderNumber: nummer(),
      target: 'paid_cash',
      now: new Date('2026-08-25T08:00:00.000Z'),
    });

    await recordOrderPayment(env.DB, { orderNumber: nummer(), target: 'paid_card', now: SPAETER });

    const row = await zeile();
    expect(row.payment_status).toBe('paid_card');
    expect(row.payment_recorded_at).toBe('2026-08-25T16:45:00.000Z');
  });

  it('meldet eine unbekannte Bestellung, ohne etwas zu schreiben', async () => {
    const ergebnis = await recordOrderPayment(env.DB, {
      orderNumber: nummer('BUS-2026-999999'),
      target: 'paid_cash',
      now: SPAETER,
    });

    expect(ergebnis).toEqual({ outcome: 'unknown_order' });
  });

  it('lässt eine abgeschlossene Bestellung als offen stehen', async () => {
    await seedOrder(NUMMER, 'completed');

    const ergebnis = await recordOrderPayment(env.DB, {
      orderNumber: nummer(),
      target: 'unpaid',
      now: SPAETER,
    });

    expect(ergebnis.outcome).toBe('recorded');
    expect(await zeile()).toMatchObject({ status: 'completed', payment_status: 'unpaid' });
  });

  it('trägt eine Zahlung auch für eine stornierte Bestellung ein', async () => {
    await seedOrder(NUMMER, 'cancelled');

    const ergebnis = await recordOrderPayment(env.DB, {
      orderNumber: nummer(),
      target: 'paid_bank',
      now: SPAETER,
    });

    expect(ergebnis.outcome).toBe('recorded');
    expect((await zeile()).status).toBe('cancelled');
  });

  it('ändert weder Produktionsstatus noch Betrag', async () => {
    await seedOrder(NUMMER, 'in_production');

    await recordOrderPayment(env.DB, { orderNumber: nummer(), target: 'paid_cash', now: SPAETER });

    const row = await zeile();
    expect(row.status).toBe('in_production');
    expect(row.total_amount_cents).toBe(4350);
  });

  it('schreibt den technischen Änderungszeitpunkt fort', async () => {
    await seedOrder();

    await recordOrderPayment(env.DB, { orderNumber: nummer(), target: 'paid_cash', now: SPAETER });

    expect((await zeile()).updated_at).toBe('2026-08-25T16:45:00.000Z');
  });

  it('fasst nur die genannte Bestellung an', async () => {
    await seedOrder('BUS-2026-000001');
    await seedOrder('BUS-2026-000002');

    await recordOrderPayment(env.DB, {
      orderNumber: nummer('BUS-2026-000001'),
      target: 'paid_cash',
      now: SPAETER,
    });

    expect((await zeile('BUS-2026-000002')).payment_status).toBe('unpaid');
  });
});
