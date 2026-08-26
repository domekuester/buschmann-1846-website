import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const TAG = '2026-08-28';
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

async function seedOrder(
  orderNumber: string,
  overrides: {
    status?: string;
    paymentStatus?: string;
    totalCents?: number;
    day?: string;
    customerId?: number;
  } = {},
): Promise<void> {
  const bezahlt = overrides.paymentStatus ?? 'unpaid';
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderNumber,
    overrides.customerId ?? 1,
    overrides.customerId === 2 ? 'Fiktiver Privatkunde' : 'Fiktives Café Nord',
    overrides.day ?? TAG,
    overrides.status ?? 'new',
    overrides.totalCents ?? 4350,
    bezahlt,
    bezahlt === 'unpaid' ? null : NOW,
    NOW,
    NOW,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES ((SELECT id FROM orders WHERE order_number = ?), 1, 'Fiktiver Käsekuchen', 'Stück',
             500, 2, 1000)`,
  ).bind(orderNumber).run();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?),
            (2, 'Fiktiver Privatkunde', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktiver Käsekuchen', 500, 'Stück', 1, 10, ?, ?)`,
  ).bind(NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/dashboard — Zugang', () => {
  it('schickt unauthenticated über den First-Party-Loginflow', async () => {
    const response = await call('/admin/dashboard');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('verweigert einem Customer den Zugriff', async () => {
    await seedOrder('BUS-2026-000001');
    const response = await call(`/admin/dashboard?date=${TAG}`, await kunde());

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).not.toContain('BUS-2026-000001');
    expect(html).not.toContain('43,50');
  });

  it('lässt einen Admin auf die Seite', async () => {
    const response = await call(`/admin/dashboard?date=${TAG}`, await admin());
    expect(response.status).toBe(200);
  });

  it('antwortet auf POST mit 405', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/admin/dashboard`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: await admin() },
      }),
      environment(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('legt die Seite in keinen Zwischenspeicher', async () => {
    const response = await call(`/admin/dashboard?date=${TAG}`, await admin());

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});

describe('GET /admin/dashboard — Tagesbezug', () => {
  it('zeigt die Bestellungen des angefragten Liefertages', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 4350 });
    await seedOrder('BUS-2026-000002', { day: '2026-08-29', totalCents: 9999 });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('BUS-2026-000001');
    expect(html).not.toContain('BUS-2026-000002');
    expect(html).toContain('43,50 €');
  });

  it('lehnt ein unmögliches Datum ab, statt still einen anderen Tag zu zeigen', async () => {
    const response = await call('/admin/dashboard?date=2026-02-30', await admin());

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Diesen Tag gibt es nicht');
    expect(html).toContain('/admin/dashboard');
  });

  it('lehnt mehrere Datumsparameter ab', async () => {
    const response = await call('/admin/dashboard?date=2026-08-28&date=2026-08-29', await admin());
    expect(response.status).toBe(400);
  });

  it('spiegelt einen fehlerhaften Datumswert nicht zurück', async () => {
    const html = await (
      await call('/admin/dashboard?date=%3Cscript%3Ealert(1)%3C/script%3E', await admin())
    ).text();

    expect(html).not.toContain('alert(1)');
  });

  it('wählt ohne Parameter den nächsten Kalendertag vor', async () => {
    const html = await (await call('/admin/dashboard', await admin())).text();
    expect(html).toContain('value="2026-08-26"');
  });
});

describe('GET /admin/dashboard — Zahlen', () => {
  it('summiert den Umsatz ohne stornierte Bestellungen', async () => {
    await seedOrder('BUS-2026-000001', { totalCents: 4350 });
    await seedOrder('BUS-2026-000002', { totalCents: 1290 });
    await seedOrder('BUS-2026-000003', { totalCents: 9999, status: 'cancelled' });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('56,40 €');
    expect(html).not.toContain('156,39');
    expect(html).toContain('davon 1 storniert');
  });

  it('weist eine abgeschlossene, unbezahlte Bestellung als offenen Betrag aus', async () => {
    await seedOrder('BUS-2026-000001', { status: 'completed', paymentStatus: 'unpaid', totalCents: 4350 });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Abgeschlossen');
    expect(html).toContain('Noch nicht bezahlt');
    expect(html).toContain('43,50 €');
  });

  it('nimmt eine bezahlte Bestellung aus dem offenen Betrag heraus', async () => {
    await seedOrder('BUS-2026-000001', { paymentStatus: 'paid_cash', totalCents: 4350 });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Bar bezahlt');
    expect(html).toContain('0,00 €');
  });

  it('zeigt für einen Tag ohne Bestellungen den leeren Zustand', async () => {
    const html = await (await call('/admin/dashboard?date=2026-09-30', await admin())).text();
    expect(html).toContain('Für diesen Tag liegt noch keine Bestellung vor');
  });

  it('zeigt zu jeder Bestellung ein Zahlungsformular mit dem CSRF-Token', async () => {
    await seedOrder('BUS-2026-000001');

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('action="/api/admin/orders/BUS-2026-000001/payment"');
    expect(html).toContain('name="csrf_token"');
    expect(html).toContain('name="payment_status"');
  });
});

describe('GET /admin/dashboard — Rückmeldung', () => {
  it('zeigt die Bestätigung nach dem Speichern', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&notice=payment_saved`, await admin())
    ).text();

    expect(html).toContain('Der Zahlungsstatus wurde gespeichert.');
  });

  it('zeigt für einen erfundenen Code gar keine Meldung', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&notice=frei-erfundener-text`, await admin())
    ).text();

    expect(html).not.toContain('frei-erfundener-text');
  });
});
