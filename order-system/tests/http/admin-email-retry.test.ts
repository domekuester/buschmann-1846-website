import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };
const NOW = '2026-08-30T10:00:00.000Z';
const NUMBER = 'BUS-2026-000042';
const PATH = `/api/admin/orders/${NUMBER}/email-retry`;
const PASSWORD = 'demo-passwort-nur-fuer-tests-16plus';
const PIN = '01234567';

const admin = { cookie: '', csrf: '' };
const customer = { cookie: '', csrf: '' };
let sentMessages: Array<{ to?: string }> = [];
let providerSend: (message: object) => Promise<void> = async (message) => {
  sentMessages.push(message as { to?: string });
};

function environment(): Env {
  const emailBinding = {
    async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
      await providerSend(message);
      return { messageId: 'test-message-id' };
    },
  } satisfies SendEmail;
  return {
    ...env,
    AUTH_PEPPER: PEPPER,
    APP_ORIGIN: ORIGIN,
    ENVIRONMENT: 'production',
    EMAIL: emailBinding,
  };
}

async function seedAccount(id: number, identifier: string, role: 'admin' | 'customer', secret: string) {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(id, identifier, role, role === 'customer' ? 1 : null, credential.algorithm,
    credential.iterations, credential.saltHex, credential.verifierHex, NOW, NOW).run();
}

async function session(identifier: string, secret: string) {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (result === null) throw new Error('Testanmeldung fehlgeschlagen');
  return { cookie: `__Host-buschmann_session=${result.token}`, csrf: result.csrfToken };
}

async function post(options: {
  cookie?: string | null;
  csrf?: string | null;
  origin?: string | null;
  body?: URLSearchParams;
} = {}): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  const cookie = options.cookie === undefined ? admin.cookie : options.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (cookie !== null) headers.set('cookie', cookie);
  if (origin !== null) headers.set('origin', origin);
  const body = options.body ?? new URLSearchParams({
    csrf_token: options.csrf === undefined ? admin.csrf : options.csrf ?? '',
    recipient: 'angreifer@example.test',
  });
  return worker.fetch(new Request(`${ORIGIN}${PATH}`, {
    method: 'POST', headers, body,
  }), environment());
}

async function ordersPage(): Promise<string> {
  const headers = new Headers({ cookie: admin.cookie });
  return (await worker.fetch(
    new Request(`${ORIGIN}/admin/orders?date=2026-09-01`, { headers }),
    environment(),
  )).text();
}

async function outbox() {
  return env.DB.prepare(
    `SELECT status, attempts, sent_at, last_error, claim_token
       FROM email_outbox WHERE notification_id = 'notification-test'`,
  ).first<Record<string, unknown>>();
}

beforeEach(async () => {
  for (const table of ['email_outbox', 'order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  sentMessages = [];
  providerSend = async (message) => { sentMessages.push(message as { to?: string }); };
  await env.DB.prepare(
    `INSERT INTO customers (id, name, email, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé', 'kunde@example.test', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
  ).bind(NOW).run();
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, created_at, updated_at)
     VALUES (42, ?1, 1, 'Testcafé', 'pickup', '2026-09-01', 'new', 870, ?2, ?2)`,
  ).bind(NUMBER, NOW).run();
  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (42, 1, 'Käsekuchen', 'Stück', 435, 2, 870)`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO email_outbox
       (notification_id, order_id, notification_kind, recipient, status, attempts,
        created_at, sent_at, last_error)
     VALUES ('notification-test', 42, 'customer_order_confirmation', 'kunde@example.test',
             'failed', 2, ?1, NULL, 'Der E-Mail-Versand ist fehlgeschlagen.')`,
  ).bind(NOW).run();
  await seedAccount(1, 'testcafe', 'customer', PIN);
  await seedAccount(2, 'admin@example.test', 'admin', PASSWORD);
  Object.assign(customer, await session('testcafe', PIN));
  Object.assign(admin, await session('admin@example.test', PASSWORD));
});

describe('POST /api/admin/orders/:orderNumber/email-retry', () => {
  it('zeigt den Retry nur für serverseitig eligible Outboxzeilen', async () => {
    expect(await ordersPage()).toContain('E-Mail erneut senden');

    await post();

    expect(await ordersPage()).not.toContain('E-Mail erneut senden');
  });

  it('sendet als Admin ausschließlich an den serverseitig gespeicherten Empfänger', async () => {
    const response = await post();

    expect(response.status).toBe(303);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.to).toBe('kunde@example.test');
    expect(await outbox()).toMatchObject({ status: 'sent', attempts: 3, last_error: null });
    expect((await outbox())?.['sent_at']).not.toBeNull();
  });

  it('sendet eine sent-Nachricht bei einem zweiten Request niemals erneut', async () => {
    await post();
    await post();

    expect(sentMessages).toHaveLength(1);
    expect(await outbox()).toMatchObject({ status: 'sent', attempts: 3 });
  });

  it('blockiert unauthentifizierte, Kunden-, Origin- und CSRF-Requests', async () => {
    expect((await post({ cookie: null })).status).toBe(303);
    expect((await post({ cookie: customer.cookie, csrf: customer.csrf })).status).toBe(403);
    expect((await post({ origin: 'https://angreifer.test' })).status).toBe(403);
    expect((await post({ csrf: 'falsch' })).status).toBe(403);
    expect(sentMessages).toHaveLength(0);
    expect(await outbox()).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('verhindert parallele Doppelrequests durch einen atomaren Claim', async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    providerSend = async (message) => {
      sentMessages.push(message as { to?: string });
      started();
      await hold;
    };

    const first = post();
    await startedPromise;
    const second = post();
    release();
    await Promise.all([first, second]);

    expect(sentMessages).toHaveLength(1);
    expect(await outbox()).toMatchObject({ status: 'sent', attempts: 3 });
  });

  it('bewahrt bei Providerfehlern den Auftrag und einen sanitisierten failed-Stand', async () => {
    providerSend = async () => { throw new Error('Provider-Key=geheim'); };

    const response = await post();

    expect(response.status).toBe(303);
    expect(await outbox()).toMatchObject({ status: 'failed', attempts: 3, sent_at: null });
    expect(String((await outbox())?.['last_error'])).not.toContain('geheim');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = 42').first()).toEqual({ n: 1 });
  });
});
