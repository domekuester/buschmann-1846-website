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
    'catalog_product_prices',
    'catalog_products',
    'order_items',
    'orders',
    'auth_sessions',
    'auth_accounts',
    'products',
    'customers',
    'order_number_sequences',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('Migrationen', () => {
  it('ergänzt nullable Last-Status-Auditfelder ohne spekulativen Index', async () => {
    const { results: spalten } = await env.DB.prepare(`PRAGMA table_info(orders)`).all<{
      name: string;
      notnull: number;
    }>();

    expect(spalten.filter((spalte) => spalte.name.startsWith('status_changed_'))).toEqual([
      expect.objectContaining({ name: 'status_changed_by_account_id', notnull: 0 }),
      expect.objectContaining({ name: 'status_changed_at', notnull: 0 }),
    ]);

    const { results: indizes } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%status_changed%'`,
    ).all<{ name: string }>();
    expect(indizes).toEqual([]);
  });

  it('haben alle Tabellen angelegt', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual([
      'auth_accounts',
      'auth_sessions',
      'catalog_product_prices',
      'catalog_products',
      'customers',
      'email_notification_settings',
      'email_operator_recipients',
      'email_outbox',
      'order_items',
      'order_number_sequences',
      'order_policy',
      'orders',
      'price_lists',
      'products',
    ]);
  });

  it('haben die Indizes angelegt, die die Abfragen des Betriebs brauchen', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`,
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual([
      'idx_auth_accounts_customer',
      'idx_auth_sessions_account',
      'idx_auth_sessions_expiry',
      'idx_customers_active_name',
      'idx_customers_price_list',
      'idx_email_outbox_order',
      'idx_email_outbox_status_created',
      'idx_order_items_order',
      'idx_order_items_product',
      'idx_orders_customer_day',
      'idx_orders_day',
      'idx_products_catalog_product',
      'idx_products_orderable',
    ]);
  });

  it('hinterlassen eine integre Datenbank', async () => {
    const { results } = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(results).toEqual([]);
  });
});

describe('Fremdschlüssel', () => {
  it('setzt den letzten Status-Actor beim Löschen des Admin-Kontos auf NULL', async () => {
    await seedCustomer();
    await seedOrder();
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
    await env.DB.prepare(
      `UPDATE orders
          SET status_changed_by_account_id = 7,
              status_changed_at = '2026-08-25T12:32:00.000Z'
        WHERE id = 1`,
    ).run();

    await env.DB.prepare(`DELETE FROM auth_accounts WHERE id = 7`).run();

    const row = await env.DB.prepare(
      `SELECT status_changed_by_account_id, status_changed_at FROM orders WHERE id = 1`,
    ).first<{ status_changed_by_account_id: number | null; status_changed_at: string | null }>();
    expect(row).toEqual({
      status_changed_by_account_id: null,
      status_changed_at: '2026-08-25T12:32:00.000Z',
    });
  });

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

/**
 * Die Anmeldekonten. Die Anwendung ist die erste Verteidigungslinie — hier
 * steht die zweite, damit ein Datensatz auch dann nicht in einen unmöglichen
 * Zustand gerät, wenn er auf anderem Weg entsteht.
 */
describe('auth_accounts', () => {
  const SALT = 'a'.repeat(32);
  const VERIFIER = 'b'.repeat(64);

  async function seedAccount(
    overrides: Partial<{
      identifier: string;
      role: string;
      customerId: number | null;
      algorithm: string;
      iterations: number;
      salt: string;
      verifier: string;
      isActive: number;
      failedAttempts: number;
      lockedUntil: string | null;
    }> = {},
  ): Promise<void> {
    const werte = {
      identifier: 'testcafe',
      role: 'customer',
      customerId: 1,
      algorithm: 'pbkdf2-sha256',
      iterations: 600000,
      salt: SALT,
      verifier: VERIFIER,
      isActive: 1,
      failedAttempts: 0,
      lockedUntil: null as string | null,
      ...overrides,
    };

    await env.DB.prepare(
      `INSERT INTO auth_accounts (login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations,
                                  credential_salt, credential_verifier, is_active,
                                  failed_attempts, locked_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        werte.identifier,
        werte.role,
        werte.customerId,
        werte.algorithm,
        werte.iterations,
        werte.salt,
        werte.verifier,
        werte.isActive,
        werte.failedAttempts,
        werte.lockedUntil,
        NOW,
        NOW,
      )
      .run();
  }

  it('nehmen ein gültiges Café-Konto auf', async () => {
    await seedCustomer();
    await seedAccount();

    const row = await env.DB.prepare(
      'SELECT login_identifier_normalized, role, customer_id, failed_attempts FROM auth_accounts',
    ).first<{ login_identifier_normalized: string; role: string; customer_id: number; failed_attempts: number }>();

    expect(row).toEqual({
      login_identifier_normalized: 'testcafe',
      role: 'customer',
      customer_id: 1,
      failed_attempts: 0,
    });
  });

  it('nehmen ein gültiges Admin-Konto ohne Kundenbezug auf', async () => {
    await seedAccount({ identifier: 'admin@example.test', role: 'admin', customerId: null });

    const row = await env.DB.prepare(
      'SELECT role, customer_id FROM auth_accounts',
    ).first<{ role: string; customer_id: number | null }>();

    expect(row).toEqual({ role: 'admin', customer_id: null });
  });

  it('kennen genau zwei Rollen', async () => {
    await seedCustomer();
    for (const rolle of ['manager', 'superadmin', 'accounting', 'owner', 'ADMIN', '']) {
      await expect(seedAccount({ role: rolle })).rejects.toThrow(/CHECK constraint/i);
    }
  });

  /**
   * Ein Café ohne Kundenbezug könnte nicht bestellen. Der Fall darf gar nicht
   * erst entstehen.
   */
  it('verlangen bei einem Café einen Kundenbezug', async () => {
    await expect(seedAccount({ role: 'customer', customerId: null })).rejects.toThrow(
      /CHECK constraint/i,
    );
  });

  /**
   * Der wichtigere der beiden: Ein Admin MIT Kundenbezug könnte im Namen
   * eines Cafés bestellen, ohne dass es im Bestellablauf sichtbar wäre.
   * Rollen sind getrennt, nicht gestuft.
   */
  it('verbieten einem Admin einen Kundenbezug', async () => {
    await seedCustomer();
    await expect(
      seedAccount({ identifier: 'admin@example.test', role: 'admin', customerId: 1 }),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen dieselbe Kennung zweimal ab', async () => {
    await seedCustomer();
    await seedAccount();
    await expect(seedAccount()).rejects.toThrow(/UNIQUE constraint/i);
  });

  it('lehnen eine leere Kennung ab', async () => {
    await seedCustomer();
    await expect(seedAccount({ identifier: '' })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ identifier: '   ' })).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen einen unbekannten Algorithmus ab', async () => {
    await seedCustomer();
    for (const algorithmus of ['md5', 'sha256', 'bcrypt', '']) {
      await expect(seedAccount({ algorithm: algorithmus })).rejects.toThrow(/CHECK constraint/i);
    }
  });

  /**
   * Die Untergrenze gehört ins Schema und nicht in den Code: credential.ts ist
   * ein Primitiv und rechnet mit dem, was es bekommt. Durchgesetzt wird die
   * Grenze dort, wo geschrieben wird.
   */
  it('lehnen einen zu niedrigen Work Factor ab', async () => {
    await seedCustomer();
    for (const iterationen of [0, 1, 1000, 99999]) {
      await expect(seedAccount({ iterations: iterationen })).rejects.toThrow(/CHECK constraint/i);
    }
    await seedAccount({ iterations: 100000 });
  });

  /**
   * Genau der Fall, den eine reine Längenprüfung durchließe: ein
   * versehentlich eingetragener Klartext derselben Länge.
   */
  it('lehnen Salt und Verifier ab, die keine Hexwerte sind', async () => {
    await seedCustomer();
    await expect(seedAccount({ salt: 'z'.repeat(32) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ salt: 'A'.repeat(32) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ salt: 'a'.repeat(31) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ verifier: 'z'.repeat(64) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ verifier: 'b'.repeat(63) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedAccount({ verifier: 'b'.repeat(65) })).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen einen negativen Fehlversuchszähler ab', async () => {
    await seedCustomer();
    await expect(seedAccount({ failedAttempts: -1 })).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen ein Konto ohne Kunden ab', async () => {
    await expect(seedAccount({ customerId: 99 })).rejects.toThrow(/FOREIGN KEY constraint/i);
  });

  /**
   * CASCADE, anders als bei orders: Eine Bestellung ist ein historisches
   * Dokument. Ein Anmeldekonto ohne Kunden ist ein Sicherheitsproblem.
   */
  it('verschwinden mit ihrem Kunden', async () => {
    await seedCustomer();
    await seedAccount();
    await env.DB.prepare('DELETE FROM customers WHERE id = 1').run();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_accounts').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

/**
 * Die Sitzungen. Der Rohtoken steht hier nicht — geprüft wird, dass das Schema
 * ihn auch gar nicht aufnehmen könnte.
 */
describe('auth_sessions', () => {
  const HASH = 'c'.repeat(64);
  const CSRF = 'd'.repeat(43);
  const SPAETER = '2026-09-23T07:00:00.000Z';

  async function seedAccountFor(id = 1): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations,
                                  credential_salt, credential_verifier, is_active,
                                  failed_attempts, created_at, updated_at)
       VALUES (?, ?, 'admin', NULL, 'pbkdf2-sha256', 600000, ?, ?, 1, 0, ?, ?)`,
    )
      .bind(id, `admin${id}@example.test`, 'a'.repeat(32), 'b'.repeat(64), NOW, NOW)
      .run();
  }

  async function seedSession(
    overrides: Partial<{
      accountId: number;
      tokenHash: string;
      csrf: string;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
    }> = {},
  ): Promise<void> {
    const werte = {
      accountId: 1,
      tokenHash: HASH,
      csrf: CSRF,
      createdAt: NOW,
      expiresAt: SPAETER,
      revokedAt: null as string | null,
      ...overrides,
    };

    await env.DB.prepare(
      `INSERT INTO auth_sessions (account_id, token_hash, csrf_token, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(werte.accountId, werte.tokenHash, werte.csrf, werte.createdAt, werte.expiresAt, werte.revokedAt)
      .run();
  }

  it('nehmen eine gültige Sitzung auf', async () => {
    await seedAccountFor();
    await seedSession();

    const row = await env.DB.prepare(
      'SELECT account_id, token_hash, csrf_token, revoked_at FROM auth_sessions',
    ).first<{ account_id: number; token_hash: string; csrf_token: string; revoked_at: string | null }>();

    expect(row).toEqual({ account_id: 1, token_hash: HASH, csrf_token: CSRF, revoked_at: null });
  });

  it('lehnen denselben Tokenhash zweimal ab', async () => {
    await seedAccountFor();
    await seedSession();
    await expect(seedSession()).rejects.toThrow(/UNIQUE constraint/i);
  });

  /**
   * Ein 43 Zeichen langer base64url-Token ist kein 64 Zeichen langer Hex-Hash.
   * Ein versehentlich gespeicherter ROHTOKEN kommt hier nicht durch — und das
   * ist der eigentliche Zweck dieser Bedingung.
   */
  it('lehnen einen Tokenhash ab, der keiner ist', async () => {
    await seedAccountFor();
    await expect(seedSession({ tokenHash: 'z'.repeat(64) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ tokenHash: 'C'.repeat(64) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ tokenHash: 'c'.repeat(43) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ tokenHash: 'c'.repeat(63) })).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen einen CSRF-Token in falscher Form ab', async () => {
    await seedAccountFor();
    await expect(seedSession({ csrf: 'd'.repeat(42) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ csrf: 'd'.repeat(44) })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ csrf: 'd'.repeat(42) + '+' })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ csrf: 'd'.repeat(42) + '=' })).rejects.toThrow(/CHECK constraint/i);
  });

  it('lehnen eine Sitzung ab, die schon bei ihrer Entstehung abgelaufen ist', async () => {
    await seedAccountFor();
    await expect(seedSession({ expiresAt: NOW })).rejects.toThrow(/CHECK constraint/i);
    await expect(seedSession({ expiresAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(
      /CHECK constraint/i,
    );
  });

  it('lehnen eine Sitzung ohne Konto ab', async () => {
    await expect(seedSession({ accountId: 99 })).rejects.toThrow(/FOREIGN KEY constraint/i);
  });

  it('verschwinden mit ihrem Konto', async () => {
    await seedAccountFor();
    await seedSession({ tokenHash: 'c'.repeat(64) });
    await seedSession({ tokenHash: 'e'.repeat(64) });
    await env.DB.prepare('DELETE FROM auth_accounts WHERE id = 1').run();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  /**
   * Die ganze Kette: Kunde weg → Konto weg → Sitzungen weg. Ein deaktivierter
   * Kunde bleibt bestehen (das ist der Normalfall), ein gelöschter nimmt
   * seinen Zugang mit.
   */
  it('verschwinden über die Kette bis zum Kunden', async () => {
    await seedCustomer();
    await env.DB.prepare(
      `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations,
                                  credential_salt, credential_verifier, is_active,
                                  failed_attempts, created_at, updated_at)
       VALUES (2, 'testcafe', 'customer', 1, 'pbkdf2-sha256', 600000, ?, ?, 1, 0, ?, ?)`,
    )
      .bind('a'.repeat(32), 'b'.repeat(64), NOW, NOW)
      .run();
    await seedSession({ accountId: 2 });

    await env.DB.prepare('DELETE FROM customers WHERE id = 1').run();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

/**
 * Die Gegenprobe zur Migration 0010: Der Capability-Link ist nicht nur aus
 * dem Code verschwunden, sondern auch aus dem Schema.
 *
 * Der Test steht hier und nicht bei den Tabellenlisten oben, weil er etwas
 * anderes belegt: Dort geht es darum, WAS es gibt; hier darum, dass es einen
 * bestimmten Weg NICHT mehr gibt.
 */
describe(() => {
  it('existiert nach den Migrationen nicht mehr', async () => {
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_access_tokens'`,
    ).first<{ name: string }>();

    expect(row).toBeNull();
  });

  it('lässt sich nicht mehr beschreiben', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at)
         VALUES (1, ?, 1, ?)`,
      )
        .bind('a'.repeat(64), NOW)
        .run(),
    ).rejects.toThrow(/no such table/i);
  });
});
