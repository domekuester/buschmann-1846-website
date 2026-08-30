import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-30T08:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const environment = (): Env => ({ ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' });

beforeEach(async () => {
  for (const table of ['customer_account_requests', 'auth_sessions', 'auth_accounts', 'customers']) {
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
    now: new Date(), existingSessionToken: null,
  });
  if (!login) throw new Error('Testlogin fehlgeschlagen');
  return { cookie: `buschmann_session_dev=${login.token}`, csrf: login.csrfToken };
}

async function seedRequest(overrides: Record<string, string | null> = {}): Promise<{ id: number; updatedAt: string }> {
  await env.DB.prepare(
    `INSERT INTO customer_account_requests
       (name, contact_person, email, email_normalized, phone, street, postal_code,
        city, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    overrides.name ?? 'Fiktive Konditorei', overrides.contactPerson ?? 'Erika Beispiel',
    overrides.email ?? 'anfrage@example.test', overrides.emailNormalized ?? 'anfrage@example.test',
    overrides.phone ?? '0211 123456', overrides.street ?? 'Teststraße 1',
    overrides.postalCode ?? '40213', overrides.city ?? 'Düsseldorf',
    overrides.message ?? 'Bitte melden Sie sich.', NOW, NOW,
  ).run();
  const row = await env.DB.prepare(
    'SELECT id, updated_at FROM customer_account_requests ORDER BY id DESC LIMIT 1',
  ).first<{ id: number; updated_at: string }>();
  return { id: row!.id, updatedAt: row!.updated_at };
}

async function get(path: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

async function post(path: string, body: URLSearchParams, cookie: string | null, origin = ORIGIN): Promise<Response> {
  const headers = new Headers({ origin, 'content-type': 'application/x-www-form-urlencoded' });
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body }), environment());
}

function conversion(csrf: string, updatedAt: string, overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    csrf_token: csrf,
    expected_updated_at: updatedAt,
    name: 'Fiktive Konditorei',
    customer_code: 'KONDITOREI-TEST',
    contact_person: 'Erika Beispiel',
    email: 'anfrage@example.test',
    phone: '0211 123456',
    delivery_street: 'Teststraße 1',
    delivery_postal_code: '40213',
    delivery_city: 'Düsseldorf',
    price_group: 'gastro',
    fulfillment: 'delivery',
    is_active: '1',
    internal_note: '',
    pin: '00123456',
    ...overrides,
  });
}

describe('Admin Kundenkonto-Anfragen', () => {
  it('blockiert Liste und Detail ohne Adminsitzung', async () => {
    const request = await seedRequest();
    for (const path of ['/admin/customers/requests', `/admin/customers/requests/${request.id}`]) {
      const response = await get(path);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login');
    }
  });

  it('verweigert einem angemeldeten Kunden Liste und Detail', async () => {
    const request = await seedRequest();
    await env.DB.prepare(
      `INSERT INTO customers
         (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Fiktiver Kunde', 1, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run();
    const credential = await deriveCredential('00123456', PEPPER, { iterations: MIN_ITERATIONS });
    await env.DB.prepare(
      `INSERT INTO auth_accounts
         (login_identifier_normalized, role, customer_id, credential_algorithm,
          credential_iterations, credential_salt, credential_verifier, is_active,
          failed_attempts, created_at, updated_at)
       VALUES ('fiktiver-kunde', 'customer', 1, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).bind(credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex, NOW, NOW).run();
    const login = await logIn(env.DB, CONFIG, {
      identifier: 'fiktiver-kunde', secret: '00123456', now: new Date(), existingSessionToken: null,
    });
    if (!login) throw new Error('Kundenlogin fehlgeschlagen');
    const cookie = `buschmann_session_dev=${login.token}`;
    expect((await get('/admin/customers/requests', cookie)).status).toBe(403);
    expect((await get(`/admin/customers/requests/${request.id}`, cookie)).status).toBe(403);
  });

  it('zeigt Liste, Detail und Pending-Zähler im bestehenden Kundenbereich', async () => {
    const request = await seedRequest();
    const session = await admin();
    const [listHtml, detailHtml, customersHtml] = await Promise.all([
      get('/admin/customers/requests', session.cookie).then((r) => r.text()),
      get(`/admin/customers/requests/${request.id}`, session.cookie).then((r) => r.text()),
      get('/admin/customers', session.cookie).then((r) => r.text()),
    ]);
    for (const value of ['Fiktive Konditorei', 'Erika Beispiel', 'anfrage@example.test', '0211 123456', 'Düsseldorf']) {
      expect(listHtml).toContain(value);
    }
    expect(listHtml).toContain('1 offen');
    expect(customersHtml).toContain('Anfragen');
    expect(customersHtml).toContain('1');
    expect(detailHtml).toContain('Bitte melden Sie sich.');
    expect(detailHtml).toContain('Als Kunde übernehmen');
  });

  it('lehnt eine offene Anfrage mit optionaler interner Notiz ab und behält sie', async () => {
    const request = await seedRequest();
    const session = await admin();
    const body = new URLSearchParams({
      csrf_token: session.csrf, expected_updated_at: request.updatedAt,
      rejection_note: 'Kein passendes Liefergebiet.',
    });
    const response = await post(`/api/admin/customer-account-requests/${request.id}/reject`, body, session.cookie);
    expect(response.status).toBe(303);
    const rejected = await env.DB.prepare(
      'SELECT status, processed_at, rejection_note FROM customer_account_requests WHERE id = ?',
    ).bind(request.id).first<{ status: string; processed_at: string; rejection_note: string }>();
    expect(rejected).toMatchObject({ status: 'rejected', rejection_note: 'Kein passendes Liefergebiet.' });
    expect(new Date(rejected!.processed_at).toISOString()).toBe(rejected!.processed_at);
  });

  it('weist eine zu lange interne Ablehnungsnotiz ohne Statusänderung zurück', async () => {
    const request = await seedRequest();
    const session = await admin();
    const body = new URLSearchParams({
      csrf_token: session.csrf,
      expected_updated_at: request.updatedAt,
      rejection_note: 'x'.repeat(501),
    });
    const response = await post(`/api/admin/customer-account-requests/${request.id}/reject`, body, session.cookie);
    expect(response.headers.get('location')).toContain('notice=request_invalid');
    expect(await env.DB.prepare('SELECT status FROM customer_account_requests WHERE id = ?').bind(request.id).first())
      .toEqual({ status: 'pending' });
  });

  it('verlangt bei der Übernahme Preisgruppe und Erfüllung ausdrücklich', async () => {
    const request = await seedRequest();
    const session = await admin();
    for (const overrides of [{ price_group: '' }, { fulfillment: '' }]) {
      const response = await post(
        `/api/admin/customer-account-requests/${request.id}/convert`,
        conversion(session.csrf, request.updatedAt, overrides),
        session.cookie,
      );
      expect(response.headers.get('location')).toContain('notice=request_invalid');
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first()).toEqual({ n: 0 });
  });

  it('übernimmt über die bestehende Kundenanlage und verknüpft die Anfrage atomar', async () => {
    const request = await seedRequest();
    const session = await admin();
    const response = await post(
      `/api/admin/customer-account-requests/${request.id}/convert`,
      conversion(session.csrf, request.updatedAt),
      session.cookie,
    );
    expect(response.headers.get('location')).toContain('notice=request_converted');
    const row = await env.DB.prepare(
      `SELECT r.status, r.processed_at, r.customer_id, c.name, c.default_fulfillment,
              l.code AS price_group, a.login_identifier_normalized AS customer_code
         FROM customer_account_requests r
         JOIN customers c ON c.id = r.customer_id
         JOIN price_lists l ON l.id = c.price_list_id
         JOIN auth_accounts a ON a.customer_id = c.id
        WHERE r.id = ?`,
    ).bind(request.id).first();
    expect(row).toMatchObject({
      status: 'converted', name: 'Fiktive Konditorei',
      default_fulfillment: 'delivery', price_group: 'gastro', customer_code: 'konditorei-test',
    });
    expect(new Date(String(row?.processed_at)).toISOString()).toBe(row?.processed_at);
    expect(row?.customer_id).toEqual(expect.any(Number));
    expect(await logIn(env.DB, CONFIG, {
      identifier: 'KONDITOREI-TEST', secret: '00123456', now: new Date(NOW), existingSessionToken: null,
    })).not.toBeNull();
  });

  it('macht eine doppelte Übernahme unmöglich', async () => {
    const request = await seedRequest();
    const session = await admin();
    const body = conversion(session.csrf, request.updatedAt);
    await post(`/api/admin/customer-account-requests/${request.id}/convert`, body, session.cookie);
    const second = await post(
      `/api/admin/customer-account-requests/${request.id}/convert`,
      conversion(session.csrf, request.updatedAt, { customer_code: 'ZWEITER-CODE' }),
      session.cookie,
    );
    expect(second.headers.get('location')).toContain('notice=request_unavailable');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first()).toEqual({ n: 1 });
  });

  it('rollt die Kundenanlage bei einem doppelten Kundencode vollständig zurück', async () => {
    const first = await seedRequest();
    const second = await seedRequest({ email: 'zweite@example.test', emailNormalized: 'zweite@example.test' });
    const session = await admin();
    await post(`/api/admin/customer-account-requests/${first.id}/convert`, conversion(session.csrf, first.updatedAt), session.cookie);
    const failed = await post(
      `/api/admin/customer-account-requests/${second.id}/convert`,
      conversion(session.csrf, second.updatedAt, { name: 'Zweite Konditorei' }),
      session.cookie,
    );
    expect(failed.headers.get('location')).toContain('notice=request_duplicate_code');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first()).toEqual({ n: 1 });
    expect(await env.DB.prepare('SELECT status, customer_id FROM customer_account_requests WHERE id = ?').bind(second.id).first())
      .toEqual({ status: 'pending', customer_id: null });
  });

  it('schützt Ablehnung und Übernahme mit Origin und CSRF', async () => {
    const request = await seedRequest();
    const session = await admin();
    const reject = new URLSearchParams({ csrf_token: session.csrf, expected_updated_at: request.updatedAt, rejection_note: '' });
    expect((await post(`/api/admin/customer-account-requests/${request.id}/reject`, reject, null)).headers.get('location')).toBe('/login');
    expect((await post(`/api/admin/customer-account-requests/${request.id}/reject`, reject, session.cookie, 'https://angreifer.test')).status).toBe(403);
    expect((await post(
      `/api/admin/customer-account-requests/${request.id}/convert`,
      conversion('falsch', request.updatedAt), session.cookie,
    )).status).toBe(403);
  });
});
