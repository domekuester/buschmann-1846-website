import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * PHASE 7C — DIE KUNDENDETAILANSICHT.
 *
 * ALLE NAMEN, BETRÄGE UND BESTELLUNGEN SIND FREI ERFUNDEN.
 */

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-27T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(
  id: number,
  identifier: string,
  role: 'admin' | 'customer',
  secret: string,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(
    id, identifier, role, role === 'customer' ? 1 : null,
    credential.algorithm, credential.iterations, credential.saltHex,
    credential.verifierHex, NOW, NOW,
  ).run();
}

async function login(identifier: string, secret: string): Promise<string> {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  return `buschmann_session_dev=${result.token}`;
}

const admin = () => login('admin@example.test', 'fiktives-admin-passwort-123');
const kunde = () => login('testcafe', 'fiktive-kunden-pin-123');

async function call(path: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

interface OrderSeed {
  id: number;
  number: string;
  customerId?: number;
  day: string;
  status?: string;
  payment?: string;
  totalCents: number;
}

async function seedOrder(order: OrderSeed): Promise<void> {
  const status = order.status ?? 'new';
  const payment = order.payment ?? 'unpaid';
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, note, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Namensschnappschuss', 'pickup', ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    order.id, order.number, order.customerId ?? 1, order.day, status, order.totalCents,
    payment, payment === 'unpaid' ? null : NOW, NOW, NOW,
  ).run();
}

async function seedItem(
  orderId: number,
  productId: number,
  unitPriceCents: number,
  quantity: number,
  unitCostCents: number | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
     VALUES (?, ?, 'Fiktives Gebäck', 'Stück', ?, ?, ?, ?)`,
  ).bind(orderId, productId, unitPriceCents, quantity, unitPriceCents * quantity, unitCostCents).run();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare("UPDATE price_lists SET is_active = 1 WHERE code IN ('gastro','private')").run();

  await env.DB.prepare(
    `INSERT INTO customers (id, name, email, phone, is_active, default_fulfillment,
                            internal_note, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 'kontakt@beispiel.test', '0211 1234567', 1, 'pickup',
             'Fiktiver Betriebshinweis', ?, ?),
            (2, 'Fiktiver Privatkunde', NULL, NULL, 1, 'pickup', NULL, ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();

  await env.DB.prepare('DELETE FROM products').run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktives Gebäck', 250, 'Stück', 1, 10, ?, ?)`,
  ).bind(NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/customers/:customerId', () => {
  it('zeigt einem Admin den Kunden mit seinem Namen', async () => {
    const response = await call('/admin/customers/1', await admin());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Fiktives Café Nord');
  });

  it('nennt die zugeordnete Preisgruppe', async () => {
    await env.DB.prepare(
      "UPDATE customers SET price_list_id = (SELECT id FROM price_lists WHERE code = 'gastro') WHERE id = 1",
    ).run();

    const html = await (await call('/admin/customers/1', await admin())).text();
    expect(html).toContain('Preisgruppe');
    expect(html).toContain('Gastronomie');
  });

  it('nennt eine fehlende Preisgruppe als „Nicht zugeordnet"', async () => {
    const html = await (await call('/admin/customers/2', await admin())).text();
    expect(html).toContain('Nicht zugeordnet');
  });

  it('benennt eine inaktiv gewordene Preisgruppe, statt sie zu ersetzen', async () => {
    await env.DB.prepare(
      "UPDATE customers SET price_list_id = (SELECT id FROM price_lists WHERE code = 'private') WHERE id = 1",
    ).run();
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'private'").run();

    const html = await (await call('/admin/customers/1', await admin())).text();
    expect(html).toContain('Privatkunden');
    expect(html).toContain('nicht mehr aktiv');
    expect(html).not.toContain('Nicht zugeordnet');
  });

  it('zeigt einen aktiven Kunden als aktiv', async () => {
    const html = await (await call('/admin/customers/1', await admin())).text();
    expect(html).toContain('Aktiv');
    expect(html).not.toContain('Inaktiv');
  });

  it('zeigt einen deaktivierten Kunden als inaktiv', async () => {
    await env.DB.prepare('UPDATE customers SET is_active = 0 WHERE id = 1').run();
    const html = await (await call('/admin/customers/1', await admin())).text();
    expect(html).toContain('Inaktiv');
  });

  it('verweigert einem Customer den Zugriff', async () => {
    const response = await call('/admin/customers/1', await kunde());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Fiktives Café Nord');
  });

  it('schickt unauthenticated über den bestehenden Loginflow', async () => {
    const response = await call('/admin/customers/1');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('beantwortet einen unbekannten Kunden mit 404 ohne Hinweis auf andere', async () => {
    const response = await call('/admin/customers/999', await admin());
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).not.toContain('Fiktives Café Nord');
    expect(html).not.toContain('Fiktiver Privatkunde');
    expect(html).not.toContain('SELECT');
    expect(html).not.toContain('customers');
  });

  it('weist eine Kennung ab, die keine positive Ganzzahl ist', async () => {
    for (const segment of ['0', '-1', '1.0', ' 1', 'abc', '1e3', '%2F1']) {
      const response = await call(`/admin/customers/${segment}`, await admin());
      expect(response.status).toBe(404);
    }
  });

  it('behält no-store und die bestehenden Security Header', async () => {
    const response = await call('/admin/customers/1', await admin());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('existiert nur als GET', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/admin/customers/1`, {
      method: 'POST', headers: { origin: ORIGIN, cookie: await admin() },
    }), environment());

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('zeigt die Bestellungen dieses Kunden', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000142', day: '2026-08-27', totalCents: 8450 });
    await seedOrder({ id: 2, number: 'BUS-2026-000137', day: '2026-08-25', totalCents: 6220 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('BUS-2026-000142');
    expect(html).toContain('BUS-2026-000137');
    expect(html).toContain('27.08.2026');
    expect(html).toContain('25.08.2026');
  });

  it('nimmt die Bestellungen anderer Kunden nicht auf', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000142', customerId: 1, day: '2026-08-27', totalCents: 8450 });
    await seedOrder({ id: 2, number: 'BUS-2026-000900', customerId: 2, day: '2026-08-26', totalCents: 1100 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('BUS-2026-000142');
    expect(html).not.toContain('BUS-2026-000900');
  });

  it('stellt die neueste Bestellung nach oben', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000001', day: '2026-08-20', totalCents: 100 });
    await seedOrder({ id: 2, number: 'BUS-2026-000002', day: '2026-08-27', totalCents: 200 });
    await seedOrder({ id: 3, number: 'BUS-2026-000003', day: '2026-08-24', totalCents: 300 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html.indexOf('BUS-2026-000002')).toBeLessThan(html.indexOf('BUS-2026-000003'));
    expect(html.indexOf('BUS-2026-000003')).toBeLessThan(html.indexOf('BUS-2026-000001'));
  });

  it('sortiert zwei Bestellungen desselben Produktionstages stabil', async () => {
    await seedOrder({ id: 7, number: 'BUS-2026-000007', day: '2026-08-27', totalCents: 100 });
    await seedOrder({ id: 8, number: 'BUS-2026-000008', day: '2026-08-27', totalCents: 200 });

    const cookie = await admin();
    const ersteSeite = await (await call('/admin/customers/1', cookie)).text();
    const zweiteSeite = await (await call('/admin/customers/1', cookie)).text();

    for (const html of [ersteSeite, zweiteSeite]) {
      expect(html.indexOf('BUS-2026-000008')).toBeLessThan(html.indexOf('BUS-2026-000007'));
    }
  });

  it('zeigt höchstens zehn Bestellungen und sagt es in der Überschrift', async () => {
    for (let i = 1; i <= 12; i += 1) {
      await seedOrder({
        id: i,
        number: `BUS-2026-${String(i).padStart(6, '0')}`,
        day: `2026-08-${String(i + 5).padStart(2, '0')}`,
        totalCents: 100 * i,
      });
    }

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('BUS-2026-000012');
    expect(html).toContain('BUS-2026-000003');
    expect(html).not.toContain('BUS-2026-000002');
    expect(html).not.toContain('BUS-2026-000001<');
    expect(html).toContain('10');
    expect(html.match(/BUS-2026-\d{6}/g)?.length).toBe(10);
  });

  it('nennt den gespeicherten Gesamtbetrag und rechnet ihn nicht aus den Positionen nach', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000142', day: '2026-08-27', totalCents: 8450 });
    // Die Positionen ergeben ABSICHTLICH einen anderen Betrag: Wer hier neu
    // rechnete, käme auf 1,00 € statt auf den Snapshot.
    await seedItem(1, 1, 100, 1);

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('84,50 €');
    expect(html).not.toContain('1,00 €');
  });

  it('zeigt den Produktionsstand mit den bestehenden Beschriftungen', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000001', day: '2026-08-27', status: 'in_production', totalCents: 100 });
    await seedOrder({ id: 2, number: 'BUS-2026-000002', day: '2026-08-26', status: 'completed', totalCents: 200 });
    await seedOrder({ id: 3, number: 'BUS-2026-000003', day: '2026-08-25', status: 'cancelled', totalCents: 300 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('In Produktion');
    expect(html).toContain('Abgeschlossen');
    expect(html).toContain('Storniert');
  });

  it('zeigt den Zahlungsstand mit den bestehenden Beschriftungen', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000001', day: '2026-08-27', payment: 'paid_card', totalCents: 100 });
    await seedOrder({ id: 2, number: 'BUS-2026-000002', day: '2026-08-26', payment: 'paid_cash', totalCents: 200 });
    await seedOrder({ id: 3, number: 'BUS-2026-000003', day: '2026-08-25', payment: 'unpaid', totalCents: 300 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    expect(html).toContain('Karte bezahlt');
    expect(html).toContain('Bar bezahlt');
    expect(html).toContain('Offen');
  });

  it('sagt bei einem Kunden ohne Bestellung, dass noch keine vorhanden ist', async () => {
    const html = await (await call('/admin/customers/2', await admin())).text();

    expect(html).toContain('Noch keine Bestellung vorhanden.');
    expect(html).not.toContain('<table');
    expect(html).toContain('Fiktiver Privatkunde');
  });

  it('zeigt weder Herstellkosten noch Rohertrag noch Marge', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000142', day: '2026-08-27', totalCents: 8450 });
    await seedItem(1, 1, 8450, 1, 771);

    const html = await (await call('/admin/customers/1', await admin())).text();

    for (const verboten of [
      '771', '7,71', 'unit_cost', 'unitCost', 'Herstellkosten', 'Rohertrag', 'Marge',
      'Deckungsbeitrag', 'cost',
    ]) {
      expect(html).not.toContain(verboten);
    }
  });

  it('zeigt editierbare Kontaktdaten und Notiz, aber keine Zugangsinternas', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000142', day: '2026-08-27', totalCents: 8450 });

    const html = await (await call('/admin/customers/1', await admin())).text();

    for (const erwartet of [
      'kontakt@beispiel.test', '0211 1234567', 'Fiktiver Betriebshinweis',
    ]) {
      expect(html).toContain(erwartet);
    }
    for (const verboten of [
      'credential_', 'token_hash', 'session_id', 'failed_attempts', 'locked_until',
      'auth_account', 'account_id', 'submission_id', 'credential_salt', 'credential_verifier',
    ]) {
      expect(html).not.toContain(verboten);
    }
  });

  it('escapet einen Kundennamen mit Markup', async () => {
    await env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (3, '<script>alert(1)</script>', 1, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run();

    const html = await (await call('/admin/customers/3', await admin())).text();

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('bricht bei einem sehr langen Kundennamen nicht und kürzt ihn nicht still', async () => {
    const langerName = `Fiktive ${'Traditionsbäckerei '.repeat(12)}Nord`.trim();
    await env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (4, ?, 1, 'pickup', ?, ?)`,
    ).bind(langerName, NOW, NOW).run();

    const response = await call('/admin/customers/4', await admin());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(langerName);
    expect(html).not.toContain('…');
  });

  it('verlinkt den Kunden aus der Kundenliste heraus', async () => {
    const html = await (await call('/admin/customers', await admin())).text();
    expect(html).toContain('href="/admin/customers/1"');
    expect(html).toContain('href="/admin/customers/2"');
  });

  it('führt von der Detailansicht zurück in die Kundenverwaltung', async () => {
    const html = await (await call('/admin/customers/1', await admin())).text();
    expect(html).toContain('href="/admin/customers"');
    expect(html).toContain('Kunden</a>');
  });

  it('nennt eine unvollständige Historie anders als eine vollständige', async () => {
    await seedOrder({ id: 1, number: 'BUS-2026-000001', day: '2026-08-27', totalCents: 100 });
    await seedOrder({ id: 2, number: 'BUS-2026-000002', day: '2026-08-26', totalCents: 200 });
    await seedOrder({ id: 3, number: 'BUS-2026-000003', day: '2026-08-25', totalCents: 300 });

    const wenige = await (await call('/admin/customers/1', await admin())).text();
    expect(wenige).toContain('alle 3 Bestellungen');
    expect(wenige).not.toContain('die letzten');

    for (let i = 4; i <= 12; i += 1) {
      await seedOrder({
        id: i,
        number: `BUS-2026-${String(i).padStart(6, '0')}`,
        day: `2026-07-${String(i).padStart(2, '0')}`,
        totalCents: 100 * i,
      });
    }

    const viele = await (await call('/admin/customers/1', await admin())).text();
    expect(viele).toContain('die letzten 10');
    expect(viele).not.toContain('alle 10');
  });
});
