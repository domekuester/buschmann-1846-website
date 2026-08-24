import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Diese Datei prüft das SCHEMA, nicht den Anwendungscode. Sie ist die Antwort
 * auf die Schwäche der Vorgängerfassung: Dort war das Schema nur gelesen,
 * nie ausgeführt. Hier laufen die echten Migrationen gegen eine echte lokale
 * D1, und jede Regel wird durch einen fehlschlagenden INSERT belegt.
 */

const NOW = '2026-08-23T07:00:00.000Z';

async function seedCustomer(id = 1, fulfillment = 'delivery'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (?, ?, 'Beispielweg 1', '40213', 'Düsseldorf', 1, ?, ?, ?)`,
  )
    .bind(id, `Beispielcafé ${id}`, fulfillment, NOW, NOW)
    .run();
}

async function seedProduct(id = 1, cents = 435): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'Stück', 1, 10, ?, ?)`,
  )
    .bind(id, `Beispielprodukt ${id}`, cents, NOW, NOW)
    .run();
}

async function seedOrder(id = 1, customerId = 1, total = 1305): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                         created_at, updated_at)
     VALUES (?, ?, ?, 'Beispielcafé 1', 'delivery', '2026-08-28',
             'Beispielweg 1, 40213 Düsseldorf', 'new', ?, ?, ?)`,
  )
    .bind(id, `BUS-2026-${String(id).padStart(6, '0')}`, customerId, total, NOW, NOW)
    .run();
}

beforeEach(async () => {
  // Reihenfolge wegen der Fremdschlüssel.
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
});

describe('Migrationen', () => {
  it('haben alle Tabellen angelegt', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual([
      'customer_access_tokens',
      'customers',
      'order_items',
      'order_number_sequences',
      'orders',
      'products',
    ]);
  });

  it('haben die Indizes angelegt, die die Abfragen des Betriebs brauchen', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`,
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual([
      'idx_cat_customer',
      'idx_customers_active_name',
      'idx_order_items_order',
      'idx_order_items_product',
      'idx_orders_customer_day',
      'idx_orders_day',
      'idx_products_orderable',
    ]);
  });

  it('hinterlassen eine integre Datenbank', async () => {
    const { results } = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(results).toEqual([]);
  });
});

describe('Fremdschlüssel', () => {
  it('werden von D1 durchgesetzt', async () => {
    const { results } = await env.DB.prepare('PRAGMA foreign_keys').all<{ foreign_keys: number }>();
    expect(results[0]?.foreign_keys).toBe(1);
  });

  it('verhindern eine Bestellung ohne existierenden Kunden', async () => {
    await expect(seedOrder(1, 999)).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('verhindern eine Position ohne existierendes Produkt', async () => {
    await seedCustomer();
    await seedOrder();
    await expect(
      env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                  unit_price_cents, quantity, line_total_cents)
         VALUES (1, 999, 'Kuchen', 'Stück', 435, 3, 1305)`,
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  /** RESTRICT: Ein je bestelltes Produkt darf nicht verschwinden. */
  it('verhindern das Löschen eines bestellten Produkts', async () => {
    await seedCustomer();
    await seedProduct();
    await seedOrder();
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (1, 1, 'Beispielprodukt 1', 'Stück', 435, 3, 1305)`,
    ).run();

    await expect(env.DB.prepare('DELETE FROM products WHERE id = 1').run()).rejects.toThrow(/FOREIGN KEY/i);
  });

  /** RESTRICT: Ein Kunde mit Bestellungen wird deaktiviert, nicht gelöscht. */
  it('verhindern das Löschen eines Kunden mit Bestellungen', async () => {
    await seedCustomer();
    await seedOrder();
    await expect(env.DB.prepare('DELETE FROM customers WHERE id = 1').run()).rejects.toThrow(/FOREIGN KEY/i);
  });

  /** CASCADE: Positionen ohne Bestellung sind sinnlos. */
  it('räumen Positionen mit ihrer Bestellung ab', async () => {
    await seedCustomer();
    await seedProduct();
    await seedOrder();
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (1, 1, 'Beispielprodukt 1', 'Stück', 435, 3, 1305)`,
    ).run();

    await env.DB.prepare('DELETE FROM orders WHERE id = 1').run();
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items').all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });
});

describe('CHECK-Bedingungen', () => {
  it('lehnen einen negativen Produktpreis ab', async () => {
    await expect(seedProduct(1, -1)).rejects.toThrow(/CHECK constraint/i);
  });

  /** Der Kern des Geldmodells: kein Fließkommawert in einer Preisspalte. */
  it('lehnen einen Fließkommapreis ab', async () => {
    await expect(seedProduct(1, 4.35)).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen eine Menge von 0 oder weniger ab', async () => {
    await seedCustomer();
    await seedProduct();
    await seedOrder();
    for (const quantity of [0, -1]) {
      await expect(
        env.DB.prepare(
          `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                    unit_price_cents, quantity, line_total_cents)
           VALUES (1, 1, 'Kuchen', 'Stück', 435, ?, 0)`,
        )
          .bind(quantity)
          .run(),
      ).rejects.toThrow(/CHECK constraint/i);
    }
  });

  /** Die Rechnung selbst als Constraint — ein manipulierter Betrag kommt nicht durch. */
  it('lehnen einen Positionsbetrag ab, der nicht Preis mal Menge ist', async () => {
    await seedCustomer();
    await seedProduct();
    await seedOrder();
    await expect(
      env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                  unit_price_cents, quantity, line_total_cents)
         VALUES (1, 1, 'Kuchen', 'Stück', 435, 3, 1)`,
      ).run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen dasselbe Produkt zweimal in einer Bestellung ab', async () => {
    await seedCustomer();
    await seedProduct();
    await seedOrder();
    const insert = () =>
      env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                  unit_price_cents, quantity, line_total_cents)
         VALUES (1, 1, 'Kuchen', 'Stück', 435, 3, 1305)`,
      ).run();

    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE constraint/i);
  });

  it('lehnen unbekannte Statuswerte ab', async () => {
    await seedCustomer();
    await expect(
      env.DB.prepare(
        `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                             fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                             created_at, updated_at)
         VALUES ('BUS-2026-000001', 1, 'Café', 'delivery', '2026-08-28', 'Weg 1', 'geliefert', 100, ?, ?)`,
      )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen unbekannte Fulfillment-Werte ab', async () => {
    await seedCustomer();
    await expect(
      env.DB.prepare(
        `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                             fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                             created_at, updated_at)
         VALUES ('BUS-2026-000001', 1, 'Café', 'versand', '2026-08-28', 'Weg 1', 'new', 100, ?, ?)`,
      )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen eine Lieferung ohne Adress-Snapshot ab', async () => {
    await seedCustomer();
    await expect(
      env.DB.prepare(
        `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                             fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                             created_at, updated_at)
         VALUES ('BUS-2026-000001', 1, 'Café', 'delivery', '2026-08-28', NULL, 'new', 100, ?, ?)`,
      )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen eine fehlerhafte Bestellnummer ab', async () => {
    await seedCustomer();
    for (const bad of ['BUS-26-1', 'bus-2026-000123', 'BUS-20X6-000123', 'XYZ-2026-000123', 'BUS-2026-0001234']) {
      await expect(
        env.DB.prepare(
          `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                               fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                               created_at, updated_at)
           VALUES (?, 1, 'Café', 'delivery', '2026-08-28', 'Weg 1', 'new', 100, ?, ?)`,
        )
          .bind(bad, NOW, NOW)
          .run(),
      ).rejects.toThrow(/CHECK constraint/i);
    }
  });

  /**
   * Das Datumsconstraint prüft nicht nur die Form, sondern den Kalender:
   * date() normalisiert, und der IS-Vergleich schlägt zu, wenn dabei etwas
   * anderes herauskommt als das, was gespeichert werden sollte.
   */
  it('lehnen ungültige Liefertage ab, nicht nur falsch geformte', async () => {
    await seedCustomer();
    for (const bad of ['2026-02-30', '2026-13-01', '2026-8-28', 'morgen', '28.08.2026', '']) {
      await expect(
        env.DB.prepare(
          `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                               fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                               created_at, updated_at)
           VALUES ('BUS-2026-000042', 1, 'Café', 'delivery', ?, 'Weg 1', 'new', 100, ?, ?)`,
        )
          .bind(bad, NOW, NOW)
          .run(),
      ).rejects.toThrow(/CHECK constraint/i);
    }
  });

  it('lehnen dieselbe Bestellnummer zweimal ab', async () => {
    await seedCustomer();
    await seedOrder(1);
    await expect(
      env.DB.prepare(
        `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                             fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                             created_at, updated_at)
         VALUES ('BUS-2026-000001', 1, 'Café', 'delivery', '2026-08-28', 'Weg 1', 'new', 100, ?, ?)`,
      )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint/i);
  });

  it('lehnen einen Lieferkunden ohne Adresse ab', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO customers (name, is_active, default_fulfillment, created_at, updated_at)
         VALUES ('Café ohne Adresse', 1, 'delivery', ?, ?)`,
      )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('erlauben einen Abholkunden ohne Adresse', async () => {
    await env.DB.prepare(
      `INSERT INTO customers (name, is_active, default_fulfillment, created_at, updated_at)
       VALUES ('Beispiel-Abholkunde', 1, 'pickup', ?, ?)`,
    )
      .bind(NOW, NOW)
      .run();

    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});

/**
 * Der Zugang eines Cafés. Die Anwendung ist die erste Verteidigungslinie —
 * hier steht die zweite, damit ein Datensatz auch dann nicht in einen
 * unmöglichen Zustand gerät, wenn er auf anderem Weg entsteht.
 */
describe('customer_access_tokens', () => {
  const HASH = 'a'.repeat(64);

  async function seedToken(hash = HASH, customerId = 1, isActive = 1, revokedAt: string | null = null) {
    await env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(customerId, hash, isActive, NOW, revokedAt)
      .run();
  }

  it('nehmen einen gültigen Zugang auf', async () => {
    await seedCustomer();
    await seedToken();

    const row = await env.DB.prepare(
      'SELECT customer_id, token_hash, is_active, revoked_at FROM customer_access_tokens',
    ).first<{ customer_id: number; token_hash: string; is_active: number; revoked_at: string | null }>();

    expect(row).toEqual({ customer_id: 1, token_hash: HASH, is_active: 1, revoked_at: null });
  });

  it('lehnen einen Hash ab, der keiner ist', async () => {
    await seedCustomer();
    // 64 Zeichen, aber kein Hex — genau der Fall, den eine reine Längenprüfung
    // durchließe.
    await expect(seedToken('z'.repeat(64))).rejects.toThrow(/CHECK constraint/i);
    await expect(seedToken('a'.repeat(63))).rejects.toThrow(/CHECK constraint/i);
    await expect(seedToken('A'.repeat(64))).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen denselben Hash zweimal ab', async () => {
    await seedCustomer();
    await seedToken();
    await expect(seedToken()).rejects.toThrow(/UNIQUE constraint/i);
  });

  it('lehnen einen Zugang ohne Kunden ab', async () => {
    await expect(seedToken(HASH, 99)).rejects.toThrow(/FOREIGN KEY constraint/i);
  });

  /** Ein Widerruf ohne Zeitpunkt wäre eine Behauptung ohne Beleg. */
  it('verlangen bei einem Widerruf einen Widerrufszeitpunkt', async () => {
    await seedCustomer();
    await expect(seedToken(HASH, 1, 0, null)).rejects.toThrow(/CHECK constraint/i);
    await seedToken(HASH, 1, 0, NOW);
  });

  it('erlauben mehrere aktive Zugänge je Café — für die Rotation', async () => {
    await seedCustomer();
    await seedToken('a'.repeat(64));
    await seedToken('b'.repeat(64));

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM customer_access_tokens WHERE customer_id = 1 AND is_active = 1',
    ).first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  /**
   * Anders als bei orders (RESTRICT): Ein Zugang ohne Kunden ist kein
   * historisches Dokument, sondern ein Sicherheitsproblem.
   */
  it('verschwinden mit ihrem Kunden', async () => {
    await seedCustomer();
    await seedToken();
    await env.DB.prepare('DELETE FROM customers WHERE id = 1').run();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_access_tokens').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

/**
 * Die Absendekennung. Sie ist der Schutz gegen den Daumen, der zweimal auf
 * „Bestellung senden" tippt — und sie hängt an der Datenbank, nicht am
 * Anwendungscode.
 */
describe('orders.submission_id', () => {
  async function seedOrderWithSubmission(id: number, customerId: number, submissionId: string | null) {
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, delivery_address_snapshot, status, total_amount_cents,
                           submission_id, created_at, updated_at)
       VALUES (?, ?, ?, 'Beispielcafé', 'delivery', '2026-08-28',
               'Beispielweg 1, 40213 Düsseldorf', 'new', 100, ?, ?, ?)`,
    )
      .bind(id, `BUS-2026-${String(id).padStart(6, '0')}`, customerId, submissionId, NOW, NOW)
      .run();
  }

  it('nehmen eine Bestellung mit Absendekennung auf', async () => {
    await seedCustomer();
    await seedOrderWithSubmission(1, 1, 'abc-123');

    const row = await env.DB.prepare('SELECT submission_id FROM orders').first<{ submission_id: string }>();
    expect(row?.submission_id).toBe('abc-123');
  });

  it('lehnen dieselbe Absendekennung beim selben Café zweimal ab', async () => {
    await seedCustomer();
    await seedOrderWithSubmission(1, 1, 'abc-123');
    await expect(seedOrderWithSubmission(2, 1, 'abc-123')).rejects.toThrow(/UNIQUE constraint/i);
  });

  /** Zwei Cafés dürfen zufällig dieselbe Kennung erzeugen, ohne sich zu stören. */
  it('erlauben dieselbe Absendekennung bei verschiedenen Cafés', async () => {
    await seedCustomer(1);
    await seedCustomer(2);
    await seedOrderWithSubmission(1, 1, 'abc-123');
    await seedOrderWithSubmission(2, 2, 'abc-123');

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  /**
   * Der Index ist partiell. Ohne das WHERE wäre NULL zwar in SQLite ohnehin
   * nicht eindeutigkeitspflichtig — aber die Absicht steht so im Schema und
   * nicht in einer Fußnote über SQLite-Eigenheiten.
   */
  it('erlauben beliebig viele Bestellungen ohne Absendekennung', async () => {
    await seedCustomer();
    await seedOrderWithSubmission(1, 1, null);
    await seedOrderWithSubmission(2, 1, null);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
    expect(row?.n).toBe(2);
  });
});
