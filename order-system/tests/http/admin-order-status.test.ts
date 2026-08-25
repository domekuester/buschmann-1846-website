import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * POST /api/admin/orders/:orderNumber/status — der erste SCHREIBENDE
 * Adminvorgang an der HTTP-Grenze.
 *
 * Bis Phase 3C konnte der Adminbereich ausschließlich lesen. Ein Endpunkt,
 * der schreibt, ist eine andere Art von Ziel: Ein fremdes Formular kann ihn
 * auslösen, ein Café könnte ihn ausprobieren, ein veralteter Bildschirm kann
 * auf einen Stand schreiben, den es nicht mehr gibt. Diese Datei prüft die
 * Grenze — WER darf, WAS kommt an, und WAS verlässt den Worker.
 *
 * Die fachlichen Regeln stehen woanders: Welcher Übergang erlaubt ist, prüft
 * tests/d1/change-order-status.test.ts gegen canTransitionTo().
 *
 * Alle Daten sind fiktiv.
 */
const ANGELEGT = '2026-08-20T06:00:00.000Z';
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const NUMMER = 'BUS-2026-000042';
const TAG = '2026-08-26';
const PFAD = `/api/admin/orders/${NUMMER}/status`;

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

const admin = { cookie: '', csrf: '', accountId: 2 };
const cafe = { cookie: '', csrf: '', accountId: 1 };

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

/**
 * Die Sitzung wird auf die ECHTE Uhr geprägt, nicht auf ANGELEGT — sonst
 * schlüge diese Datei abends fehl und morgens nicht. Dieselbe Begründung wie
 * in order-api.test.ts, wo genau das einmal passiert ist.
 */
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
  /** null lässt das Cookie weg. */
  cookie?: string | null;
  /** null lässt den CSRF-Token weg. */
  csrf?: string | null;
  /** null lässt den Origin weg. */
  origin?: string | null;
  contentType?: string | null;
  body?: string;
  method?: string;
  pfad?: string;
  headers?: Record<string, string>;
}

async function post(payload: unknown, options: Options = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.contentType !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  if (options.cookie !== null) {
    headers['cookie'] = options.cookie ?? admin.cookie;
  }
  if (options.csrf !== null) {
    headers['x-csrf-token'] = options.csrf ?? admin.csrf;
  }
  if (options.origin !== null) {
    headers['origin'] = options.origin ?? ORIGIN;
  }

  const method = options.method ?? 'POST';
  // GET und HEAD dürfen laut fetch-Standard keinen Körper tragen — der
  // Konstruktor wirft sonst, bevor der Worker überhaupt gefragt wird.
  const koerper =
    method === 'GET' || method === 'HEAD' ? null : (options.body ?? JSON.stringify(payload));

  return worker.fetch(
    new Request(`${ORIGIN}${options.pfad ?? PFAD}`, { method, headers, body: koerper }),
    umgebung(),
  );
}

async function bestellung(status = 'new', total = 1740): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, submission_id, created_at, updated_at)
     VALUES (42, ?1, 1, 'Testcafé Nord', 'delivery', ?2, 'Beispielweg 1, 40213 Düsseldorf',
             'Bitte vor acht', ?3, ?4, 'sub-testfall-0001', ?5, ?5)`,
  )
    .bind(NUMMER, TAG, status, total, ANGELEGT)
    .run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES (42, 1, 'Beispiel Käsekuchen', 'Stück', 435, 4, 1740)`,
  ).run();
}

async function zeile(): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE order_number = ?`)
    .bind(NUMMER)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error('Bestellung fehlt im Testaufbau');
  return row;
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

  await bestellung('new');
});

describe('POST /api/admin/orders/:orderNumber/status — der erlaubte Weg', () => {
  it('antwortet einem Admin mit 200', async () => {
    const response = await post({ status: 'confirmed' });

    expect(response.status).toBe(200);
  });

  it('antwortet mit Bestellnummer und neuem Status — und sonst nichts', async () => {
    const response = await post({ status: 'confirmed' });

    expect(await response.json()).toEqual({ order_number: NUMMER, status: 'confirmed' });
  });

  it('schreibt den Status tatsächlich nach D1', async () => {
    await post({ status: 'confirmed' });

    expect((await zeile())['status']).toBe('confirmed');
  });

  it('ändert updated_at', async () => {
    await post({ status: 'confirmed' });

    expect((await zeile())['updated_at']).not.toBe(ANGELEGT);
  });

  it('lässt jede andere Spalte in Ruhe', async () => {
    const vorher = await zeile();

    await post({ status: 'confirmed' });
    const nachher = await zeile();

    for (const spalte of [
      'id',
      'order_number',
      'customer_id',
      'customer_name_snapshot',
      'fulfillment_type',
      'fulfillment_date',
      'delivery_address_snapshot',
      'note',
      'total_amount_cents',
      'submission_id',
      'created_at',
    ]) {
      expect(nachher[spalte]).toEqual(vorher[spalte]);
    }
  });

  it('lässt die Positionen samt Preis-Snapshots unverändert', async () => {
    const { results: vorher } = await env.DB.prepare(
      `SELECT * FROM order_items ORDER BY id`,
    ).all<Record<string, unknown>>();

    await post({ status: 'confirmed' });

    const { results: nachher } = await env.DB.prepare(
      `SELECT * FROM order_items ORDER BY id`,
    ).all<Record<string, unknown>>();
    expect(nachher).toEqual(vorher);
  });

  /**
   * Der Körper trägt AUSSCHLIESSLICH den Zielstatus. Alles andere darin ist
   * Zierrat und darf nichts bewirken — insbesondere kein Preis und keine
   * Positionen.
   */
  it('ignoriert alles, was außer dem Status im Körper steht', async () => {
    const vorher = await zeile();

    const response = await post({
      status: 'confirmed',
      total_amount_cents: 1,
      customer_id: 999,
      note: 'übernommen?',
      fulfillment_date: '2030-01-01',
      order_number: 'BUS-2026-000001',
      created_at: '2000-01-01T00:00:00.000Z',
      items: [{ product_id: 1, quantity: 9999 }],
    });
    const nachher = await zeile();

    expect(response.status).toBe(200);
    expect(nachher['total_amount_cents']).toBe(vorher['total_amount_cents']);
    expect(nachher['customer_id']).toBe(vorher['customer_id']);
    expect(nachher['note']).toBe(vorher['note']);
    expect(nachher['fulfillment_date']).toBe(vorher['fulfillment_date']);
    expect(nachher['created_at']).toBe(vorher['created_at']);
  });
});

describe('POST /api/admin/orders/:orderNumber/status — Eingabe', () => {
  it('lehnt einen unbekannten Status mit 400 ab', async () => {
    const response = await post({ status: 'geliefert' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_status' });
  });

  it('erfindet aus einer beliebigen Zeichenkette keinen Status', async () => {
    for (const unsinn of ['CONFIRMED', ' confirmed', 'confirmed ', 'conf', '', 'null']) {
      const response = await post({ status: unsinn });

      expect(response.status).toBe(400);
      expect((await zeile())['status']).toBe('new');
    }
  });

  it('lehnt einen fehlenden Status mit 400 ab', async () => {
    const response = await post({});

    expect(response.status).toBe(400);
  });

  it('lehnt einen Status ab, der keine Zeichenkette ist', async () => {
    for (const unsinn of [1, true, null, { value: 'confirmed' }, ['confirmed']]) {
      const response = await post({ status: unsinn });

      expect(response.status).toBe(400);
    }
  });

  it('lehnt einen kaputten JSON-Körper mit 400 ab', async () => {
    const response = await post(null, { body: '{status:' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('lehnt einen fremden Content-Type mit 415 ab', async () => {
    const response = await post({ status: 'confirmed' }, { contentType: 'text/plain' });

    expect(response.status).toBe(415);
  });

  it('lehnt eine unbekannte Bestellnummer mit 404 ab', async () => {
    const response = await post({ status: 'confirmed' }, { pfad: '/api/admin/orders/BUS-2026-999999/status' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  /**
   * Eine formal falsche Bestellnummer ist dieselbe Antwort wie eine
   * unbekannte. „Das Format stimmt nicht" gegenüber „die gibt es nicht" wäre
   * eine Auskunft darüber, wie eine gültige Nummer aussieht.
   */
  it('behandelt eine formal falsche Bestellnummer wie eine unbekannte', async () => {
    for (const nummer of ['BUS-2026-42', 'kaese', 'BUS-2026-000000', '../../admin', '%2e%2e']) {
      const response = await post(
        { status: 'confirmed' },
        { pfad: `/api/admin/orders/${nummer}/status` },
      );

      expect(response.status).toBe(404);
    }
  });

  it('lehnt einen verbotenen Übergang mit 409 ab', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const response = await post({ status: 'in_production' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'invalid_transition' });
  });

  it('schreibt bei einem verbotenen Übergang nichts', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();
    const vorher = await zeile();

    await post({ status: 'in_production' });

    expect(await zeile()).toEqual(vorher);
  });

  /**
   * Die Ablehnung nennt den erlaubten Weg NICHT. Sie sagt, dass es nicht
   * geht — nicht, was stattdessen ginge. Die Übergangstabelle ist eine
   * Eigenschaft des Systems und gehört nicht in eine Fehlerantwort.
   */
  it('verrät im 409 keine State-Machine-Interna', async () => {
    await env.DB.prepare(`UPDATE orders SET status = 'completed' WHERE id = 42`).run();

    const text = await (await post({ status: 'in_production' })).text();

    for (const wort of ['completed', 'cancelled', 'ALLOWED', 'canTransitionTo', 'new']) {
      expect(text).not.toContain(wort);
    }
  });

  it('lehnt die falsche HTTP-Methode mit 405 ab', async () => {
    for (const methode of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const response = await post({ status: 'confirmed' }, { method: methode });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });
});

/**
 * DIE SICHERHEITSGRENZE.
 *
 * Jeder Test hier endet mit derselben zweiten Behauptung: Die Bestellung
 * steht danach unverändert in der Datenbank. Ein abgelehnter Statuscode
 * allein wäre keine Aussage — er könnte nach dem Schreiben entstanden sein.
 */
describe('POST /api/admin/orders/:orderNumber/status — wer nicht darf', () => {
  async function bleibtUnveraendert(): Promise<void> {
    expect((await zeile())['status']).toBe('new');
    expect((await zeile())['updated_at']).toBe(ANGELEGT);
  }

  it('lehnt eine Café-Sitzung mit 403 ab', async () => {
    const response = await post({ status: 'confirmed' }, { cookie: cafe.cookie, csrf: cafe.csrf });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    await bleibtUnveraendert();
  });

  it('meldet ein abgewiesenes Café nicht ab', async () => {
    const response = await post({ status: 'confirmed' }, { cookie: cafe.cookie, csrf: cafe.csrf });

    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('lehnt ohne Sitzung mit 401 ab', async () => {
    const response = await post({ status: 'confirmed' }, { cookie: null, csrf: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    await bleibtUnveraendert();
  });

  it('leitet eine API-Anfrage nicht auf die Loginseite um', async () => {
    const response = await post({ status: 'confirmed' }, { cookie: null, csrf: null });

    expect(response.status).not.toBe(303);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('lehnt einen deaktivierten Admin ab', async () => {
    await env.DB.prepare(`UPDATE auth_accounts SET is_active = 0 WHERE id = 2`).run();

    const response = await post({ status: 'confirmed' });

    expect(response.status).toBe(401);
    await bleibtUnveraendert();
  });

  /**
   * Beide Zeitstempel wandern in die Vergangenheit: Das Schema besteht darauf,
   * dass eine Sitzung nach ihrer Anlage abläuft (chk_auth_sessions_expiry_after
   * _creation). Ein bloß zurückgesetztes expires_at wäre kein abgelaufener
   * Zustand, sondern ein unmöglicher.
   */
  it('lehnt eine abgelaufene Sitzung ab', async () => {
    await env.DB.prepare(`UPDATE auth_sessions SET created_at = ?1, expires_at = ?2`)
      .bind('2026-08-20T05:00:00.000Z', ANGELEGT)
      .run();

    const response = await post({ status: 'confirmed' });

    expect(response.status).toBe(401);
    await bleibtUnveraendert();
  });

  it('lehnt eine widerrufene Sitzung ab', async () => {
    await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?`).bind(ANGELEGT).run();

    const response = await post({ status: 'confirmed' });

    expect(response.status).toBe(401);
    await bleibtUnveraendert();
  });

  it('lehnt einen fehlenden CSRF-Token mit 403 ab', async () => {
    const response = await post({ status: 'confirmed' }, { csrf: null });

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  it('lehnt einen falschen CSRF-Token mit 403 ab', async () => {
    const response = await post({ status: 'confirmed' }, { csrf: 'x'.repeat(43) });

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  /** Der Token EINER ANDEREN Sitzung ist ein falscher Token. */
  it('lehnt den CSRF-Token einer fremden Sitzung ab', async () => {
    const response = await post({ status: 'confirmed' }, { csrf: cafe.csrf });

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  it('lehnt einen fremden Origin mit 403 ab', async () => {
    const response = await post({ status: 'confirmed' }, { origin: 'https://angreifer.test' });

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  /** 'https://bestellen.example.angreifer.test' beginnt mit dem erwarteten Wert. */
  it('lehnt einen Origin ab, der nur so anfängt', async () => {
    const response = await post(
      { status: 'confirmed' },
      { origin: `${ORIGIN}.angreifer.test` },
    );

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  it('lehnt eine Anfrage ohne Origin ab', async () => {
    const response = await post({ status: 'confirmed' }, { origin: null });

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  /**
   * DER TEST GEGEN DIE NAHELIEGENDSTE LÜCKE. Die Rolle kommt aus D1, niemals
   * aus der Anfrage — weder aus dem Körper noch aus der Adresszeile.
   */
  it('macht aus role=admin im Körper keine Rechte', async () => {
    const response = await post(
      { status: 'confirmed', role: 'admin', is_admin: true, account_id: 2 },
      { cookie: cafe.cookie, csrf: cafe.csrf },
    );

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  it('macht aus role=admin in der Abfrage keine Rechte', async () => {
    const response = await post(
      { status: 'confirmed' },
      { cookie: cafe.cookie, csrf: cafe.csrf, pfad: `${PFAD}?role=admin&admin=1` },
    );

    expect(response.status).toBe(403);
    await bleibtUnveraendert();
  });

  it('macht aus role=admin ohne jede Sitzung keine Rechte', async () => {
    const response = await post(
      { status: 'confirmed', role: 'admin' },
      { cookie: null, csrf: null, pfad: `${PFAD}?role=admin` },
    );

    expect(response.status).toBe(401);
    await bleibtUnveraendert();
  });

  /**
   * DIE REIHENFOLGE DER PRÜFUNGEN. Wer keinen Zugang hat, erfährt nichts über
   * die erwartete Anfrageform — auch nicht, dass hier JSON erwartet wird oder
   * welcher Status gültig wäre.
   */
  it('antwortet Fremden nicht mit 415 oder 400', async () => {
    for (const optionen of [
      { cookie: null, csrf: null, contentType: 'text/plain' as const },
      { cookie: cafe.cookie, csrf: cafe.csrf, contentType: 'text/plain' as const },
    ]) {
      const response = await post({ status: 'quatsch' }, optionen);

      expect([401, 403]).toContain(response.status);
    }
  });
});

/**
 * GLEICHZEITIGKEIT AN DER GRENZE.
 *
 * Zwei Adminbrowser, derselbe veraltete Bildschirm. Der zweite Klick darf
 * keine Erfolgsmeldung bekommen, wenn er auf einen Stand schreibt, den es
 * nicht mehr gibt.
 */
describe('POST /api/admin/orders/:orderNumber/status — gleichzeitig', () => {
  it('lässt von zwei identischen Anfragen genau eine durch', async () => {
    const [a, b] = await Promise.all([post({ status: 'confirmed' }), post({ status: 'confirmed' })]);

    const codes = [a.status, b.status].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBe(409);
    expect((await zeile())['status']).toBe('confirmed');
  });

  it('bestätigt einen zweiten Klick auf einen veralteten Stand nicht', async () => {
    await post({ status: 'confirmed' });
    await post({ status: 'in_production' });

    // Der Bildschirm zeigte noch „neu"; der Admin klickt „bestätigen".
    const spaet = await post({ status: 'confirmed' });

    expect(spaet.status).toBe(409);
    expect((await zeile())['status']).toBe('in_production');
  });
});

describe('POST /api/admin/orders/:orderNumber/status — was den Worker verlässt', () => {
  /**
   * no-store auf JEDER Antwort dieses Endpunkts, nicht nur auf der
   * erfolgreichen. Eine 409 trägt den aktuellen Zustand einer Bestellung
   * ebenso wie eine 200 — und ein Tresengerät wird geteilt.
   */
  it('setzt no-store auf jede Antwort', async () => {
    const antworten = [
      await post({ status: 'confirmed' }),
      await post({ status: 'confirmed' }), // 409
      await post({ status: 'quatsch' }),
      await post({ status: 'confirmed' }, { pfad: '/api/admin/orders/BUS-2026-999999/status' }),
      await post({ status: 'confirmed' }, { cookie: cafe.cookie, csrf: cafe.csrf }),
      await post({ status: 'confirmed' }, { cookie: null, csrf: null }),
      await post({ status: 'confirmed' }, { csrf: 'x'.repeat(43) }),
      await post({ status: 'confirmed' }, { origin: 'https://angreifer.test' }),
      await post({ status: 'confirmed' }, { contentType: 'text/plain' }),
      await post({ status: 'confirmed' }, { method: 'GET' }),
      await post(null, { body: '{' }),
    ];

    for (const antwort of antworten) {
      expect(antwort.headers.get('cache-control')).toBe('no-store');
    }
  });

  /**
   * Eine beschädigte Zeile — der Gesamtbetrag passt nicht zu den Positionen —
   * lässt das Auslesen der Bestellung scheitern. Das ist der erreichbare
   * 500-Fall dieses Endpunkts, und er darf nichts erzählen.
   */
  it('gibt im 500 keine technischen Einzelheiten preis', async () => {
    await env.DB.prepare(`UPDATE orders SET total_amount_cents = 9999 WHERE id = 42`).run();

    const response = await post({ status: 'confirmed' });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    for (const verboten of [
      'SELECT',
      'UPDATE',
      'orders',
      'D1_',
      'sqlite',
      '.ts',
      'src/',
      'at ',
      'Gesamtbetrag',
      admin.csrf,
    ]) {
      expect(text).not.toContain(verboten);
    }
  });

  it('gibt in keiner Antwort Sitzungs- oder CSRF-Werte zurück', async () => {
    const texte = await Promise.all(
      [
        await post({ status: 'confirmed' }),
        await post({ status: 'quatsch' }),
        await post({ status: 'confirmed' }, { csrf: 'x'.repeat(43) }),
      ].map((r) => r.text()),
    );

    for (const text of texte) {
      expect(text).not.toContain(admin.csrf);
      expect(text).not.toContain(admin.cookie);
    }
  });

  it('gibt keine vollständige Bestellung zurück', async () => {
    const text = await (await post({ status: 'confirmed' })).text();

    for (const feld of [
      'customer_id',
      'customer_name',
      'Testcafé',
      'Beispielweg',
      'total',
      'items',
      'note',
      'Bitte vor acht',
      'submission',
      'created_at',
    ]) {
      expect(text).not.toContain(feld);
    }
  });
});
