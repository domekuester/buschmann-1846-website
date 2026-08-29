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
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'catalog_product_prices', 'catalog_products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const credential = await deriveCredential('fiktives-admin-passwort-123', PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES ('admin@example.test', 'admin', NULL, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(
    credential.algorithm,
    credential.iterations,
    credential.saltHex,
    credential.verifierHex,
    NOW,
    NOW,
  ).run();
});

async function admin(): Promise<{ cookie: string; csrf: string }> {
  const login = await logIn(env.DB, CONFIG, {
    identifier: 'admin@example.test', secret: 'fiktives-admin-passwort-123',
    now: new Date(), existingSessionToken: null,
  });
  if (!login) throw new Error('Testlogin fehlgeschlagen');
  return { cookie: `buschmann_session_dev=${login.token}`, csrf: login.csrfToken };
}

function fields(csrf: string, overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    csrf_token: csrf,
    name: 'Fiktiver Käsekuchen',
    unit: '26 cm Ring',
    is_active: '1',
    gastro_price_type: 'fixed',
    gastro_price: '24,00',
    gastro_max_price: '',
    private_price_type: 'fixed',
    private_price: '42,00',
    private_max_price: '',
    unit_cost: '8,50',
    ...overrides,
  }).toString();
}

async function post(path: string, options: {
  cookie?: string;
  origin?: string | null;
  body?: string;
  contentType?: string;
} = {}): Promise<Response> {
  const headers = new Headers({ 'content-type': options.contentType ?? 'application/x-www-form-urlencoded' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: options.body ?? '' }), environment());
}

describe('Produkt-Self-Service', () => {
  it('legt ein Produkt samt interner Relation an und leitet per PRG zurück', async () => {
    const session = await admin();
    const response = await post('/api/admin/products', { cookie: session.cookie, body: fields(session.csrf) });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=product_created#angebot');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE catalog_product_id IS NOT NULL').first<{ n: number }>()).toEqual({ n: 1 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_product_prices').first<{ n: number }>()).toEqual({ n: 2 });
  });

  it('ändert Stammdaten, Preise, Kosten und Aktivität mit einem Save', async () => {
    const session = await admin();
    await post('/api/admin/products', { cookie: session.cookie, body: fields(session.csrf) });
    const product = await env.DB.prepare('SELECT id, updated_at FROM catalog_products').first<{ id: number; updated_at: string }>();
    if (!product) throw new Error('Produkt fehlt');

    const body = fields(session.csrf, {
      expected_updated_at: product.updated_at,
      name: 'Fiktive Zitronentorte', unit: 'Torte', is_active: '',
      gastro_price_type: 'from', gastro_price: '26',
      private_price_type: 'range', private_price: '44', private_max_price: '52',
      unit_cost: '',
    });
    const response = await post(`/api/admin/products/${product.id}`, { cookie: session.cookie, body });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=product_saved#angebot');
    expect(await env.DB.prepare(
      'SELECT name, unit, is_active, unit_cost_cents FROM catalog_products WHERE id = ?',
    ).bind(product.id).first()).toEqual({ name: 'Fiktive Zitronentorte', unit: 'Torte', is_active: 0, unit_cost_cents: null });
  });

  it('weist unvollständige und ungültige Produkte ohne irgendeinen Write zurück', async () => {
    const session = await admin();
    for (const overrides of [
      { name: '' },
      { gastro_price: '-1' },
      { gastro_price_type: 'erfunden' },
      { private_price_type: 'range', private_price: '50', private_max_price: '40' },
    ]) {
      const response = await post('/api/admin/products', { cookie: session.cookie, body: fields(session.csrf, overrides) });
      expect(response.headers.get('location')).toBe('/admin/catalog?notice=product_invalid#angebot');
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_products').first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('weist fehlende Anmeldung, falschen Origin und fehlendes CSRF ohne Write zurück', async () => {
    const session = await admin();
    const unauthenticated = await post('/api/admin/products', { body: fields('falsch') });
    const wrongOrigin = await post('/api/admin/products', {
      cookie: session.cookie, origin: 'https://angreifer.test', body: fields(session.csrf),
    });
    const noCsrf = await post('/api/admin/products', { cookie: session.cookie, body: fields('', { csrf_token: '' }) });

    expect(unauthenticated.status).toBe(303);
    expect(unauthenticated.headers.get('location')).toBe('/login');
    expect(wrongOrigin.status).toBe(403);
    expect(noCsrf.status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_products').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('weist eine kaputte Produkt-ID und einen veralteten Save kontrolliert zurück', async () => {
    const session = await admin();
    await post('/api/admin/products', { cookie: session.cookie, body: fields(session.csrf) });
    const product = await env.DB.prepare('SELECT id, updated_at FROM catalog_products').first<{ id: number; updated_at: string }>();
    if (!product) throw new Error('Produkt fehlt');
    await env.DB.prepare('UPDATE catalog_products SET name = ?, updated_at = ? WHERE id = ?')
      .bind('Jüngerer Name', '2026-08-28T12:00:00.000Z', product.id).run();

    const malformed = await post('/api/admin/products/1e3', {
      cookie: session.cookie, body: fields(session.csrf, { expected_updated_at: product.updated_at }),
    });
    const stale = await post(`/api/admin/products/${product.id}`, {
      cookie: session.cookie, body: fields(session.csrf, { expected_updated_at: product.updated_at, name: 'Alter Name' }),
    });

    expect(malformed.headers.get('location')).toBe('/admin/catalog?notice=product_unknown#angebot');
    expect(stale.headers.get('location')).toBe('/admin/catalog?notice=product_conflict#angebot');
    expect(await env.DB.prepare('SELECT name FROM catalog_products WHERE id = ?').bind(product.id).first()).toEqual({ name: 'Jüngerer Name' });
  });
});
