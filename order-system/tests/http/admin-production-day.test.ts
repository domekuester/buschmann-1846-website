import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';

/**
 * Die Produktions-Tagesansicht unter /admin — geprüft am AUSGELIEFERTEN HTML.
 *
 * Jeder Test geht durch worker.fetch(), also durch Routing, Wache, Controller,
 * Anwendungsfall, echte D1 und Renderer. Ein Test gegen renderAdminPage()
 * allein bliebe grün, während die Seite gar nicht erreichbar ist — und genau
 * das soll hier nicht passieren können.
 *
 * ALLE DATEN SIND FIKTIV. Testcafé Nord, Testcafé Süd, Beispiel Käsekuchen.
 * Keine echten Cafés, keine echten Preise, keine Preisliste.
 */

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

/** Ein fester Tag in der Zukunft — unabhängig davon, wann die Suite läuft. */
const TAG = '2026-09-15';

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

interface PositionSeed {
  productId: number;
  name: string;
  unit: string;
  quantity: number;
  unitPriceCents?: number;
}

interface BestellungSeed {
  id: number;
  orderNumber: string;
  customerName: string;
  status?: 'new' | 'confirmed' | 'in_production' | 'completed' | 'cancelled';
  fulfillmentType?: 'delivery' | 'pickup';
  day?: string;
  note?: string | null;
  items: PositionSeed[];
}

async function seedBestellung(seed: BestellungSeed): Promise<void> {
  const positionen = seed.items.map((item) => ({
    ...item,
    unitPriceCents: item.unitPriceCents ?? 435,
  }));
  const gesamt = positionen.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  await env.DB.prepare(
    `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot,
                         fulfillment_type, fulfillment_date, delivery_address_snapshot,
                         note, status, total_amount_cents, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?10, ?10)`,
  )
    .bind(
      seed.id,
      seed.orderNumber,
      seed.customerName,
      seed.fulfillmentType ?? 'delivery',
      seed.day ?? TAG,
      // Eine Lieferung ohne Adresse laesst das Schema nicht zu — und das ist
      // fuer diesen Test ein Gluecksfall: Die Adresse steht damit tatsaechlich
      // in der Datenbank, und die Datensparsamkeitstests koennen belegen,
      // dass sie die Produktionsansicht trotzdem nie erreicht.
      (seed.fulfillmentType ?? 'delivery') === 'delivery'
        ? 'Beispielweg 1, 40213 Düsseldorf'
        : null,
      seed.note ?? null,
      seed.status ?? 'confirmed',
      gesamt,
      NOW_ISO,
    )
    .run();

  let positionsId = seed.id * 100;
  for (const item of positionen) {
    positionsId += 1;
    await env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot,
                                product_unit_snapshot, unit_price_cents, quantity,
                                line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        positionsId,
        seed.id,
        item.productId,
        item.name,
        item.unit,
        item.unitPriceCents,
        item.quantity,
        item.unitPriceCents * item.quantity,
      )
      .run();
  }
}

async function seedProdukt(id: number, name: string, unit: string, sortOrder: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, 435, ?, 1, ?, ?5, ?5)`,
  )
    .bind(id, name, unit, sortOrder, NOW_ISO)
    .run();
}

/** Siehe admin-page.test.ts: Die Sitzung wird auf die ECHTE Uhr geprägt. */
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

async function alsAdmin(pfad: string): Promise<string> {
  return (await call(pfad, await anmelden('admin@example.test', PASSWORT))).text();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            email, phone,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf',
             'kontakt@testcafe.test', '+49 211 0000000',
             1, 'delivery', ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await seedProdukt(1, 'Beispiel Käsekuchen', 'Stück', 10);
  await seedProdukt(2, 'Beispiel Carrot Cake', 'Stück', 20);
  await seedProdukt(3, 'Beispiel Streuselblech', 'Blech', 30);

  await seedKonto(1, 'testcafe', 'customer', PIN);
  await seedKonto(2, 'admin@example.test', 'admin', PASSWORT);
});

describe('Zugriff', () => {
  it('lässt einen Admin die Produktionsansicht sehen', async () => {
    const response = await call(`/admin?date=${TAG}`, await anmelden('admin@example.test', PASSWORT));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('lehnt ein Café mit 403 ab und zeigt ihm keine Produktionsdaten', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const response = await call(`/admin?date=${TAG}`, await anmelden('testcafe', PIN));

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain('Beispiel Käsekuchen');
    expect(text).not.toContain('BUS-2026-000123');
  });

  it('schickt ohne Sitzung in den bestehenden Loginflow', async () => {
    const response = await call(`/admin?date=${TAG}`);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  /**
   * Die Rolle wird VOR dem Datum geprüft. Ein Café mit kaputtem Datum bekommt
   * 403 und nicht 400 — sonst waere die Fehlermeldung die Auskunft, dass es
   * hier eine Seite gibt und sie ein Datum will.
   */
  it('prüft die Rolle vor dem Datum', async () => {
    const response = await call('/admin?date=kein-datum', await anmelden('testcafe', PIN));
    expect(response.status).toBe(403);
  });
});

describe('Datum', () => {
  it('zeigt ohne date-Parameter den nächsten Kalendertag', async () => {
    const morgen = new Date();
    morgen.setUTCDate(morgen.getUTCDate() + 1);
    const erwartet = morgen.toISOString().slice(0, 10);

    const text = await alsAdmin('/admin');

    expect(text).toContain(`value="${erwartet}"`);
  });

  it('verwendet ein ausdrücklich genanntes Datum', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain(`value="${TAG}"`);
    expect(text).toContain('Dienstag, 15. September 2026');
  });

  it('lehnt einen Tag ab, den es nicht gibt', async () => {
    const response = await call('/admin?date=2026-02-30', await anmelden('admin@example.test', PASSWORT));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Diesen Tag gibt es nicht');
  });

  it('lehnt einen Wert ab, der kein Datum ist', async () => {
    for (const kaputt of ['gestern', '2026-13-01', '15.09.2026', '', 'null']) {
      const response = await call(
        `/admin?date=${encodeURIComponent(kaputt)}`,
        await anmelden('admin@example.test', PASSWORT),
      );
      expect(response.status).toBe(400);
    }
  });

  it('lehnt mehrfache date-Parameter ab, statt still den ersten zu nehmen', async () => {
    const response = await call(
      `/admin?date=${TAG}&date=2026-09-16`,
      await anmelden('admin@example.test', PASSWORT),
    );

    expect(response.status).toBe(400);
  });

  /**
   * KEIN STILLES ZURUECKFALLEN. Ein Lesezeichen mit Tippfehler darf keine
   * korrekt aussehende Backliste fuer einen anderen Tag zeigen.
   */
  it('fällt bei einem ungültigen Datum nicht still auf den Standardtag zurück', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const text = await alsAdmin('/admin?date=2026-02-30');

    expect(text).not.toContain('Beispiel Käsekuchen');
    expect(text).not.toContain('3 Stück');
  });

  /** Die Fehlerseite wiederholt den Wert aus der Adresszeile nicht. */
  it('spiegelt einen fehlerhaften Datumswert nicht zurück', async () => {
    const text = await alsAdmin('/admin?date=%3Cscript%3Ealert(1)%3C%2Fscript%3E');

    expect(text).not.toContain('<script>alert(1)</script>');
    expect(text).not.toContain('alert(1)');
  });
});

describe('Produktionsliste', () => {
  beforeEach(async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000001', customerName: 'Testcafé Nord',
      items: [
        { productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 8 },
        { productId: 3, name: 'Beispiel Streuselblech', unit: 'Blech', quantity: 2 },
      ],
    });
    await seedBestellung({
      id: 2, orderNumber: 'BUS-2026-000002', customerName: 'Testcafé Süd',
      status: 'new', fulfillmentType: 'pickup',
      items: [
        { productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 },
        { productId: 2, name: 'Beispiel Carrot Cake', unit: 'Stück', quantity: 5 },
      ],
    });
  });

  it('zeigt die produzierten Produkte', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Beispiel Käsekuchen');
    expect(text).toContain('Beispiel Carrot Cake');
    expect(text).toContain('Beispiel Streuselblech');
  });

  /** DIE ZAHLEN MUESSEN STIMMEN: 8 + 3 = 11 Kaesekuchen. */
  it('summiert die Mengen exakt', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toMatch(/Beispiel Käsekuchen[\s\S]*?>11<[\s\S]*?Stück/);
    expect(text).toMatch(/Beispiel Carrot Cake[\s\S]*?>5<[\s\S]*?Stück/);
    expect(text).toMatch(/Beispiel Streuselblech[\s\S]*?>2<[\s\S]*?Blech/);
  });

  it('zeigt die Einheit aus dem Snapshot und nennt nicht alles Stück', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text).toContain('Blech');
  });

  it('zeigt die Anzahl der Bestellungen', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text).toMatch(/>2<\/strong>\s*Bestellungen/);
  });

  it('zeigt die Gesamtzahl der Einheiten', async () => {
    // 8 + 2 + 3 + 5 = 18
    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text).toMatch(/>18<\/strong>\s*Einheiten/);
  });

  it('schreibt bei genau einer Bestellung die Einzahl', async () => {
    await env.DB.prepare('DELETE FROM order_items WHERE order_id = 2').run();
    await env.DB.prepare('DELETE FROM orders WHERE id = 2').run();

    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text).toMatch(/>1<\/strong>\s*Bestellung</);
  });
});

describe('Bestellungen', () => {
  beforeEach(async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      status: 'confirmed', fulfillmentType: 'delivery',
      note: 'Bitte vor 10 Uhr anliefern',
      items: [
        { productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 },
        { productId: 2, name: 'Beispiel Carrot Cake', unit: 'Stück', quantity: 2 },
      ],
    });
    await seedBestellung({
      id: 2, orderNumber: 'BUS-2026-000124', customerName: 'Testcafé Süd',
      status: 'in_production', fulfillmentType: 'pickup',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 4 }],
    });
  });

  it('zeigt jede Bestellung', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Bestellungen');
    expect(text.match(/<article class="bestellung">/g)).toHaveLength(2);
  });

  it('zeigt den Kundennamen', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Testcafé Nord');
    expect(text).toContain('Testcafé Süd');
  });

  it('zeigt die Bestellnummer', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('BUS-2026-000123');
    expect(text).toContain('BUS-2026-000124');
  });

  /**
   * SICHTBAR IST ALLES DEUTSCH. Seit Phase 4B steht der technische Statusname
   * an genau einer Stelle im Dokument: im Wert eines VERSTECKTEN Feldes, das
   * der Server gleich wieder liest. Deshalb wird hier gegen das Markup OHNE
   * die Eingabefelder geprüft — was ein Mensch liest, ist Deutsch, und was
   * die Maschine liest, ist es nicht.
   */
  it('zeigt den Status auf Deutsch', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);
    const sichtbar = text.replace(/<input[^>]*>/g, '');

    expect(text).toContain('Bestätigt');
    expect(text).toContain('In Produktion');
    expect(sichtbar).not.toContain('confirmed');
    expect(sichtbar).not.toContain('in_production');
  });

  it('zeigt eine Lieferung auf Deutsch', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Lieferung');
    expect(text).not.toContain('delivery');
  });

  it('zeigt eine Abholung auf Deutsch', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Abholung');
    expect(text).not.toContain('pickup');
  });

  it('zeigt die Positionen je Bestellung', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('3 Stück × Beispiel Käsekuchen');
    expect(text).toContain('2 Stück × Beispiel Carrot Cake');
    expect(text).toContain('4 Stück × Beispiel Käsekuchen');
  });

  it('zeigt eine vorhandene Notiz', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Hinweis');
    expect(text).toContain('Bitte vor 10 Uhr anliefern');
  });

  /** Genau ein Notizblock — die zweite Bestellung hat keine Notiz. */
  it('erzeugt ohne Notiz keinen leeren Notizblock', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text.match(/bestellung__notiz-titel/g)).toHaveLength(1);
  });

  it('erzeugt auch bei einer Notiz aus Leerraum keinen Notizblock', async () => {
    await env.DB.prepare(`UPDATE orders SET note = '   ' WHERE id = 2`).run();
    await env.DB.prepare(`UPDATE orders SET note = NULL WHERE id = 1`).run();

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('bestellung__notiz');
  });

  /**
   * Das Lesemodell filtert completed und cancelled ueber
   * OPEN_PRODUCTION_STATUSES. Taeuchten sie hier auf, waere das ein
   * Datenproblem — der Test haelt fest, dass sie es nicht tun.
   */
  it('zeigt abgeschlossene und stornierte Bestellungen nicht', async () => {
    await seedBestellung({
      id: 3, orderNumber: 'BUS-2026-000125', customerName: 'Testcafé Abgeschlossen',
      status: 'completed',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 99 }],
    });
    await seedBestellung({
      id: 4, orderNumber: 'BUS-2026-000126', customerName: 'Testcafé Storniert',
      status: 'cancelled',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 77 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('Testcafé Abgeschlossen');
    expect(text).not.toContain('Testcafé Storniert');
    expect(text).not.toContain('Abgeschlossen');
    expect(text).not.toContain('Storniert');
    expect(text).not.toContain('<span class="backliste__zahl">99</span>');
    expect(text).not.toContain('<span class="backliste__zahl">77</span>');
  });

  it('zeigt nur Bestellungen des angefragten Tages', async () => {
    await seedBestellung({
      id: 5, orderNumber: 'BUS-2026-000127', customerName: 'Testcafé Anderer Tag',
      day: '2026-09-16',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 42 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('Testcafé Anderer Tag');
    expect(text).not.toContain('42');
  });
});

describe('Leerer Tag', () => {
  it('erklärt einen Tag ohne offene Bestellungen verständlich', async () => {
    const response = await call('/admin?date=2026-09-20', await anmelden('admin@example.test', PASSWORT));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'Für diesen Tag sind keine offenen Bestellungen vorhanden.',
    );
  });

  it('lässt die Datumsnavigation auf einem leeren Tag vollständig bedienbar', async () => {
    const text = await alsAdmin('/admin?date=2026-09-20');

    expect(text).toContain('href="/admin?date=2026-09-19"');
    expect(text).toContain('href="/admin?date=2026-09-21"');
    expect(text).toContain('<form class="tagnav__formular" method="get" action="/admin">');
  });

  it('zeigt auf einem leeren Tag ehrliche Kennzahlen', async () => {
    const text = await alsAdmin('/admin?date=2026-09-20');

    expect(text).toMatch(/>0<\/strong>\s*Bestellungen/);
    expect(text).toMatch(/>0<\/strong>\s*Einheiten/);
  });

  it('rendert auf einem leeren Tag keinen Bestellabschnitt', async () => {
    const text = await alsAdmin('/admin?date=2026-09-20');

    expect(text).not.toContain('<article class="bestellung">');
    expect(text).not.toContain('titel-bestellungen');
  });
});

describe('Datensparsamkeit', () => {
  beforeEach(async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      note: 'Bitte vor 10 Uhr',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3, unitPriceCents: 435 }],
    });
  });

  /** DER TEST, DER DIE PHASE DEFINIERT: Produktion ist finanzfrei. */
  it('zeigt keine Preise', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['€', '4,35', '435', '13,05', '1305', 'unit_price', 'line_total', 'total_amount']) {
      expect(text).not.toContain(verboten);
    }
  });

  it('zeigt keine Kosten-, Umsatz- oder Margenbegriffe', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['Umsatz', 'Marge', 'Kosten', 'Wareneinsatz', 'Bestellwert', 'Rechnung']) {
      expect(text).not.toContain(verboten);
    }
  });

  it('zeigt keine E-Mail-Adresse des Cafés', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('kontakt@testcafe.test');
    expect(text).not.toContain('@testcafe');
  });

  it('zeigt keine Telefonnummer und keine Lieferadresse', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['+49 211', '0000000', 'Beispielweg', '40213', 'Düsseldorf']) {
      expect(text).not.toContain(verboten);
    }
  });

  it('zeigt keine Authentifizierungsdaten', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['credential', 'verifier', 'salt', 'pepper', 'PBKDF2', 'iterations']) {
      expect(text.toLowerCase()).not.toContain(verboten.toLowerCase());
    }
  });

  it('schreibt den Sitzungstoken nicht ins Dokument', async () => {
    const cookie = await anmelden('admin@example.test', PASSWORT);
    const token = cookie.split('=')[1] as string;

    const text = await (await call(`/admin?date=${TAG}`, cookie)).text();

    expect(text).not.toContain(token);
  });

  it('zeigt keine internen Kennungen', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['product_id', 'productId', 'customer_id', 'order_id', 'submission_id', 'data-product']) {
      expect(text).not.toContain(verboten);
    }
  });
});

describe('Transport und Härtung', () => {
  it('darf nirgends zwischengespeichert werden', async () => {
    const response = await call(`/admin?date=${TAG}`, await anmelden('admin@example.test', PASSWORT));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('setzt den Content-Type ausdrücklich', async () => {
    const response = await call(`/admin?date=${TAG}`, await anmelden('admin@example.test', PASSWORT));
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('behält die Sicherheitskopfzeilen aus Phase 3A vollständig', async () => {
    const response = await call(`/admin?date=${TAG}`, await anmelden('admin@example.test', PASSWORT));

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('trägt dieselben Kopfzeilen auch auf der Fehlerseite eines ungültigen Datums', async () => {
    const response = await call('/admin?date=kaputt', await anmelden('admin@example.test', PASSWORT));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('lädt nichts von fremden Hosts', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('//fonts.');
  });
});

describe('Bedienung ohne JavaScript', () => {
  it('lädt kein Skript', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('<script');
    expect(text).not.toContain('onclick');
    expect(text).not.toContain('javascript:');
  });

  it('verlinkt den vorherigen Kalendertag', async () => {
    const text = await alsAdmin('/admin?date=2026-09-15');
    expect(text).toContain('href="/admin?date=2026-09-14"');
  });

  it('verlinkt den nächsten Kalendertag', async () => {
    const text = await alsAdmin('/admin?date=2026-09-15');
    expect(text).toContain('href="/admin?date=2026-09-16"');
  });

  it('springt korrekt über den Monatswechsel', async () => {
    const text = await alsAdmin('/admin?date=2026-08-31');

    expect(text).toContain('href="/admin?date=2026-08-30"');
    expect(text).toContain('href="/admin?date=2026-09-01"');
  });

  it('springt korrekt über den Jahreswechsel', async () => {
    const text = await alsAdmin('/admin?date=2026-12-31');

    expect(text).toContain('href="/admin?date=2026-12-30"');
    expect(text).toContain('href="/admin?date=2027-01-01"');
  });

  it('kennt den 29. Februar eines Schaltjahres', async () => {
    const vorher = await alsAdmin('/admin?date=2028-02-28');
    expect(vorher).toContain('href="/admin?date=2028-02-29"');

    const schalttag = await alsAdmin('/admin?date=2028-02-29');
    expect(schalttag).toContain('href="/admin?date=2028-03-01"');
    expect(schalttag).toContain('href="/admin?date=2028-02-28"');
  });

  it('bietet die Datumswahl als echtes GET-Formular an', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('<form class="tagnav__formular" method="get" action="/admin">');
    expect(text).toContain('<label for="tagwahl">Tag wählen</label>');
    expect(text).toContain('name="date"');
    expect(text).toContain('type="date"');
  });

  /**
   * KEIN OPEN REDIRECT. Das Ziel des Formulars steht als Konstante im
   * Quelltext, und jeder erzeugte Link ist /admin?date= mit einem geprueften
   * Kalendertag. Ein fremder Host kann dort nicht landen.
   */
  it('erzeugt ausschließlich interne Ziele', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    const ziele = [...text.matchAll(/(?:href|action)="([^"]*)"/g)].map((treffer) => treffer[1] ?? '');
    expect(ziele.length).toBeGreaterThan(0);

    for (const ziel of ziele) {
      expect(ziel.startsWith('/')).toBe(true);
      expect(ziel.startsWith('//')).toBe(false);
    }
  });

  it('lässt sich mit einem fremden Ziel im date-Parameter nicht umlenken', async () => {
    for (const angriff of ['//angreifer.test', 'https://angreifer.test', '/admin?date=x']) {
      const response = await call(
        `/admin?date=${encodeURIComponent(angriff)}`,
        await anmelden('admin@example.test', PASSWORT),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).not.toContain('angreifer.test');
    }
  });

  it('bietet die Abmeldung als echtes POST-Formular mit CSRF-Token an', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('<form method="post" action="/logout"');
    expect(text).toContain('name="csrf_token"');
    expect(text).toContain('Abmelden');
  });
});

describe('Escaping', () => {
  it('escapet HTML im Kundennamen', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: '<b>Testcafé</b>',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('&lt;b&gt;Testcafé&lt;/b&gt;');
    expect(text).not.toContain('<b>Testcafé</b>');
  });

  it('escapet HTML im Produkt-Snapshot', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: '<i>Kuchen</i>', unit: '<u>Stück</u>', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('&lt;i&gt;Kuchen&lt;/i&gt;');
    expect(text).toContain('&lt;u&gt;Stück&lt;/u&gt;');
    expect(text).not.toContain('<i>Kuchen</i>');
  });

  it('escapet ein Skript in der Notiz', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      note: '<script>alert(1)</script>',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('<script');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapet ein Bild mit onerror in der Notiz', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      note: '<img src=x onerror=alert(1)>',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('<img');
    expect(text).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapet Ampersand, doppelte und einfache Anführungszeichen', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Müller & Söhne',
      note: `" onmouseover="alert(1)" 'x' & mehr`,
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Müller &amp; Söhne');
    expect(text).toContain('&quot;');
    expect(text).toContain('&#39;');
    expect(text).not.toContain('onmouseover="alert');
  });

  it('escapet eine bereits vorhandene HTML-Entity ein weiteres Mal', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      note: 'A &amp; B &lt;',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 1 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('A &amp;amp; B &amp;lt;');
  });
});

describe('Snapshot-Umbenennungsfall', () => {
  /**
   * Dieselbe Produkt-ID, zwei Bezeichnungen an einem Tag. Phase 3B fuehrt sie
   * bewusst nicht zusammen; die Seite muss den Fall verstaendlich machen,
   * ohne ihn wie einen Fehler aussehen zu lassen.
   */
  it('hält zwei Snapshot-Namen derselben Produkt-ID getrennt', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000001', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 11 }],
    });
    await seedBestellung({
      id: 2, orderNumber: 'BUS-2026-000002', customerName: 'Testcafé Süd',
      items: [{ productId: 1, name: 'Klassischer Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Beispiel Käsekuchen');
    expect(text).toContain('Klassischer Käsekuchen');
    expect(text).toMatch(/Beispiel Käsekuchen[\s\S]*?>11</);
    expect(text).toMatch(/Klassischer Käsekuchen[\s\S]*?>3</);

    // KEINE zusammengefasste Zeile mit 14. Geprueft wird die MENGENZELLE der
    // Backliste und nicht der ganze Text: 14 steht auf dieser Seite zu Recht
    // — als Gesamtzahl der Einheiten in den Kennzahlen. Falsch waere allein
    // eine Backlistenzeile, die beide Bezeichnungen zu einer Zahl verschmilzt.
    expect(text).not.toContain('<span class="backliste__zahl">14</span>');
    expect(text.match(/<span class="backliste__zahl">/g)).toHaveLength(2);
  });

  it('kennzeichnet den Fall verständlich', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000001', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 11 }],
    });
    await seedBestellung({
      id: 2, orderNumber: 'BUS-2026-000002', customerName: 'Testcafé Süd',
      items: [{ productId: 1, name: 'Klassischer Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Abweichende Bezeichnung aus einer Bestellung');
  });

  /** DIE GEGENPROBE: Zwei echte Produkte mit gleichem Namen sind kein Fall. */
  it('kennzeichnet zwei verschiedene Produkt-IDs mit gleichem Namen nicht', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000001', customerName: 'Testcafé Nord',
      items: [
        { productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 11 },
        { productId: 2, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 4 },
      ],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('Abweichende Bezeichnung');
    expect(text).toMatch(/>11</);
    expect(text).toMatch(/>4</);
  });

  /**
   * Der Snapshot bleibt der Snapshot: Eine Umbenennung in den Stammdaten
   * aendert eine Bestellung von letzter Woche nicht rueckwirkend.
   */
  it('ersetzt Snapshot-Namen nicht durch den aktuellen Produktnamen', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000001', customerName: 'Testcafé Nord',
      items: [{ productId: 1, name: 'Historische Bezeichnung', unit: 'Blech', quantity: 2 }],
    });

    await env.DB.prepare(`UPDATE products SET name = 'Ganz Neuer Name', unit = 'Kiste' WHERE id = 1`).run();

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('Historische Bezeichnung');
    expect(text).toContain('Blech');
    expect(text).not.toContain('Ganz Neuer Name');
    expect(text).not.toContain('Kiste');
  });
});

describe('Struktur und Zugänglichkeit', () => {
  beforeEach(async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord',
      note: 'Bitte vor 10 Uhr',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });
  });

  it('hat genau eine h1', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text.match(/<h1/g)).toHaveLength(1);
  });

  it('überspringt keine Überschriftenebene', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('<h1');
    expect(text).toContain('<h2');
    expect(text).toContain('<h3');
    expect(text).not.toContain('<h4');
  });

  it('setzt die Backliste als semantische Tabelle mit Kopfzellen', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('<table');
    expect(text).toContain('<th scope="col"');
    expect(text).toContain('<th scope="row"');
  });

  it('benennt die Datumspfeile mit ihrem Ziel', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('aria-label="Vorheriger Tag, Montag, 14. September 2026"');
    expect(text).toContain('aria-label="Nächster Tag, Mittwoch, 16. September 2026"');
  });

  it('verbindet das Datumsfeld mit einem echten Label', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('<label for="tagwahl">');
    expect(text).toContain('id="tagwahl"');
  });

  it('verbietet das Zoomen nicht', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('content="width=device-width, initial-scale=1"');
    expect(text).not.toContain('user-scalable=no');
    expect(text).not.toContain('maximum-scale');
  });

  it('gibt die Dokumentsprache an', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);
    expect(text).toContain('<html lang="de">');
  });

  it('baut keine Attrappen-Navigation', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    for (const verboten of ['Dashboard', 'Einstellungen', 'Auswertung', 'Analytics', 'Kunden verwalten']) {
      expect(text).not.toContain(verboten);
    }
  });

  /** READ ONLY: Das einzige veraendernde Formular ist die Abmeldung. */
  /**
   * PHASE 4B HAT DIESEN TEST GEÄNDERT, und zwar an einer einzigen Stelle: Es
   * gibt jetzt Formulare, die an die API senden — die Statuswechsel.
   *
   * Was unverändert ausgeschlossen bleibt, ist die BEARBEITUNG einer
   * Bestellung: kein Auswahlfeld mit allen Statuswerten, kein Textfeld, keine
   * Menge, kein Preis, kein Kunde. Die Probe darauf ist die Menge aller
   * Feldnamen des Dokuments — sie ist abgeschlossen und kurz.
   */
  it('bietet außer dem Statuswechsel kein Bedienelement zum Ändern an', async () => {
    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).not.toContain('<select');
    expect(text).not.toContain('<textarea');

    const ziele = [...text.matchAll(/action="(\/api[^"]*)"/g)].map((treffer) => treffer[1]);
    expect(ziele.length).toBeGreaterThan(0);
    for (const ziel of ziele) {
      expect(ziel).toMatch(/^\/api\/admin\/orders\/BUS-\d{4}-\d{6}\/status$/);
    }

    const felder = [
      ...new Set([...text.matchAll(/<input[^>]*name="([^"]+)"/g)].map((t) => t[1])),
    ].sort();
    expect(felder).toEqual(['csrf_token', 'date', 'status']);
  });
});

/**
 * DIE STATUSAKTIONEN AUF DER SEITE — Phase 4B, geprüft am ausgelieferten HTML.
 *
 * Die Ableitung selbst ist in tests/domain/production-day-view.test.ts gegen
 * canTransitionTo() geprüft. Hier geht es um die Frage danach: Kommt das, was
 * die Domäne erlaubt, tatsächlich bei einem angemeldeten Admin an — durch
 * Routing, Wache, Anwendungsfall, echte D1 und Renderer?
 */
describe('Statusaktionen', () => {
  async function karte(status: NonNullable<BestellungSeed['status']>): Promise<string> {
    await seedBestellung({
      id: 1,
      orderNumber: 'BUS-2026-000123',
      customerName: 'Testcafé Nord',
      status,
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });
    return alsAdmin(`/admin?date=${TAG}`);
  }

  it('bietet einer neuen Bestellung Bestätigen und Stornieren an', async () => {
    const text = await karte('new');

    expect(text).toContain('Bestätigen');
    expect(text).toContain('Stornieren');
    expect(text).toContain('value="confirmed"');
    expect(text).toContain('href="/admin/orders/BUS-2026-000123/cancel"');
    expect(text).not.toContain('value="cancelled"');
    expect(text).not.toContain('value="in_production"');
    expect(text).not.toContain('value="completed"');
  });

  it('bietet einer bestätigten Bestellung Produktion starten und Stornieren an', async () => {
    const text = await karte('confirmed');

    expect(text).toContain('Produktion starten');
    expect(text).toContain('Stornieren');
    expect(text).toContain('value="in_production"');
    expect(text).not.toContain('value="confirmed"');
    expect(text).not.toContain('value="completed"');
  });

  it('bietet einer laufenden Produktion Abschließen und Stornieren an', async () => {
    const text = await karte('in_production');

    expect(text).toContain('Abschließen');
    expect(text).toContain('Stornieren');
    expect(text).toContain('value="completed"');
    expect(text).not.toContain('value="in_production"');
  });

  it('schickt jedes Statusformular an die eigene Bestellung', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord', status: 'new',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });
    await seedBestellung({
      id: 2, orderNumber: 'BUS-2026-000124', customerName: 'Testcafé Süd', status: 'confirmed',
      items: [{ productId: 2, name: 'Beispiel Carrot Cake', unit: 'Stück', quantity: 2 }],
    });

    const text = await alsAdmin(`/admin?date=${TAG}`);

    expect(text).toContain('action="/api/admin/orders/BUS-2026-000123/status"');
    expect(text).toContain('action="/api/admin/orders/BUS-2026-000124/status"');
  });

  /**
   * Der Token im Formular ist der Token DIESER Sitzung — nicht irgendein
   * Wert, nicht der einer anderen Sitzung, nicht leer. Ohne diese Prüfung
   * bliebe der Test grün, während jeder Klick an der CSRF-Wache scheitert.
   */
  it('setzt den CSRF-Token der eigenen Sitzung in Abmeldung und Ein-Klick-Statusformular', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord', status: 'new',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const sitzung = await logIn(env.DB, CONFIG, {
      identifier: 'admin@example.test',
      secret: PASSWORT,
      now: new Date(),
      existingSessionToken: null,
    });
    if (sitzung === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');

    const text = await (
      await call(`/admin?date=${TAG}`, `buschmann_session_dev=${sitzung.token}`)
    ).text();

    const token = [...text.matchAll(/name="csrf_token" value="([^"]+)"/g)].map((t) => t[1]);
    expect(token.length).toBeGreaterThanOrEqual(2); // Abmeldung + normale Statusaktion
    for (const wert of token) {
      expect(wert).toBe(sitzung.csrfToken);
    }
  });

  it('bietet einer abgeschlossenen oder stornierten Bestellung nichts an', async () => {
    for (const status of ['completed', 'cancelled'] as const) {
      await env.DB.prepare(`DELETE FROM order_items`).run();
      await env.DB.prepare(`DELETE FROM orders`).run();
      const text = await karte(status);

      // Sie stehen gar nicht erst in der offenen Produktion …
      expect(text).not.toContain('BUS-2026-000123');
      // … und damit auch keine Schaltfläche zu ihnen.
      expect(text).not.toContain('/status"');
    }
  });

  /**
   * SICHTBARKEIT IST KEINE BERECHTIGUNG — aber ein Café darf die Seite
   * ohnehin nicht sehen, und damit auch keine Schaltfläche.
   */
  it('zeigt einem Café weder Seite noch Schaltflächen', async () => {
    await seedBestellung({
      id: 1, orderNumber: 'BUS-2026-000123', customerName: 'Testcafé Nord', status: 'new',
      items: [{ productId: 1, name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    });

    const response = await call(`/admin?date=${TAG}`, await anmelden('testcafe', PIN));
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(text).not.toContain('Bestätigen');
    expect(text).not.toContain('Stornieren');
    expect(text).not.toContain('/status');
  });

  /** Die Kernbedienung braucht kein Skript — die Seite trägt weiterhin keines. */
  it('kommt ohne JavaScript aus', async () => {
    const text = await karte('new');

    expect(text).not.toContain('<script');
    expect(text).not.toContain('onclick');
    expect(text).toContain('method="post"');
    expect(text).toContain('<button type="submit"');
  });

  it('stellt die Backliste weiterhin vor die Bestellkarten', async () => {
    const text = await karte('new');

    expect(text.indexOf('Zu produzieren')).toBeLessThan(text.indexOf('Bestellungen'));
    expect(text.indexOf('Zu produzieren')).toBeLessThan(text.indexOf('Bestätigen'));
  });
});
