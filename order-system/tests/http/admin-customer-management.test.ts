import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-28T10:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const environment = (): Env => ({ ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' });

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const credential = await deriveCredential('fiktives-admin-passwort-123', PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES ('admin@example.test', 'admin', NULL, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex, NOW, NOW).run();
});

async function admin(): Promise<{ cookie: string; csrf: string }> {
  const login = await logIn(env.DB, CONFIG, {
    identifier: 'admin@example.test', secret: 'fiktives-admin-passwort-123',
    now: new Date(NOW), existingSessionToken: null,
  });
  if (!login) throw new Error('Testlogin fehlgeschlagen');
  return { cookie: `buschmann_session_dev=${login.token}`, csrf: login.csrfToken };
}

function fields(csrf: string, overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    csrf_token: csrf,
    name: 'Fiktives Café',
    customer_code: 'CAFEMORGEN',
    contact_person: 'Erika Beispiel',
    email: 'erika@example.test',
    phone: '0211 123456',
    delivery_street: 'Teststraße 1',
    delivery_postal_code: '40213',
    delivery_city: 'Düsseldorf',
    price_group: 'gastro',
    fulfillment: 'delivery',
    is_active: '1',
    internal_note: 'Lieferung an der Rückseite',
    pin: '00123456',
    ...overrides,
  }).toString();
}

async function post(path: string, options: { cookie?: string; origin?: string | null; body?: string } = {}): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: options.body ?? '' }), environment());
}

describe('Kunden-Self-Service', () => {
  it('legt Kunde, Preisgruppe und PIN-Zugang an', async () => {
    const session = await admin();
    const response = await post('/api/admin/customers', { cookie: session.cookie, body: fields(session.csrf) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/customers?notice=customer_created');
    expect(await env.DB.prepare(
      `SELECT c.name, c.default_fulfillment, c.is_active, l.code AS price_group,
              a.login_identifier_normalized AS customer_code
         FROM customers c JOIN price_lists l ON l.id = c.price_list_id
         JOIN auth_accounts a ON a.customer_id = c.id`,
    ).first()).toEqual({
      name: 'Fiktives Café', default_fulfillment: 'delivery', is_active: 1,
      price_group: 'gastro', customer_code: 'cafemorgen',
    });
  });

  it('ändert Kunde, Preisgruppe, Erfüllung und Aktivität und reaktiviert wieder', async () => {
    const session = await admin();
    await post('/api/admin/customers', { cookie: session.cookie, body: fields(session.csrf) });
    const customer = await env.DB.prepare('SELECT id, updated_at FROM customers').first<{ id: number; updated_at: string }>();
    if (!customer) throw new Error('Kunde fehlt');
    const edit = fields(session.csrf, {
      expected_updated_at: customer.updated_at,
      name: 'Fiktive Abholung', customer_code: 'PRIVATDEMO',
      contact_person: '', email: '', phone: '',
      delivery_street: '', delivery_postal_code: '', delivery_city: '',
      price_group: 'private', fulfillment: 'pickup', is_active: '', internal_note: '', pin: '',
    });
    expect((await post(`/api/admin/customers/${customer.id}`, { cookie: session.cookie, body: edit })).headers.get('location'))
      .toBe(`/admin/customers/${customer.id}?notice=customer_saved`);

    const changed = await env.DB.prepare('SELECT updated_at FROM customers WHERE id = ?').bind(customer.id).first<{ updated_at: string }>();
    const reactivate = fields(session.csrf, {
      expected_updated_at: changed!.updated_at,
      name: 'Fiktive Abholung', customer_code: 'PRIVATDEMO',
      contact_person: '', email: '', phone: '',
      delivery_street: '', delivery_postal_code: '', delivery_city: '',
      price_group: 'private', fulfillment: 'pickup', is_active: '1', internal_note: '', pin: '',
    });
    await post(`/api/admin/customers/${customer.id}`, { cookie: session.cookie, body: reactivate });
    expect(await env.DB.prepare('SELECT is_active, default_fulfillment FROM customers WHERE id = ?').bind(customer.id).first())
      .toEqual({ is_active: 1, default_fulfillment: 'pickup' });
  });

  it('vergibt eine neue PIN bewusst und die alte funktioniert danach nicht mehr', async () => {
    const session = await admin();
    await post('/api/admin/customers', { cookie: session.cookie, body: fields(session.csrf) });
    const customer = await env.DB.prepare('SELECT id FROM customers').first<{ id: number }>();
    if (!customer) throw new Error('Kunde fehlt');
    const reset = new URLSearchParams({
      csrf_token: session.csrf, customer_code: 'CAFEMORGEN', pin: '87654321', confirm_pin: '1',
    }).toString();
    const response = await post(`/api/admin/customers/${customer.id}/pin`, { cookie: session.cookie, body: reset });
    expect(response.headers.get('location')).toBe(`/admin/customers/${customer.id}?notice=pin_saved`);
    expect(await logIn(env.DB, CONFIG, { identifier: 'CAFEMORGEN', secret: '00123456', now: new Date(NOW), existingSessionToken: null })).toBeNull();
    expect(await logIn(env.DB, CONFIG, { identifier: 'CAFEMORGEN', secret: '87654321', now: new Date(NOW), existingSessionToken: null })).not.toBeNull();
  });

  it('weist doppelten Kundencode und ungültige Angaben ohne Teilwrites zurück', async () => {
    const session = await admin();
    await post('/api/admin/customers', { cookie: session.cookie, body: fields(session.csrf) });
    const duplicate = await post('/api/admin/customers', {
      cookie: session.cookie, body: fields(session.csrf, { name: 'Zweites Café' }),
    });
    const invalid = await post('/api/admin/customers', {
      cookie: session.cookie, body: fields(session.csrf, { name: '', customer_code: 'kaputter code' }),
    });
    expect(duplicate.headers.get('location')).toBe('/admin/customers?notice=customer_duplicate_code');
    expect(invalid.headers.get('location')).toBe('/admin/customers?notice=customer_invalid');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>()).toEqual({ n: 1 });
  });

  it('weist fehlende Anmeldung, CSRF und fremden Origin ohne Write zurück', async () => {
    const session = await admin();
    expect((await post('/api/admin/customers', { body: fields('falsch') })).headers.get('location')).toBe('/login');
    expect((await post('/api/admin/customers', { cookie: session.cookie, body: fields('', { csrf_token: '' }) })).status).toBe(403);
    expect((await post('/api/admin/customers', {
      cookie: session.cookie, origin: 'https://angreifer.test', body: fields(session.csrf),
    })).status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('weist kaputte ID, veralteten Save und unbestätigte PIN kontrolliert zurück', async () => {
    const session = await admin();
    await post('/api/admin/customers', { cookie: session.cookie, body: fields(session.csrf) });
    const customer = await env.DB.prepare('SELECT id, updated_at FROM customers').first<{ id: number; updated_at: string }>();
    if (!customer) throw new Error('Kunde fehlt');
    await env.DB.prepare('UPDATE customers SET name = ?, updated_at = ? WHERE id = ?')
      .bind('Jüngerer Name', '2026-08-28T12:00:00.000Z', customer.id).run();
    expect((await post('/api/admin/customers/1e3', {
      cookie: session.cookie, body: fields(session.csrf, { expected_updated_at: customer.updated_at }),
    })).headers.get('location')).toBe('/admin/customers?notice=customer_unknown');
    expect((await post(`/api/admin/customers/${customer.id}`, {
      cookie: session.cookie, body: fields(session.csrf, { expected_updated_at: customer.updated_at, name: 'Alter Name' }),
    })).headers.get('location')).toBe(`/admin/customers/${customer.id}?notice=customer_conflict`);
    const unconfirmed = new URLSearchParams({
      csrf_token: session.csrf, customer_code: 'CAFEMORGEN', pin: '87654321', confirm_pin: '',
    }).toString();
    expect((await post(`/api/admin/customers/${customer.id}/pin`, { cookie: session.cookie, body: unconfirmed })).headers.get('location'))
      .toBe(`/admin/customers/${customer.id}?notice=pin_invalid`);
  });
});
