import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { GASTRO, PRIVAT, PRICING_TABLES, assignPriceGroup, resetPriceLists } from '../support/pricing';

/**
 * PHASE 5D TRIFFT PHASE 5C — §27 des Auftrags, und der eigentliche Beweis
 * dieser Phase.
 *
 * Die Frage ist nicht, ob eine Spalte geschrieben wird. Die Frage ist, ob das
 * Verknüpfen im Adminbereich EXAKT das bewirkt, was ein Buschmann-Mitarbeiter
 * davon erwartet: dass ein Produkt danach bestellbar ist — mit dem Preis SEINER
 * Preisliste — und nach dem Auflösen wieder nicht.
 *
 * Deshalb läuft hier alles durch den echten Worker: Der Admin klickt (POST auf
 * den Formularendpunkt), der Kunde bestellt (POST /api/orders), und geprüft
 * wird, was in der DATENBANK steht — nicht, was eine Antwort behauptet.
 *
 * 5D RECHNET DABEI SELBST NICHTS. Zwischen dem Klick des Admins und dem Preis
 * der Bestellung liegt ausschließlich der unveränderte Resolver aus 5C. Wäre
 * in 5D eine zweite Preislogik entstanden, müssten diese Tests sie zeigen.
 *
 * ALLE NAMEN UND PREISE SIND FREI ERFUNDEN.
 */

const NOW = '2026-08-25T07:00:00.000Z';
const MORGEN = '2026-08-26';
const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const PIN = '01234567';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };

/** Produkt-IDs des Testsortiments — alle starten UNVERKNÜPFT. */
const KAESEKUCHEN = 1;   // Katalog 7: gastro 1000 fest, privat 1500 fest
const OBSTTORTE = 2;     // Katalog 8: gastro „ab 5500" — nie direkt bestellbar
const BAUMKUCHEN = 3;    // Katalog 9: gar kein Preis in irgendeiner Liste

const KATALOG_KAESE = 7;
const KATALOG_OBST = 8;
const KATALOG_BAUM = 9;

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

interface Sitzung {
  readonly cookie: string;
  readonly csrf: string;
}

async function anmelden(identifier: string, secret: string): Promise<Sitzung> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error(`Anmeldung fehlgeschlagen: ${identifier}`);
  return { cookie: `buschmann_session_dev=${ergebnis.token}`, csrf: ergebnis.csrfToken };
}

/** Der Adminvorgang aus §10 und §9 — genau so, wie das Formular ihn schickt. */
async function verknuepfe(
  sitzung: Sitzung,
  productId: number,
  catalogProductId: number | null,
): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/admin/products/${productId}/catalog-link`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      cookie: sitzung.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrf_token: sitzung.csrf,
      catalog_product_id: catalogProductId === null ? '' : String(catalogProductId),
    }).toString(),
  }), umgebung());
}

async function bestellseite(sitzung: Sitzung): Promise<string> {
  const antwort = await worker.fetch(
    new Request(`${ORIGIN}/bestellen`, { headers: { cookie: sitzung.cookie } }),
    umgebung(),
  );
  expect(antwort.status).toBe(200);
  return antwort.text();
}

async function bestellen(
  sitzung: Sitzung,
  productId: number,
  quantity: number,
): Promise<{ status: number; body: any }> {
  const antwort = await worker.fetch(new Request(`${ORIGIN}/api/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sitzung.cookie,
      'x-csrf-token': sitzung.csrf,
      origin: ORIGIN,
    },
    body: JSON.stringify({
      submission_id: `sub-${crypto.randomUUID()}`,
      fulfillment_date: MORGEN,
      items: [{ product_id: productId, quantity }],
    }),
  }), umgebung());
  return { status: antwort.status, body: await antwort.json() };
}

async function positionen(orderNumber: string) {
  const { results } = await env.DB.prepare(
    `SELECT i.product_id, i.unit_price_cents, i.quantity, i.line_total_cents, o.total_amount_cents
       FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.order_number = ?`,
  ).bind(orderNumber).all<{
    product_id: number;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
    total_amount_cents: number;
  }>();
  return results;
}

async function anzahlBestellungen(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

const sitzungen: Record<'admin' | 'gastro' | 'privat', Sitzung> = {
  admin: { cookie: '', csrf: '' },
  gastro: { cookie: '', csrf: '' },
  privat: { cookie: '', csrf: '' },
};

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);

  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Gastro', 1, 'pickup', ?1, ?1),
            (2, 'Testkunde Privat', 1, 'pickup', ?1, ?1)`,
  ).bind(NOW).run();

  /**
   * products.price_cents steht auf 99999 — also 999,99 €. Verwendet
   * irgendjemand den alten Einheitspreis doch noch, ist das kein knapper
   * Unterschied, sondern ein Betrag, der in jeder Zusicherung auffällt.
   *
   * ALLE DREI PRODUKTE STARTEN UNVERKNÜPFT. Das ist der Ausgangszustand nach
   * Migration 0014 — und der Zustand, aus dem heraus dieser Test den
   * Adminvorgang auslöst.
   */
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at)
     VALUES (1, 'Beispiel Käsekuchen', 99999, 'Stück', 1, 10, NULL, ?1, ?1),
            (2, 'Beispiel Obsttorte',  99999, 'Torte', 1, 20, NULL, ?1, ?1),
            (3, 'Beispiel Baumkuchen', 99999, 'Stück', 1, 30, NULL, ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, variant, unit, is_active, sort_order, created_at, updated_at)
     VALUES (7, 'fixture:kaese', 'Fiktiver Käsekuchen', '26-cm-Ring', NULL, 1, 10, ?1, ?1),
            (8, 'fixture:obst',  'Fiktive Obsttorte',   NULL, 'Torte',  1, 20, ?1, ?1),
            (9, 'fixture:baum',  'Fiktiver Baumkuchen', NULL, 'Stück',  1, 30, ?1, ?1)`,
  ).bind(NOW).run();

  await env.DB.batch([
    // Käsekuchen: in BEIDEN Listen ein Festpreis — und zwar ein verschiedener.
    env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (7, ?2, 'fixed', 1000, ?1, ?1), (7, ?3, 'fixed', 1500, ?1, ?1)`,
    ).bind(NOW, GASTRO, PRIVAT),
    // Obsttorte: „ab 55,00 €" — eine Preisangabe, aber keine berechenbare Zahl.
    env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, min_price_cents, created_at, updated_at)
       VALUES (8, ?2, 'from', 5500, ?1, ?1)`,
    ).bind(NOW, GASTRO),
    // Baumkuchen: Katalogprodukt ohne jede Preiszeile — §14.
  ]);

  await assignPriceGroup(env.DB, 1, GASTRO);
  await assignPriceGroup(env.DB, 2, PRIVAT);

  const adminCred = await deriveCredential('fiktives-admin-passwort-123', PEPPER, { iterations: MIN_ITERATIONS });
  const kundeCred = await deriveCredential(PIN, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (1, 'admin@example.test', 'admin', NULL, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
  ).bind(NOW, adminCred.algorithm, adminCred.iterations, adminCred.saltHex, adminCred.verifierHex).run();
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (2, 'gastro', 'customer', 1, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1),
            (3, 'privat', 'customer', 2, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
  ).bind(NOW, kundeCred.algorithm, kundeCred.iterations, kundeCred.saltHex, kundeCred.verifierHex).run();

  sitzungen.admin = await anmelden('admin@example.test', 'fiktives-admin-passwort-123');
  sitzungen.gastro = await anmelden('gastro', PIN);
  sitzungen.privat = await anmelden('privat', PIN);
});

/** §27.31 — VOR dem Verknüpfen. */
describe('Unverknüpft — der Ausgangszustand nach 0014', () => {
  it('zeigt einem Gastrokunden keinen Preis und keinen Nullbetrag', async () => {
    const seite = await bestellseite(sitzungen.gastro);

    expect(seite).toContain('Beispiel Käsekuchen');
    expect(seite).toContain('Preis auf Anfrage');
    expect(seite).not.toContain('10,00 €');
    expect(seite).not.toContain('999,99 €');

    /**
     * „0,00 €" darf in KEINER Produktzeile stehen — §38 aus Phase 5C. Die
     * Warenkorbsumme eines leeren Korbs ist davon ausgenommen und trägt
     * deshalb ihr eigenes Datenattribut; die Zusicherung prüft alles außer
     * ihr, statt die ganze Seite freizugeben.
     */
    expect(seite.replace(/<strong data-summary-total>[^<]*<\/strong>/, ''))
      .not.toContain('0,00 €');
  });

  it('lässt ein unverknüpftes Produkt nicht bestellen und speichert nichts', async () => {
    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 2);

    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('items.0.product_id');
    expect(await anzahlBestellungen()).toBe(0);
  });
});

/** §27.32 und §27.33 — DAS HERZSTÜCK DIESER PHASE. */
describe('Nach dem Verknüpfen mit einem Festpreis', () => {
  it('macht das Produkt für den Gastrokunden zum exakten Gastropreis bestellbar', async () => {
    const zuordnung = await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    expect(zuordnung.status).toBe(303);

    const seite = await bestellseite(sitzungen.gastro);
    expect(seite).toContain('10,00 €');

    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 3);
    expect(antwort.status).toBe(201);

    const zeilen = await positionen(antwort.body.order_number);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.unit_price_cents).toBe(1000);
    expect(zeilen[0]?.line_total_cents).toBe(3000);
    expect(zeilen[0]?.total_amount_cents).toBe(3000);
  });

  /**
   * §27.33 — DIESELBE ZUORDNUNG, ZWEI KUNDEN, ZWEI PREISE.
   *
   * Der Admin hat GENAU EINE Verknüpfung gesetzt. Dass daraus für den einen
   * 10,00 € und für den anderen 15,00 € werden, ist ausschließlich das Werk
   * des 5C-Resolvers über die Preisliste des jeweiligen Kunden — in 5D steht
   * keine Zeile, die zwischen Kunden unterschiede.
   */
  it('gibt demselben Katalogprodukt für den Privatkunden den Privatpreis', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);

    const gastro = await bestellen(sitzungen.gastro, KAESEKUCHEN, 1);
    const privat = await bestellen(sitzungen.privat, KAESEKUCHEN, 1);

    expect((await positionen(gastro.body.order_number))[0]?.unit_price_cents).toBe(1000);
    expect((await positionen(privat.body.order_number))[0]?.unit_price_cents).toBe(1500);
  });

  it('übernimmt dabei nicht products.price_cents', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 1);

    expect((await positionen(antwort.body.order_number))[0]?.unit_price_cents).not.toBe(99999);
    const row = await env.DB.prepare('SELECT price_cents FROM products WHERE id = 1')
      .first<{ price_cents: number }>();
    expect(row?.price_cents).toBe(99999);
  });
});

/** §27.34 — DAS AUFLÖSEN, UND WAS ES NICHT ANFASST. */
describe('Nach dem Auflösen der Zuordnung', () => {
  it('ist das Produkt wieder nicht direkt bestellbar', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    expect((await bestellen(sitzungen.gastro, KAESEKUCHEN, 1)).status).toBe(201);

    const geloest = await verknuepfe(sitzungen.admin, KAESEKUCHEN, null);
    expect(geloest.status).toBe(303);

    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 1);
    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('items.0.product_id');
  });

  /**
   * DIE SNAPSHOT-INVARIANTE — die wichtigste Zusicherung dieser Datei.
   *
   * Eine bereits gespeicherte Bestellung ist eine kaufmännische Tatsache. Sie
   * darf sich nicht ändern, weil jemand im Backoffice eine Zuordnung auflöst
   * — sonst stimmte die Rechnung von gestern nach einem Klick von heute nicht
   * mehr.
   */
  it('lässt eine bereits gespeicherte Bestellung vollständig unverändert', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 4);
    expect(antwort.status).toBe(201);

    const bestellungVorher = (await env.DB.prepare('SELECT * FROM orders').all()).results;
    const positionenVorher = (await env.DB.prepare('SELECT * FROM order_items').all()).results;

    await verknuepfe(sitzungen.admin, KAESEKUCHEN, null);

    expect((await env.DB.prepare('SELECT * FROM orders').all()).results).toEqual(bestellungVorher);
    expect((await env.DB.prepare('SELECT * FROM order_items').all()).results).toEqual(positionenVorher);
    expect((await positionen(antwort.body.order_number))[0]?.unit_price_cents).toBe(1000);
  });

  it('lässt sie auch beim Umhängen auf ein anderes Katalogprodukt unverändert', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    const antwort = await bestellen(sitzungen.gastro, KAESEKUCHEN, 2);
    const positionenVorher = (await env.DB.prepare('SELECT * FROM order_items').all()).results;

    await verknuepfe(sitzungen.admin, KAESEKUCHEN, null);
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_OBST);

    expect((await env.DB.prepare('SELECT * FROM order_items').all()).results).toEqual(positionenVorher);
    expect((await positionen(antwort.body.order_number))[0]?.unit_price_cents).toBe(1000);
  });
});

/** §27.35 und §13 — MAPPING HEISST NICHT BESTELLBAR. */
describe('Verknüpfung auf eine nicht berechenbare Preisform', () => {
  it('macht ein „ab …"-Produkt NICHT direkt bestellbar', async () => {
    const zuordnung = await verknuepfe(sitzungen.admin, OBSTTORTE, KATALOG_OBST);
    expect(zuordnung.headers.get('location')).toContain('notice=saved');

    const antwort = await bestellen(sitzungen.gastro, OBSTTORTE, 1);
    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('items.0.product_id');
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('zeigt die quelltreue Preisform an, ohne daraus eine Zahl zu machen', async () => {
    await verknuepfe(sitzungen.admin, OBSTTORTE, KATALOG_OBST);
    const seite = await bestellseite(sitzungen.gastro);

    expect(seite).toContain('ab 55,00 €');
    // Jede Nennung des Betrags trägt das „ab" — die Untergrenze wird nirgends
    // zu einem Festpreis verkürzt.
    expect(seite.split('55,00 €').length - 1).toBe(seite.split('ab 55,00 €').length - 1);
    expect(seite.replace(/<strong data-summary-total>[^<]*<\/strong>/, ''))
      .not.toContain('0,00 €');
  });

  it('nennt in der Ablehnung keinen Betrag', async () => {
    await verknuepfe(sitzungen.admin, OBSTTORTE, KATALOG_OBST);
    const antwort = await bestellen(sitzungen.gastro, OBSTTORTE, 1);

    const meldung = JSON.stringify(antwort.body);
    expect(meldung).not.toContain('5500');
    expect(meldung).not.toContain('55,00');
  });
});

/** §27.36 und §14 — KEIN FALLBACK AUF IRGENDEINE ANDERE PREISLISTE. */
describe('Verknüpfung auf ein Katalogprodukt ohne Preis', () => {
  it('bleibt für beide Kunden unbepreist und nicht bestellbar', async () => {
    const zuordnung = await verknuepfe(sitzungen.admin, BAUMKUCHEN, KATALOG_BAUM);
    expect(zuordnung.headers.get('location')).toContain('notice=saved');

    for (const sitzung of [sitzungen.gastro, sitzungen.privat]) {
      const antwort = await bestellen(sitzung, BAUMKUCHEN, 1);
      expect(antwort.status).toBe(422);
      expect(antwort.body.errors).toHaveProperty('items.0.product_id');
    }
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('greift NICHT auf den Preis der anderen Preisliste zurück', async () => {
    // Der Baumkuchen bekommt einen Preis — aber nur in der Gastroliste.
    await env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (9, ?2, 'fixed', 2400, ?1, ?1)`,
    ).bind(NOW, GASTRO).run();
    await verknuepfe(sitzungen.admin, BAUMKUCHEN, KATALOG_BAUM);

    expect((await bestellen(sitzungen.gastro, BAUMKUCHEN, 1)).status).toBe(201);

    const privat = await bestellen(sitzungen.privat, BAUMKUCHEN, 1);
    expect(privat.status).toBe(422);
    expect(JSON.stringify(privat.body)).not.toContain('2400');
  });
});

/** §5 aus Sicht des Bestellflusses. */
describe('Ein Katalogprodukt gehört zu höchstens einem Bestellprodukt', () => {
  it('verhindert, dass zwei Produkte denselben Katalogpreis tragen', async () => {
    await verknuepfe(sitzungen.admin, KAESEKUCHEN, KATALOG_KAESE);
    const zweiter = await verknuepfe(sitzungen.admin, OBSTTORTE, KATALOG_KAESE);

    expect(zweiter.headers.get('location')).toContain('notice=catalog_product_taken');

    const antwort = await bestellen(sitzungen.gastro, OBSTTORTE, 1);
    expect(antwort.status).toBe(422);
  });
});
