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
    'order_items', 'orders', 'auth_sessions', 'auth_accounts',
    'products', 'catalog_product_prices', 'catalog_products', 'customers',
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

/**
 * Zwei bestellbare Produkte für den Zuordnungsbereich aus Phase 5D: eines
 * bereits mit dem Katalog verknüpft, eines bewusst nicht. Die 99999 in
 * price_cents ist Absicht — verwendet irgendjemand den alten Einheitspreis
 * doch noch, fällt der Betrag in jeder Zusicherung auf.
 */
async function seedBestellprodukte(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order,
                           catalog_product_id, created_at, updated_at)
     VALUES (1, 'Bestellbarer Kuchen', 99999, 'Stück', 1, 10, 1, ?1, ?1),
            (2, 'Bestellbares Gebäck', 99999, 'Stück', 1, 20, NULL, ?1, ?1)`,
  ).bind(NOW).run();
}

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

/**
 * DER ZUORDNUNGSBEREICH AUF DER ECHTEN SEITE — §26 des Auftrags.
 *
 * Die Bausteine sind bereits einzeln geprüft (admin-catalog-link-html.test.ts);
 * hier geht es um die Seite, wie der Worker sie ausliefert: mit echten Daten
 * aus D1, echten Kopfzeilen und echter Rollenprüfung.
 */
describe('GET /admin/catalog — Zuordnungsbereich (Phase 5D)', () => {
  async function seite(): Promise<{ status: number; html: string; headers: Headers }> {
    const response = await call('/admin/catalog', await login('admin@example.test', 'fiktives-admin-passwort-123'));
    return { status: response.status, html: await response.text(), headers: response.headers };
  }

  /** §26.19 und §26.20 */
  it('bleibt für den Admin 200 und zeigt den Zuordnungsbereich', async () => {
    await seedBestellprodukte();
    const { status, html } = await seite();

    expect(status).toBe(200);
    expect(html).toContain('Bestellprodukte verknüpfen');
    expect(html).toContain('id="zuordnung"');
  });

  /** §26.21 und §26.22 */
  it('zeigt jedes Bestellprodukt mit seiner aktuellen Zuordnung', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    expect(html).toContain('Bestellbarer Kuchen');
    expect(html).toContain('Bestellbares Gebäck');
    expect(html).toContain('Verknüpft');
    expect(html).toContain('Fiktiver Kuchen · Ring · 26 cm Ring');
  });

  /** §26.23 */
  it('sagt bei einem unverknüpften Produkt „Nicht verknüpft"', async () => {
    await seedBestellprodukte();
    expect((await seite()).html).toContain('Nicht verknüpft');
  });

  /** §26.24 — die Optionen sind aus Name, Variante und Einheit gebildet. */
  it('beschriftet die Katalogoptionen eindeutig', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    expect(html).toContain('<option value="1"');
    expect(html).toContain('Fiktives Gebäck · 100 g');
  });

  /** §5 — ein bereits vergebenes Katalogprodukt steht nicht in fremder Auswahl. */
  it('bietet dem zweiten Produkt das belegte Katalogprodukt nicht an', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    const start = html.indexOf('action="/api/admin/products/2/catalog-link"');
    const form = html.slice(start, html.indexOf('</form>', start));
    expect(form).not.toContain('<option value="1"');
    expect(form).toContain('<option value="2"');
  });

  /** §20 */
  it('zeigt die operative Zusammenfassung', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    expect(html).toContain('2 Bestellprodukte');
    expect(html).toContain('1 verknüpft');
    expect(html).toContain('1 nicht verknüpft');
  });

  /** §26.25 */
  it('zeigt die Erfolgsmeldung nach der Weiterleitung', async () => {
    await seedBestellprodukte();
    const response = await call(
      '/admin/catalog?notice=saved',
      await login('admin@example.test', 'fiktives-admin-passwort-123'),
    );
    const html = await response.text();

    expect(html).toContain('Die Zuordnung wurde gespeichert.');
    expect(html).toContain('zuordnungsmeldung--erfolg');
  });

  /** §26.26 */
  it('erklärt den Konflikt verständlich und ohne Technik', async () => {
    await seedBestellprodukte();
    const response = await call(
      '/admin/catalog?notice=catalog_product_taken',
      await login('admin@example.test', 'fiktives-admin-passwort-123'),
    );
    const html = await response.text();

    expect(html).toContain('gehört bereits zu einem anderen Bestellprodukt');
    for (const wort of ['UNIQUE', 'SQLITE', 'D1_ERROR', 'idx_products_catalog_product']) {
      expect(html).not.toContain(wort);
    }
  });

  it('zeigt einen erfundenen Meldungscode gar nicht erst an', async () => {
    await seedBestellprodukte();
    const response = await call(
      '/admin/catalog?notice=%3Cscript%3Ealert(1)%3C/script%3E',
      await login('admin@example.test', 'fiktives-admin-passwort-123'),
    );
    const html = await response.text();

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('&lt;script&gt;');
  });

  /** §26.27 */
  it('escaped dynamische Produktnamen', async () => {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, '<img src=x onerror=alert(1)>', 99999, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW).run();
    const { html } = await seite();

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  /** §26.28 und §26.29 */
  it('behält no-store und die Security Header', async () => {
    await seedBestellprodukte();
    const { headers } = await seite();

    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  /** §26.30 */
  it('gibt weder Zugangsdaten noch überflüssige interne Werte preis', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    for (const forbidden of [
      'credential_', 'token_hash', 'session_id', 'account_id',
      'price_cents', '99999', 'source_key', 'fixture:',
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  /** §26 in Verbindung mit §16 — ein Customer sieht den Bereich gar nicht. */
  it('zeigt einem Customer den Zuordnungsbereich nicht', async () => {
    await seedBestellprodukte();
    const response = await call('/admin/catalog', await login('testcafe', 'fiktive-kunden-pin-123'));
    const html = await response.text();

    expect(response.status).toBe(403);
    expect(html).not.toContain('Bestellprodukte verknüpfen');
    expect(html).not.toContain('catalog-link');
  });

  it('kommt ohne JavaScript aus', async () => {
    await seedBestellprodukte();
    const { html } = await seite();

    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son(click|change|submit)=/);
  });

  it('zeigt einen klaren Leerzustand, solange es keine Bestellprodukte gibt', async () => {
    expect((await seite()).html).toContain('Noch keine Bestellprodukte');
  });
});
