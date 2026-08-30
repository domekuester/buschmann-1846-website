import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getProductionDay } from '../../src/application/get-production-day';

/**
 * Der Anwendungsfall gegen eine echte D1 — Abfrage und Aggregation zusammen.
 *
 * Die einzelnen Regeln stehen in tests/domain/production-day.test.ts und
 * tests/d1/production-day-repository.test.ts. Diese Datei prüft, dass beide
 * Hälften zusammen die richtige Zahl ergeben: Genau hier fiele auf, wenn die
 * Abfrage richtig filtert und die Aggregation trotzdem falsch summiert.
 *
 * Alle Daten sind fiktiv.
 */

const NOW = '2026-08-24T07:00:00.000Z';

const TAG = '2026-08-26';
const VERGANGEN = '2019-03-04';
const ZUKUNFT = '2031-11-20';

let naechsteNummer = 1;

async function bestellung(options: {
  id: number;
  customerId: number;
  customerName: string;
  day: string;
  status?: string;
  fulfillmentType?: string;
  items: readonly { productId: number; quantity: number }[];
}): Promise<void> {
  const nummer = `BUS-2026-${String(naechsteNummer++).padStart(6, '0')}`;
  const typ = options.fulfillmentType ?? 'delivery';

  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?9, ?9)`,
  )
    .bind(
      options.id,
      nummer,
      options.customerId,
      options.customerName,
      typ,
      options.day,
      typ === 'delivery' ? 'Beispielweg 1, 40213 Düsseldorf' : null,
      options.status ?? 'confirmed',
      NOW,
    )
    .run();

  for (const item of options.items) {
    const produkt = await env.DB.prepare(`SELECT name, unit FROM products WHERE id = ?`)
      .bind(item.productId)
      .first<{ name: string; unit: string }>();

    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, 0, ?, 0)`,
    )
      .bind(options.id, item.productId, produkt?.name ?? '?', produkt?.unit ?? '?', item.quantity)
      .run();
  }
}

beforeEach(async () => {
  for (const tabelle of ['order_items', 'orders', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${tabelle}`).run();
  }
  naechsteNummer = 1;

  for (const [id, name] of [
    [1, 'Testcafé Nord'],
    [2, 'Testcafé Süd'],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (?, ?, 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?3, ?3)`,
    )
      .bind(id, name, NOW)
      .run();
  }

  for (const [id, name, sortOrder] of [
    [1, 'Beispiel Käsekuchen', 10],
    [2, 'Beispiel Carrot Cake', 20],
    [3, 'Beispiel Schokoladentarte', 30],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, 435, 'Stück', 1, ?, ?4, ?4)`,
    )
      .bind(id, name, sortOrder, NOW)
      .run();
  }
});

describe('getProductionDay', () => {
  it('hält 10 bestätigte plus 2 neue Einheiten bei 10 Produktionsbedarf', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Bestätigtes Testcafé',
      day: TAG,
      status: 'confirmed',
      items: [{ productId: 1, quantity: 10 }],
    });
    await bestellung({
      id: 2,
      customerId: 2,
      customerName: 'Neues Testcafé',
      day: TAG,
      status: 'new',
      items: [{ productId: 1, quantity: 2 }],
    });

    const vorher = await getProductionDay(env.DB, TAG);
    expect(vorher.orderCount).toBe(1);
    expect(vorher.totalUnits).toBe(10);
    expect(vorher.products[0]?.quantity).toBe(10);
    expect(vorher.orders.map((order) => order.customerName)).not.toContain('Neues Testcafé');

    await env.DB.prepare("UPDATE orders SET status = 'confirmed' WHERE customer_name_snapshot = ?")
      .bind('Neues Testcafé')
      .run();

    const nachher = await getProductionDay(env.DB, TAG);
    expect(nachher.orderCount).toBe(2);
    expect(nachher.totalUnits).toBe(12);
    expect(nachher.products[0]?.quantity).toBe(12);
  });

  /**
   * DAS BEISPIEL AUS DER SPEZIFIKATION, Ende zu Ende.
   *
   * Testcafé Nord bestellt 3 Käsekuchen und 2 Carrot Cake, Testcafé Süd 8 und
   * 6. Herauskommen müssen 11 und 8 — und 19 Einheiten insgesamt.
   */
  it('beantwortet die Frage, was für einen Tag zu produzieren ist', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 2 },
      ],
    });
    await bestellung({
      id: 2,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      items: [
        { productId: 1, quantity: 8 },
        { productId: 2, quantity: 6 },
      ],
    });

    const tag = await getProductionDay(env.DB, TAG);

    expect(tag.date).toBe(TAG);
    expect(tag.orderCount).toBe(2);
    expect(tag.totalUnits).toBe(19);
    expect(tag.products).toEqual([
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 11 },
      { productId: 2, productName: 'Beispiel Carrot Cake', productUnit: 'Stück', quantity: 8 },
    ]);
    expect(tag.orders.map((o) => o.customerName)).toEqual(['Testcafé Nord', 'Testcafé Süd']);
  });

  /**
   * Der teuerste denkbare Fehler: eine stornierte Bestellung wird gebacken.
   * Hier steht sie mit 999 Stück daneben und darf die Summen nicht anfassen.
   */
  it('lässt neu, storniert und abgeschlossen aus den Summen heraus', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status: 'new',
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 2,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status: 'in_production',
      items: [{ productId: 1, quantity: 4 }],
    });
    await bestellung({
      id: 3,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      status: 'cancelled',
      items: [{ productId: 1, quantity: 999 }],
    });
    await bestellung({
      id: 4,
      customerId: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      status: 'completed',
      items: [{ productId: 1, quantity: 500 }],
    });

    const tag = await getProductionDay(env.DB, TAG);

    expect(tag.orderCount).toBe(1);
    expect(tag.totalUnits).toBe(4);
    expect(tag.products).toEqual([
      { productId: 1, productName: 'Beispiel Käsekuchen', productUnit: 'Stück', quantity: 4 },
    ]);
  });

  it('summiert Lieferung und Abholung gemeinsam', async () => {
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

    const tag = await getProductionDay(env.DB, TAG);

    expect(tag.totalUnits).toBe(7);
    expect(tag.products[0]?.quantity).toBe(7);
  });

  it('liefert für einen Tag ohne Bestellungen Nullen und leere Listen', async () => {
    expect(await getProductionDay(env.DB, TAG)).toEqual({
      date: TAG,
      orderCount: 0,
      totalUnits: 0,
      products: [],
      orders: [],
    });
  });

  /**
   * Ein Admin muss den letzten Freitag nachvollziehen können. Die Regel
   * „nicht in der Vergangenheit" gilt beim BESTELLEN, nicht beim Lesen.
   */
  it('liest einen vergangenen Tag', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: VERGANGEN,
      items: [{ productId: 1, quantity: 5 }],
    });

    const tag = await getProductionDay(env.DB, VERGANGEN);

    expect(tag.date).toBe(VERGANGEN);
    expect(tag.totalUnits).toBe(5);
  });

  it('liest einen weit in der Zukunft liegenden Tag', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: ZUKUNFT,
      items: [{ productId: 1, quantity: 6 }],
    });

    expect((await getProductionDay(env.DB, ZUKUNFT)).totalUnits).toBe(6);
  });

  /**
   * DER ZEITZONENTEST: Derselbe Datenbestand, drei aufeinanderfolgende Tage.
   * Eine Verschiebung um ±1 Tag — durch eine UTC-Umrechnung irgendwo im
   * Ablauf — würde hier sofort die falsche Menge liefern.
   */
  it('hält den Kalendertag stabil gegen Nachbartage', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: '2026-08-25',
      items: [{ productId: 1, quantity: 1 }],
    });
    await bestellung({
      id: 2,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: '2026-08-26',
      items: [{ productId: 1, quantity: 2 }],
    });
    await bestellung({
      id: 3,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: '2026-08-27',
      items: [{ productId: 1, quantity: 3 }],
    });

    expect((await getProductionDay(env.DB, '2026-08-25')).totalUnits).toBe(1);
    expect((await getProductionDay(env.DB, '2026-08-26')).totalUnits).toBe(2);
    expect((await getProductionDay(env.DB, '2026-08-27')).totalUnits).toBe(3);
  });

  /**
   * Auch über eine Sommerzeitumstellung hinweg: Der 29. März 2026 ist der
   * Tag, an dem in Europe/Berlin eine Stunde fehlt. Für einen Kalendertag
   * darf das keinerlei Rolle spielen — und tut es auch nicht, weil nirgends
   * gerechnet wird.
   */
  it('bleibt am Tag der Zeitumstellung korrekt', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: '2026-03-29',
      items: [{ productId: 1, quantity: 7 }],
    });

    expect((await getProductionDay(env.DB, '2026-03-29')).totalUnits).toBe(7);
    expect((await getProductionDay(env.DB, '2026-03-28')).totalUnits).toBe(0);
    expect((await getProductionDay(env.DB, '2026-03-30')).totalUnits).toBe(0);
  });

  it('trägt keine Preisfelder in das Ergebnis', async () => {
    await bestellung({
      id: 1,
      customerId: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    // Der rohe JSON-Text des Ergebnisses — nicht die Feldnamen, die ich
    // erwarte, sondern alles, was tatsächlich drinsteht.
    const roh = JSON.stringify(await getProductionDay(env.DB, TAG));

    for (const verboten of ['cents', 'price', 'Price', 'total_amount', 'unitPrice', 'lineTotal']) {
      expect(roh).not.toContain(verboten);
    }
  });
});
