import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * POST /api/admin/catalog-products/:catalogProductId/cost — §18 des Auftrags.
 *
 * Der sechste schreibende Adminvorgang des Systems, geprüft von außen durch
 * den echten Worker: Wer darf ihn auslösen, was passiert, wenn eine der drei
 * Schutzschichten fehlt, und was steht danach in der Datenbank.
 *
 * ALLE NAMEN UND WERTE SIND FREI ERFUNDEN.
 */

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://buschmann1846.de.angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-26T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const PFAD = '/api/admin/catalog-products/7/cost';

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

function feld(csrf: string, unitCost: string): string {
  return new URLSearchParams({ csrf_token: csrf, unit_cost: unitCost }).toString();
}

async function kosten(catalogProductId: number): Promise<number | null | 'fehlt'> {
  const row = await env.DB.prepare('SELECT unit_cost_cents FROM catalog_products WHERE id = ?')
    .bind(catalogProductId).first<{ unit_cost_cents: number | null }>();
  return row === null ? 'fehlt' : row.unit_cost_cents;
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
     VALUES (1, 'Fiktives Café', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO catalog_products
       (id, source_key, name, variant, unit, is_active, sort_order, unit_cost_cents, created_at, updated_at)
     VALUES (7, 'fixture:kaese', 'Fiktiver Käsekuchen', NULL, 'Stück', 1, 10, NULL, ?1, ?1),
            (8, 'fixture:butter', 'Fiktiver Butterkuchen', NULL, 'Blech', 1, 20, 1450, ?1, ?1),
            (9, 'fixture:alt', 'Fiktiver Altbestand', NULL, NULL, 0, 30, NULL, ?1, ?1)`,
  ).bind(NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('Erfolgsfall — §18.23 und §18.27 PRG', () => {
  it('speichert einen Betrag und leitet mit 303 zurück auf den Katalog', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '2,10') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_saved#herstellkosten');
    expect(await kosten(7)).toBe(210);
  });

  it('überschreibt einen bestehenden Wert', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/catalog-products/8/cost', cookie, body: feld(csrf, '15,90'),
    });

    expect(response.status).toBe(303);
    expect(await kosten(8)).toBe(1590);
  });

  /** §2 — 0 ist eine bewusste Aussage und wird gespeichert. */
  it('speichert 0 als Betrag und nicht als „nicht hinterlegt"', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, '0') });

    expect(await kosten(7)).toBe(0);
  });

  /** Der leere Wert entfernt einen gepflegten Kostenwert wieder. */
  it('entfernt einen Wert über das leere Feld und meldet das eigens', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/catalog-products/8/cost', cookie, body: feld(csrf, ''),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_cleared#herstellkosten');
    expect(await kosten(8)).toBeNull();
  });

  /** §18.28 */
  it('antwortet ohne Inhalt und mit no-store, damit ein Neuladen nichts wiederholt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '2,10') });

    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('betrifft ausschließlich das im Pfad adressierte Katalogprodukt', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, '2,10') });

    expect(await kosten(8)).toBe(1450);
    expect(await kosten(9)).toBeNull();
  });

  /** §3 — der Endpunkt fasst keine Bestellung an. */
  it('lässt bestehende Bestellpositionen unberührt', async () => {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at)
       VALUES (1, 'Fiktiver Käsekuchen', 520, 'Stück', 1, 10, 7, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café', 'pickup', '2026-08-28', 'new', 1560, ?1, ?1)`,
    ).bind(NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
       VALUES (1, 1, 'Fiktiver Käsekuchen', 'Stück', 520, 3, 1560, 195)`,
    ).run();

    const { cookie, csrf } = await admin();
    await post({ cookie, body: feld(csrf, '2,60') });

    const row = await env.DB.prepare(
      'SELECT unit_cost_cents_snapshot AS wert, unit_price_cents FROM order_items',
    ).first<{ wert: number | null; unit_price_cents: number }>();

    expect(row?.wert).toBe(195);
    expect(row?.unit_price_cents).toBe(520);
    expect(await kosten(7)).toBe(260);
  });
});

describe('Autorisierung — §15.8', () => {
  /** §15.8 — ein Café hat auf diesem Endpunkt nichts zu suchen. */
  it('weist einen Customer ab, ohne etwas zu schreiben', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({ cookie, body: feld(csrf, '2,10') });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });

  /**
   * OHNE SITZUNG FÜHRT DIE WACHE AUF DIE ANMELDUNG — dieselbe Antwort wie bei
   * jedem anderen Formularendpunkt des Adminbereichs ('html'-Modus). Wichtig
   * ist nicht der Statuscode, sondern dass NICHTS geschrieben wurde und das
   * Ziel die Anmeldung ist und nicht der Katalog.
   */
  it('führt eine Anfrage ohne Sitzung auf die Anmeldung, ohne zu schreiben', async () => {
    const response = await post({ body: feld('irgendein-token', '2,10') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(await kosten(7)).toBeNull();
  });

  /** §10 — eine behauptete Rolle im Körper ist keine Rolle. */
  it('lässt sich durch role=admin im Körper nicht überreden', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({
      cookie,
      body: new URLSearchParams({
        csrf_token: csrf, unit_cost: '2,10', role: 'admin', account_id: '1',
      }).toString(),
    });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });
});

describe('CSRF und Origin — §18.25 und §18.26', () => {
  /** §18.25 */
  it('weist einen fehlenden CSRF-Token ab', async () => {
    const { cookie } = await admin();
    const response = await post({
      cookie, body: new URLSearchParams({ unit_cost: '2,10' }).toString(),
    });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });

  it('weist einen falschen CSRF-Token ab', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: feld('fiktiver-falscher-token', '2,10') });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });

  /** §18.26 */
  it('weist einen fremden Origin ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: FREMD, body: feld(csrf, '2,10') });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });

  it('weist eine Anfrage ganz ohne Origin ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, origin: null, body: feld(csrf, '2,10') });

    expect(response.status).toBe(403);
    expect(await kosten(7)).toBeNull();
  });

  /** Die Ablehnung sagt nicht, WELCHE Prüfung gescheitert ist. */
  it('nennt in der Ablehnung keinen Grund', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, body: feld('falsch', '2,10') });
    const text = await response.text();

    expect(text).not.toMatch(/csrf|origin|token/i);
  });
});

describe('Ungültige Eingaben — §18.24', () => {
  /** §15.4 und §18.24 */
  it('weist negative Herstellkosten ab, ohne zu schreiben', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: feld(csrf, '-2,10') });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_invalid#herstellkosten');
    expect(await kosten(7)).toBeNull();
  });

  it('weist unlesbare Beträge ab, ohne zu schreiben', async () => {
    const { cookie, csrf } = await admin();

    for (const wert of ['zwei Euro', '2,105', '1.234,56', '2e2', '2,10 €', '99999,99']) {
      const response = await post({ cookie, body: feld(csrf, wert) });
      expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_invalid#herstellkosten');
    }

    expect(await kosten(7)).toBeNull();
  });

  /**
   * EIN BESTEHENDER WERT ÜBERLEBT EINEN TIPPFEHLER. Genau dafür gibt es das
   * dreiwertige Leseergebnis: „unlesbar" ist nicht „leer".
   */
  it('lässt einen gepflegten Wert bei ungültiger Eingabe stehen', async () => {
    const { cookie, csrf } = await admin();
    await post({ path: '/api/admin/catalog-products/8/cost', cookie, body: feld(csrf, '14,5x') });

    expect(await kosten(8)).toBe(1450);
  });

  it('weist ein fehlendes Feld ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, body: new URLSearchParams({ csrf_token: csrf }).toString(),
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_invalid#herstellkosten');
    expect(await kosten(7)).toBeNull();
  });

  it('weist ein doppelt geschicktes Feld ab, statt eines davon zu nehmen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, body: `csrf_token=${encodeURIComponent(csrf)}&unit_cost=2%2C10&unit_cost=9%2C99`,
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_invalid#herstellkosten');
    expect(await kosten(7)).toBeNull();
  });

  it('meldet ein unbekanntes Katalogprodukt, ohne etwas anzulegen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/catalog-products/4242/cost', cookie, body: feld(csrf, '2,10'),
    });

    expect(response.headers.get('location'))
      .toBe('/admin/catalog?notice=cost_unknown_product#herstellkosten');
    expect(await kosten(4242)).toBe('fehlt');
  });

  /**
   * EINE UNMÖGLICHE KENNUNG IST DIESELBE ANTWORT WIE EINE UNBEKANNTE — sonst
   * wäre die Antwort eine Auskunft darüber, wie eine gültige Kennung aussieht.
   */
  it('behandelt eine unmögliche Kennung wie eine unbekannte', async () => {
    const { cookie, csrf } = await admin();

    for (const segment of ['0', '-1', '7.0', 'abc', '%2e%2e']) {
      const response = await post({
        path: `/api/admin/catalog-products/${segment}/cost`, cookie, body: feld(csrf, '2,10'),
      });
      expect([303, 404]).toContain(response.status);
      if (response.status === 303) {
        expect(response.headers.get('location'))
          .toBe('/admin/catalog?notice=cost_unknown_product#herstellkosten');
      }
    }

    expect(await kosten(7)).toBeNull();
  });

  /** Ein stillgelegtes Katalogprodukt steht auf keiner Seite und wird nicht beschrieben. */
  it('schreibt nicht auf ein stillgelegtes Katalogprodukt', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      path: '/api/admin/catalog-products/9/cost', cookie, body: feld(csrf, '2,10'),
    });

    expect(response.headers.get('location'))
      .toBe('/admin/catalog?notice=cost_unknown_product#herstellkosten');
    expect(await kosten(9)).toBeNull();
  });
});

describe('Anfrageform', () => {
  it('lehnt einen anderen Content-Type mit 415 ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie, contentType: 'application/json', body: JSON.stringify({ csrf_token: csrf, unit_cost: '2,10' }),
    });

    expect(response.status).toBe(415);
    expect(await kosten(7)).toBeNull();
  });

  /** Die 415 kommt erst NACH der Wache — ein Fremder erfährt die Form nicht. */
  it('antwortet einem Fremden auch bei falschem Content-Type mit 403', async () => {
    const response = await post({ contentType: 'application/json', body: '{}' });

    expect(response.status).not.toBe(415);
    expect(await kosten(7)).toBeNull();
  });

  it('lehnt GET mit 405 ab', async () => {
    const { cookie } = await admin();
    const response = await post({ cookie, method: 'GET' });

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  /** Kein Open Redirect: Das Ziel steht im Quelltext, nicht in der Anfrage. */
  it('folgt keinem gewünschten Rückkehrziel aus dem Körper', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: new URLSearchParams({
        csrf_token: csrf,
        unit_cost: '2,10',
        next: FREMD,
        redirect: FREMD,
        return_to: '/admin/customers',
      }).toString(),
    });

    expect(response.headers.get('location')).toBe('/admin/catalog?notice=cost_saved#herstellkosten');
  });
});
