import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-24T07:00:00.000Z';
const TAG = '2026-09-15';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

const environment = (): Env => ({ ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' });

async function account(id: number, identifier: string, role: 'admin' | 'customer', customerId: number | null) {
  const credential = await deriveCredential('fiktives-passwort-123', PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(`INSERT INTO auth_accounts
    (id, login_identifier_normalized, role, customer_id, credential_algorithm,
     credential_iterations, credential_salt, credential_verifier, is_active,
     failed_attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
    .bind(id, identifier, role, customerId, credential.algorithm, credential.iterations,
      credential.saltHex, credential.verifierHex, NOW, NOW).run();
}

async function login(identifier: string): Promise<string> {
  const result = await logIn(env.DB, CONFIG, { identifier, secret: 'fiktives-passwort-123', now: new Date(), existingSessionToken: null });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  return `buschmann_session_dev=${result.token}`;
}

async function call(path: string, cookie?: string): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(`INSERT INTO customers
    (id, name, email, phone, delivery_street, delivery_postal_code, delivery_city,
     is_active, default_fulfillment, created_at, updated_at)
    VALUES (1, 'Fiktives Café', 'kontakt@example.test', '0211 12345', 'Geheimweg 1', '40213', 'Düsseldorf', 1, 'pickup', ?, ?)`)
    .bind(NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO products
    (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
    VALUES (1, 'Aktueller Name', 99999, 'Aktuelle Einheit', 1, 10, ?, ?)`)
    .bind(NOW, NOW).run();
  await account(1, 'admin@example.test', 'admin', null);
  await account(2, 'kunde', 'customer', 1);
});

async function order(number: string, status: string, quantity: number, day = TAG, note: string | null = null) {
  await env.DB.prepare(`INSERT INTO orders
    (order_number, customer_id, customer_name_snapshot, fulfillment_type, fulfillment_date,
     note, status, total_amount_cents, created_at, updated_at)
    VALUES (?, 1, 'Café Snapshot', 'pickup', ?, ?, ?, 123456, ?, ?)`)
    .bind(number, day, note, status, NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO order_items
    (order_id, product_id, product_name_snapshot, product_unit_snapshot,
     unit_price_cents, quantity, line_total_cents)
    VALUES ((SELECT id FROM orders WHERE order_number = ?), 1, 'Käsekuchen Snapshot', '26-cm-Ring', 99999, ?, ?)`)
    .bind(number, quantity, 99999 * quantity).run();
}

describe('GET /admin/production-list', () => {
  it('verlangt Adminzugang und trägt private Security Header', async () => {
    expect((await call(`/admin/production-list?date=${TAG}`)).status).toBe(303);
    expect((await call(`/admin/production-list?date=${TAG}`, await login('kunde'))).status).toBe(403);

    const response = await call(`/admin/production-list?date=${TAG}`, await login('admin@example.test'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('aggregiert offene Snapshot-Produkte nach fulfillment_date und schließt Endstatus aus', async () => {
    await order('BUS-2026-000001', 'new', 2, TAG, 'Noch nicht bestätigt');
    await order('BUS-2026-000002', 'in_production', 3, TAG, 'Bis 10 Uhr <bereit>.');
    await order('BUS-2026-000003', 'completed', 50, TAG, 'Nicht zeigen');
    await order('BUS-2026-000004', 'cancelled', 70, TAG, 'Nie zeigen');
    await order('BUS-2026-000005', 'confirmed', 90, '2026-09-16');

    const html = await (await call(`/admin/production-list?date=${TAG}`, await login('admin@example.test'))).text();
    expect(html).toContain('Käsekuchen Snapshot');
    expect(html).toContain('26-cm-Ring');
    expect(html).toContain('>3<');
    expect(html).toContain('Bis 10 Uhr &lt;bereit&gt;.');
    expect(html).not.toContain('Noch nicht bestätigt');
    for (const forbidden of ['Aktueller Name', 'Aktuelle Einheit', '999,99', '1234,56', 'kontakt@example.test', '0211 12345', 'Geheimweg 1', 'Nicht zeigen', 'Nie zeigen']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('weist ungültige und mehrfache Datumswerte ab und ignoriert unbekannte Parameter', async () => {
    const cookie = await login('admin@example.test');
    expect((await call('/admin/production-list?date=2026-02-30', cookie)).status).toBe(400);
    expect((await call(`/admin/production-list?date=${TAG}&date=2026-09-16`, cookie)).status).toBe(400);
    const unknown = await call(`/admin/production-list?date=${TAG}&return=https://example.test`, cookie);
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).not.toContain('https://example.test');
  });

  it('liefert für einen leeren Tag den druckbaren Empty State', async () => {
    const html = await (await call(`/admin/production-list?date=${TAG}`, await login('admin@example.test'))).text();
    expect(html).toContain('Für diesen Produktionstag ist aktuell nichts mehr zu produzieren.');
  });

  it('ist vom Tagesdashboard und von der Produktion mit exakt demselben Datum erreichbar', async () => {
    const cookie = await login('admin@example.test');
    const dashboard = await (await call(`/admin/dashboard?date=${TAG}`, cookie)).text();
    const production = await (await call(`/admin?date=${TAG}`, cookie)).text();
    const target = `href="/admin/production-list?date=${TAG}"`;

    expect(dashboard).toContain(target);
    expect(production).toContain(target);
    expect(dashboard).toContain('Produktionsliste drucken');
    expect(production).toContain('Produktionsliste drucken');
  });
});
