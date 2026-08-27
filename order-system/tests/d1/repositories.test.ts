import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog } from '../../src/infrastructure/d1/product-repository';
import { loadOrderPricing } from '../../src/infrastructure/d1/customer-price-book-repository';
import { findCustomer } from '../../src/infrastructure/d1/customer-repository';
import { reserveOrderNumber } from '../../src/infrastructure/d1/order-number-sequence';
import {
  findOrderByNumber,
  findOrderBySubmission,
  saveOrder,
} from '../../src/infrastructure/d1/order-repository';
import { Order } from '../../src/domain/order';
import { OrderDraft } from '../../src/domain/order-draft';
import { OrderNumber } from '../../src/domain/order-number';

const NOW = new Date('2026-08-23T07:00:00Z');

async function seed(): Promise<void> {
  const ts = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, contact_person, email, phone, delivery_street,
                              delivery_postal_code, delivery_city, is_active, default_fulfillment,
                              internal_note, created_at, updated_at)
       VALUES (1, 'Beispielcafé Nord', 'Beispielperson', 'kontakt@example.org', '0211 1234567',
               'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', 'Platzhalter', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Beispiel-Abholkunde', 1, 'pickup', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (3, 'Ehemaliges Beispielcafé', 'Beispielweg 9', '40210', 'Düsseldorf', 0, 'delivery', ?1, ?1)`,
    ).bind(ts),
    /**
     * KATALOG UND VERKNÜPFUNG — seit Phase 5C die Preisquelle.
     *
     * products.price_cents steht weiterhin in den Zeilen, wird aber nicht
     * mehr gelesen. Die Werte sind deshalb absichtlich UNSINNIG (99999): Wenn
     * jemand den Preis doch wieder von dort nimmt, ist das kein knapper
     * Unterschied, sondern ein Test, der laut scheitert.
     */
    env.DB.prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
       VALUES (101, 'kuchen-a', 'Beispielkuchen A', 1, 10, ?1, ?1),
              (102, 'kuchen-b', 'Beispielkuchen B', 1, 20, ?1, ?1),
              (109, 'saison-e', 'Saisonartikel E',  1, 50, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (101, 1, 'fixed', 435, ?1, ?1),
              (102, 1, 'fixed', 280, ?1, ?1),
              (109, 1, 'fixed', 350, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order,
                             catalog_product_id, created_at, updated_at)
       VALUES (1, 'Beispielkuchen A', 'Platzhalter', 99999, 'Stück', 1, 10, 101, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order,
                             catalog_product_id, created_at, updated_at)
       VALUES (2, 'Beispielkuchen B', NULL, 99999, 'Blech', 1, 20, 102, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order,
                             catalog_product_id, created_at, updated_at)
       VALUES (9, 'Saisonartikel E', NULL, 99999, 'Stück', 0, 50, 109, ?1, ?1)`,
    ).bind(ts),
    // Die beiden bestellenden Kunden gehören zur Gastronomie-Preisliste.
    // Kunde 3 bleibt ABSICHTLICH unzugeordnet: Ein Bestand, in dem jeder
    // eine Preisgruppe hat, prüft den Zustand „nicht zugeordnet" nicht.
    env.DB.prepare(`UPDATE customers SET price_list_id = 1 WHERE id IN (1, 2)`),
  ]);
}

/**
 * Preiswelt UND Herstellkosten eines Kunden — genau so, wie der Bestellfluss
 * sie lädt. Seit Phase 7A ein Paar, weil Order.place() beides verlangt.
 */
async function pricingOf(customerId = 1) {
  const customer = await findCustomer(env.DB, customerId);
  return loadOrderPricing(env.DB, customer!);
}

beforeEach(async () => {
  // Reihenfolge wegen der Fremdschlüssel: products hängt seit 0014 an
  // catalog_products, catalog_product_prices ebenfalls.
  for (const table of [
    'order_items',
    'orders',
    'products',
    'catalog_product_prices',
    'catalog_products',
    'customers',
    'order_number_sequences',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seed();
});

describe('loadCatalog', () => {
  it('lädt alle Produkte — den Preis trägt seit 5C die Preiswelt des Kunden', async () => {
    const catalog = await loadCatalog(env.DB);
    const { priceBook: buch } = await pricingOf();
    expect(catalog.count()).toBe(3);
    const preis = buch.priceFor(1);
    expect(preis.kind === 'fixed' && preis.unitPrice.cents).toBe(435);
    expect(catalog.get(1).name).toBe('Beispielkuchen A');
    expect(catalog.get(1).description).toBe('Platzhalter');
    expect(catalog.get(2).description).toBeNull();
  });

  it('übersetzt is_active aus dem INTEGER der Datenbank', async () => {
    const catalog = await loadCatalog(env.DB);
    expect(catalog.get(1).isActive).toBe(true);
    expect(catalog.get(9).isActive).toBe(false);
  });

  it('liefert das bestellbare Sortiment in Anzeigereihenfolge', async () => {
    const catalog = await loadCatalog(env.DB);
    expect(catalog.orderable().map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('findCustomer', () => {
  it('lädt einen Lieferkunden mit Adresse', async () => {
    const customer = await findCustomer(env.DB, 1);
    expect(customer?.name).toBe('Beispielcafé Nord');
    expect(customer?.deliveryAddress?.toSingleLine()).toBe('Beispielweg 1, 40213 Düsseldorf');
    expect(customer?.defaultFulfillment).toBe('delivery');
    expect(customer?.email).toBe('kontakt@example.org');
    expect(customer?.isActive).toBe(true);
  });

  it('lädt einen Abholkunden ohne Adresse', async () => {
    const customer = await findCustomer(env.DB, 2);
    expect(customer?.deliveryAddress).toBeNull();
    expect(customer?.defaultFulfillment).toBe('pickup');
  });

  it('erkennt einen deaktivierten Kunden', async () => {
    expect((await findCustomer(env.DB, 3))?.isActive).toBe(false);
  });

  it('liefert null für unbekannte Kunden', async () => {
    expect(await findCustomer(env.DB, 999)).toBeNull();
  });

  /**
   * Phase 5B — die Zuordnung reist mit dem Kunden.
   *
   * Damit kann Phase 5C später „welche Preisgruppe gilt für diesen Kunden?"
   * beantworten, ohne dafür ein neues Schema oder eine zweite Abfrage zu
   * brauchen. Der geladene Kunde BERECHNET damit weiterhin nichts.
   */
  it('trägt eine fehlende Preisgruppe als „nicht zugeordnet"', async () => {
    expect((await findCustomer(env.DB, 3))?.priceListId).toBeNull();
  });

  it('trägt eine gesetzte Preisgruppe mit', async () => {
    const gastro = await env.DB.prepare("SELECT id FROM price_lists WHERE code = 'gastro'")
      .first<{ id: number }>();

    expect((await findCustomer(env.DB, 1))?.priceListId).toBe(gastro?.id);
  });
});

describe('reserveOrderNumber', () => {
  it('beginnt jedes Jahr bei eins und zählt hoch', async () => {
    expect((await reserveOrderNumber(env.DB, 2026)).value).toBe('BUS-2026-000001');
    expect((await reserveOrderNumber(env.DB, 2026)).value).toBe('BUS-2026-000002');
    expect((await reserveOrderNumber(env.DB, 2026)).value).toBe('BUS-2026-000003');
  });

  it('zählt je Kalenderjahr getrennt', async () => {
    await reserveOrderNumber(env.DB, 2026);
    await reserveOrderNumber(env.DB, 2026);
    expect((await reserveOrderNumber(env.DB, 2027)).value).toBe('BUS-2027-000001');
    expect((await reserveOrderNumber(env.DB, 2026)).value).toBe('BUS-2026-000003');
  });

  /**
   * Der eigentliche Grund für die Sequenztabelle. Würde die Nummer aus
   * MAX(id)+1 gebildet — also lesen, dann schreiben —, bekämen gleichzeitige
   * Bestellungen dieselbe. Der UPSERT mit RETURNING ist EINE Anweisung.
   */
  it('vergibt auch bei gleichzeitigen Anfragen jede Nummer nur einmal', async () => {
    const reserved = await Promise.all(
      Array.from({ length: 25 }, () => reserveOrderNumber(env.DB, 2026)),
    );
    const values = reserved.map((n) => n.value);
    expect(new Set(values).size).toBe(25);
    expect(values.map((v) => Number(v.slice(-6))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });
});

describe('saveOrder', () => {
  async function order(seq = 1, items = [{ product_id: 1, quantity: 3 }]): Promise<Order> {
    const customer = await findCustomer(env.DB, 1);
    const catalog = await loadCatalog(env.DB);
    return Order.place({
      customer: customer!,
      catalog,
      ...(await pricingOf(1)),
      draft: OrderDraft.fromInput(
        { fulfillment_type: 'delivery', fulfillment_date: '2026-08-28', items, note: 'Bitte kühl stellen' },
        NOW,
      ),
      orderNumber: OrderNumber.fromYearAndSequence(2026, seq),
      now: NOW,
    });
  }

  it('schreibt Bestellung und Positionen', async () => {
    await saveOrder(env.DB, await order(1, [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 7 }]));

    const stored = await env.DB.prepare(
      'SELECT order_number, total_amount_cents, status, note FROM orders',
    ).first<{ order_number: string; total_amount_cents: number; status: string; note: string }>();
    expect(stored?.order_number).toBe('BUS-2026-000001');
    expect(stored?.total_amount_cents).toBe(3265);
    expect(stored?.status).toBe('new');
    expect(stored?.note).toBe('Bitte kühl stellen');

    const { results } = await env.DB.prepare(
      'SELECT product_id, unit_price_cents, quantity, line_total_cents FROM order_items ORDER BY product_id',
    ).all<{ product_id: number; unit_price_cents: number; quantity: number; line_total_cents: number }>();
    expect(results).toEqual([
      { product_id: 1, unit_price_cents: 435, quantity: 3, line_total_cents: 1305 },
      { product_id: 2, unit_price_cents: 280, quantity: 7, line_total_cents: 1960 },
    ]);
  });

  /**
   * Regel 18: Es darf nicht vorkommen, dass die Bestellung angelegt wird und
   * die Positionen nur zur Hälfte. Erzwungen wird der Fehler über den
   * Fremdschlüssel: Das Produkt wird zwischen Katalogaufbau und Speichern
   * gelöscht, die zweite Position schlägt dadurch fehl.
   */
  it('schreibt alles oder nichts', async () => {
    const toSave = await order(1, [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 7 }]);
    await env.DB.prepare('DELETE FROM products WHERE id = 2').run();

    await expect(saveOrder(env.DB, toSave)).rejects.toThrow();

    const counts = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM orders) AS o, (SELECT COUNT(*) FROM order_items) AS i',
    ).first<{ o: number; i: number }>();
    expect(counts).toEqual({ o: 0, i: 0 });
  });

  it('liest eine gespeicherte Bestellung vollständig zurück', async () => {
    await saveOrder(env.DB, await order(1, [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 7 }]));

    const loaded = await findOrderByNumber(env.DB, 'BUS-2026-000001');
    expect(loaded?.customerId).toBe(1);
    expect(loaded?.customerNameSnapshot).toBe('Beispielcafé Nord');
    expect(loaded?.fulfillmentType).toBe('delivery');
    expect(loaded?.fulfillmentDate.value).toBe('2026-08-28');
    expect(loaded?.deliveryAddressSnapshot).toBe('Beispielweg 1, 40213 Düsseldorf');
    expect(loaded?.status).toBe('new');
    expect(loaded?.createdAt).toBe('2026-08-23T07:00:00.000Z');
    expect(loaded?.items).toHaveLength(2);
    expect(loaded?.total().cents).toBe(3265);
  });

  it('liefert null für unbekannte Bestellnummern', async () => {
    expect(await findOrderByNumber(env.DB, 'BUS-2026-999999')).toBeNull();
  });

  /**
   * Regel 8 gegen eine echte Datenbank: Der Preis-Snapshot überlebt eine
   * Preisänderung im Stammdatensatz. Das ist der Test, den die reine
   * Domänenfassung nicht führen kann.
   */
  it('hält den Preis-Snapshot fest, wenn sich der Katalogpreis danach ändert', async () => {
    await saveOrder(env.DB, await order(1));
    expect((await findOrderByNumber(env.DB, 'BUS-2026-000001'))?.total().cents).toBe(1305);

    await env.DB.prepare(
      'UPDATE catalog_product_prices SET price_cents = 520 WHERE product_id = 101 AND price_list_id = 1',
    ).run();

    const alt = await findOrderByNumber(env.DB, 'BUS-2026-000001');
    expect(alt?.items[0]?.unitPrice.cents).toBe(435);
    expect(alt?.total().cents).toBe(1305);

    await saveOrder(env.DB, await order(2));
    const neu = await findOrderByNumber(env.DB, 'BUS-2026-000002');
    expect(neu?.items[0]?.unitPrice.cents).toBe(520);
    expect(neu?.total().cents).toBe(1560);
  });

  /**
   * DIE GEGENPROBE ZUR VORIGEN: products.price_cents IST KEIN PREIS MEHR.
   *
   * Die Spalte steht noch in der Tabelle, und der Seed füllt sie absichtlich
   * mit 99999. Ändert man sie, darf sich WEDER eine bestehende NOCH eine neue
   * Bestellung dadurch verändern. Dieser Test ist die stehende Fassung von
   * Mutation B aus §29 — er würde rot, sobald jemand einen Rückfall auf den
   * alten Einheitspreis einbaut.
   */
  it('lässt products.price_cents auch auf NEUE Bestellungen ohne Wirkung', async () => {
    await env.DB.prepare('UPDATE products SET price_cents = 1 WHERE id = 1').run();

    await saveOrder(env.DB, await order(1));
    const neu = await findOrderByNumber(env.DB, 'BUS-2026-000001');

    expect(neu?.items[0]?.unitPrice.cents).toBe(435);
    expect(neu?.total().cents).toBe(1305);
  });
});

/**
 * Die Absendekennung ist der serverseitige Teil des Doppelklick-Schutzes.
 * Sie wird im SELBEN INSERT geschrieben wie die Bestellung — es gibt keinen
 * Zustand, in dem eine Bestellung ohne ihre Kennung oder eine Kennung ohne
 * ihre Bestellung existiert.
 */
describe('saveOrder mit Absendekennung', () => {
  async function order(seq = 1, customerId = 1): Promise<Order> {
    const customer = await findCustomer(env.DB, customerId);
    const catalog = await loadCatalog(env.DB);
    return Order.place({
      customer: customer!,
      catalog,
      ...(await pricingOf(customerId)),
      draft: OrderDraft.fromInput(
        {
          fulfillment_type: customer!.defaultFulfillment,
          fulfillment_date: '2026-08-28',
          items: [{ product_id: 1, quantity: 3 }],
        },
        NOW,
      ),
      orderNumber: OrderNumber.fromYearAndSequence(2026, seq),
      now: NOW,
    });
  }

  it('schreibt die Kennung in dieselbe Zeile', async () => {
    await saveOrder(env.DB, await order(1), 'sub-0001-abcd');

    const row = await env.DB.prepare(
      'SELECT order_number, submission_id FROM orders',
    ).first<{ order_number: string; submission_id: string | null }>();

    expect(row).toEqual({ order_number: 'BUS-2026-000001', submission_id: 'sub-0001-abcd' });
  });

  it('schreibt ohne Kennung NULL — der Phase-1-Pfad bleibt unberührt', async () => {
    await saveOrder(env.DB, await order(1));

    const row = await env.DB.prepare('SELECT submission_id FROM orders').first<{
      submission_id: string | null;
    }>();
    expect(row?.submission_id).toBeNull();
  });

  it('findet eine Bestellung über Kunde und Kennung wieder', async () => {
    await saveOrder(env.DB, await order(1), 'sub-0001-abcd');

    const found = await findOrderBySubmission(env.DB, 1, 'sub-0001-abcd');
    expect(found?.orderNumber.value).toBe('BUS-2026-000001');
    expect(found?.total().cents).toBe(1305);
    expect(found?.items).toHaveLength(1);
  });

  it('liefert null für eine unbekannte Kennung', async () => {
    await saveOrder(env.DB, await order(1), 'sub-0001-abcd');
    expect(await findOrderBySubmission(env.DB, 1, 'sub-9999-zzzz')).toBeNull();
  });

  /**
   * Der Kunde gehört zum Schlüssel. Ohne ihn könnte ein Café mit einer
   * geratenen Kennung die Bestellung eines anderen Cafés auslesen.
   */
  it('liefert die Kennung eines anderen Cafés nicht aus', async () => {
    await saveOrder(env.DB, await order(1), 'sub-0001-abcd');
    expect(await findOrderBySubmission(env.DB, 2, 'sub-0001-abcd')).toBeNull();
  });

  it('lehnt dieselbe Kennung beim selben Café ein zweites Mal ab', async () => {
    await saveOrder(env.DB, await order(1), 'sub-0001-abcd');
    await expect(saveOrder(env.DB, await order(2), 'sub-0001-abcd')).rejects.toThrow(
      /UNIQUE constraint/i,
    );

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
