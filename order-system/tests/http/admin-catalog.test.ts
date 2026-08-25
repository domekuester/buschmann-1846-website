import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(id: number, identifier: string, role: 'admin' | 'customer', secret: string): Promise<void> {
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

async function call(path: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

beforeEach(async () => {
  for (const table of [
    'catalog_product_prices', 'catalog_products', 'order_items', 'orders',
    'auth_sessions', 'auth_accounts', 'products', 'customers',
  ]) await env.DB.prepare(`DELETE FROM ${table}`).run();

  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');

  await env.DB.prepare(
    `INSERT INTO catalog_products
       (id, source_key, name, variant, unit, category, sort_order, created_at, updated_at)
     VALUES (1, 'fixture:kuchen', 'Fiktiver Kuchen', 'Ring', '26 cm Ring', 'Kuchen', 10, ?, ?),
            (2, 'fixture:gebaeck', 'Fiktives Gebäck', NULL, '100 g', 'Gebäck', 20, ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       SELECT 1, id, 'fixed', 2100, ?, ? FROM price_lists WHERE code = 'gastro'`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, min_price_cents, created_at, updated_at)
       SELECT 1, id, 'from', 3900, ?, ? FROM price_lists WHERE code = 'private'`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, created_at, updated_at)
       SELECT 2, id, 'on_request', ?, ? FROM price_lists WHERE code = 'private'`,
    ).bind(NOW, NOW),
  ]);
});

describe('GET /admin/catalog', () => {
  it('zeigt einem Admin Sortiment, Einheit, Variante und Preise', async () => {
    const response = await call('/admin/catalog', await login('admin@example.test', 'fiktives-admin-passwort-123'));
    const html = await response.text();
    expect(response.status).toBe(200);
    for (const text of ['Fiktiver Kuchen', '26 cm Ring', 'Ring', '21,00 €', 'ab 39,00 €', 'Auf Anfrage']) {
      expect(html).toContain(text);
    }
  });

  it('schickt unauthenticated über den First-Party-Loginflow', async () => {
    const response = await call('/admin/catalog');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('verweigert einem Customer den Zugriff', async () => {
    const response = await call('/admin/catalog', await login('testcafe', 'fiktive-kunden-pin-123'));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Fiktiver Kuchen');
  });

  it('behält no-store und die bestehenden Security Header', async () => {
    const response = await call('/admin/catalog', await login('admin@example.test', 'fiktives-admin-passwort-123'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rendert weder Authdaten noch Editierfunktionen', async () => {
    const html = await (await call('/admin/catalog', await login('admin@example.test', 'fiktives-admin-passwort-123'))).text();
    for (const forbidden of ['credential_', 'token_hash', 'session_id', 'account_id', '>Bearbeiten<', '>Löschen<']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('existiert nur als GET', async () => {
    const cookie = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const response = await worker.fetch(new Request(`${ORIGIN}/admin/catalog`, {
      method: 'POST', headers: { origin: ORIGIN, cookie },
    }), environment());
    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('verlinkt vom Sortiment zurück zur Produktion', async () => {
    const html = await (await call('/admin/catalog', await login('admin@example.test', 'fiktives-admin-passwort-123'))).text();
    expect(html).toContain('href="/admin"');
  });

  it('lässt die Produktionsroute samt Link zum Sortiment intakt', async () => {
    const response = await call('/admin', await login('admin@example.test', 'fiktives-admin-passwort-123'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="/admin/catalog"');
  });
});
