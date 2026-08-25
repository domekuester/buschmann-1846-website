import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * POST /api/admin/orders/:orderNumber/status ALS ECHTES FORMULAR — Phase 4B.
 *
 * Derselbe Endpunkt wie in admin-order-status.test.ts, derselbe
 * Anwendungsfall, dieselbe Domänenentscheidung. Was hinzukommt, ist
 * ausschließlich die Anfrageform: `application/x-www-form-urlencoded` statt
 * JSON — und die Antwort, die ein BROWSER damit anfangen kann.
 *
 * ES GIBT KEINEN ZWEITEN ENDPUNKT UND KEINE ZWEITE STATUSLOGIK. Genau
 * deshalb steht in dieser Datei kein einziger Test über erlaubte Übergänge:
 * Die stehen in tests/d1/change-order-status.test.ts gegen canTransitionTo()
 * und gelten für beide Anfrageformen, weil beide durch dieselbe Funktion
 * gehen.
 *
 * Alle Daten sind fiktiv.
 */
const ANGELEGT = '2026-08-20T06:00:00.000Z';
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const NUMMER = 'BUS-2026-000042';
const ZWEITE = 'BUS-2026-000043';
const TAG = '2026-09-26';
const PFAD = `/api/admin/orders/${NUMMER}/status`;

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

const admin = { cookie: '', csrf: '' };
const cafe = { cookie: '', csrf: '' };

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
      ANGELEGT,
      ANGELEGT,
    )
    .run();
}

/** Siehe admin-order-status.test.ts: Die Sitzung wird auf die ECHTE Uhr geprägt. */
async function anmelden(identifier: string, secret: string) {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: new Date(),
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');
  return { cookie: `__Host-buschmann_session=${ergebnis.token}`, csrf: ergebnis.csrfToken };
}

interface Options {
  cookie?: string | null;
  /** null lässt das CSRF-Feld weg. */
  csrf?: string | null;
  origin?: string | null;
  pfad?: string;
  /** Zusätzliche Formularfelder — für die Schmuggelversuche. */
  extra?: Record<string, string>;
}

/**
 * Ein echtes Formular schickt seinen Token im KÖRPER und nicht in einer
 * Kopfzeile — ein <form> kann keine Kopfzeilen setzen. Genau diesen Weg
 * prüft diese Datei.
 */
async function absenden(status: string, options: Options = {}): Promise<Response> {
  const felder = new URLSearchParams({ status, ...(options.extra ?? {}) });
  if (options.csrf !== null) {
    felder.set('csrf_token', options.csrf ?? admin.csrf);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (options.cookie !== null) headers['cookie'] = options.cookie ?? admin.cookie;
  if (options.origin !== null) headers['origin'] = options.origin ?? ORIGIN;

  return worker.fetch(
    new Request(`${ORIGIN}${options.pfad ?? PFAD}`, {
      method: 'POST',
      headers,
      body: felder.toString(),
    }),
    umgebung(),
  );
}

/** Der JSON-Weg aus Phase 4A — unverändert, für die Regressionstests. */
async function alsJson(status: unknown, pfad = PFAD): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${pfad}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: ORIGIN,
      },
      body: JSON.stringify({ status }),
    }),
    umgebung(),
  );
}

async function seite(pfad: string, cookie = admin.cookie): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${pfad}`, { headers: { cookie, origin: ORIGIN } }),
    umgebung(),
  );
}

async function bestellung(
  id: number,
  nummer: string,
  status: string,
  tag = TAG,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, submission_id, created_at, updated_at)
     VALUES (?1, ?2, 1, 'Testcafé Nord', 'delivery', ?3, 'Beispielweg 1, 40213 Düsseldorf',
             'Bitte vor acht', ?4, 1740, ?5, ?6, ?6)`,
  )
    .bind(id, nummer, tag, status, `sub-testfall-${id}`, ANGELEGT)
    .run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (?1, 1, 'Beispiel Käsekuchen', 'Stück', 435, 4, 1740)`,
  )
    .bind(id)
    .run();
}

async function zeile(nummer = NUMMER): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE order_number = ?`)
    .bind(nummer)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error('Bestellung fehlt im Testaufbau');
  return row;
}

async function status(nummer = NUMMER): Promise<unknown> {
  return (await zeile(nummer))['status'];
}

beforeEach(async () => {
  for (const tabelle of [
    'order_items',
    'orders',
    'auth_sessions',
    'auth_accounts',
    'products',
    'customers',
  ]) {
    await env.DB.prepare(`DELETE FROM ${tabelle}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
  )
    .bind(ANGELEGT)
    .run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
  )
    .bind(ANGELEGT)
    .run();

  await seedKonto(1, 'testcafe', 'customer', PIN);
  await seedKonto(2, 'admin@example.test', 'admin', PASSWORT);

  Object.assign(cafe, await anmelden('testcafe', PIN));
  Object.assign(admin, await anmelden('admin@example.test', PASSWORT));

  await bestellung(42, NUMMER, 'new');
});

describe('Formular-POST — der erlaubte Weg', () => {
  it('nimmt application/x-www-form-urlencoded entgegen und antwortet mit 303', async () => {
    const response = await absenden('confirmed');

    expect(response.status).toBe(303);
  });

  it('schreibt den Status tatsächlich nach D1', async () => {
    await absenden('confirmed');

    expect(await status()).toBe('confirmed');
  });

  /**
   * ZURÜCK AUF DENSELBEN PRODUKTIONSTAG — und zwar auf den der BESTELLUNG,
   * wie er in D1 steht. Nicht auf „heute", nicht auf den Standardtag und
   * ganz sicher nicht auf ein Ziel aus der Anfrage.
   */
  it('leitet auf den Produktionstag der Bestellung zurück', async () => {
    const response = await absenden('confirmed');

    expect(response.headers.get('location')).toBe(`/admin?date=${TAG}`);
  });

  it('leitet auch dann auf den Tag der Bestellung, wenn er nicht der Standardtag ist', async () => {
    await bestellung(43, ZWEITE, 'new', '2027-01-07');

    const response = await absenden('confirmed', { pfad: `/api/admin/orders/${ZWEITE}/status` });

    expect(response.headers.get('location')).toBe('/admin?date=2027-01-07');
  });

  it('führt den ganzen Arbeitsablauf durch', async () => {
    expect((await absenden('confirmed')).status).toBe(303);
    expect(await status()).toBe('confirmed');

    expect((await absenden('in_production')).status).toBe(303);
    expect(await status()).toBe('in_production');

    expect((await absenden('completed')).status).toBe(303);
    expect(await status()).toBe('completed');
  });

  it('lässt Preise, Positionen und Idempotenzschlüssel unangetastet', async () => {
    const vorher = await zeile();
    const { results: positionenVorher } = await env.DB.prepare(
      `SELECT * FROM order_items ORDER BY id`,
    ).all<Record<string, unknown>>();

    await absenden('confirmed');

    const nachher = await zeile();
    const { results: positionenNachher } = await env.DB.prepare(
      `SELECT * FROM order_items ORDER BY id`,
    ).all<Record<string, unknown>>();

    expect(positionenNachher).toEqual(positionenVorher);
    for (const spalte of [
      'total_amount_cents',
      'submission_id',
      'customer_id',
      'customer_name_snapshot',
      'fulfillment_date',
      'note',
      'created_at',
    ]) {
      expect(nachher[spalte]).toEqual(vorher[spalte]);
    }
  });

  it('setzt no-store auf die Weiterleitung', async () => {
    const response = await absenden('confirmed');

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/**
 * KEIN OPEN REDIRECT.
 *
 * Das Ziel der Weiterleitung stammt aus der Bestellung in D1 und aus keiner
 * Eingabe. Ein Formularfeld oder ein Parameter mit einem Wunschziel wird
 * nicht gelesen — es gibt im Endpunkt keine Zeile, die es läse.
 */
describe('Formular-POST — Weiterleitungsziel', () => {
  it('übernimmt kein Ziel aus dem Formularkörper', async () => {
    const response = await absenden('confirmed', {
      extra: {
        return_url: 'https://angreifer.test/',
        returnUrl: '//angreifer.test',
        redirect: 'https://angreifer.test/',
        next: '/etwas-anderes',
        date: '2030-01-01',
      },
    });

    expect(response.headers.get('location')).toBe(`/admin?date=${TAG}`);
  });

  it('übernimmt kein Ziel aus der Abfrage', async () => {
    const response = await absenden('confirmed', {
      pfad: `${PFAD}?return=https://angreifer.test/&date=2030-01-01&next=//angreifer.test`,
    });

    expect(response.headers.get('location')).toBe(`/admin?date=${TAG}`);
  });

  it('leitet ausschließlich auf einen eigenen Pfad', async () => {
    const ziel = (await absenden('confirmed')).headers.get('location') ?? '';

    expect(ziel.startsWith('/admin?date=')).toBe(true);
    expect(ziel).not.toContain('//');
    expect(ziel).not.toContain(':');
    expect(ziel).not.toContain('angreifer');
  });
});

/**
 * DIE SICHERHEITSGRENZE GILT FÜR DAS FORMULAR GENAUSO.
 *
 * Jeder Test endet mit derselben zweiten Behauptung: Die Bestellung steht
 * danach unverändert in der Datenbank.
 */
describe('Formular-POST — wer nicht darf', () => {
  async function unveraendert(): Promise<void> {
    expect(await status()).toBe('new');
    expect((await zeile())['updated_at']).toBe(ANGELEGT);
  }

  it('lehnt ein fehlendes CSRF-Feld ab', async () => {
    const response = await absenden('confirmed', { csrf: null });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt ein falsches CSRF-Feld ab', async () => {
    const response = await absenden('confirmed', { csrf: 'x'.repeat(43) });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt den CSRF-Token einer fremden Sitzung ab', async () => {
    const response = await absenden('confirmed', { csrf: cafe.csrf });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt einen fremden Origin ab', async () => {
    const response = await absenden('confirmed', { origin: 'https://angreifer.test' });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt eine Anfrage ohne Origin ab', async () => {
    const response = await absenden('confirmed', { origin: null });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt ein Café ab', async () => {
    const response = await absenden('confirmed', { cookie: cafe.cookie, csrf: cafe.csrf });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('zeigt einem Café keine Produktionsdaten in der Ablehnung', async () => {
    const text = await (
      await absenden('confirmed', { cookie: cafe.cookie, csrf: cafe.csrf })
    ).text();

    expect(text).not.toContain('Testcafé Nord');
    expect(text).not.toContain(NUMMER);
    expect(text).not.toContain('Käsekuchen');
  });

  it('schickt eine Anfrage ohne Sitzung in den Loginflow, ohne zu schreiben', async () => {
    const response = await absenden('confirmed', { cookie: null, csrf: null });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    await unveraendert();
  });

  it('macht aus role=admin im Formular keine Rechte', async () => {
    const response = await absenden('confirmed', {
      cookie: cafe.cookie,
      csrf: cafe.csrf,
      extra: { role: 'admin', is_admin: 'true', account_id: '2' },
    });

    expect(response.status).toBe(403);
    await unveraendert();
  });

  it('lehnt einen unbekannten Zielstatus ab, ohne zu schreiben', async () => {
    for (const unsinn of ['geliefert', 'CONFIRMED', ' confirmed', '', 'null']) {
      const response = await absenden(unsinn);

      expect(response.status).toBe(400);
      await unveraendert();
    }
  });

  it('lehnt ein fehlendes Statusfeld ab', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${PFAD}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: admin.cookie,
          origin: ORIGIN,
        },
        body: new URLSearchParams({ csrf_token: admin.csrf }).toString(),
      }),
      umgebung(),
    );

    expect(response.status).toBe(400);
    await unveraendert();
  });
});

/**
 * WAS EIN MENSCH SIEHT, WENN ES NICHT GEKLAPPT HAT.
 *
 * Keine stille Weiterleitung mit gefälschtem Erfolg: Wer auf eine Seite
 * zurückgeschickt wird, auf der der alte Status steht, hält das für einen
 * Anzeigefehler und klickt noch einmal. Es gibt deshalb eine eigene Antwort,
 * und sie sagt in einem Satz, dass NICHTS geändert wurde.
 */
describe('Formular-POST — kontrollierte Fehler', () => {
  it('antwortet auf einen unmöglichen Übergang mit 409 und einer Seite', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const response = await absenden('in_production');

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('sagt bei einem unmöglichen Übergang deutsch, dass nichts geändert wurde', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const text = await (await absenden('in_production')).text();

    expect(text).toContain('nicht geändert');
    expect(text).toContain('/admin?date=');
  });

  it('schreibt bei einem unmöglichen Übergang nichts', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();
    const vorher = await zeile();

    await absenden('in_production');

    expect(await zeile()).toEqual(vorher);
  });

  /**
   * DER ECHTE FALL: Admin A hat die Seite offen, Admin B ändert den Status.
   * A klickt seine alte Schaltfläche.
   */
  it('bestätigt einen Klick auf einen veralteten Bildschirm nicht', async () => {
    await absenden('confirmed');
    await absenden('in_production');

    const spaet = await absenden('confirmed');

    expect(spaet.status).toBe(409);
    expect(await status()).toBe('in_production');
  });

  it('lässt von zwei gleichzeitigen Formularen genau eines durch', async () => {
    const [a, b] = await Promise.all([absenden('confirmed'), absenden('confirmed')]);

    expect([a.status, b.status].sort()).toEqual([303, 409]);
    expect(await status()).toBe('confirmed');
  });

  it('erklärt den Konflikt und bietet den Weg zurück an', async () => {
    await absenden('confirmed');
    await absenden('in_production');

    const text = await (await absenden('confirmed')).text();

    expect(text).toContain('nicht geändert');
    expect(text).toContain(`/admin?date=${TAG}`);
    expect(text).toContain('Buschmann');
  });

  it('antwortet auf eine unbekannte Bestellung mit 404 und einer Seite', async () => {
    const response = await absenden('confirmed', {
      pfad: '/api/admin/orders/BUS-2026-999999/status',
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('/admin');
  });

  it('gibt in keiner Fehlerseite technische Einzelheiten preis', async () => {
    await env.DB.prepare(`UPDATE orders SET total_amount_cents = 9999 WHERE id = 42`).run();

    const response = await absenden('confirmed');
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    for (const verboten of [
      'SELECT',
      'UPDATE',
      'D1_',
      'sqlite',
      '.ts',
      'src/',
      'canTransitionTo',
      'Error',
      admin.csrf,
      admin.cookie,
    ]) {
      expect(text).not.toContain(verboten);
    }
  });

  it('setzt no-store auf jede Fehlerseite', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = 42`).run();

    const antworten = [
      await absenden('confirmed'),
      await absenden('confirmed', { pfad: '/api/admin/orders/BUS-2026-999999/status' }),
      await absenden('quatsch'),
      await absenden('confirmed', { csrf: null }),
      await absenden('confirmed', { origin: 'https://angreifer.test' }),
    ];

    for (const antwort of antworten) {
      expect(antwort.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('nennt in keiner Fehlerseite den CSRF-Token', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const text = await (await absenden('in_production')).text();

    expect(text).not.toContain(admin.csrf);
  });
});

/**
 * DIE FOLGE FÜR DIE PRODUKTIONSANSICHT.
 *
 * completed und cancelled gehören nicht mehr zur OFFENEN Produktion. Dass sie
 * nach dem Wechsel aus der Liste verschwinden, ist kein Nebeneffekt, sondern
 * der Sinn der Sache — und es wird hier durch den GANZEN Weg geprüft: POST,
 * Weiterleitung, erneutes Laden der Seite.
 */
describe('Formular-POST — Wirkung auf den Produktionstag', () => {
  it('nimmt eine abgeschlossene Bestellung aus der offenen Produktion', async () => {
    await absenden('confirmed');
    await absenden('in_production');

    const vorher = await (await seite(`/admin?date=${TAG}`)).text();
    expect(vorher).toContain(NUMMER);

    const response = await absenden('completed');
    const nachher = await (await seite(response.headers.get('location') ?? '')).text();

    expect(nachher).not.toContain(NUMMER);
    expect(nachher).not.toContain('Testcafé Nord');
  });

  it('nimmt eine stornierte Bestellung aus der offenen Produktion', async () => {
    const response = await absenden('cancelled');
    const nachher = await (await seite(response.headers.get('location') ?? '')).text();

    expect(await status()).toBe('cancelled');
    expect(nachher).not.toContain(NUMMER);
  });

  it('lässt die übrigen Bestellungen des Tages stehen', async () => {
    await bestellung(43, ZWEITE, 'new');

    const response = await absenden('cancelled');
    const nachher = await (await seite(response.headers.get('location') ?? '')).text();

    expect(nachher).toContain(ZWEITE);
    expect(nachher).not.toContain(NUMMER);
  });
});

/**
 * PHASE 4A BLEIBT, WAS SIE WAR.
 *
 * Der JSON-Weg ist nicht „auch noch da", sondern unverändert: derselbe
 * Statuscode, derselbe Körper, dieselbe Kopfzeile. Ein Formular-POST erzeugt
 * NIE eine JSON-Antwort und ein JSON-POST NIE eine Weiterleitung.
 */
describe('JSON bleibt JSON', () => {
  it('antwortet einem JSON-Aufruf weiterhin mit 200 und dem gewohnten Körper', async () => {
    const response = await alsJson('confirmed');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ order_number: NUMMER, status: 'confirmed' });
  });

  it('leitet einen JSON-Aufruf nicht weiter', async () => {
    const response = await alsJson('confirmed');

    expect(response.headers.get('location')).toBeNull();
  });

  it('antwortet einem JSON-Aufruf im Konflikt weiterhin mit 409 und JSON', async () => {
    const [a, b] = await Promise.all([alsJson('confirmed'), alsJson('confirmed')]);
    const verloren = a.status === 409 ? a : b;

    expect(verloren.status).toBe(409);
    expect(await verloren.json()).toEqual({ error: 'conflict' });
  });

  /** Zweimal derselbe Klick auf denselben Stand ist kein Konflikt, sondern ein
   *  Übergang, den es von dort aus nicht gibt — auch das unverändert. */
  it('unterscheidet für JSON weiterhin Konflikt und unmöglichen Übergang', async () => {
    await alsJson('confirmed');

    const response = await alsJson('confirmed');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'invalid_transition' });
  });

  it('antwortet einem JSON-Aufruf bei verbotenem Übergang weiterhin mit JSON', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const response = await alsJson('in_production');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'invalid_transition' });
  });

  it('antwortet einem JSON-Aufruf mit unbekannter Bestellung weiterhin mit JSON', async () => {
    const response = await alsJson('confirmed', '/api/admin/orders/BUS-2026-999999/status');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('gibt einem JSON-Aufruf ohne Sitzung weiterhin 401 und kein HTML', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${PFAD}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      umgebung(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
