import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
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
      role === 'customer' ? 1 : null,
      credential.algorithm,
      credential.iterations,
      credential.saltHex,
      credential.verifierHex,
      NOW_ISO,
      NOW_ISO,
    )
    .run();
}

/**
 * WICHTIG: Die Sitzung wird auf die ECHTE Uhr geprägt, nicht auf NOW.
 *
 * NOW ist ein fester Zeitpunkt für die Testdaten. Der Worker prüft eine
 * Sitzung aber gegen `new Date()` — er bekommt keine Uhr übergeben. Eine
 * Adminsitzung läuft 12 Stunden; wäre sie auf NOW = 07:00 UTC geprägt,
 * schlüge dieser Test ab 19:00 UTC fehl und davor nicht. Genau das ist hier
 * einmal passiert.
 */
async function anmelden(identifier: string, secret: string): Promise<string> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: new Date(),
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

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await seedKonto(1, 'testcafe', 'customer', PIN);
  await seedKonto(2, 'admin@example.test', 'admin', PASSWORT);
});

describe('GET /admin — Zugriff', () => {
  it('zeigt einem Admin die Shell', async () => {
    const response = await call('/admin', await anmelden('admin@example.test', PASSWORT));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Adminbereich ist bereit.');
  });

  it('nennt die Kennung des angemeldeten Admins', async () => {
    const response = await call('/admin', await anmelden('admin@example.test', PASSWORT));
    expect(await response.text()).toContain('admin@example.test');
  });

  it('schickt ohne Sitzung zum Login', async () => {
    const response = await call('/admin');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  /**
   * DER SICHERHEITSTEST DIESER DATEI: Ein Café erreicht den Adminbereich
   * nicht dadurch, dass es die Adresse eintippt.
   */
  it('lehnt eine Café-Sitzung mit 403 ab', async () => {
    const response = await call('/admin', await anmelden('testcafe', PIN));

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Adminbereich ist bereit.');
  });

  it('meldet ein abgewiesenes Café nicht ab', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const abgewiesen = await call('/admin', cookie);
    expect(abgewiesen.headers.get('set-cookie')).toBeNull();

    // Die Sitzung gilt weiter — der Tippfehler in der Adresszeile hat nichts
    // kaputt gemacht.
    expect((await call('/api/auth/session', cookie)).status).toBe(200);
  });

  it('darf nirgends zwischengespeichert werden', async () => {
    const response = await call('/admin', await anmelden('admin@example.test', PASSWORT));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('gibt es nur als GET', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/admin`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: await anmelden('admin@example.test', PASSWORT) },
      }),
      umgebung(),
    );

    expect(response.status).toBe(405);
  });
});

describe('GET /admin — Inhalt', () => {
  /**
   * Phase 3A baut KEIN Dashboard. Die Shell beweist die Auth-Grenze und sonst
   * nichts — keine Bestellungen, keine Produkte, keine Kunden, keine Zahlen.
   * Was hier nicht steht, kann auch nicht versehentlich falsch stehen.
   */
  it('zeigt keine Betriebsdaten', async () => {
    const text = await (await call('/admin', await anmelden('admin@example.test', PASSWORT))).text();

    for (const verboten of ['Testcafé Nord', 'Beispiel Käsekuchen', 'Bestellung', 'BUS-2026', '€', 'Umsatz']) {
      expect(text).not.toContain(verboten);
    }
  });

  it('bietet eine Abmeldung als echtes Formular an', async () => {
    const text = await (await call('/admin', await anmelden('admin@example.test', PASSWORT))).text();

    expect(text).toContain('<form method="post" action="/logout"');
    expect(text).toContain('name="csrf_token"');
    expect(text).toContain('Abmelden');
  });

  it('trägt den CSRF-Token der eigenen Sitzung im Abmeldeformular', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const text = await (await call('/admin', cookie)).text();

    const treffer = /name="csrf_token" value="([^"]+)"/.exec(text);
    expect(treffer?.[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Und er funktioniert: Die Abmeldung geht damit durch.
    const abmeldung = await worker.fetch(
      new Request(`${ORIGIN}/logout`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ csrf_token: treffer?.[1] ?? '' }).toString(),
      }),
      umgebung(),
    );

    expect(abmeldung.status).toBe(303);
  });

  /**
   * Der Sitzungstoken steht im Cookie und darf nirgends im Dokument
   * auftauchen — auch nicht im Abmeldeformular.
   */
  it('schreibt den Sitzungstoken nicht ins Dokument', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const token = cookie.split('=')[1] as string;
    const text = await (await call('/admin', cookie)).text();

    expect(text).not.toContain(token);
  });

  it('lädt kein Skript und nichts von fremden Hosts', async () => {
    const text = await (await call('/admin', await anmelden('admin@example.test', PASSWORT))).text();

    expect(text).not.toContain('<script');
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });
});
