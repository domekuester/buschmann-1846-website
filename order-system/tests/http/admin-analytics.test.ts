import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { cancelOrderItem, changeOrderItemQuantities } from '../../src/application/edit-order-item';
import { OrderNumber } from '../../src/domain/order-number';
import { businessDay, plusDays } from '../../src/domain/clock';
import {
  formatGermanDate,
  formatGermanMonthYear,
  formatGermanNumericDate,
  formatGermanShortDate,
} from '../../src/ui/format';

/**
 * DER WORKER LIEST DIE ECHTE UHR. Diese Datei rechnet deshalb jeden Tag aus
 * `businessDay(new Date())` und schreibt kein Datum fest — ein Test mit
 * '2026-09-15' wäre am 16. rot, ohne dass sich am Code etwas geändert hätte.
 */
const HEUTE = businessDay(new Date());

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-09-15T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

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

let nummer = 0;

async function seedOrder(day: string, over: { status?: string; totalCents?: number; customerId?: number; paymentStatus?: string } = {}) {
  nummer += 1;
  const bestellnummer = `BUS-2026-${String(nummer).padStart(6, '0')}`;
  const bezahlt = over.paymentStatus ?? 'unpaid';
  const betrag = over.totalCents ?? 4_350;
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    bestellnummer,
    over.customerId ?? 1,
    over.customerId === 2 ? 'Fiktiver Privatkunde' : 'Fiktives Café Nord',
    day,
    over.status ?? 'completed',
    betrag,
    bezahlt,
    bezahlt === 'unpaid' ? null : NOW,
    NOW,
    NOW,
  ).run();
  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
     VALUES ((SELECT id FROM orders WHERE order_number = ?), 1, 'Fiktiver Käsekuchen', 'Stück',
             ?, 1, ?, 1000)`,
  ).bind(bestellnummer, betrag, betrag).run();
}

beforeEach(async () => {
  nummer = 0;
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?1, ?1),
            (2, 'Fiktiver Privatkunde', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktiver Käsekuchen', 500, 'Stück', 1, 10, ?1, ?1)`,
  ).bind(NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/auswertung — Zugang', () => {
  it('schickt unangemeldete über den Loginflow', async () => {
    const response = await call('/admin/auswertung');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('verweigert einem Kunden den Zugriff und zeigt ihm keine Zahl', async () => {
    await seedOrder(HEUTE, { totalCents: 123_456 });
    const response = await call('/admin/auswertung', await kunde());
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).not.toContain('1.234,56');
    expect(html).not.toContain('Fiktives Café Nord');
  });

  it('lässt einen Admin auf die Seite', async () => {
    const response = await call('/admin/auswertung', await admin());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('antwortet auf POST mit 405', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/admin/auswertung`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: await admin() },
      }),
      environment(),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});

describe('GET /admin/auswertung — Zeitraum', () => {
  it('zeigt ohne Parameter den laufenden Monat', async () => {
    const html = await (await call('/admin/auswertung', await admin())).text();
    expect(html).toContain(formatGermanMonthYear(HEUTE));
  });

  it('rechnet den gewählten Zeitraum aus der Serveruhr in Europe/Berlin', async () => {
    await seedOrder(HEUTE, { totalCents: 10_000 });
    await seedOrder(plusDays(HEUTE, -1), { totalCents: 20_000 });
    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    expect(html).toContain(`Heute, ${formatGermanDate(HEUTE)}`);
    expect(html).toContain('100,00 €');
    expect(html).toContain(`Gestern, ${formatGermanDate(plusDays(HEUTE, -1))}`);
  });

  it('nimmt eine freie Spanne entgegen', async () => {
    const von = plusDays(HEUTE, -20);
    const bis = plusDays(HEUTE, -10);
    await seedOrder(plusDays(HEUTE, -15), { totalCents: 5_000 });
    const html = await (
      await call(`/admin/auswertung?period=zeitraum&from=${von}&to=${bis}`, await admin())
    ).text();
    expect(html).toContain(`${formatGermanShortDate(von)}–${formatGermanNumericDate(bis)}`);
    expect(html).toContain('50,00 €');
  });

  it('schaltet die Kurve auf Bestellungen um', async () => {
    const html = await (await call('/admin/auswertung?period=woche&metric=bestellungen', await admin())).text();
    expect(html).toContain('Bestellungen je Tag');
  });
});

describe('GET /admin/auswertung — ungültige Eingaben', () => {
  it('fällt bei einem unbekannten Zeitraum nicht still auf einen anderen zurück', async () => {
    const response = await call('/admin/auswertung?period=quartal', await admin());
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).not.toContain(formatGermanMonthYear(HEUTE));
  });

  it('weist einen ungültigen Tag zurück', async () => {
    const response = await call('/admin/auswertung?period=zeitraum&from=2026-02-30&to=2026-03-01', await admin());
    expect(response.status).toBe(400);
  });

  it('weist ein Bis vor dem Von zurück', async () => {
    const response = await call('/admin/auswertung?period=zeitraum&from=2026-03-01&to=2026-02-01', await admin());
    expect(response.status).toBe(400);
  });

  it('weist eine freie Spanne ohne Grenzen zurück', async () => {
    const response = await call('/admin/auswertung?period=zeitraum', await admin());
    expect(response.status).toBe(400);
  });

  it('weist eine unbekannte Reihe zurück', async () => {
    const response = await call('/admin/auswertung?metric=marge', await admin());
    expect(response.status).toBe(400);
  });

  it('weist einen doppelt angegebenen Parameter zurück', async () => {
    const response = await call('/admin/auswertung?period=monat&period=jahr', await admin());
    expect(response.status).toBe(400);
  });

  it('spiegelt den fehlerhaften Wert nicht zurück', async () => {
    const response = await call('/admin/auswertung?period=%3Cscript%3E', await admin());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('script%3E');
  });
});

describe('GET /admin/auswertung — Zahlen', () => {
  it('lässt stornierte Bestellungen aus dem Umsatz', async () => {
    await seedOrder(HEUTE, { totalCents: 10_000 });
    await seedOrder(HEUTE, { totalCents: 99_900, status: 'cancelled' });
    const html = await (await call('/admin/auswertung', await admin())).text();
    expect(html).toContain('100,00 €');
    expect(html).not.toContain('999,00 €');
  });

  it('folgt beim offenen Betrag dem gespeicherten Zahlungsstand', async () => {
    await seedOrder(HEUTE, { totalCents: 10_000, paymentStatus: 'paid_cash' });
    await seedOrder(HEUTE, { totalCents: 2_500, paymentStatus: 'unpaid' });
    const html = await (await call('/admin/auswertung', await admin())).text();
    expect(html).toContain('25,00 €');
    expect(html).toContain('1 Bestellung ist noch nicht bezahlt');
  });

  it('nennt Top-Produkt und Top-Kunde ohne technische Kennung', async () => {
    await seedOrder(HEUTE, { totalCents: 10_000, customerId: 2 });
    const html = await (await call('/admin/auswertung', await admin())).text();
    expect(html).toContain('Fiktiver Käsekuchen');
    expect(html).toContain('Fiktiver Privatkunde');
  });
});


/**
 * DIE PFLICHTPRÜFUNG DIESER PHASE: Was die Positionsbearbeitung ändert, muss
 * die Auswertung sehen — und was sie protokolliert, darf sie NICHT sehen.
 *
 * Die Bestellung wird hier nicht von Hand umgeschrieben, sondern über
 * dieselben Anwendungsfälle geändert, die auch der Adminbereich benutzt.
 * Ein Test, der `order_items` direkt bearbeitete, prüfte eine Annahme über
 * die Bearbeitung statt der Bearbeitung selbst.
 */
describe('GET /admin/auswertung — Bestellungen, die nachträglich geändert wurden', () => {
  const NUMMER = OrderNumber.parse('BUS-2026-000001');

  async function stand(): Promise<{ version: string; items: { id: number; productId: number }[] }> {
    const order = await env.DB.prepare(
      'SELECT id, updated_at FROM orders WHERE order_number = ?',
    )
      .bind('BUS-2026-000001')
      .first<{ id: number; updated_at: string }>();
    const items = await env.DB.prepare(
      'SELECT id, product_id FROM order_items WHERE order_id = ? ORDER BY id',
    )
      .bind(order?.id)
      .all<{ id: number; product_id: number }>();
    return {
      version: order?.updated_at ?? '',
      items: items.results.map((r) => ({ id: r.id, productId: r.product_id })),
    };
  }

  beforeEach(async () => {
    // 5 × 22,00 € = 110,00 €, Status 'new' — also bearbeitbar.
    await env.DB.prepare(
      `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, payment_status,
                           created_at, updated_at)
       VALUES ('BUS-2026-000001', 1, 'Fiktives Café Nord', 'pickup', ?, 'new', 11000, 'unpaid', ?, ?)`,
    ).bind(HEUTE, NOW, NOW).run();
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                                unit_price_cents, quantity, line_total_cents, unit_cost_cents_snapshot)
       VALUES ((SELECT id FROM orders WHERE order_number = 'BUS-2026-000001'), 1,
               'Fiktiver Käsekuchen', 'Stück', 2200, 5, 11000, 1000)`,
    ).run();
  });

  it('zeigt vor der Änderung fünf Stück und 110,00 €', async () => {
    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    expect(html).toContain('110,00 €');
    expect(html).toContain('<p class="auswertwert">5</p>');
  });

  it('zeigt nach einer Mengenänderung von 5 auf 3 genau drei Stück und 66,00 €', async () => {
    const vorher = await stand();
    const ergebnis = await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER!,
      requested: [{ id: vorher.items[0]!.id, quantity: '3' }],
      expectedVersion: vorher.version,
      now: new Date(),
      actorAccountId: 1,
    });
    expect(ergebnis.outcome).toBe('saved');

    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    expect(html).toContain('66,00 €');
    expect(html).not.toContain('110,00 €');
    expect(html).toContain('<p class="auswertwert">3</p>');
    // Die Historie ist keine zusätzliche Bestellung und kein zusätzlicher Umsatz.
    expect(html).toContain('<p class="auswertwert">1</p>');
  });

  it('lässt eine stornierte Position vollständig aus Umsatz, Stück und Toplisten', async () => {
    const vorher = await stand();
    const ergebnis = await cancelOrderItem(env.DB, {
      orderNumber: NUMMER!,
      orderItemId: vorher.items[0]!.id,
      expectedVersion: vorher.version,
      now: new Date(),
      actorAccountId: 1,
    });
    expect(ergebnis.outcome).toBe('saved');

    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    expect(html).not.toContain('110,00 €');
    expect(html).toContain('In diesem Zeitraum wurde noch nichts verkauft.');
    expect(html).toContain('In diesem Zeitraum gibt es noch keine Bestellungen.');
  });

  it('summiert die Änderungshistorie nirgends als Verkauf', async () => {
    const vorher = await stand();
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER!,
      requested: [{ id: vorher.items[0]!.id, quantity: '4' }],
      expectedVersion: vorher.version,
      now: new Date(),
      actorAccountId: 1,
    });
    const danach = await stand();
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER!,
      requested: [{ id: danach.items[0]!.id, quantity: '2' }],
      expectedVersion: danach.version,
      now: new Date(),
      actorAccountId: 1,
    });

    const zeilen = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_item_changes').first<{ n: number }>();
    expect(zeilen?.n).toBe(2);

    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    // 2 × 22,00 € — nicht 5, nicht 4, nicht 11 (2 + 4 + 5).
    expect(html).toContain('44,00 €');
    expect(html).toContain('<p class="auswertwert">2</p>');
  });

  it('meldet den Zahlungsstand einer bezahlten, danach verkleinerten Bestellung unverändert', async () => {
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid_bank', payment_recorded_at = ? WHERE order_number = 'BUS-2026-000001'`,
    ).bind(NOW).run();

    const vorher = await stand();
    await changeOrderItemQuantities(env.DB, {
      orderNumber: NUMMER!,
      requested: [{ id: vorher.items[0]!.id, quantity: '3' }],
      expectedVersion: vorher.version,
      now: new Date(),
      actorAccountId: 1,
    });

    const html = await (await call('/admin/auswertung?period=heute', await admin())).text();
    // Der Umsatz folgt der Bestellung, der offene Betrag dem Zahlungsstand.
    expect(html).toContain('66,00 €');
    expect(html).toContain('Nichts offen');
  });
});
