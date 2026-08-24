import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { requireRole } from '../../src/http/guard';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);
const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedKonto(
  id: number,
  identifier: string,
  role: 'customer' | 'admin',
  secret: string,
  customerId: number | null = null,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      identifier,
      role,
      customerId ?? (role === 'customer' ? 1 : null),
      credential.algorithm,
      credential.iterations,
      credential.saltHex,
      credential.verifierHex,
      NOW_ISO,
      NOW_ISO,
    )
    .run();
}

async function anmelden(identifier: string, secret: string): Promise<string> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: NOW,
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');
  return `buschmann_session_dev=${ergebnis.token}`;
}

async function call(pfad: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie !== null) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${pfad}`, { headers }), umgebung());
}

function anfrage(cookie: string | null = null): Request {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie !== null) headers.set('cookie', cookie);
  return new Request(`${ORIGIN}/beliebig`, { headers });
}

beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, contact_person, email, phone, delivery_street,
                            delivery_postal_code, delivery_city, is_active, default_fulfillment,
                            internal_note, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielperson', 'geheim@example.org', '0211 1234567',
             'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
             'Interner Hinweis — darf nirgends auftauchen', ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await seedKonto(1, 'testcafe', 'customer', PIN, 1);
  await seedKonto(2, 'admin@example.test', 'admin', PASSWORT);
});

describe('requireRole — ohne Sitzung', () => {
  /**
   * Eine SEITE leitet zum Login weiter, eine API antwortet mit 401. Der
   * Unterschied ist nicht kosmetisch: Ein fetch, der eine Loginseite als HTML
   * zurückbekäme, würde sie als Nutzdaten verarbeiten — und ein Mensch, der
   * eine 401 mit JSON-Körper sieht, weiß nicht, was er tun soll.
   */
  it('leitet eine Seite zum Login', async () => {
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(), NOW, 'customer', 'html');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).toBe(303);
    expect(ergebnis.response.headers.get('location')).toBe('/login');
  });

  it('antwortet einer API mit 401', async () => {
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(), NOW, 'customer', 'api');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).toBe(401);
    expect(await ergebnis.response.json()).toEqual({ error: 'unauthorized' });
  });

  /**
   * Ein abgelaufenes oder unbekanntes Cookie wird gelöscht. Sonst schickt der
   * Browser es bei jedem weiteren Request wieder mit, und die Weiterleitung
   * zum Login sieht für den Benutzer aus wie eine Schleife.
   */
  it('löscht ein unbrauchbares Cookie', async () => {
    const ergebnis = await requireRole(
      env.DB,
      CONFIG,
      anfrage(`buschmann_session_dev=${'x'.repeat(43)}`),
      NOW,
      'customer',
      'html',
    );

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('requireRole — falsche Rolle', () => {
  it('lehnt eine Café-Sitzung an einer Admin-API mit 403 ab', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'api');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).toBe(403);
    expect(await ergebnis.response.json()).toEqual({ error: 'forbidden' });
  });

  it('lehnt eine Café-Sitzung an einer Adminseite mit 403 ab', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'html');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).toBe(403);
    expect(ergebnis.response.headers.get('content-type')).toContain('text/html');
  });

  /**
   * Rollen sind getrennt, nicht gestuft: Ein Admin ist kein Café mit mehr
   * Rechten. Er hat keinen Kundenbezug und kann deshalb nicht bestellen.
   */
  it('lehnt eine Adminsitzung an der Kundenseite mit 403 ab', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'customer', 'html');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).toBe(403);
  });

  /**
   * Ein 403 und KEINE Weiterleitung zum Login: Wer angemeldet ist, hat kein
   * Anmeldeproblem. Eine Weiterleitung wäre für den Benutzer verwirrend und
   * für einen Angreifer die Auskunft, dass die Route existiert und nur die
   * Rolle fehlt.
   */
  it('leitet bei falscher Rolle nicht zum Login', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'html');

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.response.status).not.toBe(303);
  });

  it('verrät auf der Ablehnungsseite nichts über Rollen', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'html');

    if (ergebnis.ok) return;
    const text = await ergebnis.response.text();
    for (const wort of ['admin', 'Admin', 'customer', 'Rolle', 'role']) {
      expect(text).not.toContain(wort);
    }
  });

  it('meldet bei falscher Rolle niemanden ab', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'html');

    if (ergebnis.ok) return;
    expect(ergebnis.response.headers.get('set-cookie')).toBeNull();
  });
});

describe('requireRole — richtige Rolle', () => {
  it('lässt ein Café mit seinem eigenen Kunden durch', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'customer', 'html');

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.context.role).toBe('customer');
    expect(ergebnis.context.role === 'customer' ? ergebnis.context.customer.id : null).toBe(1);
  });

  it('lässt einen Admin durch', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const ergebnis = await requireRole(env.DB, CONFIG, anfrage(cookie), NOW, 'admin', 'api');

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.context.role).toBe('admin');
  });
});

describe('GET /api/auth/session', () => {
  it('antwortet einem Café mit Rolle und Cafénamen', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const response = await call('/api/auth/session', cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      role: 'customer',
      customer: { name: 'Testcafé Nord' },
    });
  });

  it('antwortet einem Admin nur mit der Rolle', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const response = await call('/api/auth/session', cookie);

    expect(await response.json()).toEqual({ authenticated: true, role: 'admin' });
  });

  it('antwortet ohne Sitzung mit 401', async () => {
    const response = await call('/api/auth/session');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  /**
   * Die Antwort ist das MINIMUM, das ein Client brauchen könnte — und keine
   * Zeile mehr. Jedes zusätzliche Feld wäre etwas, das ein Screenshot, ein
   * Log oder ein Zwischenspeicher mitnehmen kann.
   */
  it('gibt keine Interna heraus', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const text = await (await call('/api/auth/session', cookie)).text();

    for (const verboten of [
      'hash',
      'salt',
      'pepper',
      'token',
      'failed',
      'locked',
      'accountId',
      'sessionId',
      'iterations',
      'geheim@example.org',
      '0211 1234567',
      'Interner Hinweis',
      'Beispielweg',
    ]) {
      expect(text.toLowerCase()).not.toContain(verboten.toLowerCase());
    }
  });

  it('nennt keine Kunden-ID', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const body = (await (await call('/api/auth/session', cookie)).json()) as {
      customer?: Record<string, unknown>;
    };

    expect(Object.keys(body.customer ?? {})).toEqual(['name']);
  });

  it('darf nirgends zwischengespeichert werden', async () => {
    const cookie = await anmelden('testcafe', PIN);
    expect((await call('/api/auth/session', cookie)).headers.get('cache-control')).toBe('no-store');
    expect((await call('/api/auth/session')).headers.get('cache-control')).toBe('no-store');
  });

  it('gibt es nur als GET', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/auth/session`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie },
      }),
      umgebung(),
    );

    expect(response.status).toBe(405);
  });
});
