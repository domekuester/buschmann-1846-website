import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const TAG = '2026-08-28';
const NUMMER = 'BUS-2026-000001';
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

async function seedOrder(orderNumber = NUMMER, status = 'new'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (?, 1, 'Fiktives Café Nord', 'pickup', ?, ?, 4350, ?, ?)`,
  ).bind(orderNumber, TAG, status, NOW, NOW).run();
}

async function zahlung(orderNumber = NUMMER): Promise<{
  payment_status: string;
  payment_recorded_at: string | null;
}> {
  const row = await env.DB.prepare(
    'SELECT payment_status, payment_recorded_at FROM orders WHERE order_number = ?',
  ).bind(orderNumber).first<{ payment_status: string; payment_recorded_at: string | null }>();
  if (!row) throw new Error('Bestellung fehlt');
  return row;
}

interface PostOptions {
  readonly session?: Sitzung | null;
  readonly origin?: string | null;
  readonly csrf?: string | null;
  readonly body?: string;
  readonly contentType?: string | null;
  readonly path?: string;
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
  felder.set('payment_status', 'paid_cash');

  return worker.fetch(
    new Request(`${ORIGIN}${options.path ?? `/api/admin/orders/${NUMMER}/payment`}`, {
      method: 'POST',
      headers,
      body: options.body ?? felder.toString(),
    }),
    environment(),
  );
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();
  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
  await seedOrder();
});

describe('POST /api/admin/orders/:orderNumber/payment — Erfolg', () => {
  it('trägt den Zahlungsstand ein und führt auf den Tag der Bestellung zurück', async () => {
    const response = await post({ session: await admin() });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/admin/dashboard?date=${TAG}&notice=payment_saved`,
    );
    expect((await zahlung()).payment_status).toBe('paid_cash');
  });

  it('setzt den Zahlungszeitpunkt', async () => {
    await post({ session: await admin() });
    expect((await zahlung()).payment_recorded_at).not.toBeNull();
  });

  it('nimmt jede der fünf Zahlarten an', async () => {
    const session = await admin();

    for (const status of ['paid_card', 'paid_bank', 'paid_other', 'paid_cash', 'unpaid']) {
      const felder = new URLSearchParams({ csrf_token: session.csrfToken, payment_status: status });
      const response = await post({ session, body: felder.toString() });

      expect(response.status).toBe(303);
      expect((await zahlung()).payment_status).toBe(status);
    }
  });

  it('löscht den Zeitpunkt beim Zurücksetzen auf offen', async () => {
    const session = await admin();
    await post({ session });

    const felder = new URLSearchParams({ csrf_token: session.csrfToken, payment_status: 'unpaid' });
    await post({ session, body: felder.toString() });

    expect(await zahlung()).toEqual({ payment_status: 'unpaid', payment_recorded_at: null });
  });

  it('lässt den Produktionsstatus unberührt', async () => {
    await env.DB.prepare("UPDATE orders SET status = 'completed' WHERE order_number = ?")
      .bind(NUMMER).run();

    await post({ session: await admin() });

    const row = await env.DB.prepare('SELECT status FROM orders WHERE order_number = ?')
      .bind(NUMMER).first<{ status: string }>();
    expect(row?.status).toBe('completed');
  });

  it('antwortet einem Formular niemals mit JSON', async () => {
    const response = await post({ session: await admin() });

    // Die Weiterleitung hat gar keinen Körper und damit auch keinen
    // Content-Type — die schärfere Form von „kein JSON im Browserfenster".
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });
});

describe('POST /api/admin/orders/:orderNumber/payment — Zugang', () => {
  it('weist eine Anfrage ohne Sitzung ab, ohne zu schreiben', async () => {
    const response = await post({ session: null, csrf: 'irgendwas' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('weist einen Customer ab, ohne zu schreiben', async () => {
    const response = await post({ session: await kunde() });

    expect(response.status).toBe(403);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('weist eine Anfrage ohne CSRF-Token ab, ohne zu schreiben', async () => {
    const response = await post({ session: await admin(), csrf: null });

    expect(response.status).toBe(403);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('weist einen falschen CSRF-Token ab, ohne zu schreiben', async () => {
    const response = await post({ session: await admin(), csrf: 'falscher-token' });

    expect(response.status).toBe(403);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('weist einen fremden Origin ab, ohne zu schreiben', async () => {
    const response = await post({ session: await admin(), origin: FREMD });

    expect(response.status).toBe(403);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('weist eine Anfrage ganz ohne Origin ab, ohne zu schreiben', async () => {
    const response = await post({ session: await admin(), origin: null });

    expect(response.status).toBe(403);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('nennt in der Ablehnung nicht, welche Prüfung gescheitert ist', async () => {
    const text = await (await post({ session: await admin(), origin: FREMD })).text();

    expect(text.toLowerCase()).not.toContain('csrf');
    expect(text.toLowerCase()).not.toContain('origin');
  });

  it('antwortet auf GET mit 405 und no-store', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/orders/${NUMMER}/payment`, {
        method: 'GET',
        headers: { origin: ORIGIN, cookie: (await admin()).cookie },
      }),
      environment(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /api/admin/orders/:orderNumber/payment — Eingaben', () => {
  it('lehnt einen erfundenen Zahlungsstand ab, ohne zu schreiben', async () => {
    const session = await admin();
    const felder = new URLSearchParams({
      csrf_token: session.csrfToken,
      payment_status: 'paid_bitcoin',
    });

    const response = await post({ session, body: felder.toString() });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('notice=invalid');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('lehnt einen Produktionsstatus als Zahlungsstand ab', async () => {
    const session = await admin();
    const felder = new URLSearchParams({
      csrf_token: session.csrfToken,
      payment_status: 'completed',
    });

    const response = await post({ session, body: felder.toString() });

    expect(response.headers.get('location')).toContain('notice=invalid');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('normalisiert nichts', async () => {
    const session = await admin();
    for (const wert of ['PAID_CASH', ' paid_cash', 'paid_cash ', 'Bar']) {
      const felder = new URLSearchParams({ csrf_token: session.csrfToken, payment_status: wert });
      await post({ session, body: felder.toString() });
      expect((await zahlung()).payment_status).toBe('unpaid');
    }
  });

  it('lehnt ein fehlendes Feld ab', async () => {
    const session = await admin();
    const felder = new URLSearchParams({ csrf_token: session.csrfToken });

    const response = await post({ session, body: felder.toString() });

    expect(response.headers.get('location')).toContain('notice=invalid');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('lehnt mehrere Felder ab, statt still das erste zu nehmen', async () => {
    const session = await admin();
    const felder = new URLSearchParams();
    felder.set('csrf_token', session.csrfToken);
    felder.append('payment_status', 'paid_cash');
    felder.append('payment_status', 'unpaid');

    const response = await post({ session, body: felder.toString() });

    expect(response.headers.get('location')).toContain('notice=invalid');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('meldet eine unbekannte Bestellung, ohne etwas zu schreiben', async () => {
    const response = await post({
      session: await admin(),
      path: '/api/admin/orders/BUS-2026-999999/payment',
    });

    expect(response.headers.get('location')).toBe('/admin/dashboard?notice=unknown_order');
    expect((await zahlung()).payment_status).toBe('unpaid');
  });

  it('meldet eine unmögliche Bestellnummer wie eine unbekannte', async () => {
    const response = await post({
      session: await admin(),
      path: '/api/admin/orders/kein-format/payment',
    });

    expect(response.headers.get('location')).toBe('/admin/dashboard?notice=unknown_order');
  });

  it('lehnt einen fremden Content-Type ab', async () => {
    const response = await post({ session: await admin(), contentType: 'application/json' });

    expect(response.status).toBe(415);
    expect((await zahlung()).payment_status).toBe('unpaid');
  });
});

describe('POST /api/admin/orders/:orderNumber/payment — kein Open Redirect', () => {
  it('ignoriert ein mitgeschicktes Rückkehrziel', async () => {
    const session = await admin();
    const felder = new URLSearchParams({
      csrf_token: session.csrfToken,
      payment_status: 'paid_cash',
      return_to: FREMD,
      next: FREMD,
      redirect: FREMD,
    });

    const response = await post({ session, body: felder.toString() });

    expect(response.headers.get('location')).toBe(
      `/admin/dashboard?date=${TAG}&notice=payment_saved`,
    );
  });

  it('ignoriert einen mitgeschickten Betrag und einen fremden Kunden', async () => {
    const session = await admin();
    const felder = new URLSearchParams({
      csrf_token: session.csrfToken,
      payment_status: 'paid_cash',
      total_amount_cents: '1',
      customer_id: '99',
      status: 'cancelled',
    });

    await post({ session, body: felder.toString() });

    const row = await env.DB.prepare(
      'SELECT total_amount_cents, customer_id, status FROM orders WHERE order_number = ?',
    ).bind(NUMMER).first<{ total_amount_cents: number; customer_id: number; status: string }>();

    expect(row).toEqual({ total_amount_cents: 4350, customer_id: 1, status: 'new' });
  });
});
