import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { findValidSession } from '../../src/infrastructure/d1/auth-session-repository';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

/**
 * Die Umgebung, die der Worker sieht. `env` aus cloudflare:test trägt das
 * D1-Binding; die drei Auth-Werte kommen hier dazu, weil sie in Produktion aus
 * Secrets kämen und nicht aus wrangler.jsonc.
 */
function umgebung(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    AUTH_PEPPER: PEPPER,
    APP_ORIGIN: ORIGIN,
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

async function seedKonto(options: {
  id: number;
  identifier: string;
  role: 'customer' | 'admin';
  secret: string;
  customerId?: number | null;
  isActive?: number;
  failedAttempts?: number;
  lockedUntil?: string | null;
}): Promise<void> {
  const credential = await deriveCredential(options.secret, PEPPER, { iterations: MIN_ITERATIONS });

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      options.id,
      options.identifier,
      options.role,
      options.customerId ?? (options.role === 'customer' ? 1 : null),
      credential.algorithm,
      credential.iterations,
      credential.saltHex,
      credential.verifierHex,
      options.isActive ?? 1,
      options.failedAttempts ?? 0,
      options.lockedUntil ?? null,
      NOW_ISO,
      NOW_ISO,
    )
    .run();
}

interface AnfrageOptionen {
  method?: string;
  body?: string | undefined;
  origin?: string | null;
  contentType?: string | null;
  cookie?: string | null;
  env?: Env;
}

async function call(pfad: string, optionen: AnfrageOptionen = {}): Promise<Response> {
  const headers = new Headers();
  const origin = optionen.origin === undefined ? ORIGIN : optionen.origin;
  if (origin !== null) headers.set('origin', origin);

  const contentType =
    optionen.contentType === undefined ? 'application/x-www-form-urlencoded' : optionen.contentType;
  if (contentType !== null && optionen.body !== undefined) headers.set('content-type', contentType);

  if (optionen.cookie != null) headers.set('cookie', optionen.cookie);

  const init: RequestInit = { method: optionen.method ?? 'GET', headers };
  if (optionen.body !== undefined) init.body = optionen.body;

  return worker.fetch(new Request(`${ORIGIN}${pfad}`, init), optionen.env ?? umgebung());
}

/** Meldet direkt über den Anwendungsfall an und liefert den Cookie-Header. */
async function angemeldetAls(identifier: string, secret: string): Promise<string> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: new Date(),
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');
  return `buschmann_session_dev=${ergebnis.token}`;
}

function formular(felder: Record<string, string>): string {
  return new URLSearchParams(felder).toString();
}

beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(NOW_ISO),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Ehemaliges Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', ?1, ?1)`,
    ).bind(NOW_ISO),
  ]);

  await seedKonto({ id: 1, identifier: 'testcafe', role: 'customer', secret: PIN });
  await seedKonto({ id: 2, identifier: 'admin@example.test', role: 'admin', secret: PASSWORT });
  await seedKonto({ id: 3, identifier: 'ehemalig', role: 'customer', secret: PIN, customerId: 2 });
  await seedKonto({ id: 4, identifier: 'stillgelegt', role: 'customer', secret: PIN, isActive: 0 });
  await seedKonto({
    id: 5,
    identifier: 'gesperrt',
    role: 'customer',
    secret: PIN,
    failedAttempts: 5,
    lockedUntil: '2099-01-01T00:00:00.000Z',
  });
});

describe('GET /login', () => {
  it('liefert das Formular', async () => {
    const response = await call('/login');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<form method="post" action="/login"');
  });

  it('darf nirgends zwischengespeichert werden', async () => {
    expect((await call('/login')).headers.get('cache-control')).toBe('no-store');
  });

  it('trägt die Sicherheitskopfzeilen', async () => {
    const response = await call('/login');
    const csp = response.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('leitet eine gültige Kundensitzung sofort zur Bestellseite', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);
    const response = await call('/login', { cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/bestellen');
  });

  it('leitet eine gültige Adminsitzung sofort in den Adminbereich', async () => {
    const cookie = await angemeldetAls('admin@example.test', PASSWORT);
    const response = await call('/login', { cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin');
  });

  it('zeigt bei einem unbekannten Cookie wieder das Formular', async () => {
    const response = await call('/login', { cookie: `buschmann_session_dev=${'x'.repeat(43)}` });

    expect(response.status).toBe(200);
  });
});

describe('POST /login — Erfolg', () => {
  it('meldet ein Café an und leitet zur Bestellseite', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'TESTCAFE', secret: PIN }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/bestellen');
  });

  it('meldet einen Admin an und leitet in den Adminbereich', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'admin@example.test', secret: PASSWORT }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin');
  });

  it('setzt ein Sitzungscookie mit den Schutzattributen', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(cookie).toContain('buschmann_session_dev=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });

  it('setzt in Produktion ein Secure-Cookie mit __Host--Präfix', async () => {
    const produktion = umgebung({
      ENVIRONMENT: 'production',
      APP_ORIGIN: 'https://buschmann1846.de',
    });
    const response = await worker.fetch(
      new Request('https://buschmann1846.de/login', {
        method: 'POST',
        headers: {
          origin: 'https://buschmann1846.de',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: formular({ identifier: 'testcafe', secret: PIN }),
      }),
      produktion,
    );
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(303);
    expect(cookie).toContain('__Host-buschmann_session=');
    expect(cookie).toContain('Secure');
  });

  it('gibt der Kundensitzung 30 Tage und der Adminsitzung 12 Stunden', async () => {
    const cafe = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });
    const admin = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'admin@example.test', secret: PASSWORT }),
    });

    expect(cafe.headers.get('set-cookie')).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    expect(admin.headers.get('set-cookie')).toContain(`Max-Age=${12 * 60 * 60}`);
  });

  /**
   * Der Sitzungstoken geht ausschließlich ins Cookie. Ein Token, der auch im
   * Antwortkörper stünde, läge damit im Browserverlauf, in einem Screenshot
   * und im Quelltext.
   */
  it('schreibt den Token in kein Antwortdokument', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });

    const cookie = response.headers.get('set-cookie') ?? '';
    const token = cookie.slice('buschmann_session_dev='.length).split(';')[0] ?? '';

    expect(token).toHaveLength(43);
    expect(await response.text()).not.toContain(token);
  });

  it('erzeugt eine Sitzung, die anschließend gültig ist', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });
    const token = (response.headers.get('set-cookie') ?? '')
      .slice('buschmann_session_dev='.length)
      .split(';')[0] as string;

    expect(await findValidSession(env.DB, token, NOW)).not.toBeNull();
  });
});

describe('POST /login — Ablehnung', () => {
  const ablehnungen: [string, Record<string, string>][] = [
    ['falsches Geheimnis', { identifier: 'testcafe', secret: '99999999' }],
    ['unbekannte Kennung', { identifier: 'gibtesnicht', secret: PIN }],
    ['deaktiviertes Konto', { identifier: 'stillgelegt', secret: PIN }],
    ['deaktiviertes Café', { identifier: 'ehemalig', secret: PIN }],
    ['gesperrtes Konto', { identifier: 'gesperrt', secret: PIN }],
    ['leere Eingabe', { identifier: '', secret: '' }],
  ];

  for (const [name, felder] of ablehnungen) {
    it(`lehnt ab: ${name}`, async () => {
      const response = await call('/login', { method: 'POST', body: formular(felder) });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  }

  /**
   * DER TEST, AUF DEN ES ANKOMMT.
   *
   * Alle sechs Ablehnungsgründe liefern eine BYTEWEISE identische Antwort.
   * Nicht bloß dieselbe Meldung — dieselbe Länge, derselbe Statuscode,
   * derselbe Körper. Eine abweichende Länge wäre für sich schon ein Kanal.
   */
  it('antwortet auf alle Ablehnungsgründe byteweise identisch', async () => {
    const antworten: string[] = [];
    const status: number[] = [];

    for (const [, felder] of ablehnungen) {
      const response = await call('/login', { method: 'POST', body: formular(felder) });
      status.push(response.status);
      antworten.push(await response.text());
    }

    expect(new Set(antworten).size).toBe(1);
    expect(new Set(status).size).toBe(1);
  });

  it('legt bei einer Ablehnung keine Sitzung an', async () => {
    await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: '99999999' }),
    });

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('POST /login — Anfrageform', () => {
  it('lehnt einen fremden Origin ab', async () => {
    const response = await call('/login', {
      method: 'POST',
      origin: 'https://angreifer.test',
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('lehnt einen fehlenden Origin ab', async () => {
    const response = await call('/login', {
      method: 'POST',
      origin: null,
      body: formular({ identifier: 'testcafe', secret: PIN }),
    });

    expect(response.status).toBe(403);
  });

  it('lehnt einen falschen Content-Type ab', async () => {
    const response = await call('/login', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ identifier: 'testcafe', secret: PIN }),
    });

    expect(response.status).toBe(415);
  });

  /**
   * Kein next-Ziel. Die Weiterleitung ist eine Funktion der ROLLE, sonst
   * nichts — und damit gibt es keinen Parser, den man täuschen, und keine
   * Allowlist, die man vergessen könnte.
   */
  it('kennt kein next-Ziel', async () => {
    for (const versuch of [
      '/login?next=https://angreifer.test',
      '/login?next=//angreifer.test',
      '/login?redirect=/admin',
    ]) {
      const response = await call(versuch, {
        method: 'POST',
        body: formular({ identifier: 'testcafe', secret: PIN }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/bestellen');
    }
  });

  it('lässt ein zusätzliches Feld im Formular wirkungslos', async () => {
    const response = await call('/login', {
      method: 'POST',
      body: formular({ identifier: 'testcafe', secret: PIN, role: 'admin', next: '/admin' }),
    });

    expect(response.headers.get('location')).toBe('/bestellen');
  });
});

describe('Logout', () => {
  /**
   * Niemals GET. Ein GET-Logout wird von Link-Prefetch, Bildvorschau und
   * Virenscannern ausgelöst — und meldet dann jemanden ab, der nichts getan
   * hat.
   */
  it('gibt es nicht als GET', async () => {
    const response = await call('/logout');
    expect(response.status).toBe(405);
  });

  it('beendet die Sitzung und leitet zum Login', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);
    const token = cookie.split('=')[1] as string;
    const sitzung = await findValidSession(env.DB, token, NOW);

    const response = await call('/logout', {
      method: 'POST',
      cookie,
      body: formular({ csrf_token: sitzung?.csrfToken ?? '' }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(await findValidSession(env.DB, token, NOW)).toBeNull();
  });

  it('löscht das Cookie', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);
    const token = cookie.split('=')[1] as string;
    const sitzung = await findValidSession(env.DB, token, NOW);

    const response = await call('/logout', {
      method: 'POST',
      cookie,
      body: formular({ csrf_token: sitzung?.csrfToken ?? '' }),
    });

    const gesetzt = response.headers.get('set-cookie') ?? '';
    expect(gesetzt).toContain('buschmann_session_dev=;');
    expect(gesetzt).toContain('Max-Age=0');
  });

  it('lehnt ein Logout ohne CSRF-Token ab', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);
    const token = cookie.split('=')[1] as string;

    const response = await call('/logout', { method: 'POST', cookie, body: formular({}) });

    expect(response.status).toBe(403);
    // Die Sitzung lebt weiter — ein abgelehnter Request ändert nichts.
    expect(await findValidSession(env.DB, token, NOW)).not.toBeNull();
  });

  it('lehnt ein Logout mit falschem CSRF-Token ab', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);

    const response = await call('/logout', {
      method: 'POST',
      cookie,
      body: formular({ csrf_token: 'x'.repeat(43) }),
    });

    expect(response.status).toBe(403);
  });

  it('lehnt ein Logout von fremdem Origin ab', async () => {
    const cookie = await angemeldetAls('testcafe', PIN);
    const token = cookie.split('=')[1] as string;
    const sitzung = await findValidSession(env.DB, token, NOW);

    const response = await call('/logout', {
      method: 'POST',
      cookie,
      origin: 'https://angreifer.test',
      body: formular({ csrf_token: sitzung?.csrfToken ?? '' }),
    });

    expect(response.status).toBe(403);
  });

  it('lehnt ein Logout ohne Sitzung ab', async () => {
    const response = await call('/logout', {
      method: 'POST',
      body: formular({ csrf_token: 'x'.repeat(43) }),
    });

    expect(response.status).toBe(401);
  });
});

describe('Fehlkonfiguration', () => {
  /**
   * Fail closed: Ohne Pepper gibt es keine Anmeldung — und keine Auskunft
   * darüber, was fehlt. Die 500 ist die ehrliche Aussage: Hier stimmt der
   * Server nicht, nicht der Benutzer.
   */
  it('lehnt jede Anmeldung ohne AUTH_PEPPER ab', async () => {
    const ohnePepper = umgebung({ AUTH_PEPPER: undefined });
    const response = await call('/login', { env: ohnePepper });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('PEPPER');
  });

  it('lehnt jede Anmeldung ohne APP_ORIGIN ab', async () => {
    const ohneOrigin = umgebung({ APP_ORIGIN: undefined });
    expect((await call('/login', { env: ohneOrigin })).status).toBe(500);
  });

  /**
   * Der versehentliche Produktionsstart: ENVIRONMENT=development gegen eine
   * https-Adresse ergäbe Cookies ohne Secure.
   */
  it('lehnt development mit https-Origin ab', async () => {
    const falsch = umgebung({ ENVIRONMENT: 'development', APP_ORIGIN: 'https://buschmann1846.de' });
    expect((await call('/login', { env: falsch })).status).toBe(500);
  });

  it('lässt die Gesundheitsprüfung trotzdem zu', async () => {
    // Sonst wäre nicht zu unterscheiden, ob der Worker läuft oder nur
    // falsch konfiguriert ist.
    const response = await call('/api/health', { env: umgebung({ AUTH_PEPPER: undefined }) });
    expect(response.status).toBe(200);
  });
});
