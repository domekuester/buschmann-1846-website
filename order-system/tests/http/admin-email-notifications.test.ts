import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { loadEmailNotificationSettings } from '../../src/infrastructure/d1/email-notification-settings-repository';

const ORIGIN = 'http://127.0.0.1:8787';
const FOREIGN_ORIGIN = 'https://angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-29T08:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const PATH = '/api/admin/email-notifications';

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(id: number, identifier: string, role: 'admin' | 'customer', secret: string) {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(
    id, identifier, role, role === 'customer' ? 1 : null,
    credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex,
    NOW, NOW,
  ).run();
}

async function login(identifier: string, secret: string) {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(NOW), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  const session = await env.DB.prepare(
    'SELECT csrf_token FROM auth_sessions ORDER BY id DESC LIMIT 1',
  ).first<{ csrf_token: string }>();
  if (!session) throw new Error('Testsitzung fehlt');
  return { cookie: `buschmann_session_dev=${result.token}`, csrf: session.csrf_token };
}

function form(csrf: string, recipients: readonly string[] = [], toggles: {
  operator?: boolean;
  customer?: boolean;
} = {}): string {
  const fields = new URLSearchParams({ csrf_token: csrf });
  if (toggles.operator) fields.set('operator_notifications_enabled', '1');
  if (toggles.customer) fields.set('customer_confirmations_enabled', '1');
  for (const recipient of recipients) fields.append('operator_recipient', recipient);
  return fields.toString();
}

async function post(options: {
  cookie?: string;
  origin?: string | null;
  body?: string;
  method?: string;
} = {}) {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return worker.fetch(new Request(`${ORIGIN}${PATH}`, {
    method: options.method ?? 'POST',
    headers,
    ...((options.method ?? 'POST') === 'GET' ? {} : { body: options.body ?? '' }),
  }), environment());
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM email_outbox').run();
  await env.DB.prepare('DELETE FROM email_operator_recipients').run();
  await env.DB.prepare(
    `UPDATE email_notification_settings
        SET operator_notifications_enabled = 0,
            customer_confirmations_enabled = 0,
            updated_at = NULL
      WHERE id = 1`,
  ).run();
  await env.DB.prepare('DELETE FROM auth_sessions').run();
  await env.DB.prepare('DELETE FROM auth_accounts').run();
  await env.DB.prepare('DELETE FROM customers').run();
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();
  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('POST /api/admin/email-notifications', () => {
  it('speichert mehrere normalisierte, deduplizierte Empfänger und beide Schalter per PRG', async () => {
    const admin = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const response = await post({
      cookie: admin.cookie,
      body: form(admin.csrf, [
        ' Claudia@Example.TEST ', 'gregor@example.test', 'claudia@example.test', '',
      ], { operator: true, customer: true }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/settings?notice=email_saved');
    expect(await loadEmailNotificationSettings(env.DB)).toMatchObject({
      operatorNotificationsEnabled: true,
      customerConfirmationsEnabled: true,
      operatorRecipients: ['claudia@example.test', 'gregor@example.test'],
    });
  });

  it('lehnt ungültige Empfänger kontrolliert ab und speichert nichts teilweise', async () => {
    const admin = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const response = await post({
      cookie: admin.cookie,
      body: form(admin.csrf, ['gut@example.test', 'keine-adresse'], { operator: true }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/settings?notice=email_invalid');
    expect(await loadEmailNotificationSettings(env.DB)).toMatchObject({
      operatorNotificationsEnabled: false,
      customerConfirmationsEnabled: false,
      operatorRecipients: [],
    });
  });

  it('verlangt mindestens einen Empfänger, wenn Betreiberbenachrichtigungen aktiv sind', async () => {
    const admin = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const response = await post({
      cookie: admin.cookie,
      body: form(admin.csrf, ['', '   '], { operator: true }),
    });
    expect(response.headers.get('location')).toBe('/admin/settings?notice=email_recipient_required');
  });

  it('speichert die maximal zehn Empfänger auch mit der progressiven leeren Zeile erneut', async () => {
    const admin = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const recipients = Array.from({ length: 10 }, (_, index) => `betrieb-${index + 1}@example.test`);
    const response = await post({
      cookie: admin.cookie,
      body: form(admin.csrf, [...recipients, ''], { operator: true }),
    });

    expect(response.headers.get('location')).toBe('/admin/settings?notice=email_saved');
    expect((await loadEmailNotificationSettings(env.DB)).operatorRecipients).toEqual(recipients);
  });

  it('erzwingt Adminrolle, CSRF und Origin vor jeder Mutation', async () => {
    const admin = await login('admin@example.test', 'fiktives-admin-passwort-123');
    const customer = await login('testcafe', 'fiktive-kunden-pin-123');

    const responses = await Promise.all([
      post({ cookie: customer.cookie, body: form(customer.csrf, ['x@example.test'], { operator: true }) }),
      post({ cookie: admin.cookie, body: form(`${admin.csrf}x`, ['x@example.test'], { operator: true }) }),
      post({ cookie: admin.cookie, origin: FOREIGN_ORIGIN, body: form(admin.csrf, ['x@example.test'], { operator: true }) }),
      post({ cookie: admin.cookie, origin: null, body: form(admin.csrf, ['x@example.test'], { operator: true }) }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect((await loadEmailNotificationSettings(env.DB)).operatorRecipients).toEqual([]);
  });

  it('leitet unangemeldet zum Login und existiert nur als POST', async () => {
    const unauthenticated = await post({ body: form('egal', [], { customer: true }) });
    const method = await post({ cookie: (await login('admin@example.test', 'fiktives-admin-passwort-123')).cookie, method: 'GET' });

    expect(unauthenticated.status).toBe(303);
    expect(unauthenticated.headers.get('location')).toBe('/login');
    expect(method.status).toBe(405);
  });
});
