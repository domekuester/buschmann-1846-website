import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { businessDay, plusDays } from '../../src/domain/clock';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const TAG = '2026-08-26';
const MONTAG = '2026-08-24';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(
  id: number,
  identifier: string,
  role: 'admin' | 'customer',
  secret: string,
): Promise<void> {
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

async function seedOrder(
  orderNumber: string,
  overrides: {
    status?: string;
    paymentStatus?: string;
    totalCents?: number;
    day?: string;
    customerId?: number;
  } = {},
): Promise<void> {
  const bezahlt = overrides.paymentStatus ?? 'unpaid';
  await env.DB.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name_snapshot, fulfillment_type,
                         fulfillment_date, status, total_amount_cents, payment_status,
                         payment_recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderNumber,
    overrides.customerId ?? 1,
    overrides.customerId === 2 ? 'Fiktiver Privatkunde' : 'Fiktives Café Nord',
    overrides.day ?? TAG,
    overrides.status ?? 'new',
    overrides.totalCents ?? 4350,
    bezahlt,
    bezahlt === 'unpaid' ? null : NOW,
    NOW,
    NOW,
  ).run();

  await env.DB.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_unit_snapshot,
                              unit_price_cents, quantity, line_total_cents)
     VALUES ((SELECT id FROM orders WHERE order_number = ?), 1, 'Fiktiver Käsekuchen', 'Stück',
             500, 2, 1000)`,
  ).bind(orderNumber).run();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?),
            (2, 'Fiktiver Privatkunde', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW, NOW, NOW).run();
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (1, 'Fiktiver Käsekuchen', 500, 'Stück', 1, 10, ?, ?)`,
  ).bind(NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});


/**
 * PHASE 6C — HANDLUNGSBEDARF, SCHNELLWAHL, WOCHE UND FILTER an der
 * HTTP-Grenze.
 *
 * Die Regeln selbst sind in der Domäne geprüft; hier wird geprüft, dass die
 * SEITE sie zeigt — mit echtem Worker, echter D1 und echtem Wächter.
 */

describe('GET /admin/dashboard — Handlungsbedarf', () => {
  it('meldet neue Bestellungen mit Anzahl und Weg', async () => {
    await seedOrder('BUS-2026-000001', { status: 'new' });
    await seedOrder('BUS-2026-000002', { status: 'new' });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Handlungsbedarf');
    expect(html).toContain('Neue Bestellungen');
    expect(html).toContain('warten auf Bestätigung');
    expect(html).toContain(`href="/admin?date=${TAG}"`);
  });

  it('meldet die offene Produktion', async () => {
    await seedOrder('BUS-2026-000001', { status: 'in_production' });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Offen in der Produktion');
    expect(html).toContain('Produktion öffnen');
    expect(html).not.toContain('Neue Bestellung<');
  });

  it('meldet offene Zahlungen mit Snapshotbetrag', async () => {
    await seedOrder('BUS-2026-000001', {
      status: 'completed',
      paymentStatus: 'unpaid',
      totalCents: 4350,
    });
    await seedOrder('BUS-2026-000002', {
      status: 'completed',
      paymentStatus: 'unpaid',
      totalCents: 2610,
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Zahlungen offen');
    expect(html).toContain('69,60 €');
    expect(html).toContain('Offene Zahlungen anzeigen');
  });

  it('lässt eine stornierte unbezahlte Bestellung aus dem Handlungsbedarf heraus', async () => {
    await seedOrder('BUS-2026-000001', {
      status: 'cancelled',
      paymentStatus: 'unpaid',
      totalCents: 9999,
    });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();
    const bereich = html.slice(html.indexOf('Handlungsbedarf'), html.indexOf('ringzone'));

    expect(bereich).toContain('Für diesen Produktionstag ist aktuell nichts offen.');
    expect(bereich).not.toContain('Zahlungen offen');
    // Der Betrag steht weiterhin in der Bestellliste — die stornierte Zeile
    // bleibt sichtbar. Nur im Handlungsbedarf hat sie nichts zu suchen.
    expect(bereich).not.toContain('99,99 €');
    expect(html).toContain('99,99 €');
  });

  it('zeigt an einem erledigten Tag genau einen ruhigen Satz', async () => {
    await seedOrder('BUS-2026-000001', { status: 'completed', paymentStatus: 'paid_cash' });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Für diesen Produktionstag ist aktuell nichts offen.');
    expect(html).toContain('Neue Bestellungen, Produktion und Zahlungen sind erledigt.');
    expect(html).not.toContain('handlungszeile');
  });

  it('bezieht sich ausschließlich auf den gewählten Produktionstag', async () => {
    await seedOrder('BUS-2026-000001', { day: '2026-08-27', status: 'new', totalCents: 9999 });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('Für diesen Produktionstag ist aktuell nichts offen.');
    expect(html).not.toContain('99,99 €');
    expect(html).not.toContain('BUS-2026-000001');
  });
});

describe('GET /admin/dashboard — Schnellwahl', () => {
  it('bietet Heute, Morgen und Woche an', async () => {
    const heute = businessDay(new Date());
    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain(`href="/admin/dashboard?date=${heute}"`);
    expect(html).toContain(`href="/admin/dashboard?date=${plusDays(heute, 1)}"`);
    expect(html).toContain(`href="/admin/dashboard?date=${MONTAG}&amp;view=week"`);
    expect(html).toContain('>Heute<');
    expect(html).toContain('>Morgen<');
    expect(html).toContain('>Woche<');
  });

  it('nimmt das Datum vom SERVER und nicht aus dem Browser', async () => {
    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    // Die Seite trägt kein Skript — ein Browserdatum ist gar nicht erreichbar.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('new Date');
  });

  it('markiert Heute, wenn der Tag von heute angesehen wird', async () => {
    const heute = businessDay(new Date());
    const html = await (await call(`/admin/dashboard?date=${heute}`, await admin())).text();

    expect(html).toContain('schnellwahl__ziel--aktiv');
    expect(html).toContain('aria-current="page"');
  });

  it('lässt die freie Datumswahl unangetastet', async () => {
    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('<form class="tagnav__formular" method="get" action="/admin/dashboard">');
    expect(html).toContain(`value="${TAG}"`);
    expect(html).toContain('Anzeigen');
  });
});

describe('GET /admin/dashboard — Kennzahlnavigation', () => {
  it('führt Bestellungen auf die Liste, Offen auf die Produktion, Kunden auf die Kundenseite', async () => {
    await seedOrder('BUS-2026-000001');

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain('href="#bestellungen"');
    expect(html).toContain(`href="/admin?date=${TAG}"`);
    expect(html).toContain('href="/admin/customers"');
    expect(html).toContain('id="bestellungen"');
  });

  it('macht Umsatz und Einheiten NICHT klickbar', async () => {
    await seedOrder('BUS-2026-000001');

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    /**
     * Die Karte als vollständiges Element — samt ihrem öffnenden Tag, denn
     * genau dort steht, ob sie ein Link ist.
     */
    const karten = [...html.matchAll(/<(a|div) class="kennzahlkarte[\s\S]*?<\/\1>/g)].map(
      (treffer) => treffer[0],
    );
    const karte = (label: string): string =>
      karten.find((block) => block.includes(`>${label}</span>`)) ?? '';

    expect(karte('Umsatz')).not.toContain('kennzahlkarte--weg');
    expect(karte('Umsatz')).not.toContain('href=');
    expect(karte('Einheiten')).not.toContain('kennzahlkarte--weg');
    expect(karte('Einheiten')).not.toContain('href=');
    // Zur Gegenprobe: die vier, die führen sollen, führen auch.
    expect(karte('Bestellungen')).toContain('kennzahlkarte--weg');
    expect(karte('Kunden')).toContain('kennzahlkarte--weg');
  });

  it('führt den offenen Betrag auf die gefilterte Liste', async () => {
    await seedOrder('BUS-2026-000001', { paymentStatus: 'unpaid' });

    const html = await (await call(`/admin/dashboard?date=${TAG}`, await admin())).text();

    expect(html).toContain(`href="/admin/dashboard?date=${TAG}&amp;orders=unpaid#bestellungen"`);
  });
});

describe('GET /admin/dashboard — Zahlungsfilter', () => {
  beforeEach(async () => {
    await seedOrder('BUS-2026-000001', { paymentStatus: 'unpaid', totalCents: 4350 });
    await seedOrder('BUS-2026-000002', { paymentStatus: 'paid_cash', totalCents: 1290 });
    await seedOrder('BUS-2026-000003', {
      status: 'cancelled',
      paymentStatus: 'unpaid',
      totalCents: 9999,
    });
  });

  it('zeigt ausschließlich die offenen, nicht stornierten Bestellungen', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&orders=unpaid`, await admin())
    ).text();

    expect(html).toContain('BUS-2026-000001');
    expect(html).not.toContain('BUS-2026-000002');
    expect(html).not.toContain('BUS-2026-000003');
    expect(html).toContain('Offene Zahlungen');
  });

  it('lässt die Kennzahlen des Tages unverändert', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&orders=unpaid`, await admin())
    ).text();

    // Umsatz weiterhin über beide nicht stornierten Bestellungen.
    expect(html).toContain('56,40 €');
    expect(html).toContain('zusätzlich 1 storniert');
  });

  it('bietet den Weg zurück zu allen Bestellungen', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&orders=unpaid`, await admin())
    ).text();

    expect(html).toContain(`href="/admin/dashboard?date=${TAG}#bestellungen"`);
    expect(html).toContain('Alle Bestellungen');
  });

  it('zeigt mit orders=all wieder alle Bestellungen', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&orders=all`, await admin())
    ).text();

    expect(html).toContain('BUS-2026-000001');
    expect(html).toContain('BUS-2026-000002');
    expect(html).toContain('BUS-2026-000003');
  });

  it('sagt es, wenn nichts offen ist, statt einen leeren Rahmen zu zeigen', async () => {
    await env.DB.prepare("UPDATE orders SET payment_status = 'paid_card', payment_recorded_at = ?")
      .bind(NOW)
      .run();

    const html = await (
      await call(`/admin/dashboard?date=${TAG}&orders=unpaid`, await admin())
    ).text();

    expect(html).toContain('Für diesen Tag ist keine Zahlung offen.');
  });

  it('lehnt einen unbekannten Filterwert mit 400 ab', async () => {
    const response = await call(`/admin/dashboard?date=${TAG}&orders=erfunden`, await admin());

    expect(response.status).toBe(400);
  });

  it('lehnt einen doppelten Filterparameter mit 400 ab', async () => {
    const response = await call(
      `/admin/dashboard?date=${TAG}&orders=all&orders=unpaid`,
      await admin(),
    );

    expect(response.status).toBe(400);
  });

  it('verweigert einem Customer auch die gefilterte Liste', async () => {
    const response = await call(`/admin/dashboard?date=${TAG}&orders=unpaid`, await kunde());

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).not.toContain('BUS-2026-000001');
    expect(html).not.toContain('43,50');
  });
});

describe('GET /admin/dashboard?view=week', () => {
  it('zeigt die Kalenderwoche des angefragten Tages', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${TAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('Wochenübersicht');
    expect(html).toContain('24. August 2026 – 30. August 2026');
    for (const wochentag of [
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
      'Sonntag',
    ]) {
      expect(html).toContain(wochentag);
    }
  });

  it('führt jede Tageszeile auf ihre Tagesansicht', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('href="/admin/dashboard?date=2026-08-24"');
    expect(html).toContain('href="/admin/dashboard?date=2026-08-30"');
  });

  it('rechnet Umsatz, offene Produktion und offene Zahlung je Tag', async () => {
    await seedOrder('BUS-2026-000001', { day: '2026-08-24', totalCents: 42050, status: 'new' });
    await seedOrder('BUS-2026-000002', {
      day: '2026-08-25',
      totalCents: 31000,
      status: 'completed',
      paymentStatus: 'paid_bank',
    });

    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('420,50 €');
    expect(html).toContain('310,00 €');
    expect(html).toContain('730,50 €');
    expect(html).toContain('Ganze Woche');
  });

  it('lässt Bestellungen außerhalb der Woche vollständig heraus', async () => {
    await seedOrder('BUS-2026-000001', { day: '2026-08-23', totalCents: 9999 });
    await seedOrder('BUS-2026-000002', { day: '2026-08-31', totalCents: 8888 });

    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).not.toContain('99,99 €');
    expect(html).not.toContain('88,88 €');
  });

  it('nimmt den Sonntag noch mit', async () => {
    await seedOrder('BUS-2026-000001', { day: '2026-08-30', totalCents: 4350 });

    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('43,50 €');
  });

  it('lässt stornierte Bestellungen aus dem Wochenumsatz heraus', async () => {
    await seedOrder('BUS-2026-000001', {
      day: MONTAG,
      totalCents: 9999,
      status: 'cancelled',
    });

    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).not.toContain('99,99 €');
    expect(html).toContain('zusätzlich 1 storniert');
  });

  it('zeigt keine Ringe, keine Bestellliste und kein Meistbestellt', async () => {
    await seedOrder('BUS-2026-000001', { day: MONTAG });

    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).not.toContain('ring__grafik');
    expect(html).not.toContain('Meistbestellt');
    expect(html).not.toContain('BUS-2026-000001');
    expect(html).not.toContain('<script');
  });

  it('bleibt bei einer leeren Woche vollständig', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('Sonntag');
    expect(html).toContain('0,00 €');
  });

  it('führt die Pfeile auf die Wochen davor und danach', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).toContain('href="/admin/dashboard?date=2026-08-17&amp;view=week"');
    expect(html).toContain('href="/admin/dashboard?date=2026-08-31&amp;view=week"');
  });

  it('lehnt einen unbekannten view-Wert mit 400 ab', async () => {
    expect((await call(`/admin/dashboard?date=${TAG}&view=jahr`, await admin())).status).toBe(400);
  });

  it('lehnt einen doppelten view-Parameter mit 400 ab', async () => {
    expect(
      (await call(`/admin/dashboard?date=${TAG}&view=day&view=week`, await admin())).status,
    ).toBe(400);
  });

  it('lehnt ein ungültiges Datum auch in der Wochenansicht mit 400 ab', async () => {
    expect((await call('/admin/dashboard?date=2026-02-30&view=week', await admin())).status).toBe(
      400,
    );
  });

  it('verweigert einem Customer die Wochenansicht', async () => {
    await seedOrder('BUS-2026-000001', { day: MONTAG, totalCents: 4350 });

    const response = await call(`/admin/dashboard?date=${MONTAG}&view=week`, await kunde());

    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).not.toContain('43,50');
    expect(html).not.toContain('Wochenübersicht');
  });

  it('schickt unauthenticated über den Loginflow', async () => {
    const response = await call(`/admin/dashboard?date=${MONTAG}&view=week`);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('spiegelt keinen Parameterwert in die Seite zurück', async () => {
    const response = await call(
      '/admin/dashboard?date=2026-08-24&view=%3Cscript%3Ealert(1)%3C/script%3E',
      await admin(),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('alert(1)');
  });

  it('führt über keinen Parameter aus der Anwendung heraus', async () => {
    const html = await (
      await call(`/admin/dashboard?date=${MONTAG}&view=week`, await admin())
    ).text();

    expect(html).not.toContain('href="http');
    expect(html).not.toContain('href="//');
  });
});
