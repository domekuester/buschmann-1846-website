import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/domain/errors';
import { OPEN_PRODUCTION_STATUSES } from '../../src/domain/order-status';
import {
  PRODUCTION_DAY_QUERIES,
  findProductionOrders,
} from '../../src/infrastructure/d1/production-day-repository';

/**
 * Die Tagesabfrage gegen eine ECHTE lokale D1 — mit den echten Migrationen,
 * durch echtes SQLite gespielt.
 *
 * Das ist der Unterschied, auf den es hier ankommt: Ein Mock würde
 * bestätigen, dass die Funktion tut, was ich glaube. Diese Datei prüft, was
 * SQLite tut — einschließlich Fremdschlüsseln, CHECK-Bedingungen und
 * Sortierkollation.
 *
 * Alle Daten sind fiktiv.
 */

const NOW = '2026-08-24T07:00:00.000Z';

const TAG = '2026-08-26';
const VORTAG = '2026-08-25';
const FOLGETAG = '2026-08-27';

let naechsteNummer = 1;

async function kunde(id: number, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (?, ?, 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?3, ?3)`,
  )
    .bind(id, name, NOW)
    .run();
}

async function produkt(
  id: number,
  name: string,
  options: { unit?: string; sortOrder?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, 435, ?, 1, ?, ?5, ?5)`,
  )
    .bind(id, name, options.unit ?? 'Stück', options.sortOrder ?? id * 10, NOW)
    .run();
}

interface PositionsWunsch {
  readonly productId: number;
  readonly quantity: number;
  /** Der Snapshot. Fehlt er, wird der aktuelle Produktname genommen. */
  readonly nameSnapshot?: string;
  readonly unitSnapshot?: string;
}

async function bestellung(options: {
  id: number;
  customerId: number;
  customerName: string;
  day: string;
  status?: string;
  fulfillmentType?: string;
  note?: string | null;
  items: readonly PositionsWunsch[];
  statusChangedByAccountId?: number | null;
  statusChangedAt?: string | null;
}): Promise<string> {
  const nummer = `BUS-2026-${String(naechsteNummer++).padStart(6, '0')}`;
  const typ = options.fulfillmentType ?? 'delivery';

  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, created_at, updated_at,
                         status_changed_by_account_id, status_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?10, ?10, ?11, ?12)`,
  )
    .bind(
      options.id,
      nummer,
      options.customerId,
      options.customerName,
      typ,
      options.day,
      typ === 'delivery' ? 'Beispielweg 1, 40213 Düsseldorf' : null,
      options.note ?? null,
      options.status ?? 'confirmed',
      NOW,
      options.statusChangedByAccountId ?? null,
      options.statusChangedAt ?? null,
    )
    .run();

  for (const item of options.items) {
    const produktzeile = await env.DB.prepare(`SELECT name, unit FROM products WHERE id = ?`)
      .bind(item.productId)
      .first<{ name: string; unit: string }>();

    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, 0, ?, 0)`,
    )
      .bind(
        options.id,
        item.productId,
        item.nameSnapshot ?? produktzeile?.name ?? '?',
        item.unitSnapshot ?? produktzeile?.unit ?? '?',
        item.quantity,
      )
      .run();
  }

  return nummer;
}

beforeEach(async () => {
  for (const tabelle of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${tabelle}`).run();
  }
  naechsteNummer = 1;

  await kunde(1, 'Testcafé Nord');
  await kunde(2, 'Testcafé Süd');
  await produkt(1, 'Beispiel Käsekuchen', { sortOrder: 10 });
  await produkt(2, 'Beispiel Carrot Cake', { sortOrder: 20 });
  await produkt(3, 'Beispiel Schokoladentarte', { sortOrder: 30 });
});

describe('findProductionOrders — ein Tag', () => {
  it('liefert eine einzelne Bestellung vollständig', async () => {
    const nummer = await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: 'Bitte vor 10 Uhr',
      items: [{ productId: 1, quantity: 3 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual({
      orderNumber: nummer,
      customerName: 'Testcafé Nord',
      status: 'confirmed',
      fulfillmentType: 'delivery',
      note: 'Bitte vor 10 Uhr',
      lastStatusChange: null,
      items: [
        {
          productId: 1,
          productName: 'Beispiel Käsekuchen',
          productUnit: 'Stück',
          sortOrder: 10,
          quantity: 3,
        },
      ],
    });
  });

  it('liefert den letzten Statuswechsel mit vertrauenswürdigem Admin-Identifier', async () => {
    await env.DB.prepare(
      `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations,
                                  credential_salt, credential_verifier, is_active,
                                  failed_attempts, created_at, updated_at)
       VALUES (7, 'admin-a@example.test', 'admin', NULL, 'pbkdf2-sha256', 600000,
               ?, ?, 1, 0, ?, ?)`,
    )
      .bind('a'.repeat(32), 'b'.repeat(64), NOW, NOW)
      .run();
    await bestellung({
      id: 2,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      statusChangedByAccountId: 7,
      statusChangedAt: '2026-08-25T12:32:00.000Z',
      items: [{ productId: 1, quantity: 3 }],
    });

    expect((await findProductionOrders(env.DB, TAG))[0]?.lastStatusChange).toEqual({
      changedAt: '2026-08-25T12:32:00.000Z',
      changedBy: 'admin-a@example.test',
    });
  });

  it('liefert mehrere Bestellungen desselben Tages', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 2,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      items: [{ productId: 1, quantity: 8 }],
    });

    expect(await findProductionOrders(env.DB, TAG)).toHaveLength(2);
  });

  it('liefert einen leeren Tag als leere Liste und nicht als Fehler', async () => {
    expect(await findProductionOrders(env.DB, TAG)).toEqual([]);
  });

  /**
   * DER ZEITZONENTEST AUF DATENEBENE: Vortag und Folgetag liegen bereit. Ein
   * Fehler um ±1 Tag — durch eine UTC-Umrechnung des Kalendertags — würde
   * hier sofort die falsche Bestellung liefern.
   */
  it('schließt Vortag und Folgetag aus', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: VORTAG,
      items: [{ productId: 1, quantity: 100 }],
    });
    await bestellung({
      id: 2,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 3,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: FOLGETAG,
      items: [{ productId: 1, quantity: 200 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders).toHaveLength(1);
    expect(orders[0]?.items[0]?.quantity).toBe(3);
  });
});

describe('findProductionOrders — Statusfilter', () => {
  async function nurStatus(status: string): Promise<number> {
    await env.DB.prepare(`DELETE FROM order_items`).run();
    await env.DB.prepare(`DELETE FROM orders`).run();
    naechsteNummer = 1;

    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status,
      items: [{ productId: 1, quantity: 3 }],
    });

    return (await findProductionOrders(env.DB, TAG)).length;
  }

  it('lässt new bis zur Bestätigung aus dem Produktionsbedarf', async () => {
    expect(await nurStatus('new')).toBe(0);
  });

  it('nimmt confirmed auf', async () => {
    expect(await nurStatus('confirmed')).toBe(1);
  });

  it('nimmt in_production auf', async () => {
    expect(await nurStatus('in_production')).toBe(1);
  });

  it('lässt completed weg', async () => {
    expect(await nurStatus('completed')).toBe(0);
  });

  /** Die Regel, deren Verletzung weggeworfenen Kuchen bedeutet. */
  it('lässt cancelled weg', async () => {
    expect(await nurStatus('cancelled')).toBe(0);
  });

  it('lässt eine stornierte Großbestellung die Tagesmenge nicht verändern', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status: 'confirmed',
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 2,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      status: 'cancelled',
      items: [{ productId: 1, quantity: 999 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders).toHaveLength(1);
    expect(orders[0]?.items[0]?.quantity).toBe(3);
  });
});

describe('findProductionOrders — Lieferung und Abholung', () => {
  /** Beides muss gebacken werden. Es gibt keinen Fulfillment-Filter. */
  it('nimmt delivery und pickup gleichermaßen auf', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      fulfillmentType: 'delivery',
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 2,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      fulfillmentType: 'pickup',
      items: [{ productId: 1, quantity: 4 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.fulfillmentType).sort()).toEqual(['delivery', 'pickup']);
  });
});

describe('findProductionOrders — Snapshots', () => {
  it('nimmt den Kundennamen aus der Bestellung, nicht aus customers', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      // Der Snapshot weicht bewusst vom aktuellen Kundennamen ab.
      customerName: 'Testcafé Nord (alter Name)',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders[0]?.customerName).toBe('Testcafé Nord (alter Name)');
  });

  it('nimmt den Produktnamen aus der Position, nicht aus products', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3, nameSnapshot: 'Käsekuchen (alter Name)' }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders[0]?.items[0]?.productName).toBe('Käsekuchen (alter Name)');
  });

  /**
   * DER TEST, DER DIE SNAPSHOT-REGEL BEWEIST: Das Produkt wird NACH der
   * Bestellung umbenannt. Die Bestellung darf sich dadurch nicht ändern.
   *
   * Genau das würde ein JOIN auf products.name kaputt machen — und genau
   * deshalb steht dort nur sort_order.
   */
  it('lässt eine Umbenennung des Produkts die Bestellung nicht verändern', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    await env.DB.prepare(`UPDATE products SET name = 'Ganz Neuer Name' WHERE id = 1`).run();

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders[0]?.items[0]?.productName).toBe('Beispiel Käsekuchen');
    expect(orders[0]?.items[0]?.productName).not.toBe('Ganz Neuer Name');
  });

  it('nimmt die Einheit aus der Position, nicht aus products', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3, unitSnapshot: 'Blech' }],
    });

    expect((await findProductionOrders(env.DB, TAG))[0]?.items[0]?.productUnit).toBe('Blech');
  });

  it('nimmt sort_order aus dem aktuellen Produktdatensatz', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    await env.DB.prepare(`UPDATE products SET sort_order = 99 WHERE id = 1`).run();

    // Die Sortierung ist eine Eigenschaft der Gegenwart, kein Snapshot.
    expect((await findProductionOrders(env.DB, TAG))[0]?.items[0]?.sortOrder).toBe(99);
  });
});

describe('findProductionOrders — Notiz', () => {
  it('reicht eine Notiz unverändert durch', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: 'Bitte vor 10 Uhr an der Rückseite abstellen.',
      items: [{ productId: 1, quantity: 3 }],
    });

    expect((await findProductionOrders(env.DB, TAG))[0]?.note).toBe(
      'Bitte vor 10 Uhr an der Rückseite abstellen.',
    );
  });

  it('lässt eine fehlende Notiz null bleiben und macht keine leere Zeichenkette daraus', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: null,
      items: [{ productId: 1, quantity: 3 }],
    });

    expect((await findProductionOrders(env.DB, TAG))[0]?.note).toBeNull();
  });

  /**
   * Die Notiz ist Kundeneingabe. Sie wird als TEXT behandelt — nicht
   * interpretiert, nicht escapet, nicht gekürzt. Das Escapen gehört dorthin,
   * wo gerendert wird, und das ist Phase 3C.
   */
  it('interpretiert Markup in der Notiz nicht', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: '<b>fett</b> & "zitiert"',
      items: [{ productId: 1, quantity: 3 }],
    });

    expect((await findProductionOrders(env.DB, TAG))[0]?.note).toBe('<b>fett</b> & "zitiert"');
  });
});

describe('findProductionOrders — Sortierung', () => {
  it('sortiert Bestellungen nach Kundenname, dann Bestellnummer', async () => {
    await bestellung({
      id: 1,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      items: [{ productId: 1, quantity: 1 }],
    });
    await bestellung({
      id: 2,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 1 }],
    });
    await bestellung({
      id: 3,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 1 }],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders.map((o) => o.customerName)).toEqual([
      'Testcafé Nord',
      'Testcafé Nord',
      'Testcafé Süd',
    ]);
    // Bei gleichem Kunden entscheidet die Bestellnummer — sie ist UNIQUE,
    // damit ist die Reihenfolge vollständig bestimmt.
    expect(orders[0]?.orderNumber).toBe('BUS-2026-000002');
    expect(orders[1]?.orderNumber).toBe('BUS-2026-000003');
  });

  it('sortiert Positionen nach sort_order des Produkts', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [
        { productId: 3, quantity: 1 },
        { productId: 1, quantity: 1 },
        { productId: 2, quantity: 1 },
      ],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders[0]?.items.map((i) => i.productId)).toEqual([1, 2, 3]);
  });

  it('liefert bei wiederholtem Aufruf dieselbe Reihenfolge', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await bestellung({
        id: i,
        customerId: 1,
        customerName: 'Testcafé Nord',
        day: TAG,
        items: [{ productId: 1, quantity: i }],
      });
    }

    const einmal = (await findProductionOrders(env.DB, TAG)).map((o) => o.orderNumber);
    const nochmal = (await findProductionOrders(env.DB, TAG)).map((o) => o.orderNumber);

    expect(einmal).toEqual(nochmal);
  });
});

describe('findProductionOrders — Randfälle des Schemas', () => {
  /**
   * Das Order-Aggregat verlangt mindestens eine Position, das SCHEMA aber
   * nicht. Eine spätere Erfassung im Backoffice oder eine Korrektur von Hand
   * kann eine positionslose Bestellung erzeugen — und eine Tagesübersicht,
   * die eine Bestellung stillschweigend verschwinden lässt, ist schlimmer als
   * eine, die sie mit null Positionen zeigt.
   *
   * Genau das wäre passiert, wenn Bestellungen und Positionen über EINE
   * Abfrage mit JOIN geladen würden.
   */
  it('zeigt eine Bestellung ohne Positionen mit leerer Positionsliste', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [],
    });

    const orders = await findProductionOrders(env.DB, TAG);

    expect(orders).toHaveLength(1);
    expect(orders[0]?.items).toEqual([]);
  });

  /**
   * Der Fulfillment-Typ wird — anders als der Status — von der Abfrage NICHT
   * gefiltert. Ein unbekannter Wert käme also durch, wenn ihn nicht der Code
   * abfinge. Genau das wird hier geprüft.
   *
   * Das CHECK der Tabelle verhindert einen solchen Wert bereits; es wird für
   * diesen einen Test absichtlich umgangen, um die zweite Verteidigungslinie
   * zu prüfen. PRAGMA ignore_check_constraints gilt nur für diese Verbindung.
   */
  it('lehnt eine Zeile mit unbekanntem Fulfillment-Typ ab, statt sie durchzureichen', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    await env.DB.prepare(`PRAGMA ignore_check_constraints = ON`).run();
    await env.DB.prepare(`UPDATE orders SET fulfillment_type = 'drohne' WHERE id = 1`).run();
    await env.DB.prepare(`PRAGMA ignore_check_constraints = OFF`).run();

    await expect(findProductionOrders(env.DB, TAG)).rejects.toThrow(InvalidArgumentError);
  });

  /**
   * Ein unbekannter Status kann diese Abfrage gar nicht verlassen: Der
   * IN-Filter lässt ausschließlich die drei produktionsrelevanten Werte
   * durch. Eine beschädigte Zeile verschwindet also aus der Tagesliste,
   * statt sie zum Scheitern zu bringen — für eine Produktionsansicht ist das
   * die richtige Richtung.
   *
   * Die Prüfung im Code bleibt trotzdem stehen. Sie ist die Stelle, an der
   * aus einem `string` aus D1 ein `OrderStatus` wird; ohne sie wäre die
   * Zuweisung eine Behauptung statt einer Prüfung.
   */
  it('lässt eine Zeile mit unbekanntem Status aus der Tagesliste fallen', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    await env.DB.prepare(`PRAGMA ignore_check_constraints = ON`).run();
    await env.DB.prepare(`UPDATE orders SET status = 'geliefert' WHERE id = 1`).run();
    await env.DB.prepare(`PRAGMA ignore_check_constraints = OFF`).run();

    expect(await findProductionOrders(env.DB, TAG)).toEqual([]);
  });

  it('verlangt weiterhin einen gültigen Fremdschlüssel auf products', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
                                  product_unit_snapshot, unit_price_cents, quantity, line_total_cents)
         VALUES (1, 999, 'Erfundenes Produkt', 'Stück', 0, 1, 0)`,
      ).run(),
    ).rejects.toThrow();
  });
});

/**
 * DER QUERY PLAN — als geprüfte Eigenschaft und nicht als einmaliger Befund
 * in einem Protokoll.
 *
 * Ein Plan, den jemand einmal von Hand angeschaut hat, ist in dem Moment
 * veraltet, in dem jemand anders einen Index entfernt oder eine Bedingung
 * umstellt. Hier läuft er in jedem Testlauf gegen dieselbe frisch migrierte
 * D1 wie alles andere — und wird rot, wenn aus dem Indexzugriff ein Scan
 * wird.
 *
 * Die Abfragen kommen aus dem Modul selbst. Sie hier abzuschreiben hieße, den
 * Plan einer Abfrage zu prüfen, die gar nicht ausgeführt wird.
 */
describe('Query Plan', () => {
  async function plan(sql: string): Promise<string[]> {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(TAG, ...OPEN_PRODUCTION_STATUSES)
      .all<{ detail: string }>();

    return results.map((zeile) => zeile.detail);
  }

  it('findet die Bestellungen des Tages über idx_orders_day', async () => {
    const zeilen = await plan(PRODUCTION_DAY_QUERIES.orders);

    expect(zeilen.join(' | ')).toContain('idx_orders_day');
  });

  it('findet die Positionen über idx_orders_day und idx_order_items_order', async () => {
    const zeilen = await plan(PRODUCTION_DAY_QUERIES.items);
    const text = zeilen.join(' | ');

    expect(text).toContain('idx_orders_day');
    expect(text).toContain('idx_order_items_order');
  });

  /**
   * KEIN FULL TABLE SCAN in keiner der beiden Abfragen.
   *
   * SQLite schreibt „SCAN <tabelle>", wenn es eine Tabelle vollständig liest,
   * und „SEARCH ... USING INDEX", wenn es einen Index benutzt. Ein Tag darf
   * niemals die gesamte Bestellhistorie lesen — genau dafür gibt es
   * idx_orders_day.
   *
   * Das verbleibende „USE TEMP B-TREE FOR ORDER BY" ist ausdrücklich in
   * Ordnung: Es sortiert das bereits auf EINEN Tag eingeschränkte Ergebnis,
   * also eine Handvoll Zeilen. Ein zusätzlicher Index auf
   * customer_name_snapshot wäre bei jedem Bestellvorgang mitzuschreiben, um
   * die Sortierung von zehn Zeilen zu beschleunigen — kein guter Handel.
   */
  it('liest keine Tabelle vollständig', async () => {
    for (const sql of [PRODUCTION_DAY_QUERIES.orders, PRODUCTION_DAY_QUERIES.items]) {
      for (const zeile of await plan(sql)) {
        expect(zeile.startsWith('SCAN')).toBe(false);
      }
    }
  });

  /**
   * Die Zahl der Abfragen ist Teil des Vertrags: ZWEI je Request, unabhängig
   * davon, wie viele Bestellungen der Tag hat. Diese Prüfung ist der Wächter
   * gegen ein N+1, das sich später einschleicht — eine Schleife über
   * Bestellungen fiele hier sofort auf.
   */
  it('kommt mit genau zwei Abfragen aus', async () => {
    expect(Object.keys(PRODUCTION_DAY_QUERIES)).toHaveLength(2);

    for (let i = 1; i <= 8; i += 1) {
      await bestellung({
        id: i,
        customerId: 1,
        customerName: 'Testcafé Nord',
        day: TAG,
        items: [
          { productId: 1, quantity: i },
          { productId: 2, quantity: i },
        ],
      });
    }

    const zaehler = { anzahl: 0 };
    const gezaehlt = new Proxy(env.DB, {
      get(ziel, name, empfaenger) {
        if (name === 'prepare') {
          return (sql: string) => {
            zaehler.anzahl += 1;
            return ziel.prepare(sql);
          };
        }
        return Reflect.get(ziel, name, empfaenger) as unknown;
      },
    });

    const orders = await findProductionOrders(gezaehlt, TAG);

    expect(orders).toHaveLength(8);
    expect(zaehler.anzahl).toBe(2);
  });
});
