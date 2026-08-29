import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * POST /api/admin/products/:productId/catalog-link — §25 des Auftrags.
 *
 * Der dritte schreibende Adminvorgang des Systems, geprüft von außen durch
 * den echten Worker: Wer darf ihn auslösen, was passiert, wenn eine der drei
 * Schutzschichten fehlt, und was steht danach in der Datenbank.
 *
 * ALLE NAMEN UND WERTE SIND FREI ERFUNDEN.
 */

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://buschmann1846.de.angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const PFAD = '/api/admin/products/1/catalog-link';

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(
  id: number,
  identifier: string,
  role: 'admin' | 'customer',
  secret: string,
  isActive = true,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(
    id, identifier, role, role === 'customer' ? 1 : null,
    credential.algorithm, credential.iterations, credential.saltHex,
    credential.verifierHex, isActive ? 1 : 0, NOW, NOW,
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
  return { cookie: `buschmann_session_dev=${result.token}`, csrf: result.csrfToken };
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
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.body ?? '' }),
  }), environment());
}

function feld(csrf: string, catalogProductId: string): string {
  return new URLSearchParams({ csrf_token: csrf, catalog_product_id: catalogProductId }).toString();
}

async function verknuepfung(productId: number): Promise<number | null | 'fehlt'> {
  const row = await env.DB.prepare('SELECT catalog_product_id FROM products WHERE id = ?')
    .bind(productId).first<{ catalog_product_id: number | null }>();
  return row === null ? 'fehlt' : row.catalog_product_id;
}

beforeEach(async () => {
  for (const table of [
    'order_items', 'orders', 'auth_sessions', 'auth_accounts',
    'products', 'catalog_product_prices', 'catalog_products', 'customers',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();

  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, variant, unit, is_active, sort_order, created_at, updated_at)
     VALUES (7, 'fixture:kaese', 'Fiktiver Käsekuchen', '26-cm-Ring', NULL, 1, 10, ?1, ?1),
            (8, 'fixture:butter', 'Fiktiver Butterkuchen', NULL, 'Blech', 1, 20, ?1, ?1),
            (9, 'fixture:alt', 'Fiktiver Altbestand', NULL, NULL, 0, 30, ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at)
     VALUES (1, 'Käsekuchen', 99999, 'Stück', 1, 10, NULL, ?1, ?1),
            (2, 'Butterkuchen', 99999, 'Blech', 1, 20, 8, ?1, ?1)`,
  ).bind(NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
  await seedAccount(3, 'ex-admin@example.test', 'admin', 'fiktives-altadmin-passwort-123', false);
});

describe('Erfolgsfall — §17 PRG', () => {
  /** §25.11 */
  it('verknüpft als Admin und leitet mit 303 zurück auf den Katalog', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '7') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=saved#zuordnung');
    expect(await verknuepfung(1)).toBe(7);
  });

  it('hängt eine bestehende Zuordnung auf ein anderes Katalogprodukt um', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, '7') });
    await post({ path: '/api/admin/products/2/catalog-link', cookie, body: feld(csrf, '') });
    const response = await post({ cookie, body: feld(csrf, '8') });

    expect(response.status).toBe(303);
    expect(await verknuepfung(1)).toBe(8);
  });

  /** §9 — „Nicht verknüpft" über den leeren Wert. */
  it('löst eine Zuordnung über das leere Feld wieder auf', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/products/2/catalog-link', cookie, body: feld(csrf, ''),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=saved#zuordnung');
    expect(await verknuepfung(2)).toBeNull();
  });

  it('antwortet ohne Inhalt, damit ein Neuladen den POST nicht wiederholt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '7') });

    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('betrifft ausschließlich das im Pfad adressierte Produkt', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, '7') });

    expect(await verknuepfung(2)).toBe(8);
  });
});

describe('Autorisierung — §25.12 bis §25.17', () => {
  it('weist einen Customer ab, ohne etwas zu schreiben', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({ cookie, body: feld(csrf, '7') });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  /** §25.17 — eine behauptete Rolle im Körper ist keine Rolle. */
  it('lässt sich durch role=admin im Körper nicht überreden', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({
      cookie,
      body: new URLSearchParams({
        csrf_token: csrf,
        catalog_product_id: '7',
        role: 'admin',
        customer_id: '1',
        price_cents: '1',
      }).toString(),
    });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  /** §25.13 */
  it('schickt einen Unangemeldeten auf die Loginseite, ohne etwas zu schreiben', async () => {
    const response = await post({ body: 'catalog_product_id=7' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(await verknuepfung(1)).toBeNull();
  });

  it('lässt einen deaktivierten Admin nicht schreiben', async () => {
    const sitzung = await anmelden('ex-admin@example.test', 'fiktives-altadmin-passwort-123')
      .catch(() => null);
    if (sitzung === null) {
      // Ein deaktiviertes Konto kommt schon an der Anmeldung nicht vorbei.
      expect(await verknuepfung(1)).toBeNull();
      return;
    }
    const response = await post({ cookie: sitzung.cookie, body: feld(sitzung.csrf, '7') });
    expect(response.status).not.toBe(303);
    expect(await verknuepfung(1)).toBeNull();
  });
});

describe('CSRF und Origin — §25.14 bis §25.16', () => {
  it('verweigert einen fehlenden CSRF-Token', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: 'catalog_product_id=7' });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  it('verweigert einen falschen CSRF-Token', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: feld('falsch-und-erfunden', '7') });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  it('verweigert einen fremden Origin', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: FREMD, body: feld(csrf, '7') });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  it('verweigert einen fehlenden Origin', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: null, body: feld(csrf, '7') });

    expect(response.status).toBe(403);
    expect(await verknuepfung(1)).toBeNull();
  });

  it('nennt nicht, welche Prüfung gescheitert ist', async () => {
    const { cookie, csrf } = await admin();
    const ohneCsrf = await (await post({ cookie, body: 'catalog_product_id=7' })).text();
    const fremd = await (await post({ cookie, origin: FREMD, body: feld(csrf, '7') })).text();

    for (const text of [ohneCsrf, fremd]) {
      expect(text.toLowerCase()).not.toContain('csrf');
      expect(text.toLowerCase()).not.toContain('origin');
    }
  });
});

describe('Eingabeprüfung — §25.18 und §18', () => {
  it('speichert kein unbekanntes Katalogprodukt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '999') });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=unknown_catalog_product#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
  });

  it('vergibt ein stillgelegtes Katalogprodukt nicht neu', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '9') });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=inactive_catalog_product#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
  });

  /** §5 — der Unique-Konflikt kommt als Meldung zurück, nicht als SQL-Fehler. */
  it('lehnt ein bereits vergebenes Katalogprodukt kontrolliert ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '8') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=catalog_product_taken#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
    expect(await verknuepfung(2)).toBe(8);
  });

  it('meldet ein unbekanntes Produkt, ohne andere Produkte anzufassen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/products/999/catalog-link', cookie, body: feld(csrf, '7'),
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=unknown_product#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
    expect(await verknuepfung(2)).toBe(8);
  });

  it('behandelt eine unmögliche Produktkennung wie eine unbekannte', async () => {
    const { cookie, csrf } = await admin();
    for (const segment of ['0', '-1', '1.0', 'abc', '%20 1']) {
      const response = await post({
        path: `/api/admin/products/${segment}/catalog-link`, cookie, body: feld(csrf, '7'),
      });
      expect(response.headers.get('location')).toBe('/admin/catalog?notice=unknown_product#zuordnung');
    }
    expect(await verknuepfung(1)).toBeNull();
  });

  it('behandelt eine unmögliche Katalogkennung wie eine unbekannte', async () => {
    const { cookie, csrf } = await admin();
    for (const wert of ['0', '-1', '7.0', 'sieben', ' 7 ']) {
      const response = await post({ cookie, body: feld(csrf, wert) });
      expect(response.headers.get('location')).toBe('/admin/catalog?notice=unknown_catalog_product#zuordnung');
    }
    expect(await verknuepfung(1)).toBeNull();
  });

  it('erreicht über einen Traversal-Pfad gar nicht erst den Endpunkt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/products/../catalog-link', cookie, body: feld(csrf, '7'),
    });

    // Der URL-Parser normalisiert '..' weg, bevor überhaupt geroutet wird.
    expect(response.status).toBe(404);
    expect(await verknuepfung(1)).toBeNull();
  });

  /**
   * Ein kodierter Schrägstrich erzeugt KEIN zusätzliches Pfadsegment: `[^/]+`
   * im Muster sieht '1%2F..%2F2' als ein Segment, und daraus wird nach dem
   * Dekodieren keine gültige Kennung.
   */
  it('macht aus einem kodierten Schrägstrich kein zweites Segment', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/products/1%2F..%2F2/catalog-link', cookie, body: feld(csrf, '7'),
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=unknown_product#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
    expect(await verknuepfung(2)).toBe(8);
  });

  it('verlangt das Katalogfeld ausdrücklich', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, body: new URLSearchParams({ csrf_token: csrf }).toString(),
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=invalid#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
  });

  it('lehnt mehrfach geschickte Katalogfelder ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: `csrf_token=${encodeURIComponent(csrf)}&catalog_product_id=7&catalog_product_id=8`,
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=invalid#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
  });

  it('nimmt kein JSON entgegen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, contentType: 'application/json',
      body: JSON.stringify({ csrf_token: csrf, catalog_product_id: 7 }),
    });

    expect(response.status).toBe(415);
    expect(await verknuepfung(1)).toBeNull();
  });

  it('lehnt einen übergroßen Körper ab, ohne zu schreiben', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, body: `${feld(csrf, '7')}&fuellung=${'x'.repeat(4096)}`,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=internal#zuordnung');
    expect(await verknuepfung(1)).toBeNull();
  });

  it('existiert nur als POST', async () => {
    const { cookie } = await admin();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await post({ cookie, method });
      expect(response.status).toBe(405);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('§17 — kein Open Redirect, kein fremdes Ziel', () => {
  it('leitet auch im Fehlerfall ausschließlich auf den eigenen Katalog', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: `${feld(csrf, '999')}&returnUrl=${encodeURIComponent(FREMD)}&next=${encodeURIComponent(FREMD)}`,
    });

    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('/admin/catalog?notice=')).toBe(true);
    expect(location).not.toContain('angreifer');
  });
});

describe('§11 und §24.10 — was der Endpunkt NICHT anfasst', () => {
  it('verändert weder Preise noch Katalogdaten noch bestehende Bestellungen', async () => {
    const { cookie, csrf } = await admin();
    await env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (7, 1, 'fixed', 2100, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, status,
                           fulfillment_type, fulfillment_date, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café', 'new', 'pickup', '2026-08-26', 4200, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (1, 1, 1, 'Käsekuchen', 'Stück', 2100, 2, 4200)`,
    ).run();

    const preiseVorher = (await env.DB.prepare('SELECT * FROM catalog_product_prices').all()).results;
    const katalogVorher = (await env.DB.prepare('SELECT * FROM catalog_products').all()).results;
    const bestellungVorher = (await env.DB.prepare('SELECT * FROM orders').all()).results;
    const positionenVorher = (await env.DB.prepare('SELECT * FROM order_items').all()).results;
    const preisVorher = await env.DB.prepare('SELECT price_cents FROM products WHERE id = 1')
      .first<{ price_cents: number }>();

    await post({ cookie, body: feld(csrf, '7') });

    expect((await env.DB.prepare('SELECT * FROM catalog_product_prices').all()).results).toEqual(preiseVorher);
    expect((await env.DB.prepare('SELECT * FROM catalog_products').all()).results).toEqual(katalogVorher);
    expect((await env.DB.prepare('SELECT * FROM orders').all()).results).toEqual(bestellungVorher);
    expect((await env.DB.prepare('SELECT * FROM order_items').all()).results).toEqual(positionenVorher);
    expect((await env.DB.prepare('SELECT price_cents FROM products WHERE id = 1')
      .first<{ price_cents: number }>())?.price_cents).toBe(preisVorher?.price_cents);
  });
});
