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
  for (const table of ['auth_sessions', 'auth_accounts']) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const credential = await deriveCredential('fiktives-admin-passwort-123', PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES ('admin@example.test', 'admin', NULL, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex, NOW, NOW).run();
});

async function cookie(): Promise<string> {
  const login = await logIn(env.DB, CONFIG, {
    identifier: 'admin@example.test', secret: 'fiktives-admin-passwort-123',
    now: new Date(), existingSessionToken: null,
  });
  if (!login) throw new Error('Testlogin fehlgeschlagen');
  return `buschmann_session_dev=${login.token}`;
}

async function page(path: string, session: string): Promise<string> {
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { cookie: session } }), environment());
  expect(response.status).toBe(200);
  return response.text();
}

describe('sechs Admin-Arbeitsbereiche', () => {
  it('macht alle sechs Ziele erreichbar und markiert jeweils den aktiven Bereich', async () => {
    const session = await cookie();
    for (const [path, label] of [
      ['/admin', 'Übersicht'], ['/admin/orders', 'Bestellungen'], ['/admin/production', 'Produktion'],
      ['/admin/catalog', 'Angebot'], ['/admin/customers', 'Kunden'], ['/admin/settings', 'Einstellungen'],
    ] as const) {
      const html = await page(path, session);
      const nav = /<nav class="adminnav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
      expect(nav).toContain(`>${label}</a>`);
      expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it('hält Verknüpfung aus dem normalen Angebot heraus und interne Wartungsroute unangetastet', async () => {
    const html = await page('/admin/catalog', await cookie());
    expect(html).not.toContain('Bestellprodukte verknüpfen');
    expect(html).not.toContain('catalog-link');
    const maintenance = await worker.fetch(new Request(`${ORIGIN}/api/admin/products/1/catalog-link`, { method: 'GET' }), environment());
    expect(maintenance.status).toBe(405);
  });

  it('hält Bestellaktionen, Produktionsdruck und Bestellregeln im richtigen Bereich erreichbar', async () => {
    const session = await cookie();
    expect(await page('/admin/orders', session)).toContain('Bestellungen');
    const production = await page('/admin/production', session);
    expect(production).toContain('/admin/production-list');
    expect(production).toContain('/admin/abholliste');
    const settings = await page('/admin/settings', session);
    expect(settings).toContain('Bestellschluss');
    expect(settings).toContain('Wochentage');
  });

  it('zeigt auf Übersicht keine Statusdonuts und keine vollständige Bestelltabelle', async () => {
    const html = await page('/admin', await cookie());
    expect(html).not.toContain('class="ringzone"');
    expect(html).not.toContain('id="bestellungen"');
    expect(html).toContain('Noch nicht bezahlt');
  });
});
