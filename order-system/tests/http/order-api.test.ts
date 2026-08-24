import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { findValidSession } from '../../src/infrastructure/d1/auth-session-repository';

/**
 * Der Bestell-Endpunkt an der HTTP-Grenze.
 *
 * SEIT PHASE 3A TRÄGT EIN COOKIE DIE AUTORISIERUNG, KEIN HEADER.
 *
 * Phase 2 hatte damit konstruktiv kein CSRF-Risiko: Ein fremdes Formular kann
 * keine Kopfzeile setzen, und ein Cross-Origin-fetch scheitert am Preflight.
 * Ein Cookie schickt der Browser dagegen von sich aus mit — deshalb prüft der
 * Endpunkt jetzt zusätzlich Origin und CSRF-Token, und deshalb prüfen die
 * Tests dieser Datei genau das.
 */
const NOW = '2026-08-24T07:00:00.000Z';
const MORGEN = '2026-08-25';
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

/** Die Sitzung des Cafés — in jedem beforeEach frisch angemeldet. */
const sitzung = { cookie: '', csrf: '' };
/** Eine Adminsitzung, die an diesem Endpunkt nichts zu suchen hat. */
const adminSitzung = { cookie: '', csrf: '' };

async function anmelden(identifier: string, secret: string): Promise<{ cookie: string; csrf: string }> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: new Date(NOW),
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');
  return { cookie: `__Host-buschmann_session=${ergebnis.token}`, csrf: ergebnis.csrfToken };
}

interface Options {
  /** null lässt das Cookie weg. */
  cookie?: string | null;
  /** null lässt den CSRF-Token weg. */
  csrf?: string | null;
  /** null lässt den Origin weg. */
  origin?: string | null;
  contentType?: string | null;
  body?: string;
  method?: string;
  headers?: Record<string, string>;
}

async function post(payload: unknown, options: Options = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.contentType !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  if (options.cookie !== null) {
    headers['cookie'] = options.cookie ?? sitzung.cookie;
  }
  if (options.csrf !== null) {
    headers['x-csrf-token'] = options.csrf ?? sitzung.csrf;
  }
  if (options.origin !== null) {
    headers['origin'] = options.origin ?? ORIGIN;
  }

  const method = options.method ?? 'POST';
  // GET und HEAD dürfen laut fetch-Standard keinen Körper tragen — der
  // Konstruktor wirft sonst, bevor der Worker überhaupt gefragt wird.
  const init: RequestInit =
    method === 'GET' || method === 'HEAD'
      ? { method, headers }
      : { method, headers, body: options.body ?? JSON.stringify(payload) };

  return worker.fetch(new Request(`${ORIGIN}/api/orders`, init), umgebung());
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submission_id: `sub-${crypto.randomUUID()}`,
    fulfillment_date: MORGEN,
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
}

async function countOrders(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  for (const table of [
    'order_items',
    'orders',
    'auth_sessions',
    'auth_accounts',
    'products',
    'customers',
    'order_number_sequences',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, email, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, internal_note, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'geheim@example.org', 'Beispielweg 1', '40213', 'Düsseldorf',
               1, 'delivery', 'Interner Hinweis', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Beispiel Streuselblech', 280, 'Blech', 1, 20, ?1, ?1)`,
    ).bind(NOW),
  ]);

  const cafeCredential = await deriveCredential(PIN, PEPPER, { iterations: MIN_ITERATIONS });
  const adminCredential = await deriveCredential(PASSWORT, PEPPER, { iterations: MIN_ITERATIONS });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations, credential_salt,
                                  credential_verifier, is_active, failed_attempts, created_at, updated_at)
       VALUES (1, 'testcafe', 'customer', 1, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
    ).bind(
      NOW,
      cafeCredential.algorithm,
      cafeCredential.iterations,
      cafeCredential.saltHex,
      cafeCredential.verifierHex,
    ),
    env.DB.prepare(
      `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                  credential_algorithm, credential_iterations, credential_salt,
                                  credential_verifier, is_active, failed_attempts, created_at, updated_at)
       VALUES (2, 'admin@example.test', 'admin', NULL, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
    ).bind(
      NOW,
      adminCredential.algorithm,
      adminCredential.iterations,
      adminCredential.saltHex,
      adminCredential.verifierHex,
    ),
  ]);

  Object.assign(sitzung, await anmelden('testcafe', PIN));
  Object.assign(adminSitzung, await anmelden('admin@example.test', PASSWORT));
});

describe('POST /api/orders — der gute Fall', () => {
  it('legt die Bestellung an und antwortet mit 201', async () => {
    const response = await post(payload());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      order_number: 'BUS-2026-000001',
      fulfillment_date: MORGEN,
      total_cents: 1305,
      items: [{ name: 'Beispiel Käsekuchen', quantity: 3, unit: 'Stück' }],
    });
  });

  it('bestätigt mehrere Positionen mit der richtigen Summe', async () => {
    const response = await post(
      payload({ items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 2 }] }),
    );

    const body = (await response.json()) as { total_cents: number; items: unknown[] };
    expect(body.total_cents).toBe(3 * 435 + 2 * 280);
    expect(body.items).toHaveLength(2);
  });

  /**
   * Die Bestätigung stammt aus der GESPEICHERTEN Bestellung, nicht aus der
   * Anfrage. Sonst würde sie bestätigen, was das Café geschickt hat, statt
   * was tatsächlich in der Datenbank steht.
   */
  it('bestätigt den Serverpreis, nicht den mitgesendeten', async () => {
    const response = await post(
      payload({
        items: [{ product_id: 1, quantity: 3, unit_price_cents: 1 }],
        total_amount_cents: 3,
      }),
    );

    expect(((await response.json()) as { total_cents: number }).total_cents).toBe(1305);
  });

  it('gibt keine internen Felder heraus', async () => {
    const text = await (await post(payload())).text();

    for (const leak of ['customer_id', 'submission_id', 'internal_note', 'Interner Hinweis',
                        'geheim@example.org', 'price_cents', 'status', 'created_at']) {
      expect(text).not.toContain(leak);
    }
  });

  it('trägt no-store, damit die Bestätigung nirgends liegen bleibt', async () => {
    const response = await post(payload());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('POST /api/orders — Zugang', () => {
  it('lehnt eine Anfrage ohne Sitzung mit 401 ab', async () => {
    const response = await post(payload(), { cookie: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine unbekannte Sitzung mit 401 ab', async () => {
    const response = await post(payload(), {
      cookie: `__Host-buschmann_session=${'x'.repeat(43)}`,
    });
    expect(response.status).toBe(401);
  });

  it('lehnt eine widerrufene Sitzung mit 401 ab', async () => {
    // Abmelden über den Endpunkt, dann mit demselben Cookie bestellen.
    const token = sitzung.cookie.split('=')[1] as string;
    const gefunden = await findValidSession(env.DB, token, new Date(NOW));
    await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ?1 WHERE id = ?2')
      .bind(NOW, gefunden?.id ?? 0)
      .run();

    expect((await post(payload())).status).toBe(401);
    expect(await countOrders()).toBe(0);
  });

  it('antwortet auf alle Zugangsfälle identisch', async () => {
    const bodies = await Promise.all([
      post(payload(), { cookie: null }).then((r) => r.text()),
      post(payload(), { cookie: `__Host-buschmann_session=${'x'.repeat(43)}` }).then((r) => r.text()),
      post(payload(), { cookie: '__Host-buschmann_session=zu-kurz' }).then((r) => r.text()),
    ]);

    expect(new Set(bodies).size).toBe(1);
  });

  /**
   * ROLLENTRENNUNG: Ein Admin ist kein Café mit mehr Rechten. Er hat keinen
   * Kundenbezug und kann deshalb nicht bestellen — sonst gäbe es einen Weg,
   * im Namen eines Cafés zu bestellen, der im Bestellablauf nicht sichtbar
   * wäre.
   */
  it('lehnt eine Adminsitzung mit 403 ab', async () => {
    const response = await post(payload(), {
      cookie: adminSitzung.cookie,
      csrf: adminSitzung.csrf,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(await countOrders()).toBe(0);
  });

  /**
   * Zugang VOR Eingabeprüfung. Andernfalls bekäme ein Aufrufer ohne gültige
   * Sitzung feldweise Rückmeldung darüber, wie eine richtige Anfrage aussähe
   * — und könnte den Endpunkt erkunden, ohne je einen Zugang zu haben.
   */
  it('prüft den Zugang, bevor es die Eingabe prüft', async () => {
    for (const body of [{}, { items: [] }, { submission_id: 'unbrauchbar' }]) {
      const response = await post(body, { cookie: null });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('prüft den Zugang, bevor es den Content-Type prüft', async () => {
    // Ein 415 für einen Fremden wäre die Auskunft „hier ist ein
    // JSON-Endpunkt, versuch es anders".
    const response = await post(payload(), { cookie: null, contentType: 'text/plain' });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/orders — CSRF und Origin', () => {
  it('nimmt eine Bestellung mit gültigem CSRF-Token an', async () => {
    expect((await post(payload())).status).toBe(201);
  });

  it('lehnt eine Bestellung ohne CSRF-Token mit 403 ab', async () => {
    const response = await post(payload(), { csrf: null });

    expect(response.status).toBe(403);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt einen falschen CSRF-Token mit 403 ab', async () => {
    const response = await post(payload(), { csrf: 'x'.repeat(43) });

    expect(response.status).toBe(403);
    expect(await countOrders()).toBe(0);
  });

  /**
   * Der Token gilt für GENAU EINE Sitzung. Der einer Adminsitzung hilft an
   * einer Kundensitzung nicht weiter.
   */
  it('lehnt den CSRF-Token einer fremden Sitzung ab', async () => {
    const response = await post(payload(), { csrf: adminSitzung.csrf });
    expect(response.status).toBe(403);
  });

  it('lehnt einen fremden Origin mit 403 ab', async () => {
    const response = await post(payload(), { origin: 'https://angreifer.test' });

    expect(response.status).toBe(403);
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine Anfrage ohne Origin mit 403 ab', async () => {
    expect((await post(payload(), { origin: null })).status).toBe(403);
  });

  /**
   * Der Origin wird VOR der Sitzung geprüft: Eine fremd ausgelöste Anfrage
   * soll gar nicht erst zu einem Datenbankzugriff führen.
   */
  it('prüft den Origin auch ohne Sitzung', async () => {
    const response = await post(payload(), { origin: 'https://angreifer.test', cookie: null });
    expect(response.status).toBe(403);
  });

  it('sagt nicht, welche der drei Prüfungen fehlgeschlagen ist', async () => {
    const bodies = await Promise.all([
      post(payload(), { csrf: null }).then((r) => r.text()),
      post(payload(), { csrf: 'x'.repeat(43) }).then((r) => r.text()),
      post(payload(), { origin: 'https://angreifer.test' }).then((r) => r.text()),
      post(payload(), { cookie: adminSitzung.cookie, csrf: adminSitzung.csrf }).then((r) => r.text()),
    ]);

    expect(new Set(bodies).size).toBe(1);
  });
});

describe('POST /api/orders — Kundenbindung', () => {
  /**
   * Die wichtigste Zusage des Endpunkts: Der Kunde kommt aus der Sitzung.
   * Ein mitgesendetes customerId wirkt nicht — nicht weil es geprüft würde,
   * sondern weil es nirgends gelesen wird.
   */
  it('ignoriert eine mitgesendete Kunden-ID vollständig', async () => {
    const response = await post(payload({ customerId: 999, customer_id: 999 }));

    expect(response.status).toBe(201);

    const row = await env.DB.prepare('SELECT customer_id FROM orders').first<{ customer_id: number }>();
    expect(row?.customer_id).toBe(1);
  });

  it('lässt eine mitgesendete Rolle wirkungslos', async () => {
    const response = await post(payload({ role: 'admin' }));
    expect(response.status).toBe(201);

    const row = await env.DB.prepare('SELECT customer_id FROM orders').first<{ customer_id: number }>();
    expect(row?.customer_id).toBe(1);
  });
});

describe('POST /api/orders — die HTTP-Grenze', () => {
  it('antwortet auf GET mit 405 und nennt das erlaubte Verfahren', async () => {
    const response = await post(payload(), { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('lehnt einen falschen Content-Type mit 415 ab', async () => {
    const response = await post(payload(), { contentType: 'text/plain' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported_media_type' });
  });

  it('lehnt eine Anfrage ohne Content-Type mit 415 ab', async () => {
    expect((await post(payload(), { contentType: null })).status).toBe(415);
  });

  it('akzeptiert einen Content-Type mit Zeichensatzangabe', async () => {
    expect((await post(payload(), { contentType: 'application/json; charset=utf-8' })).status).toBe(201);
  });

  it('macht aus ungültigem JSON eine kontrollierte 400', async () => {
    const response = await post(null, { body: '{ "items": ' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('verrät bei ungültigem JSON nichts über den Parser', async () => {
    const text = await (await post(null, { body: '{,}' })).text();
    for (const leak of ['JSON', 'SyntaxError', 'position', 'Unexpected', 'token']) {
      expect(text).not.toContain(leak);
    }
  });

  it('lehnt einen leeren Körper mit 400 ab', async () => {
    expect((await post(null, { body: '' })).status).toBe(400);
  });

  it('lehnt ein Array und einen Skalar mit 400 ab', async () => {
    expect((await post(null, { body: '[]' })).status).toBe(400);
    expect((await post(null, { body: '"text"' })).status).toBe(400);
    expect((await post(null, { body: 'null' })).status).toBe(400);
  });

  it('lehnt einen zu großen Körper mit 413 ab', async () => {
    const response = await post(payload({ note: 'x'.repeat(70_000) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine angekündigte Übergröße ab, bevor gelesen wird', async () => {
    const response = await post(payload(), { headers: { 'content-length': '999999' } });
    expect(response.status).toBe(413);
  });
});

describe('POST /api/orders — Eingabefehler', () => {
  it('meldet Feldfehler als 422 mit Zuordnung', async () => {
    const response = await post(payload({ fulfillment_date: '2026-08-01' }));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; errors: Record<string, string> };
    expect(body.error).toBe('validation_failed');
    expect(body.errors['fulfillment_date']).toContain('Vergangenheit');
    expect(await countOrders()).toBe(0);
  });

  it('meldet eine Bestellung ohne Produkt', async () => {
    const body = (await (await post(payload({ items: [] }))).json()) as {
      errors: Record<string, string>;
    };
    expect(body.errors['items']).toBeTruthy();
  });

  it('meldet mehrere Fehler gemeinsam', async () => {
    const body = (await (
      await post(payload({ items: [], fulfillment_date: 'kein Datum', note: 'x'.repeat(501) }))
    ).json()) as { errors: Record<string, string> };

    expect(Object.keys(body.errors).length).toBeGreaterThanOrEqual(3);
  });

  it('lehnt eine fehlende Absendekennung ab', async () => {
    const response = await post({ fulfillment_date: MORGEN, items: [{ product_id: 1, quantity: 3 }] });
    expect(response.status).toBe(422);
    expect(await countOrders()).toBe(0);
  });

  it('gibt in Fehlermeldungen keine internen Einzelheiten preis', async () => {
    const text = await (await post(payload({ items: [{ product_id: 999, quantity: 1 }] }))).text();
    for (const leak of ['SQL', 'D1_', 'sqlite', 'constraint', 'at ']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('POST /api/orders — Doppelklick', () => {
  it('beantwortet die Wiederholung mit 200 und derselben Bestellnummer', async () => {
    const body = payload();

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await countOrders()).toBe(1);
  });

  it('erzeugt bei zwei gleichzeitigen Absendungen genau eine Bestellung', async () => {
    const body = payload();
    const [a, b] = await Promise.all([post(body), post(body)]);

    expect(await countOrders()).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });

  it('lässt eine neue Kennung wieder durch', async () => {
    await post(payload());
    expect((await post(payload())).status).toBe(201);
    expect(await countOrders()).toBe(2);
  });
});

describe('Routing', () => {
  it('beantwortet unbekannte Pfade weiterhin mit 404', async () => {
    const response = await worker.fetch(new Request('https://bestellen.example/gibt-es-nicht'), env);
    expect(response.status).toBe(404);
  });

  it('lässt den Health-Endpunkt unberührt', async () => {
    const response = await worker.fetch(new Request('https://bestellen.example/api/health'), env);
    expect(response.status).toBe(200);
  });
});
