import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://buschmann1846.de.angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const PFAD = '/api/admin/customers/1/price-list';

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

interface Sitzung {
  readonly cookie: string;
  readonly csrf: string;
}

async function anmelden(identifier: string, secret: string): Promise<Sitzung> {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  const row = await env.DB.prepare(
    'SELECT csrf_token FROM auth_sessions ORDER BY id DESC LIMIT 1',
  ).first<{ csrf_token: string }>();
  if (!row) throw new Error('Sitzung fehlt');
  return { cookie: `buschmann_session_dev=${result.token}`, csrf: row.csrf_token };
}

const admin = () => anmelden('admin@example.test', 'fiktives-admin-passwort-123');
const kunde = () => anmelden('testcafe', 'fiktive-kunden-pin-123');

interface PostOptions {
  readonly path?: string;
  readonly cookie?: string | null;
  readonly origin?: string | null;
  readonly body?: string;
  readonly contentType?: string | null;
  readonly method?: string;
}

async function post(options: PostOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/x-www-form-urlencoded');
  }

  const method = options.method ?? 'POST';
  return worker.fetch(new Request(`${ORIGIN}${options.path ?? PFAD}`, {
    method,
    headers,
    // GET und HEAD dürfen keinen Körper tragen — der Request-Konstruktor wirft sonst.
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.body ?? '' }),
  }), environment());
}

function feld(csrf: string, code: string): string {
  return new URLSearchParams({ csrf_token: csrf, price_list_code: code }).toString();
}

async function zuordnung(customerId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT l.code AS code FROM customers c
       LEFT JOIN price_lists l ON l.id = c.price_list_id WHERE c.id = ?`,
  ).bind(customerId).first<{ code: string | null }>();
  if (!row) throw new Error('Kunde fehlt');
  return row.code;
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare("DELETE FROM price_lists WHERE code = 'fixture_alt'").run();
  await env.DB.prepare("UPDATE price_lists SET is_active = 1 WHERE code IN ('gastro','private')").run();

  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?),
            (2, 'Fiktiver Privatkunde', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('POST /api/admin/customers/:customerId/price-list — Erfolgsfall', () => {
  it('ordnet als Admin zu und leitet mit 303 zurück auf die Kundenliste', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, 'gastro') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/customers?notice=saved');
    expect(await zuordnung(1)).toBe('gastro');
  });

  it('setzt eine Zuordnung über das leere Feld auf „nicht zugeordnet" zurück', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, 'gastro') });
    const response = await post({ cookie, body: feld(csrf, '') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/customers?notice=saved');
    expect(await zuordnung(1)).toBeNull();
  });

  it('antwortet ohne Inhalt, damit ein Neuladen den POST nicht wiederholt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, 'gastro') });

    expect(response.status).toBe(303);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('betrifft ausschließlich den im Pfad adressierten Kunden', async () => {
    const { cookie, csrf } = await admin();
    await post({ path: '/api/admin/customers/2/price-list', cookie, body: feld(csrf, 'private') });

    expect(await zuordnung(1)).toBeNull();
    expect(await zuordnung(2)).toBe('private');
  });
});

describe('POST … /price-list — Autorisierung', () => {
  it('weist einen Customer ab, ohne etwas zu schreiben', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({ cookie, body: feld(csrf, 'gastro') });

    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('lässt sich durch role=admin im Körper nicht überreden', async () => {
    const { cookie, csrf } = await kunde();
    const body = new URLSearchParams({
      csrf_token: csrf,
      price_list_code: 'gastro',
      role: 'admin',
      account_role: 'admin',
      admin: 'true',
      customer_id: '1',
    }).toString();

    const response = await post({ cookie, body });
    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('schickt einen Unangemeldeten auf die Loginseite, ohne etwas zu schreiben', async () => {
    const response = await post({ body: 'price_list_code=gastro' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(await zuordnung(1)).toBeNull();
  });

  it('lässt einen deaktivierten Admin nicht schreiben', async () => {
    const { cookie, csrf } = await admin();
    await env.DB.prepare('UPDATE auth_accounts SET is_active = 0 WHERE id = 1').run();

    const response = await post({ cookie, body: feld(csrf, 'gastro') });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(await zuordnung(1)).toBeNull();
  });
});

describe('POST … /price-list — CSRF und Origin', () => {
  it('verweigert einen fehlenden CSRF-Token', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: 'price_list_code=gastro' });

    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('verweigert einen falschen CSRF-Token', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: feld('fiktiver-falscher-token', 'gastro') });

    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('verweigert einen fremden Origin', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: FREMD, body: feld(csrf, 'gastro') });

    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('verweigert einen fehlenden Origin', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: null, body: feld(csrf, 'gastro') });

    expect(response.status).toBe(403);
    expect(await zuordnung(1)).toBeNull();
  });

  it('nennt nicht, welche Prüfung gescheitert ist', async () => {
    const { cookie, csrf } = await admin();
    const ohneToken = await post({ cookie, body: 'price_list_code=gastro' });
    const fremderOrigin = await post({ cookie, origin: FREMD, body: feld(csrf, 'gastro') });

    expect(await ohneToken.text()).toBe(await fremderOrigin.text());
  });
});

describe('POST … /price-list — Eingabeprüfung', () => {
  it('speichert keine unbekannte Preisgruppe', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, 'gibt-es-nicht') });

    expect(response.headers.get('location')).toBe('/admin/customers?notice=unknown_price_group');
    expect(await zuordnung(1)).toBeNull();
  });

  it('nimmt eine deaktivierte Preisgruppe nicht an', async () => {
    await env.DB.prepare("UPDATE price_lists SET is_active = 0 WHERE code = 'private'").run();
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, 'private') });

    expect(response.headers.get('location')).toBe('/admin/customers?notice=inactive_price_group');
    expect(await zuordnung(1)).toBeNull();
  });

  it('meldet einen unbekannten Kunden, ohne andere Kunden anzufassen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/customers/987654/price-list',
      cookie,
      body: feld(csrf, 'gastro'),
    });

    expect(response.headers.get('location')).toBe('/admin/customers?notice=unknown_customer');
    expect(await zuordnung(1)).toBeNull();
    expect(await zuordnung(2)).toBeNull();
  });

  it.each(['abc', '1.5', '-1', '0', '1%20', '1e3', '01', ' 1'])('weist die unmögliche Kundenkennung „%s" ab', async (segment) => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: `/api/admin/customers/${segment}/price-list`,
      cookie,
      body: feld(csrf, 'gastro'),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/customers?notice=unknown_customer');
    expect(await zuordnung(1)).toBeNull();
    expect(await zuordnung(2)).toBeNull();
  });

  it('erreicht über einen Traversal-Pfad gar nicht erst den Endpunkt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/customers/../price-list',
      cookie,
      body: feld(csrf, 'gastro'),
    });

    // Der URL-Parser normalisiert '..' weg, bevor überhaupt geroutet wird.
    expect(response.status).toBe(404);
    expect(await zuordnung(1)).toBeNull();
  });

  it('verlangt das Preisgruppenfeld ausdrücklich', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: new URLSearchParams({ csrf_token: csrf }).toString() });

    expect(response.headers.get('location')).toBe('/admin/customers?notice=invalid');
    expect(await zuordnung(1)).toBeNull();
  });

  it('lehnt mehrfach geschickte Preisgruppenfelder ab', async () => {
    const { cookie, csrf } = await admin();
    const body = `csrf_token=${encodeURIComponent(csrf)}&price_list_code=gastro&price_list_code=private`;
    const response = await post({ cookie, body });

    expect(response.headers.get('location')).toBe('/admin/customers?notice=invalid');
    expect(await zuordnung(1)).toBeNull();
  });

  it('nimmt kein JSON entgegen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      contentType: 'application/json',
      body: JSON.stringify({ csrf_token: csrf, price_list_code: 'gastro' }),
    });

    expect(response.status).toBe(415);
    expect(await zuordnung(1)).toBeNull();
  });

  it('lehnt einen übergroßen Körper ab, ohne zu schreiben', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: `${feld(csrf, 'gastro')}&fuellung=${'a'.repeat(2048)}`,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/customers?notice=internal');
    expect(await zuordnung(1)).toBeNull();
  });

  it('existiert nur als POST', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, method: 'GET', contentType: null });

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST … /price-list — kein Open Redirect', () => {
  it.each([
    'https://angreifer.test',
    '//angreifer.test',
    '/admin/customers/../../etwas',
  ])('ignoriert ein mitgeschicktes Rückkehrziel %s', async (ziel) => {
    const { cookie, csrf } = await admin();
    const body = new URLSearchParams({
      csrf_token: csrf,
      price_list_code: 'gastro',
      returnUrl: ziel,
      next: ziel,
      redirect: ziel,
    }).toString();

    const response = await post({ cookie, body });
    expect(response.headers.get('location')).toBe('/admin/customers?notice=saved');
  });

  it('leitet auch im Fehlerfall ausschließlich auf die eigene Kundenliste', async () => {
    const { cookie, csrf } = await admin();
    const body = new URLSearchParams({
      csrf_token: csrf,
      price_list_code: 'gibt-es-nicht',
      returnUrl: 'https://angreifer.test',
    }).toString();

    const location = (await post({ cookie, body })).headers.get('location') ?? '';
    expect(location.startsWith('/admin/customers?notice=')).toBe(true);
  });
});

describe('POST … /price-list — bestehendes System bleibt unberührt', () => {
  it('verändert weder Bestellungen noch Katalogpreise noch Produkte', async () => {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Fiktiver Kuchen', 2100, 'Stück', 1, 10, ?, ?)`,
    ).bind(NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café Nord', 'pickup', '2026-08-27', 'new', 2100, ?, ?)`,
    ).bind(NOW, NOW).run();

    const abzug = () => env.DB.prepare(
      `SELECT (SELECT price_cents FROM products WHERE id = 1) AS produktpreis,
              (SELECT total_amount_cents FROM orders WHERE id = 1) AS bestellsumme,
              (SELECT status FROM orders WHERE id = 1) AS status,
              (SELECT COUNT(*) FROM catalog_product_prices) AS katalogpreise`,
    ).first();

    const vorher = await abzug();
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, 'gastro') });

    expect(await abzug()).toEqual(vorher);
  });
});
