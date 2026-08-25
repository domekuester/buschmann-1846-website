import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { changeOrderStatus } from '../../src/application/change-order-status';
import { ORDER_STATUSES, canTransitionTo, type OrderStatus } from '../../src/domain/order-status';
import { OrderNumber } from '../../src/domain/order-number';
import { updateOrderStatus } from '../../src/infrastructure/d1/order-repository';

/**
 * Der Statuswechsel gegen eine echte D1 — ohne HTTP, ohne Sitzung, ohne
 * Rolle.
 *
 * Diese Datei beantwortet zwei Fragen, und beide sind fachlich:
 *
 *   WAS ÄNDERT SICH? Genau zwei Spalten. Der Rest der Bestellung ist ein
 *   Dokument und bleibt es — Snapshots, Preise, Positionen, Zeitpunkt der
 *   Anlage.
 *
 *   WER ENTSCHEIDET? canTransitionTo() aus der Domäne und nichts sonst. Diese
 *   Datei schreibt keine eigene Übergangstabelle auf; sie liest die
 *   vorhandene und prüft, dass der Anwendungsfall ihr folgt.
 *
 * WER FRAGEN DARF, steht in tests/http/admin-order-status.test.ts. Die
 * Trennung ist dieselbe wie bei place-cafe-order: Ein Anwendungsfall, der
 * seine eigene Autorisierung mitbrächte, hätte sie an zwei Stellen.
 *
 * Alle Daten sind fiktiv.
 */

const ANGELEGT = '2026-08-20T06:00:00.000Z';
const JETZT = new Date('2026-08-25T09:30:00.000Z');
const NUMMER = 'BUS-2026-000042';
const TAG = '2026-08-26';

function nummer(value = NUMMER): OrderNumber {
  return OrderNumber.fromString(value);
}

async function bestellung(status: OrderStatus = 'new'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, submission_id, created_at, updated_at)
     VALUES (42, ?1, 1, 'Testcafé Nord', 'delivery', ?2, 'Beispielweg 1, 40213 Düsseldorf',
             'Bitte vor acht', ?3, 1740, 'sub-testfall-0001', ?4, ?4)`,
  )
    .bind(NUMMER, TAG, status, ANGELEGT)
    .run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (42, 1, 'Beispiel Käsekuchen', 'Stück', 435, 4, 1740)`,
  ).run();
}

/** Die Bestellzeile, wie sie in D1 steht — ohne Umweg über die Domäne. */
async function zeile(): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE order_number = ?`)
    .bind(NUMMER)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error('Bestellung fehlt im Testaufbau');
  return row;
}

async function positionen(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM order_items WHERE order_id = 42 ORDER BY id`,
  ).all<Record<string, unknown>>();
  return results;
}

beforeEach(async () => {
  for (const tabelle of ['order_items', 'orders', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${tabelle}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
  )
    .bind(ANGELEGT)
    .run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
  )
    .bind(ANGELEGT)
    .run();
});

describe('changeOrderStatus — der erlaubte Wechsel', () => {
  it('meldet den Wechsel und liefert die geänderte Bestellung', async () => {
    await bestellung('new');

    const ergebnis = await changeOrderStatus(env.DB, {
      orderNumber: nummer(),
      target: 'confirmed',
      now: JETZT,
    });

    expect(ergebnis.outcome).toBe('changed');
    if (ergebnis.outcome !== 'changed') return;
    expect(ergebnis.order.status).toBe('confirmed');
    expect(ergebnis.order.orderNumber.value).toBe(NUMMER);
  });

  /** Nicht das Ergebnisobjekt, sondern die Datenbank. */
  it('schreibt den Status tatsächlich nach D1', async () => {
    await bestellung('new');

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'confirmed', now: JETZT });

    expect((await zeile())['status']).toBe('confirmed');
  });

  it('setzt updated_at auf den übergebenen Zeitpunkt', async () => {
    await bestellung('new');

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'confirmed', now: JETZT });

    const nachher = await zeile();
    expect(nachher['updated_at']).toBe(JETZT.toISOString());
    expect(nachher['updated_at']).not.toBe(ANGELEGT);
  });

  /**
   * DER KERN DIESER DATEI. Eine Bestellung ist ein Dokument; ein
   * Statuswechsel ist ein Vermerk darauf und keine Neuausstellung.
   *
   * Die Liste ist ausgeschrieben und nicht aus der Zeile abgeleitet: Eine
   * spätere Spalte soll hier eine bewusste Zeile kosten.
   */
  it('lässt jede andere Spalte unangetastet', async () => {
    await bestellung('new');
    const vorher = await zeile();

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'confirmed', now: JETZT });
    const nachher = await zeile();

    for (const spalte of [
      'id',
      'order_number',
      'customer_id',
      'customer_name_snapshot',
      'fulfillment_type',
      'fulfillment_date',
      'delivery_address_snapshot',
      'note',
      'total_amount_cents',
      'submission_id',
      'created_at',
    ]) {
      expect(nachher[spalte]).toEqual(vorher[spalte]);
    }
  });

  it('lässt die Positionen samt Preis-Snapshots unverändert', async () => {
    await bestellung('new');
    const vorher = await positionen();

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'confirmed', now: JETZT });

    expect(await positionen()).toEqual(vorher);
    expect(vorher[0]?.['unit_price_cents']).toBe(435);
    expect(vorher[0]?.['line_total_cents']).toBe(1740);
  });

  it('legt keine zweite Bestellung an', async () => {
    await bestellung('new');

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'confirmed', now: JETZT });

    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe('changeOrderStatus — was nicht geht', () => {
  it('meldet eine unbekannte Bestellnummer', async () => {
    await bestellung('new');

    const ergebnis = await changeOrderStatus(env.DB, {
      orderNumber: nummer('BUS-2026-999999'),
      target: 'confirmed',
      now: JETZT,
    });

    expect(ergebnis.outcome).toBe('unknown_order');
  });

  it('lehnt einen verbotenen Übergang ab', async () => {
    await bestellung('completed');

    const ergebnis = await changeOrderStatus(env.DB, {
      orderNumber: nummer(),
      target: 'in_production',
      now: JETZT,
    });

    expect(ergebnis.outcome).toBe('invalid_transition');
  });

  it('schreibt bei einem verbotenen Übergang gar nichts', async () => {
    await bestellung('completed');
    const vorher = await zeile();

    await changeOrderStatus(env.DB, { orderNumber: nummer(), target: 'in_production', now: JETZT });

    expect(await zeile()).toEqual(vorher);
  });

  /** Derselbe Status ist kein Übergang — die Domäne kennt ihn nicht. */
  it('lehnt den Wechsel auf denselben Status ab', async () => {
    await bestellung('confirmed');

    const ergebnis = await changeOrderStatus(env.DB, {
      orderNumber: nummer(),
      target: 'confirmed',
      now: JETZT,
    });

    expect(ergebnis.outcome).toBe('invalid_transition');
  });

  /**
   * DIE PROBE DARAUF, DASS ES KEINE ZWEITE STATE MACHINE GIBT.
   *
   * Alle 25 Paare werden durchgespielt, und der ERWARTUNGSWERT kommt aus
   * canTransitionTo() selbst — nicht aus einer hier abgeschriebenen Tabelle.
   * Eine Kopie der Regel im Anwendungsfall fiele hier auf, sobald sie von der
   * Domäne abwiche; eine Kopie im Test dagegen wäre bloß eine dritte Stelle,
   * die irgendwann nachgezogen werden müsste.
   */
  it('folgt in jedem Paar genau canTransitionTo()', async () => {
    for (const von of ORDER_STATUSES) {
      for (const nach of ORDER_STATUSES) {
        await env.DB.prepare(`DELETE FROM order_items`).run();
        await env.DB.prepare(`DELETE FROM orders`).run();
        await bestellung(von);

        const ergebnis = await changeOrderStatus(env.DB, {
          orderNumber: nummer(),
          target: nach,
          now: JETZT,
        });

        expect({ von, nach, outcome: ergebnis.outcome }).toEqual({
          von,
          nach,
          outcome: canTransitionTo(von, nach) ? 'changed' : 'invalid_transition',
        });
      }
    }
  });
});

/**
 * LOST UPDATE.
 *
 * Admin A liest „bestätigt". Admin B setzt „in Produktion". Admin A schickt
 * danach seinen Wechsel ab — auf Grundlage eines Standes, den es nicht mehr
 * gibt.
 *
 * Der Schutz ist eine Bedingung im UPDATE und kein Lock: Geschrieben wird
 * nur, wenn der Ausgangsstatus noch der ist, gegen den die Domäne geprüft
 * hat. Trifft das nicht zu, ändert sich keine Zeile — und der Aufrufer
 * erfährt es, statt eine Erfolgsmeldung zu bekommen.
 */
describe('changeOrderStatus — gleichzeitige Änderungen', () => {
  it('überschreibt einen veralteten Ausgangsstatus nicht still', async () => {
    await bestellung('confirmed');

    // Genau der Fall aus dem Kommentar: A hat 'confirmed' gelesen, B hat
    // längst geschrieben. Der Aufruf steht für As verspäteten Schreibvorgang.
    const geschrieben = await updateOrderStatus(env.DB, {
      orderNumber: NUMMER,
      expectedStatus: 'new',
      newStatus: 'cancelled',
      updatedAt: JETZT.toISOString(),
    });

    expect(geschrieben).toBe(false);
    expect((await zeile())['status']).toBe('confirmed');
    expect((await zeile())['updated_at']).toBe(ANGELEGT);
  });

  it('schreibt, wenn der Ausgangsstatus noch stimmt', async () => {
    await bestellung('confirmed');

    const geschrieben = await updateOrderStatus(env.DB, {
      orderNumber: NUMMER,
      expectedStatus: 'confirmed',
      newStatus: 'in_production',
      updatedAt: JETZT.toISOString(),
    });

    expect(geschrieben).toBe(true);
    expect((await zeile())['status']).toBe('in_production');
  });

  it('meldet für eine unbekannte Bestellnummer nichts Geschriebenes', async () => {
    await bestellung('confirmed');

    const geschrieben = await updateOrderStatus(env.DB, {
      orderNumber: 'BUS-2026-999999',
      expectedStatus: 'confirmed',
      newStatus: 'in_production',
      updatedAt: JETZT.toISOString(),
    });

    expect(geschrieben).toBe(false);
  });

  /**
   * Zwei Adminbrowser, dieselbe Sekunde, dasselbe Ziel. Einer gewinnt; der
   * andere bekommt eine Ablehnung und keine Erfolgsmeldung.
   *
   * Welche der beiden Ablehnungen es wird, hängt an der Ausführungsreihenfolge
   * und ist deshalb NICHT festgeschrieben: Laufen beide Ladevorgänge vor dem
   * ersten Schreibvorgang, ist es 'conflict'; ist der zweite Aufruf langsamer,
   * liest er bereits 'confirmed' und scheitert an der Domäne. Der Test
   * besteht auf dem, was in beiden Fällen gelten muss — genau ein Wechsel.
   */
  it('lässt bei zwei gleichzeitigen Versuchen genau einen durch', async () => {
    await bestellung('new');

    const befehl = { orderNumber: nummer(), target: 'confirmed' as const, now: JETZT };
    const [a, b] = await Promise.all([
      changeOrderStatus(env.DB, befehl),
      changeOrderStatus(env.DB, befehl),
    ]);

    const erfolge = [a, b].filter((e) => e.outcome === 'changed');
    expect(erfolge).toHaveLength(1);
    expect([a, b].map((e) => e.outcome)).toContainEqual(
      expect.stringMatching(/^(conflict|invalid_transition)$/),
    );
    expect((await zeile())['status']).toBe('confirmed');
  });
});
