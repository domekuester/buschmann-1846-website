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
  for (const table of ['auth_sessions', 'auth_accounts', 'products', 'catalog_product_prices', 'catalog_products']) {
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
  await env.DB.prepare(
    `INSERT INTO catalog_products
       (id, source_key, name, unit, is_active, sort_order, unit_cost_cents, created_at, updated_at)
     VALUES (1, 'fixture:kuchen', 'Fiktiver Kuchen', '26 cm Ring', 1, 10, 850, ?1, ?1)`,
  ).bind(NOW).run();
  await env.DB.prepare(
    `INSERT INTO catalog_product_prices
       (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
     SELECT 1, id, 'fixed', CASE code WHEN 'gastro' THEN 2400 ELSE 4200 END, ?1, ?1
       FROM price_lists WHERE code IN ('gastro', 'private')`,
  ).bind(NOW).run();
  await env.DB.prepare(
    `INSERT INTO products
       (id, name, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at)
     VALUES (1, 'Fiktiver Kuchen', 2400, '26 cm Ring', 1, 10, 1, ?1, ?1)`,
  ).bind(NOW).run();
});

async function adminCookie(): Promise<string> {
  const result = await logIn(env.DB, CONFIG, {
    identifier: 'admin@example.test', secret: 'fiktives-admin-passwort-123', now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  return `buschmann_session_dev=${result.token}`;
}

async function page(cookie: string | null = null, path = '/admin/catalog'): Promise<Response> {
  const init: RequestInit = cookie === null ? {} : { headers: { cookie } };
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), environment());
}

describe('GET /admin/catalog — Angebot', () => {
  it('zeigt aktuelle Produkte, Preise, Kosten und Status editierbar', async () => {
    const html = await (await page(await adminCookie())).text();
    for (const text of ['Angebot', 'Fiktiver Kuchen', '26 cm Ring', '24,00', '42,00', '8,50', 'Aktiv']) expect(html).toContain(text);
    expect(html).toContain('action="/api/admin/products/1"');
    expect(html).toContain(`name="expected_updated_at" value="${NOW}"`);
  });

  it('bietet Neues Produkt mit allen Geschäftsangaben an', async () => {
    const html = await (await page(await adminCookie())).text();
    expect(html).toContain('Neues Produkt');
    expect(html).toContain('action="/api/admin/products"');
    for (const field of ['name', 'unit', 'gastro_price_type', 'gastro_price', 'private_price_type', 'private_price', 'unit_cost', 'is_active']) {
      expect(html).toContain(`name="${field}"`);
    }
    for (const label of ['Festpreis', 'Ab-Preis', 'Preisspanne', 'Preis auf Anfrage']) expect(html).toContain(label);
  });

  it('enthält keine manuelle Produktverknüpfung im normalen Arbeitsbereich', async () => {
    const html = await (await page(await adminCookie())).text();
    expect(html).not.toContain('Bestellprodukte verknüpfen');
    expect(html).not.toContain('catalog-link');
    expect(html).not.toContain('Nicht verknüpft');
  });

  it('zeigt NULL-Kosten als nicht gepflegt und niemals als null Euro', async () => {
    await env.DB.prepare('UPDATE catalog_products SET unit_cost_cents = NULL WHERE id = 1').run();
    const html = await (await page(await adminCookie())).text();
    expect(html).toContain('Nicht gepflegt');
    expect(html).not.toContain('0,00 €');
  });

  it('escapet dynamische Produktdaten', async () => {
    await env.DB.prepare('UPDATE catalog_products SET name = ? WHERE id = 1').bind('<img src=x onerror=alert(1)>').run();
    const html = await (await page(await adminCookie())).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('verlangt Admin-Anmeldung, nutzt no-store und existiert nur lesend', async () => {
    expect((await page()).headers.get('location')).toBe('/login');
    const cookie = await adminCookie();
    const response = await page(cookie);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const post = await worker.fetch(new Request(`${ORIGIN}/admin/catalog`, { method: 'POST', headers: { cookie } }), environment());
    expect(post.status).toBe(405);
  });
});
