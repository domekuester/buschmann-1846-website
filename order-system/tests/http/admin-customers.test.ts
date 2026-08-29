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

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare("DELETE FROM price_lists WHERE code = 'fixture_alt'").run();
  await env.DB.prepare("UPDATE price_lists SET is_active = 1 WHERE code IN ('gastro','private')").run();

  await env.DB.prepare(
    `INSERT INTO customers (id, name, email, phone, is_active, default_fulfillment,
                            internal_note, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 'kontakt@beispiel.test', '0211 1234567', 1, 'pickup',
             'Fiktiver Betriebshinweis', ?, ?),
            (2, 'Fiktiver Privatkunde', NULL, NULL, 1, 'pickup', NULL, ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/customers', () => {
  it('zeigt einem Admin Kunden und ihre Preisgruppen', async () => {
    await env.DB.prepare(
      "UPDATE customers SET price_list_id = (SELECT id FROM price_lists WHERE code = 'gastro') WHERE id = 1",
    ).run();

    const response = await call('/admin/customers', await admin());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Fiktives Café Nord');
    expect(html).toContain('Fiktiver Privatkunde');
    expect(html).toContain('Gastronomie');
    expect(html).toContain('Nicht zugeordnet');
  });

  it('stellt bestehende Kunden ohne Preisgruppe weiterhin als nicht zugeordnet dar', async () => {
    const html = await (await call('/admin/customers', await admin())).text();
    expect(html).toContain('Nicht zugeordnet');
    expect(html).toContain('Fiktives Café Nord');
    expect(html).toContain('Fiktiver Privatkunde');
  });

  it('bietet die aktiven Preisgruppen zur Auswahl an', async () => {
    const html = await (await call('/admin/customers', await admin())).text();
    expect(html).toContain('value="gastro"');
    expect(html).toContain('value="private"');
  });

  it('bietet eine deaktivierte Preisgruppe nicht zur Auswahl an', async () => {
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'private'").run();
    const html = await (await call('/admin/customers', await admin())).text();

    expect(html).toContain('value="gastro"');
    expect(html).not.toContain('value="private"');
  });

  it('schickt unauthenticated über den First-Party-Loginflow', async () => {
    const response = await call('/admin/customers');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('verweigert einem Customer den Zugriff', async () => {
    const response = await call('/admin/customers', await kunde());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Fiktives Café Nord');
  });

  it('verweigert einem deaktivierten Admin den Zugriff', async () => {
    const cookie = await admin();
    await env.DB.prepare('UPDATE auth_accounts SET is_active = 0 WHERE id = 1').run();

    const response = await call('/admin/customers', cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('behält no-store und die bestehenden Security Header', async () => {
    const response = await call('/admin/customers', await admin());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('zeigt weder Zugangsdaten noch Produktpreise', async () => {
    const html = await (await call('/admin/customers', await admin())).text();
    for (const verboten of [
      'credential_', 'token_hash', 'session_id', 'failed_attempts', 'locked_until',
      '€', 'price_cents',
    ]) {
      expect(html).not.toContain(verboten);
    }
  });

  it('zeigt keine Kontaktdaten und keine internen Notizen', async () => {
    const html = await (await call('/admin/customers', await admin())).text();
    expect(html).not.toContain('kontakt@beispiel.test');
    expect(html).not.toContain('0211 1234567');
    expect(html).not.toContain('Fiktiver Betriebshinweis');
  });

  it('escapet dynamische Kundennamen', async () => {
    await env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (3, '<script>alert(1)</script>', 1, 'pickup', ?, ?)`,
    ).bind(NOW, NOW).run();

    const html = await (await call('/admin/customers', await admin())).text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('spiegelt einen erfundenen Rückmeldungscode nicht in die Seite', async () => {
    const html = await (await call(
      '/admin/customers?notice=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      await admin(),
    )).text();

    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('role="status"');
  });

  it('existiert nur als GET', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/admin/customers`, {
      method: 'POST', headers: { origin: ORIGIN, cookie: await admin() },
    }), environment());

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('führt die drei echten Adminbereiche und verlinkt sie gegenseitig', async () => {
    const cookie = await admin();
    const kunden = await (await call('/admin/customers', cookie)).text();
    const produktion = await (await call('/admin', cookie)).text();
    const sortiment = await (await call('/admin/catalog', cookie)).text();

    for (const html of [kunden, produktion, sortiment]) {
      expect(html).toContain('href="/admin"');
      expect(html).toContain('href="/admin/catalog"');
      expect(html).toContain('href="/admin/customers"');
    }
  });
});
