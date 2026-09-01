import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelOrderItem,
  changeOrderItemQuantities,
} from '../../src/application/edit-order-item';
import { OrderNumber } from '../../src/domain/order-number';
import { findEditableOrder } from '../../src/infrastructure/d1/admin-order-edit-repository';
import { findOrderByNumber } from '../../src/infrastructure/d1/order-repository';
import { findProductionOrders } from '../../src/infrastructure/d1/production-day-repository';

const ERSTELLT = '2026-09-01T06:00:00.000Z';
const JETZT = new Date('2026-09-01T09:30:00.000Z');
const JETZT_ISO = '2026-09-01T09:30:00.000Z';
const TAG = '2026-09-04';
const NUMMER = OrderNumber.parse('BUS-2026-000001')!;
const ADMIN = 7;

/**
 * „Setze diese Position auf jene Menge" und „storniere diese Position".
 *
 * Die beiden schreibenden Vorgänge der Positionsbearbeitung — und die Datei,
 * in der geprüft wird, was sie NICHT tun: keinen Preis neu ermitteln, keine
 * Zeile löschen, keinen Zahlungsstand versöhnen, keine Historie überschreiben.
 */

async function seed(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(ERSTELLT, ERSTELLT).run();

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, credential_algorithm,
                                credential_iterations, credential_salt, credential_verifier,
                                is_active, failed_attempts, created_at, updated_at)
     VALUES (?, 'claudia', 'admin', 'pbkdf2-sha256', 600000, ?, ?, 1, 0, ?, ?)`,
  ).bind(ADMIN, 'a'.repeat(32), 'b'.repeat(64), ERSTELLT, ERSTELLT).run();

  for (const [id, name, sort] of [[1, 'New York Cheesecake Classic', 10], [2, 'Brownie', 20]] as const) {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, 2200, 'Stück', ?, 1, ?, ?)`,
    ).bind(id, name, sort, ERSTELLT, ERSTELLT).run();
  }

  // 5 × 22,00 € + 3 × 4,00 € = 122,00 €
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (1, ?, 1, 'Fiktives Café Nord', 'pickup', ?, 'confirmed', 12200, ?, ?)`,
  ).bind(NUMMER.value, TAG, ERSTELLT, ERSTELLT).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
     VALUES (1, 1, 1, 'New York Cheesecake Classic', 'Stück', 2200, 5, 11000, 900)`,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
     VALUES (2, 1, 2, 'Brownie', 'Stück', 400, 3, 1200, 150)`,
  ).run();
}

/** Der Stand, gegen den optimistisch geschrieben wird. */
async function version(): Promise<string> {
  const row = await env.DB.prepare('SELECT updated_at FROM orders WHERE id = 1')
    .first<{ updated_at: string }>();
  return row!.updated_at;
}

async function spuren(): Promise<
  readonly {
    order_item_id: number;
    change_type: string;
    previous_quantity: number;
    new_quantity: number | null;
    changed_at: string;
    changed_by_account_id: number | null;
  }[]
> {
  const { results } = await env.DB.prepare(
    `SELECT order_item_id, change_type, previous_quantity, new_quantity, changed_at,
            changed_by_account_id
       FROM order_item_changes ORDER BY id`,
  ).all<never>();
  return results as never;
}

async function menge(itemId: number): Promise<{ quantity: number; line_total_cents: number; cancelled_at: string | null }> {
  const row = await env.DB.prepare(
    'SELECT quantity, line_total_cents, cancelled_at FROM order_items WHERE id = ?',
  ).bind(itemId).first<{ quantity: number; line_total_cents: number; cancelled_at: string | null }>();
  return row!;
}

async function bestellung(): Promise<{ status: string; total_amount_cents: number; payment_status: string }> {
  const row = await env.DB.prepare(
    'SELECT status, total_amount_cents, payment_status FROM orders WHERE id = 1',
  ).first<{ status: string; total_amount_cents: number; payment_status: string }>();
  return row!;
}

beforeEach(async () => {
  for (const table of ['order_item_changes', 'order_items', 'orders', 'products', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seed();
});

describe('changeOrderItemQuantities — Menge verringern', () => {
  it('setzt 5 auf 3', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }, { id: 2, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis.outcome).toBe('saved');
    expect(await menge(1)).toEqual({ quantity: 3, line_total_cents: 6600, cancelled_at: null });
  });

  /**
   * DER PREIS-SNAPSHOT BLEIBT MASSGEBLICH. 3 × 22,00 € = 66,00 €, und zwar
   * auch dann, wenn der Katalogpreis inzwischen ein anderer ist. Der neue
   * Positionsbetrag wird in SQL aus unit_price_cents DERSELBEN ZEILE
   * gerechnet — es gibt in dieser Anweisung keinen Weg zu einem anderen Preis.
   */
  it('rechnet mit dem Preis-Snapshot und nicht mit dem heutigen Katalogpreis', async () => {
    await env.DB.prepare('UPDATE products SET price_cents = 9999 WHERE id = 1').run();

    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect((await menge(1)).line_total_cents).toBe(6600);
  });

  it('schreibt den neuen Gesamtbetrag der Bestellung fort', async () => {
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    // 3 × 22,00 € + 3 × 4,00 € = 78,00 €
    expect((await bestellung()).total_amount_cents).toBe(7800);
  });

  it('meldet den neuen Gesamtbetrag zurück', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toMatchObject({ outcome: 'saved', newTotalCents: 7800, orderCancelled: false });
  });

  it('hinterlässt eine Spur mit vorheriger Menge, neuer Menge, Zeitpunkt und Person', async () => {
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(await spuren()).toEqual([
      {
        order_item_id: 1,
        change_type: 'quantity_changed',
        previous_quantity: 5,
        new_quantity: 3,
        changed_at: JETZT_ISO,
        changed_by_account_id: ADMIN,
      },
    ]);
  });
});

describe('changeOrderItemQuantities — Menge erhöhen', () => {
  it('setzt 3 auf 5', async () => {
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 2, quantity: '5' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(await menge(2)).toEqual({ quantity: 5, line_total_cents: 2000, cancelled_at: null });
    expect((await bestellung()).total_amount_cents).toBe(13000);
  });
});

describe('changeOrderItemQuantities — Ablehnungen', () => {
  it('lehnt die Menge 0 ab und schreibt nichts', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '0' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'invalid_quantity', fulfillmentDate: TAG });
    expect((await menge(1)).quantity).toBe(5);
    expect(await spuren()).toEqual([]);
  });

  it('lehnt eine negative und eine gebrochene Menge ab', async () => {
    for (const unsinn of ['-1', '2.5', 'drei', '']) {
      const ergebnis = await changeOrderItemQuantities(env.DB, {
        orderNumber: NUMMER,
        requested: [{ id: 1, quantity: unsinn }],
        expectedVersion: await version(),
        now: JETZT,
        actorAccountId: ADMIN,
      });
      expect(ergebnis.outcome).toBe('invalid_quantity');
    }
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt eine unplausibel hohe Menge ab', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '10000' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis.outcome).toBe('invalid_quantity');
  });

  it('lehnt eine unbekannte Bestellung ab', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: OrderNumber.parse('BUS-2026-999999')!,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: 'egal',
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'unknown_order' });
  });

  it('lehnt eine Position ab, die zu einer anderen Bestellung gehört', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 4711, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'unknown_item', fulfillmentDate: TAG });
  });

  /**
   * DIE STATUSREGEL — sie steht in der Domäne und wird hier nur gefragt.
   */
  it('lehnt jede Bestellung ab, die nicht mehr bearbeitbar ist', async () => {
    for (const status of ['in_production', 'completed', 'cancelled']) {
      await env.DB.prepare('UPDATE orders SET status = ? WHERE id = 1').bind(status).run();

      const ergebnis = await changeOrderItemQuantities(env.DB, {
        orderNumber: NUMMER,
        requested: [{ id: 1, quantity: '3' }],
        expectedVersion: await version(),
        now: JETZT,
        actorAccountId: ADMIN,
      });

      expect(ergebnis).toEqual({ outcome: 'not_editable', fulfillmentDate: TAG });
      expect((await menge(1)).quantity).toBe(5);
    }
  });

  it('erlaubt die Bearbeitung einer neuen Bestellung', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'new' WHERE id = 1").run();

    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis.outcome).toBe('saved');
    expect((await bestellung()).status).toBe('new');
  });

  it('meldet „unverändert", wenn das Formular nichts ändert', async () => {
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '5' }, { id: 2, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'unchanged', fulfillmentDate: TAG });
    expect(await spuren()).toEqual([]);
  });

  /**
   * DER VERLORENE SCHREIBVORGANG — der Fall, für den die Versionsprüfung da
   * ist. Zwischen dem Anzeigen der Seite und dem Absenden hat ein zweiter
   * Admin dieselbe Bestellung geändert.
   *
   * ES DARF DABEI NICHT DIE HÄLFTE GESCHRIEBEN WERDEN. Beide Positionen, die
   * Spur und der Gesamtbetrag hängen an derselben Bedingung; ist sie nicht
   * mehr erfüllt, geschieht gar nichts.
   */
  it('lehnt einen veralteten Stand ab und schreibt keine einzige Zeile', async () => {
    const veraltet = await version();
    await env.DB.prepare('UPDATE orders SET updated_at = ? WHERE id = 1')
      .bind('2026-09-01T08:00:00.000Z').run();

    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }, { id: 2, quantity: '1' }],
      expectedVersion: veraltet,
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'conflict', fulfillmentDate: TAG });
    expect((await menge(1)).quantity).toBe(5);
    expect((await menge(2)).quantity).toBe(3);
    expect((await bestellung()).total_amount_cents).toBe(12200);
    expect(await spuren()).toEqual([]);
  });
});

describe('cancelOrderItem', () => {
  it('storniert eine Position, ohne sie zu löschen', async () => {
    const ergebnis = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis.outcome).toBe('saved');
    expect(await menge(2)).toEqual({
      quantity: 3,
      line_total_cents: 1200,
      cancelled_at: JETZT_ISO,
    });
  });

  it('lässt die übrigen Positionen unberührt', async () => {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(await menge(1)).toEqual({ quantity: 5, line_total_cents: 11000, cancelled_at: null });
  });

  it('zieht den Gesamtbetrag der Bestellung nach', async () => {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect((await bestellung()).total_amount_cents).toBe(11000);
  });

  it('nimmt die stornierte Position aus der Produktion', async () => {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    const [order] = await findProductionOrders(env.DB, TAG);
    expect(order?.items.map((i) => i.productName)).toEqual(['New York Cheesecake Classic']);
  });

  it('hinterlässt eine Spur mit der ursprünglichen Menge und ohne neue Menge', async () => {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(await spuren()).toEqual([
      {
        order_item_id: 2,
        change_type: 'item_cancelled',
        previous_quantity: 3,
        new_quantity: null,
        changed_at: JETZT_ISO,
        changed_by_account_id: ADMIN,
      },
    ]);
  });

  it('bleibt bei wiederholter Stornierung folgenlos', async () => {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    const zweiter = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: new Date('2026-09-01T10:00:00.000Z'),
      actorAccountId: ADMIN,
    });

    expect(zweiter).toEqual({ outcome: 'already_cancelled', fulfillmentDate: TAG });
    expect((await menge(2)).cancelled_at).toBe(JETZT_ISO);
    expect(await spuren()).toHaveLength(1);
  });

  it('lehnt eine Position ab, die zu einer anderen Bestellung gehört', async () => {
    const ergebnis = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 4711,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'unknown_item', fulfillmentDate: TAG });
  });

  it('lehnt eine Bestellung ab, die nicht mehr bearbeitbar ist', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'in_production' WHERE id = 1").run();

    const ergebnis = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'not_editable', fulfillmentDate: TAG });
    expect((await menge(2)).cancelled_at).toBeNull();
  });

  it('lehnt einen veralteten Stand ab und schreibt nichts', async () => {
    const veraltet = await version();
    await env.DB.prepare('UPDATE orders SET updated_at = ? WHERE id = 1')
      .bind('2026-09-01T08:00:00.000Z').run();

    const ergebnis = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: veraltet,
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toEqual({ outcome: 'conflict', fulfillmentDate: TAG });
    expect((await menge(2)).cancelled_at).toBeNull();
    expect(await spuren()).toEqual([]);
  });
});

describe('cancelOrderItem — die letzte Position', () => {
  async function storniereBeide(): Promise<{ outcome: string }> {
    await cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 2,
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });
    return cancelOrderItem(env.DB, {
      orderNumber: NUMMER,
      orderItemId: 1,
      expectedVersion: await version(),
      now: new Date('2026-09-01T10:00:00.000Z'),
      actorAccountId: ADMIN,
    });
  }

  /**
   * Wird die letzte aktive Position storniert, folgt die BESTELLUNG in den
   * Storno-Zustand — über denselben Statusweg wie jede andere Stornierung.
   */
  it('führt die Bestellung selbst in den Storno-Zustand', async () => {
    await storniereBeide();

    expect((await bestellung()).status).toBe('cancelled');
  });

  it('meldet die Stornierung der Bestellung zurück', async () => {
    const ergebnis = await storniereBeide();

    expect(ergebnis).toMatchObject({ outcome: 'saved', orderCancelled: true, newTotalCents: 0 });
  });

  it('schreibt den Statuswechsel in dieselben Auditfelder wie jeder andere', async () => {
    await storniereBeide();

    const row = await env.DB.prepare(
      'SELECT status_changed_by_account_id, status_changed_at FROM orders WHERE id = 1',
    ).first<{ status_changed_by_account_id: number | null; status_changed_at: string | null }>();

    expect(row).toEqual({
      status_changed_by_account_id: ADMIN,
      status_changed_at: '2026-09-01T10:00:00.000Z',
    });
  });

  it('lässt die so stornierte Bestellung weiterhin lesen', async () => {
    await storniereBeide();

    const order = await findOrderByNumber(env.DB, NUMMER.value);
    expect(order?.status).toBe('cancelled');
    expect(order?.total().cents).toBe(0);
  });

  it('zeigt in der Bearbeitungsansicht weiterhin beide Positionen', async () => {
    await storniereBeide();

    const order = await findEditableOrder(env.DB, NUMMER.value);
    expect(order?.items).toHaveLength(2);
    expect(order?.items.every((i) => i.cancelledAt !== null)).toBe(true);
  });

  it('nimmt die Bestellung vollständig aus der Produktion', async () => {
    await storniereBeide();

    expect(await findProductionOrders(env.DB, TAG)).toEqual([]);
  });

  it('rührt den Zahlungsstand nicht an', async () => {
    await env.DB.prepare(
      "UPDATE orders SET payment_status = 'paid_cash', payment_recorded_at = ? WHERE id = 1",
    ).bind(ERSTELLT).run();

    await storniereBeide();

    expect((await bestellung()).payment_status).toBe('paid_cash');
  });
});

describe('bezahlte Bestellungen', () => {
  it('lässt die Änderung zu und verändert den Zahlungsstand nicht', async () => {
    await env.DB.prepare(
      "UPDATE orders SET payment_status = 'paid_bank', payment_recorded_at = ? WHERE id = 1",
    ).bind(ERSTELLT).run();

    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER,
      requested: [{ id: 1, quantity: '3' }],
      expectedVersion: await version(),
      now: JETZT,
      actorAccountId: ADMIN,
    });

    expect(ergebnis).toMatchObject({ outcome: 'saved', newTotalCents: 7800 });
    expect((await bestellung()).payment_status).toBe('paid_bank');

    const row = await env.DB.prepare('SELECT payment_recorded_at FROM orders WHERE id = 1')
      .first<{ payment_recorded_at: string | null }>();
    expect(row?.payment_recorded_at).toBe(ERSTELLT);
  });
});
