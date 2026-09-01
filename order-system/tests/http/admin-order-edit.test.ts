import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-09-01T06:00:00.000Z';
const TAG = '2026-09-04';
const NUMMER = 'BUS-2026-000001';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

const SEITE = `/admin/orders/${NUMMER}/bearbeiten`;
const MENGEN = `/api/admin/orders/${NUMMER}/items`;
const STORNO = (itemId: number) => `/api/admin/orders/${NUMMER}/items/${itemId}/cancel`;

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
  readonly csrfToken: string;
}

async function login(identifier: string, secret: string): Promise<Sitzung> {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  return { cookie: `buschmann_session_dev=${result.token}`, csrfToken: result.csrfToken };
}

const admin = () => login('admin@example.test', 'fiktives-admin-passwort-123');
const kunde = () => login('testcafe', 'fiktive-kunden-pin-123');

async function version(): Promise<string> {
  const row = await env.DB.prepare('SELECT updated_at FROM orders WHERE order_number = ?')
    .bind(NUMMER).first<{ updated_at: string }>();
  return row!.updated_at;
}

async function menge(itemId: number): Promise<{ quantity: number; cancelled_at: string | null }> {
  const row = await env.DB.prepare(
    'SELECT quantity, cancelled_at FROM order_items WHERE id = ?',
  ).bind(itemId).first<{ quantity: number; cancelled_at: string | null }>();
  return row!;
}

async function gesamt(): Promise<number> {
  const row = await env.DB.prepare('SELECT total_amount_cents FROM orders WHERE order_number = ?')
    .bind(NUMMER).first<{ total_amount_cents: number }>();
  return row!.total_amount_cents;
}

interface PostOptions {
  readonly session?: Sitzung | null;
  readonly origin?: string | null;
  readonly csrf?: string | null;
  readonly contentType?: string | null;
  readonly path?: string;
  readonly felder?: Record<string, string>;
  readonly rawBody?: string;
}

async function post(options: PostOptions = {}): Promise<Response> {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set('origin', origin);
  if (options.session) headers.set('cookie', options.session.cookie);
  const contentType =
    options.contentType === undefined ? 'application/x-www-form-urlencoded' : options.contentType;
  if (contentType !== null) headers.set('content-type', contentType);

  const felder = new URLSearchParams();
  const csrf = options.csrf === undefined ? options.session?.csrfToken ?? null : options.csrf;
  if (csrf !== null) felder.set('csrf_token', csrf);
  felder.set('version', await version());
  for (const [key, value] of Object.entries(options.felder ?? { 'quantity_1': '3' })) {
    felder.set(key, value);
  }

  return worker.fetch(
    new Request(`${ORIGIN}${options.path ?? MENGEN}`, {
      method: 'POST',
      headers,
      body: options.rawBody ?? felder.toString(),
    }),
    environment(),
  );
}

async function get(path: string, session?: Sitzung | null): Promise<Response> {
  const headers = new Headers();
  if (session) headers.set('cookie', session.cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

async function seedOrder(status = 'confirmed', paymentStatus = 'unpaid'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (1, ?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, 12200, ?, ?, ?, ?)`,
  ).bind(
    NUMMER, TAG, status, paymentStatus,
    paymentStatus === 'unpaid' ? null : NOW, NOW, NOW,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (1, 1, 1, 'New York Cheesecake Classic', 'Stück', 2200, 5, 11000)`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (2, 1, 2, 'Brownie', 'Stück', 400, 3, 1200)`,
  ).run();
}

beforeEach(async () => {
  for (const table of [
    'order_item_changes', 'order_items', 'orders', 'auth_sessions', 'auth_accounts',
    'products', 'customers',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
  for (const [id, name, sort] of [[1, 'New York Cheesecake Classic', 10], [2, 'Brownie', 20]] as const) {
    await env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, 2200, 'Stück', ?, 1, ?, ?)`,
    ).bind(id, name, sort, NOW, NOW).run();
  }
  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
  await seedOrder();
});

// ===========================================================================
// GET /admin/orders/:nr/bearbeiten
// ===========================================================================

describe('GET /admin/orders/:orderNumber/bearbeiten — Zugang', () => {
  it('weist eine Anfrage ohne Sitzung auf die Loginseite', async () => {
    const response = await get(SEITE);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('weist ein angemeldetes Café ab', async () => {
    const response = await get(SEITE, await kunde());

    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('New York Cheesecake Classic');
  });

  it('zeigt einem Admin die Seite', async () => {
    const response = await get(SEITE, await admin());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('trägt no-store wie jede andere Adminseite', async () => {
    const response = await get(SEITE, await admin());

    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('antwortet auf eine unbekannte Bestellung mit 404', async () => {
    const response = await get('/admin/orders/BUS-2026-999999/bearbeiten', await admin());

    expect(response.status).toBe(404);
  });

  it('antwortet auf eine unmögliche Bestellnummer ebenso mit 404', async () => {
    const response = await get('/admin/orders/keine-nummer/bearbeiten', await admin());

    expect(response.status).toBe(404);
  });

  it('lehnt jede andere Methode ab', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${SEITE}`, { method: 'DELETE' }),
      environment(),
    );

    expect(response.status).toBe(405);
  });
});

describe('GET /admin/orders/:orderNumber/bearbeiten — Inhalt', () => {
  it('zeigt jede Position mit Name, Einheit, Stückpreis, Menge und Positionsbetrag', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain('New York Cheesecake Classic');
    expect(html).toContain('Stück');
    expect(html).toContain('22,00');
    expect(html).toContain('110,00');
  });

  it('zeigt den aktuellen Gesamtbetrag', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain('122,00');
  });

  it('bietet je aktiver Position ein Mengenfeld mit der aktuellen Menge', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).toMatch(/name="quantity_1"[^>]*value="5"/);
    expect(html).toMatch(/name="quantity_2"[^>]*value="3"/);
  });

  it('führt den Stand der Bestellung als verstecktes Feld mit', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain(`name="version" value="${NOW}"`);
  });

  it('bietet je aktiver Position eine Stornierung an', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain('Position stornieren');
    expect(html).toContain('stornieren=1');
  });

  it('zeigt KEINE Zahlungswarnung, solange die Bestellung offen ist', async () => {
    const html = await (await get(SEITE, await admin())).text();

    expect(html).not.toContain('bereits als bezahlt markiert');
  });

  it('warnt sichtbar, wenn die Bestellung bereits als bezahlt markiert ist', async () => {
    await env.DB.prepare(
      "UPDATE orders SET payment_status = 'paid_cash', payment_recorded_at = ? WHERE id = 1",
    ).bind(NOW).run();

    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain('bereits als bezahlt markiert');
    expect(html).toContain('Erstattung');
    expect(html).toMatch(/role="alert"/);
  });

  it('verlangt eine Bestätigung, bevor eine Position storniert wird', async () => {
    const html = await (await get(`${SEITE}?stornieren=2`, await admin())).text();

    expect(html).toContain('Brownie');
    expect(html).toMatch(/wirklich stornieren/i);
    expect(html).toContain(`/api/admin/orders/${NUMMER}/items/2/cancel`);
  });

  it('zeigt eine stornierte Position weiterhin und kennzeichnet sie', async () => {
    await env.DB.prepare('UPDATE order_items SET cancelled_at = ? WHERE id = 2').bind(NOW).run();
    await env.DB.prepare('UPDATE orders SET total_amount_cents = 11000 WHERE id = 1').run();

    const html = await (await get(SEITE, await admin())).text();

    expect(html).toContain('Brownie');
    expect(html).toContain('Storniert');
    expect(html).not.toMatch(/name="quantity_2"/);
  });

  it('führt eine nicht mehr bearbeitbare Bestellung zurück auf die Liste', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'in_production' WHERE id = 1").run();

    const response = await get(SEITE, await admin());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/admin/orders?date=${TAG}&notice=edit_not_editable`,
    );
  });
});

// ===========================================================================
// POST /api/admin/orders/:nr/items
// ===========================================================================

describe('POST /api/admin/orders/:orderNumber/items — Zugang', () => {
  it('schickt eine Anfrage ohne Sitzung auf die Loginseite und ändert nichts', async () => {
    const response = await post({ session: null });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt ein angemeldetes Café ab und ändert nichts', async () => {
    const response = await post({ session: await kunde() });

    expect(response.status).toBe(403);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt einen fremden Origin ab und ändert nichts', async () => {
    const response = await post({ session: await admin(), origin: FREMD });

    expect(response.status).toBe(403);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt eine Anfrage ganz ohne Origin ab', async () => {
    const response = await post({ session: await admin(), origin: null });

    expect(response.status).toBe(403);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt einen fehlenden CSRF-Token ab und ändert nichts', async () => {
    const response = await post({ session: await admin(), csrf: null });

    expect(response.status).toBe(403);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt einen falschen CSRF-Token ab und ändert nichts', async () => {
    const response = await post({ session: await admin(), csrf: 'a'.repeat(43) });

    expect(response.status).toBe(403);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt einen anderen Content-Type ab — erst nach der Wache', async () => {
    expect((await post({ session: await admin(), contentType: 'application/json' })).status).toBe(415);
    expect((await post({ session: null, contentType: 'application/json' })).status).toBe(303);
  });

  it('lehnt GET ab', async () => {
    const response = await get(MENGEN, await admin());

    expect(response.status).toBe(405);
  });
});

describe('POST /api/admin/orders/:orderNumber/items — Mengen', () => {
  it('verringert 5 auf 3 und führt auf die Bearbeitungsseite zurück', async () => {
    const response = await post({ session: await admin(), felder: { quantity_1: '3', quantity_2: '3' } });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_saved`);
    expect((await menge(1)).quantity).toBe(3);
  });

  it('erhöht 3 auf 5', async () => {
    await post({ session: await admin(), felder: { quantity_1: '5', quantity_2: '5' } });

    expect((await menge(2)).quantity).toBe(5);
  });

  it('schreibt den neuen Gesamtbetrag fort', async () => {
    await post({ session: await admin(), felder: { quantity_1: '3', quantity_2: '3' } });

    expect(await gesamt()).toBe(7800);
  });

  it('zeigt den neuen Gesamtbetrag auf der Seite danach', async () => {
    await post({ session: await admin(), felder: { quantity_1: '3', quantity_2: '3' } });

    const html = await (await get(`${SEITE}?notice=items_saved`, await admin())).text();
    expect(html).toContain('78,00');
  });

  it('meldet eine unveränderte Eingabe als solche', async () => {
    const response = await post({ session: await admin(), felder: { quantity_1: '5', quantity_2: '3' } });

    expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_unchanged`);
  });

  it('lehnt die Menge 0 ab und ändert nichts', async () => {
    const response = await post({ session: await admin(), felder: { quantity_1: '0' } });

    expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_invalid`);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt eine negative, gebrochene und unsinnige Menge ab', async () => {
    for (const unsinn of ['-1', '2.5', 'drei', '99999']) {
      const response = await post({ session: await admin(), felder: { quantity_1: unsinn } });
      expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_invalid`);
    }
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt einen veralteten Stand ab und ändert nichts', async () => {
    const session = await admin();
    const felder = new URLSearchParams();
    felder.set('csrf_token', session.csrfToken);
    felder.set('version', '2020-01-01T00:00:00.000Z');
    felder.set('quantity_1', '3');

    const response = await worker.fetch(
      new Request(`${ORIGIN}${MENGEN}`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: session.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: felder.toString(),
      }),
      environment(),
    );

    expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_conflict`);
    expect((await menge(1)).quantity).toBe(5);
  });

  it('lehnt eine nicht mehr bearbeitbare Bestellung ab', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'completed' WHERE id = 1").run();

    const response = await post({ session: await admin() });

    expect(response.headers.get('location')).toBe(
      `/admin/orders?date=${TAG}&notice=edit_not_editable`,
    );
    expect((await menge(1)).quantity).toBe(5);
  });

  it('übergeht ein Feld zu einer Position, die es nicht gibt', async () => {
    const response = await post({
      session: await admin(),
      felder: { quantity_1: '3', quantity_4711: '9' },
    });

    // Die Wünsche entstehen aus den Positionen der Bestellung, nicht aus den
    // Feldnamen des Körpers. Ein erfundenes Feld bewirkt gar nichts.
    expect(response.headers.get('location')).toBe(`${SEITE}?notice=items_saved`);
    expect((await menge(1)).quantity).toBe(3);
  });

  it('ändert keine fremde Bestellung, auch wenn ein Feld sie nennt', async () => {
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (2, 'BUS-2026-000002', 1, 'Fiktives Café Nord', 'pickup', ?, 'confirmed', 2200, ?, ?)`,
    ).bind(TAG, NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (9, 2, 1, 'New York Cheesecake Classic', 'Stück', 2200, 1, 2200)`,
    ).run();

    await post({ session: await admin(), felder: { quantity_9: '99' } });

    expect((await menge(9)).quantity).toBe(1);
  });
});

// ===========================================================================
// POST /api/admin/orders/:nr/items/:id/cancel
// ===========================================================================

describe('POST /api/admin/orders/:orderNumber/items/:itemId/cancel', () => {
  const storniere = (session: Sitzung | null, itemId = 2) =>
    post({ session, path: STORNO(itemId), felder: {} });

  it('lehnt eine Anfrage ohne Sitzung ab und storniert nichts', async () => {
    await storniere(null);

    expect((await menge(2)).cancelled_at).toBeNull();
  });

  it('lehnt ein angemeldetes Café ab und storniert nichts', async () => {
    const response = await storniere(await kunde());

    expect(response.status).toBe(403);
    expect((await menge(2)).cancelled_at).toBeNull();
  });

  it('lehnt einen fremden Origin ab', async () => {
    const response = await post({ session: await admin(), path: STORNO(2), origin: FREMD, felder: {} });

    expect(response.status).toBe(403);
    expect((await menge(2)).cancelled_at).toBeNull();
  });

  it('lehnt einen falschen CSRF-Token ab', async () => {
    const response = await post({
      session: await admin(), path: STORNO(2), csrf: 'a'.repeat(43), felder: {},
    });

    expect(response.status).toBe(403);
    expect((await menge(2)).cancelled_at).toBeNull();
  });

  it('storniert die Position und führt auf die Bearbeitungsseite zurück', async () => {
    const response = await storniere(await admin());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SEITE}?notice=item_cancelled`);
    expect((await menge(2)).cancelled_at).not.toBeNull();
  });

  it('lässt die übrigen Positionen aktiv', async () => {
    await storniere(await admin());

    expect(await menge(1)).toEqual({ quantity: 5, cancelled_at: null });
  });

  it('zieht den Gesamtbetrag nach', async () => {
    await storniere(await admin());

    expect(await gesamt()).toBe(11000);
  });

  it('bleibt bei wiederholter Stornierung folgenlos', async () => {
    await storniere(await admin());
    const zweiter = await storniere(await admin());

    expect(zweiter.headers.get('location')).toBe(`${SEITE}?notice=item_already_cancelled`);

    const { results } = await env.DB.prepare('SELECT id FROM order_item_changes').all();
    expect(results).toHaveLength(1);
  });

  it('lehnt eine Position ab, die zu einer anderen Bestellung gehört', async () => {
    const response = await storniere(await admin(), 4711);

    expect(response.headers.get('location')).toBe(`${SEITE}?notice=item_unknown`);
  });

  it('führt die Bestellung in den Storno-Zustand, wenn die letzte Position storniert wird', async () => {
    await storniere(await admin(), 1);
    const response = await storniere(await admin(), 2);

    expect(response.headers.get('location')).toBe(
      `/admin/orders?date=${TAG}&notice=order_cancelled_by_items`,
    );

    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = 1')
      .first<{ status: string }>();
    expect(row?.status).toBe('cancelled');
  });
});

// ===========================================================================
// Die Bestellliste
// ===========================================================================

describe('/admin/orders — der Weg zur Bearbeitung', () => {
  it('bietet je bearbeitbarer Bestellung „Bestellung bearbeiten" an', async () => {
    const html = await (await get(`/admin/orders?date=${TAG}`, await admin())).text();

    expect(html).toContain('Bestellung bearbeiten');
    expect(html).toContain(`/admin/orders/${NUMMER}/bearbeiten`);
  });

  it('bietet die Bearbeitung NICHT an, sobald die Bestellung in Produktion ist', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'in_production' WHERE id = 1").run();

    const html = await (await get(`/admin/orders?date=${TAG}`, await admin())).text();

    expect(html).not.toContain(`/admin/orders/${NUMMER}/bearbeiten`);
  });
});
