import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * Der Produktionstag an der HTTP-Grenze.
 *
 * Zwei Fragen werden hier beantwortet, und nur hier: WER darf diese Daten
 * sehen, und WAS genau verlässt den Worker.
 *
 * Die Rechenregeln stehen woanders. Diese Datei prüft die Grenze.
 *
 * Alle Daten sind fiktiv.
 */

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const TAG = '2026-08-26';
const PFAD = '/api/admin/production-day';

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
 * Die Sitzung wird auf die ECHTE Uhr geprägt, nicht auf NOW_ISO — sonst
 * schlüge diese Datei abends fehl und morgens nicht. Dieselbe Begründung wie
 * in admin-page.test.ts, wo genau das einmal passiert ist.
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

async function alsAdmin(): Promise<string> {
  return anmelden('admin@example.test', PASSWORT);
}

async function call(
  query: string,
  cookie: string | null = null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie !== null) headers.set('cookie', cookie);
  for (const [k, v] of Object.entries((init.headers as Record<string, string>) ?? {})) {
    headers.set(k, v);
  }

  const { headers: _weg, ...rest } = init;
  return worker.fetch(new Request(`${ORIGIN}${PFAD}${query}`, { ...rest, headers }), umgebung());
}

async function bestellung(options: {
  id: number;
  customerName: string;
  day: string;
  status?: string;
  note?: string | null;
  items: readonly { productId: number; quantity: number }[];
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, delivery_address_snapshot, note, status,
                         total_amount_cents, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'delivery', ?, 'Beispielweg 1, 40213 Düsseldorf', ?, ?, 4711, ?7, ?7)`,
  )
    .bind(
      options.id,
      `BUS-2026-${String(options.id).padStart(6, '0')}`,
      options.customerName,
      options.day,
      options.note ?? null,
      options.status ?? 'confirmed',
      NOW_ISO,
    )
    .run();

  for (const item of options.items) {
    const produkt = await env.DB.prepare(`SELECT name, unit FROM products WHERE id = ?`)
      .bind(item.productId)
      .first<{ name: string; unit: string }>();

    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, 435, ?, ?)`,
    )
      .bind(
        options.id,
        item.productId,
        produkt?.name ?? '?',
        produkt?.unit ?? '?',
        item.quantity,
        435 * item.quantity,
      )
      .run();
  }
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

  /**
   * Der Kunde bekommt Kontaktdaten und eine interne Notiz — ausdrücklich,
   * damit die Leck-Tests weiter unten etwas zu finden hätten, wenn die
   * Abfrage doch auf customers verbände.
   */
  await env.DB.prepare(
    `INSERT INTO customers (id, name, contact_person, email, phone,
                            delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, internal_note, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Alex Beispiel', 'nord@example.test', '+49 211 1234567',
             'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
             'Lieferung an der Rückseite', ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (2, 'Beispiel Carrot Cake', 520, 'Stück', 1, 20, ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await seedKonto(1, 'testcafe', 'customer', PIN);
  await seedKonto(2, 'admin@example.test', 'admin', PASSWORT);
});

describe('GET /api/admin/production-day — Zugriff', () => {
  it('antwortet einem Admin mit 200', async () => {
    const response = await call(`?date=${TAG}`, await alsAdmin());
    expect(response.status).toBe(200);
  });

  /**
   * DER SICHERHEITSTEST DIESER DATEI. Ein Café darf nicht sehen, was die
   * anderen Cafés bestellt haben — und erreicht diese Daten auch nicht
   * dadurch, dass es die Adresse errät.
   */
  it('lehnt eine Café-Sitzung mit 403 ab', async () => {
    const response = await call(`?date=${TAG}`, await anmelden('testcafe', PIN));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('meldet ein abgewiesenes Café nicht ab', async () => {
    const cookie = await anmelden('testcafe', PIN);
    const abgewiesen = await call(`?date=${TAG}`, cookie);

    expect(abgewiesen.headers.get('set-cookie')).toBeNull();
  });

  it('lehnt ohne Sitzung mit 401 ab', async () => {
    const response = await call(`?date=${TAG}`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('leitet eine API-Anfrage nicht auf die Loginseite um', async () => {
    const response = await call(`?date=${TAG}`);

    // Ein fetch, der HTML zurückbekäme, verarbeitete es als Nutzdaten.
    expect(response.status).not.toBe(303);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('lehnt eine widerrufene Sitzung ab', async () => {
    const cookie = await alsAdmin();
    expect((await call(`?date=${TAG}`, cookie)).status).toBe(200);

    await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?`).bind(NOW_ISO).run();

    expect((await call(`?date=${TAG}`, cookie)).status).toBe(401);
  });

  /**
   * Beide Zeitstempel werden zurückdatiert, nicht nur der Ablauf: Das Schema
   * verlangt, dass eine Sitzung nach ihrer Entstehung abläuft
   * (chk_auth_sessions_expiry_after_creation). Eine Sitzung, die vor ihrer
   * eigenen Erzeugung endet, kann es nicht geben — auch nicht im Test.
   */
  it('lehnt eine abgelaufene Sitzung ab', async () => {
    const cookie = await alsAdmin();
    await env.DB.prepare(
      `UPDATE auth_sessions
          SET created_at = '2019-12-31T00:00:00.000Z',
              expires_at = '2020-01-01T00:00:00.000Z'`,
    ).run();

    expect((await call(`?date=${TAG}`, cookie)).status).toBe(401);
  });

  /**
   * Die Rolle wird bei JEDEM Request neu aus D1 gelesen — ein Sitzungstoken
   * ist kein Dauerausweis. Wird ein Adminkonto deaktiviert, endet der Zugriff
   * auf Produktionsdaten beim nächsten Request und nicht erst in zwölf
   * Stunden.
   */
  it('lehnt ein deaktiviertes Adminkonto sofort ab', async () => {
    const cookie = await alsAdmin();
    expect((await call(`?date=${TAG}`, cookie)).status).toBe(200);

    await env.DB.prepare(`UPDATE auth_accounts SET is_active = 0 WHERE id = 2`).run();

    expect((await call(`?date=${TAG}`, cookie)).status).toBe(401);
  });

  it('lehnt ein erfundenes Sitzungscookie ab', async () => {
    const response = await call(`?date=${TAG}`, 'buschmann_session_dev=erfunden-und-ungueltig');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/admin/production-day — Rolle lässt sich nicht behaupten', () => {
  it('macht ?role=admin niemanden zum Admin', async () => {
    expect((await call(`?date=${TAG}&role=admin`)).status).toBe(401);
    expect(
      (await call(`?date=${TAG}&role=admin`, await anmelden('testcafe', PIN))).status,
    ).toBe(403);
  });

  it('macht ein role-Feld im Körper niemanden zum Admin', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${PFAD}?date=${TAG}`, {
        method: 'GET',
        headers: { origin: ORIGIN, cookie: await anmelden('testcafe', PIN) },
      }),
      umgebung(),
    );

    expect(response.status).toBe(403);
  });

  it('macht ?customer_id=1 einem Café die Daten nicht zugänglich', async () => {
    const response = await call(
      `?date=${TAG}&customer_id=1&admin=1&is_admin=true`,
      await anmelden('testcafe', PIN),
    );

    expect(response.status).toBe(403);
  });
});

describe('GET /api/admin/production-day — Methode', () => {
  for (const methode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`lehnt ${methode} mit 405 ab`, async () => {
      const response = await worker.fetch(
        new Request(`${ORIGIN}${PFAD}?date=${TAG}`, {
          method: methode,
          headers: { origin: ORIGIN, cookie: await alsAdmin() },
        }),
        umgebung(),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
    });
  }

  /**
   * Phase 3B ist READ ONLY. Es gibt keinen schreibenden Zugang zu
   * Produktionsdaten — auch nicht als Nebenwirkung.
   */
  it('legt bei einem abgelehnten POST nichts an und ändert nichts', async () => {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status: 'new',
      items: [{ productId: 1, quantity: 3 }],
    });

    await worker.fetch(
      new Request(`${ORIGIN}${PFAD}?date=${TAG}`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: await alsAdmin(), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      }),
      umgebung(),
    );

    const zeile = await env.DB.prepare(`SELECT status FROM orders WHERE id = 1`).first<{
      status: string;
    }>();
    expect(zeile?.status).toBe('new');
  });
});

describe('GET /api/admin/production-day — Datum', () => {
  async function statusFuer(query: string): Promise<number> {
    return (await call(query, await alsAdmin())).status;
  }

  it('nimmt ein korrektes JJJJ-MM-TT an', async () => {
    expect(await statusFuer(`?date=${TAG}`)).toBe(200);
  });

  it('lehnt ein fehlendes Datum ab', async () => {
    expect(await statusFuer('')).toBe(400);
  });

  it('lehnt ein leeres Datum ab', async () => {
    expect(await statusFuer('?date=')).toBe(400);
  });

  it('lehnt falsche Formate ab', async () => {
    for (const wert of ['25.08.2026', '2026%2F08%2F25', '2026-8-26', '20260826']) {
      expect(await statusFuer(`?date=${wert}`)).toBe(400);
    }
  });

  it('lehnt Datumssprache ab', async () => {
    for (const wert of ['tomorrow', 'today', 'heute', 'morgen']) {
      expect(await statusFuer(`?date=${wert}`)).toBe(400);
    }
  });

  it('lehnt unmögliche Kalendertage ab', async () => {
    for (const wert of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31']) {
      expect(await statusFuer(`?date=${wert}`)).toBe(400);
    }
  });

  it('nimmt den 29. Februar im Schaltjahr an', async () => {
    expect(await statusFuer('?date=2028-02-29')).toBe(200);
  });

  it('lehnt den 29. Februar im Nichtschaltjahr ab', async () => {
    expect(await statusFuer('?date=2026-02-29')).toBe(400);
  });

  it('lehnt einen Zeitstempel ab', async () => {
    expect(await statusFuer('?date=2026-08-26T10:00:00Z')).toBe(400);
  });

  /**
   * Welcher Wert bei mehrfachem Parameter gewinnt, hinge sonst an der
   * Reihenfolge in der URL. Ein Endpunkt, dessen Antwort von einer solchen
   * Feinheit abhängt, lädt zu Parameter-Schmuggel ein.
   */
  it('lehnt einen doppelten date-Parameter ab', async () => {
    expect(await statusFuer(`?date=${TAG}&date=2026-08-27`)).toBe(400);
    expect(await statusFuer(`?date=unsinn&date=${TAG}`)).toBe(400);
  });

  it('nennt für jeden Datumsfehler denselben Code', async () => {
    for (const wert of ['', '?date=', '?date=unsinn', '?date=2026-02-30']) {
      const response = await call(wert, await alsAdmin());
      expect(await response.json()).toEqual({ error: 'invalid_date' });
    }
  });

  /**
   * ROLLE VOR DATUM: Wer keinen gültigen Zugang hat, soll keine Rückmeldung
   * über die erwartete Parameterform bekommen. Ein 400 für einen Fremden wäre
   * die Auskunft „hier ist ein Endpunkt, und er will ein Datum".
   */
  it('antwortet ohne Sitzung mit 401 und nicht mit 400', async () => {
    expect((await call('')).status).toBe(401);
    expect((await call('?date=unsinn')).status).toBe(401);
  });

  it('antwortet einem Café mit 403 und nicht mit 400', async () => {
    const cookie = await anmelden('testcafe', PIN);
    expect((await call('', cookie)).status).toBe(403);
    expect((await call('?date=unsinn', cookie)).status).toBe(403);
  });

  it('liest Vergangenheit, Gegenwart und Zukunft', async () => {
    const cookie = await alsAdmin();
    for (const wert of ['2019-03-04', '2026-08-25', '2031-11-20']) {
      expect((await call(`?date=${wert}`, cookie)).status).toBe(200);
    }
  });
});

describe('GET /api/admin/production-day — Antwort', () => {
  it('liefert einen vollständigen Produktionstag', async () => {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: 'Bitte vor 10 Uhr',
      items: [
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 2 },
      ],
    });
    await bestellung({
      id: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      items: [{ productId: 1, quantity: 8 }],
    });

    const body = await (await call(`?date=${TAG}`, await alsAdmin())).json();

    expect(body).toEqual({
      date: TAG,
      order_count: 2,
      total_units: 13,
      products: [
        { product_id: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 11 },
        { product_id: 2, name: 'Beispiel Carrot Cake', unit: 'Stück', quantity: 2 },
      ],
      orders: [
        {
          order_number: 'BUS-2026-000001',
          customer_name: 'Testcafé Nord',
          status: 'confirmed',
          fulfillment_type: 'delivery',
          note: 'Bitte vor 10 Uhr',
          items: [
            { product_id: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 },
            { product_id: 2, name: 'Beispiel Carrot Cake', unit: 'Stück', quantity: 2 },
          ],
        },
        {
          order_number: 'BUS-2026-000002',
          customer_name: 'Testcafé Süd',
          status: 'confirmed',
          fulfillment_type: 'delivery',
          note: null,
          items: [{ product_id: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 8 }],
        },
      ],
    });
  });

  /** Ein Tag ohne Bestellungen ist ein freier Tag und kein 404. */
  it('liefert einen leeren Tag als 200 mit Nullen', async () => {
    const response = await call(`?date=${TAG}`, await alsAdmin());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      date: TAG,
      order_count: 0,
      total_units: 0,
      products: [],
      orders: [],
    });
  });

  it('lässt neu, storniert und abgeschlossen weg', async () => {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      status: 'new',
      items: [{ productId: 1, quantity: 3 }],
    });
    await bestellung({
      id: 2,
      customerName: 'Testcafé Süd',
      day: TAG,
      status: 'cancelled',
      items: [{ productId: 1, quantity: 999 }],
    });
    await bestellung({
      id: 3,
      customerName: 'Testcafé West',
      day: TAG,
      status: 'completed',
      items: [{ productId: 1, quantity: 500 }],
    });
    await bestellung({
      id: 4,
      customerName: 'Testcafé Ost',
      day: TAG,
      status: 'confirmed',
      items: [{ productId: 1, quantity: 4 }],
    });

    const body = (await (await call(`?date=${TAG}`, await alsAdmin())).json()) as {
      order_count: number;
      total_units: number;
    };

    expect(body.order_count).toBe(1);
    expect(body.total_units).toBe(4);
  });

  it('ist application/json', async () => {
    const response = await call(`?date=${TAG}`, await alsAdmin());
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('reicht Markup in der Notiz unverändert durch, ohne es zu interpretieren', async () => {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: '<b>eilig</b> & "wichtig"',
      items: [{ productId: 1, quantity: 1 }],
    });

    const body = (await (await call(`?date=${TAG}`, await alsAdmin())).json()) as {
      orders: { note: string }[];
    };

    expect(body.orders[0]?.note).toBe('<b>eilig</b> & "wichtig"');
  });
});

describe('GET /api/admin/production-day — Zwischenspeicher', () => {
  /**
   * Produktionsdaten sagen, welches Café wie viel bestellt. Das ist eine
   * Geschäftsbeziehung und gehört in keinen Zwischenspeicher — nicht an den
   * Rand des Netzes, nicht in einen Firmen-Proxy und nicht in den Browser
   * eines geteilten Tresengeräts.
   */
  it('trägt no-store auf jeder Antwort, auch auf den Ablehnungen', async () => {
    const adminCookie = await alsAdmin();
    const cafeCookie = await anmelden('testcafe', PIN);

    const antworten = [
      await call(`?date=${TAG}`, adminCookie),
      await call('?date=unsinn', adminCookie),
      await call('', adminCookie),
      await call(`?date=${TAG}`, cafeCookie),
      await call(`?date=${TAG}`),
    ];

    for (const antwort of antworten) {
      expect(antwort.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('trägt die üblichen Schutzkopfzeilen', async () => {
    const response = await call(`?date=${TAG}`, await alsAdmin());

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('GET /api/admin/production-day — Datenminimierung', () => {
  async function rohtext(): Promise<string> {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      note: 'Bitte vor 10 Uhr',
      items: [
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 2 },
      ],
    });

    return (await call(`?date=${TAG}`, await alsAdmin())).text();
  }

  /**
   * Geprüft wird der ROHE Antworttext und nicht eine Feldliste, die ich
   * erwarte. Ein Feld, an das ich nicht gedacht habe, fällt nur so auf.
   */
  it('enthält keine Preise', async () => {
    const text = await rohtext();

    for (const verboten of [
      'cents',
      'price',
      'Preis',
      '435',
      '520',
      '4711',
      'unit_price',
      'line_total',
      'total_amount',
    ]) {
      expect(text).not.toContain(verboten);
    }
  });

  it('enthält keine Kundenkontaktdaten und keine Adresse', async () => {
    const text = await rohtext();

    for (const verboten of [
      'nord@example.test',
      '+49 211 1234567',
      'Alex Beispiel',
      'Beispielweg',
      '40213',
      'Lieferung an der Rückseite',
    ]) {
      expect(text).not.toContain(verboten);
    }
  });

  it('enthält keine Auth- oder Sitzungsdaten', async () => {
    const cookie = await alsAdmin();
    const token = cookie.split('=')[1] as string;

    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    const text = await (await call(`?date=${TAG}`, cookie)).text();

    for (const verboten of [
      token,
      'admin@example.test',
      'csrf',
      'token',
      'session',
      'credential',
      'salt',
      'verifier',
      'pepper',
      PEPPER,
    ]) {
      expect(text.toLowerCase()).not.toContain(verboten.toLowerCase());
    }
  });

  it('enthält keine internen Kennungen und keine Zeitstempel', async () => {
    const text = await rohtext();

    for (const verboten of [
      'customer_id',
      'order_id',
      'submission',
      'created_at',
      'updated_at',
      'account_id',
      NOW_ISO,
    ]) {
      expect(text).not.toContain(verboten);
    }
  });

  /**
   * sortOrder ist ein internes Sortiermerkmal. Es wird geladen, weil die
   * Reihenfolge daran hängt, und verlässt den Worker trotzdem nicht: Ein Feld
   * ohne Nutzen für den Aufrufer gehört nicht in die Antwort.
   */
  it('enthält kein Sortiermerkmal', async () => {
    const text = await rohtext();

    expect(text).not.toContain('sort_order');
    expect(text).not.toContain('sortOrder');
  });

  it('hat auf oberster Ebene genau die vereinbarten Schlüssel', async () => {
    const body = (await (await call(`?date=${TAG}`, await alsAdmin())).json()) as object;

    expect(Object.keys(body).sort()).toEqual([
      'date',
      'order_count',
      'orders',
      'products',
      'total_units',
    ]);
  });

  it('hat je Bestellung und je Position genau die vereinbarten Schlüssel', async () => {
    await bestellung({
      id: 1,
      customerName: 'Testcafé Nord',
      day: TAG,
      items: [{ productId: 1, quantity: 3 }],
    });

    const body = (await (await call(`?date=${TAG}`, await alsAdmin())).json()) as {
      products: object[];
      orders: (object & { items: object[] })[];
    };

    expect(Object.keys(body.products[0] ?? {}).sort()).toEqual([
      'name',
      'product_id',
      'quantity',
      'unit',
    ]);
    expect(Object.keys(body.orders[0] ?? {}).sort()).toEqual([
      'customer_name',
      'fulfillment_type',
      'items',
      'note',
      'order_number',
      'status',
    ]);
    expect(Object.keys(body.orders[0]?.items[0] ?? {}).sort()).toEqual([
      'name',
      'product_id',
      'quantity',
      'unit',
    ]);
  });
});

describe('GET /api/admin/production-day — Fehler', () => {
  /**
   * Ein Datenbankfehler darf kein SQL-Fragment, keinen Tabellennamen und
   * keinen Dateipfad nach außen tragen. Der Körper wird nicht aus dem Fehler
   * GEBILDET, er ist eine Konstante.
   */
  it('verrät bei einem Datenbankfehler nichts über die Datenbank', async () => {
    const cookie = await alsAdmin();

    // Die Tabelle verschwindet unter der laufenden Abfrage. Der
    // Fremdschlüssel auf order_items zwingt dazu, sie zuerst zu leeren.
    await env.DB.prepare(`DROP TABLE order_items`).run();
    await env.DB.prepare(`DROP TABLE orders`).run();

    const response = await call(`?date=${TAG}`, cookie);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });

    for (const verboten of ['SELECT', 'orders', 'no such table', 'D1_', '.ts', 'sqlite']) {
      expect(text).not.toContain(verboten);
    }
  });
});
