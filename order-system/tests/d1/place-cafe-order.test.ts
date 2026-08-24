import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { placeCafeOrder } from '../../src/application/place-cafe-order';
import { generateAccessToken, hashAccessToken } from '../../src/domain/access-token';
import { AccessDeniedError, ValidationError } from '../../src/domain/errors';
import { findOrderByNumber } from '../../src/infrastructure/d1/order-repository';

/**
 * Der vollständige Bestellvorgang eines Cafés gegen eine echte D1 — vom
 * Token bis zur gespeicherten Zeile. Hier laufen die Regeln zusammen, die
 * einzeln schon geprüft sind, und hier fällt auf, wenn sie sich gegenseitig
 * aushebeln.
 */
const NOW = new Date('2026-08-24T07:00:00Z'); // Montag, Berlin: 09:00
const MORGEN = '2026-08-25';

const token = {
  nord: generateAccessToken(),
  sued: generateAccessToken(),
  abholung: generateAccessToken(),
  widerrufen: generateAccessToken(),
  unbekannt: generateAccessToken(),
};

async function countOrders(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fulfillment_date: MORGEN,
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
}

async function order(
  overrides: Record<string, unknown> = {},
  opts: { token?: string; submissionId?: string; now?: Date } = {},
) {
  return placeCafeOrder(env.DB, {
    token: opts.token ?? token.nord,
    submissionId: opts.submissionId ?? `sub-${crypto.randomUUID()}`,
    input: request(overrides),
    now: opts.now ?? NOW,
  });
}

beforeEach(async () => {
  for (const table of [
    'order_items',
    'orders',
    'customer_access_tokens',
    'products',
    'customers',
    'order_number_sequences',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  const ts = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, email, phone, delivery_street, delivery_postal_code,
                              delivery_city, is_active, default_fulfillment, internal_note,
                              created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'kontakt@example.org', '0211 1234567', 'Beispielweg 1', '40213',
               'Düsseldorf', 1, 'delivery', 'Platzhalter — Lieferung an der Rückseite', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Testcafé Süd', 'Beispielallee 22', '40215', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (3, 'Testkunde Abholung', 1, 'pickup', ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen', 'Platzhalter', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Beispiel Streuselblech', 280, 'Blech', 1, 20, ?1, ?1)`,
    ).bind(ts),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (9, 'Beispiel Saisontorte', 350, 'Torte', 0, 50, ?1, ?1)`,
    ).bind(ts),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at) VALUES (1, ?, 1, ?)`,
    ).bind(await hashAccessToken(token.nord), ts),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at) VALUES (2, ?, 1, ?)`,
    ).bind(await hashAccessToken(token.sued), ts),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at) VALUES (3, ?, 1, ?)`,
    ).bind(await hashAccessToken(token.abholung), ts),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at, revoked_at)
       VALUES (1, ?, 0, ?, ?)`,
    ).bind(await hashAccessToken(token.widerrufen), ts, ts),
  ]);
});

describe('placeCafeOrder — der gute Fall', () => {
  it('legt eine Bestellung für das Café des Tokens an', async () => {
    const { order: placed, created } = await order();

    expect(created).toBe(true);
    expect(placed.orderNumber.value).toBe('BUS-2026-000001');
    expect(placed.customerId).toBe(1);
    expect(placed.customerNameSnapshot).toBe('Testcafé Nord');
    expect(placed.status).toBe('new');
    expect(placed.total().cents).toBe(1305);
  });

  it('speichert die Bestellung mit allen Positionen', async () => {
    await order({ items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 2 }] });

    const stored = await findOrderByNumber(env.DB, 'BUS-2026-000001');
    expect(stored?.items).toHaveLength(2);
    expect(stored?.total().cents).toBe(3 * 435 + 2 * 280);
  });

  it('übernimmt den Liefertag und die Notiz', async () => {
    const { order: placed } = await order({ note: '  Bitte an der Rückseite anliefern  ' });

    expect(placed.fulfillmentDate.value).toBe(MORGEN);
    expect(placed.note).toBe('Bitte an der Rückseite anliefern');
  });

  it('lässt die Notiz weg, wenn keine da ist', async () => {
    expect((await order()).order.note).toBeNull();
    expect((await order({ note: '   ' })).order.note).toBeNull();
  });

  it('vergibt fortlaufende Bestellnummern', async () => {
    expect((await order()).order.orderNumber.value).toBe('BUS-2026-000001');
    expect((await order()).order.orderNumber.value).toBe('BUS-2026-000002');
  });
});

describe('placeCafeOrder — Zugang', () => {
  it('lehnt einen unbekannten Token ab, ohne etwas zu speichern', async () => {
    await expect(order({}, { token: token.unbekannt })).rejects.toThrow(AccessDeniedError);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt einen widerrufenen Token ab', async () => {
    await expect(order({}, { token: token.widerrufen })).rejects.toThrow(AccessDeniedError);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt einen formal ungültigen Token ab', async () => {
    await expect(order({}, { token: 'zu-kurz' })).rejects.toThrow(AccessDeniedError);
    await expect(order({}, { token: '' })).rejects.toThrow(AccessDeniedError);
    expect(await countOrders()).toBe(0);
  });

  it('verbraucht bei einem abgelehnten Zugang keine Bestellnummer', async () => {
    await expect(order({}, { token: token.unbekannt })).rejects.toThrow(AccessDeniedError);
    expect((await order()).order.orderNumber.value).toBe('BUS-2026-000001');
  });

  /**
   * Die wichtigste Zusage des ganzen Vorgangs: Der Kunde kommt aus dem
   * Token, nie aus der Anfrage. Ein mitgesendetes customer_id wirkt nicht —
   * nicht weil es geprüft würde, sondern weil es nie gelesen wird.
   */
  it('nimmt den Kunden aus dem Token, nicht aus der Anfrage', async () => {
    const { order: placed } = await order({ customer_id: 2, customerId: 2 });

    expect(placed.customerId).toBe(1);
    expect(placed.customerNameSnapshot).toBe('Testcafé Nord');
  });

  it('bestellt mit dem Token von Café Süd für Café Süd', async () => {
    const { order: placed } = await order({}, { token: token.sued });
    expect(placed.customerId).toBe(2);
    expect(placed.customerNameSnapshot).toBe('Testcafé Süd');
  });
});

describe('placeCafeOrder — Fulfillment', () => {
  /**
   * Die Bestelloberfläche fragt nicht „Lieferung oder Abholung?". Der Wert
   * steht am Kunden. Ein Klick weniger.
   */
  it('nimmt den Fulfillment-Typ aus den Stammdaten des Cafés', async () => {
    expect((await order()).order.fulfillmentType).toBe('delivery');
    expect((await order({}, { token: token.abholung })).order.fulfillmentType).toBe('pickup');
  });

  it('lässt einen mitgesendeten Fulfillment-Typ nicht wirken', async () => {
    // Ein Lieferkunde soll nicht versehentlich eine Abholung erzeugen.
    const { order: placed } = await order({ fulfillment_type: 'pickup' });
    expect(placed.fulfillmentType).toBe('delivery');
    expect(placed.deliveryAddressSnapshot).toBe('Beispielweg 1, 40213 Düsseldorf');
  });

  it('speichert bei Abholung keine Lieferadresse', async () => {
    const { order: placed } = await order({}, { token: token.abholung });
    expect(placed.deliveryAddressSnapshot).toBeNull();
  });
});

describe('placeCafeOrder — Preise kommen ausschließlich aus D1', () => {
  it('ignoriert mitgesendete Preisfelder vollständig', async () => {
    await order({
      items: [{ product_id: 1, quantity: 3, unit_price_cents: 1, line_total_cents: 3, price: '0.01' }],
      total_amount_cents: 3,
      total: '0.03',
    });

    const row = await env.DB.prepare(
      `SELECT o.total_amount_cents, i.unit_price_cents, i.line_total_cents
         FROM orders o JOIN order_items i ON i.order_id = o.id`,
    ).first<{ total_amount_cents: number; unit_price_cents: number; line_total_cents: number }>();

    expect(row).toEqual({ total_amount_cents: 1305, unit_price_cents: 435, line_total_cents: 1305 });
  });

  it('nimmt den Preis aus der Produkttabelle', async () => {
    await env.DB.prepare('UPDATE products SET price_cents = 520 WHERE id = 1').run();
    expect((await order()).order.total().cents).toBe(1560);
  });

  it('hält den Preis-Snapshot fest, wenn sich der Preis danach ändert', async () => {
    await order();
    await env.DB.prepare('UPDATE products SET price_cents = 520 WHERE id = 1').run();

    const stored = await findOrderByNumber(env.DB, 'BUS-2026-000001');
    expect(stored?.items[0]?.unitPrice.cents).toBe(435);
    expect(stored?.total().cents).toBe(1305);
  });

  it('rechnet über mehrere Positionen richtig', async () => {
    const { order: placed } = await order({
      items: [{ product_id: 1, quantity: 7 }, { product_id: 2, quantity: 4 }],
    });
    expect(placed.total().cents).toBe(7 * 435 + 4 * 280);
  });

  it('lässt Status und Bestellnummer nicht einschleusen', async () => {
    const { order: placed } = await order({ status: 'completed', order_number: 'BUS-2099-999999' });
    expect(placed.status).toBe('new');
    expect(placed.orderNumber.value).toBe('BUS-2026-000001');
  });
});

describe('placeCafeOrder — Positionen', () => {
  it('lehnt eine Bestellung ohne Positionen ab', async () => {
    await expect(order({ items: [] })).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  it('erzeugt für Menge 0 keine Position', async () => {
    const { order: placed } = await order({
      items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 0 }],
    });

    expect(placed.items).toHaveLength(1);
    expect(placed.items[0]?.productId).toBe(1);
  });

  it('lehnt eine Bestellung ab, in der alle Mengen 0 sind', async () => {
    await expect(
      order({ items: [{ product_id: 1, quantity: 0 }, { product_id: 2, quantity: 0 }] }),
    ).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine negative Menge ab', async () => {
    await expect(order({ items: [{ product_id: 1, quantity: -1 }] })).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine gebrochene Menge ab', async () => {
    await expect(order({ items: [{ product_id: 1, quantity: 2.5 }] })).rejects.toThrow(ValidationError);
  });

  it('lehnt ein inaktives Produkt ab und speichert nichts', async () => {
    await expect(order({ items: [{ product_id: 9, quantity: 1 }] })).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt ein unbekanntes Produkt ab', async () => {
    await expect(order({ items: [{ product_id: 4711, quantity: 1 }] })).rejects.toThrow(ValidationError);
  });

  it('lehnt dasselbe Produkt zweimal ab', async () => {
    await expect(
      order({ items: [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }] }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('placeCafeOrder — Liefertag und Notiz', () => {
  it('lehnt einen Tag in der Vergangenheit ab', async () => {
    await expect(order({ fulfillment_date: '2026-08-23' })).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  it('erlaubt den heutigen Tag', async () => {
    expect((await order({ fulfillment_date: '2026-08-24' })).order.fulfillmentDate.value).toBe('2026-08-24');
  });

  it('lehnt ein unmögliches Datum ab', async () => {
    await expect(order({ fulfillment_date: '2026-02-30' })).rejects.toThrow(ValidationError);
    await expect(order({ fulfillment_date: '25.08.2026' })).rejects.toThrow(ValidationError);
    await expect(order({ fulfillment_date: '' })).rejects.toThrow(ValidationError);
    await expect(order({ fulfillment_date: 20260825 })).rejects.toThrow(ValidationError);
  });

  /**
   * Eine Plausibilitätsgrenze gegen Tippfehler, keine Lieferkalender-Regel:
   * '2036-08-25' statt '2026-08-25' stünde sonst zehn Jahre lang in der
   * Produktionsliste.
   */
  it('lehnt einen Tag jenseits eines Jahres ab', async () => {
    await expect(order({ fulfillment_date: '2027-08-26' })).rejects.toThrow(ValidationError);
    await expect(order({ fulfillment_date: '2036-08-25' })).rejects.toThrow(ValidationError);
  });

  it('erlaubt den letzten Tag innerhalb des Horizonts', async () => {
    expect((await order({ fulfillment_date: '2027-08-24' })).order.fulfillmentDate.value).toBe('2027-08-24');
  });

  it('erzwingt die Längengrenze der Notiz', async () => {
    await expect(order({ note: 'ü'.repeat(501) })).rejects.toThrow(ValidationError);
    expect((await order({ note: 'ü'.repeat(500) })).order.note).toHaveLength(500);
  });

  it('meldet mehrere Eingabefehler gemeinsam', async () => {
    try {
      await order({ fulfillment_date: '2026-08-01', note: 'x'.repeat(501), items: [] });
      expect.unreachable('hätte scheitern müssen');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).fieldCount()).toBeGreaterThanOrEqual(3);
    }
  });

  it('verbraucht bei einem Eingabefehler keine Bestellnummer', async () => {
    await expect(order({ items: [] })).rejects.toThrow(ValidationError);
    expect((await order()).order.orderNumber.value).toBe('BUS-2026-000001');
  });
});

describe('placeCafeOrder — Doppelklick', () => {
  it('erzeugt bei derselben Kennung genau eine Bestellung', async () => {
    const submissionId = 'sub-doppelt-0001';

    const first = await order({}, { submissionId });
    const second = await order({}, { submissionId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.order.orderNumber.value).toBe(first.order.orderNumber.value);
    expect(await countOrders()).toBe(1);
  });

  it('liefert bei der Wiederholung die gespeicherte Bestellung, nicht die neue Anfrage', async () => {
    const submissionId = 'sub-doppelt-0002';
    await order({ items: [{ product_id: 1, quantity: 3 }] }, { submissionId });

    // Der zweite Aufruf behauptet etwas anderes — er darf nichts verändern.
    const { order: replay, created } = await order(
      { items: [{ product_id: 2, quantity: 99 }] },
      { submissionId },
    );

    expect(created).toBe(false);
    expect(replay.items).toHaveLength(1);
    expect(replay.items[0]?.productId).toBe(1);
    expect(replay.total().cents).toBe(1305);
    expect(await countOrders()).toBe(1);
  });

  it('trennt die Kennungen zweier Cafés', async () => {
    const submissionId = 'sub-gleich-0003';
    await order({}, { submissionId, token: token.nord });
    await order({}, { submissionId, token: token.sued });

    expect(await countOrders()).toBe(2);
  });

  it('lässt nach einer Bestellung eine neue Kennung durch', async () => {
    await order({}, { submissionId: 'sub-erste-0004' });
    await order({}, { submissionId: 'sub-zweite-0005' });
    expect(await countOrders()).toBe(2);
  });

  it('lehnt eine formal ungültige Kennung ab', async () => {
    await expect(order({}, { submissionId: 'kurz' })).rejects.toThrow(ValidationError);
    await expect(order({}, { submissionId: 'a'.repeat(65) })).rejects.toThrow(ValidationError);
    await expect(order({}, { submissionId: 'nicht erlaubt!' })).rejects.toThrow(ValidationError);
    expect(await countOrders()).toBe(0);
  });

  /**
   * Der eigentliche Doppelklick: zwei Anfragen, die sich überlappen. Die
   * Vorabprüfung greift hier nicht, weil beide noch nichts sehen — der
   * UNIQUE-Index muss es auffangen.
   */
  it('hält auch zwei gleichzeitige Absendungen aus', async () => {
    const submissionId = 'sub-gleichzeitig-0006';

    const results = await Promise.all([
      order({}, { submissionId }),
      order({}, { submissionId }),
    ]);

    expect(await countOrders()).toBe(1);
    expect(results[0].order.orderNumber.value).toBe(results[1].order.orderNumber.value);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
});

describe('placeCafeOrder — Atomarität', () => {
  /**
   * Wird das Schreiben der Positionen unmöglich gemacht, darf auch die
   * Bestellung nicht entstehen. Geprüft wird das über einen Fremdschlüssel,
   * den das Produkt nach dem Laden des Katalogs verliert.
   */
  it('hinterlässt bei einem Fehler in einer Position keine halbe Bestellung', async () => {
    await env.DB.prepare('DROP TABLE order_items').run();

    await expect(order()).rejects.toThrow();
    expect(await countOrders()).toBe(0);

    // Aufräumen, damit die übrigen Tests dieser Datei weiterlaufen.
    await env.DB.prepare(
      `CREATE TABLE order_items (
          id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
          product_name_snapshot TEXT NOT NULL, product_unit_snapshot TEXT NOT NULL,
          unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL,
          line_total_cents INTEGER NOT NULL,
          CONSTRAINT uq_order_items_product UNIQUE (order_id, product_id),
          CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
          CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
       )`,
    ).run();
  });
});
