import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import {
  GASTRO,
  PRIVAT,
  PRICING_TABLES,
  assignPriceGroup,
  changeCatalogPrice,
  deactivatePriceList,
  priceProduct,
  resetPriceLists,
} from '../support/pricing';

/**
 * PHASE 5C VON AUSSEN — durch den echten Worker, gegen eine echte D1.
 *
 * §27 und §28 des Auftrags. Die Domänentests belegen, dass der Resolver das
 * Richtige TUT; diese Datei belegt, dass zwei verschiedene angemeldete Kunden
 * am selben Endpunkt tatsächlich verschiedene Preise bekommen — und dass die
 * Manipulationen aus §17 und §23 an dieser Grenze nichts ausrichten.
 *
 * ALLE PREISE SIND FREI ERFUNDEN.
 */

const NOW = '2026-08-24T07:00:00.000Z';
const MORGEN = '2026-08-25';
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const PIN = '01234567';

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

/** Produkt-IDs des Testsortiments. */
const KAESEKUCHEN = 1;   // gastro 1000 / privat 1500 — der Kern von §27
const HOCHZEITSTORTE = 2; // gastro on_request / privat on_request
const OBSTTORTE = 3;      // gastro from 5500
const PETITFOURS = 4;     // gastro range 5500–7500
const BAUMKUCHEN = 5;     // gar nicht mit dem Katalog verknüpft

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

interface Sitzung {
  cookie: string;
  csrf: string;
}

async function anmelden(identifier: string): Promise<Sitzung> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret: PIN,
    now: new Date(),
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error(`Anmeldung fehlgeschlagen: ${identifier}`);
  return { cookie: `__Host-buschmann_session=${ergebnis.token}`, csrf: ergebnis.csrfToken };
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
  payload: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const antwort = await worker.fetch(
    new Request(`${ORIGIN}/api/orders`, {
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
        ...payload,
      }),
    }),
    umgebung(),
  );
  return { status: antwort.status, body: await antwort.json() };
}

/** Die gespeicherten Positionen einer Bestellung — aus der Datenbank, nicht aus der Antwort. */
async function gespeichert(orderNumber: string) {
  return env.DB.prepare(
    `SELECT o.order_number, o.total_amount_cents, o.customer_id,
            i.product_id, i.unit_price_cents, i.quantity, i.line_total_cents
       FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.order_number = ?
      ORDER BY i.product_id`,
  )
    .bind(orderNumber)
    .all<{
      order_number: string;
      total_amount_cents: number;
      customer_id: number;
      product_id: number;
      unit_price_cents: number;
      quantity: number;
      line_total_cents: number;
    }>();
}

async function anzahlBestellungen(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

const sitzungen: Record<'gastro' | 'privat' | 'ohne', Sitzung> = {
  gastro: { cookie: '', csrf: '' },
  privat: { cookie: '', csrf: '' },
  ohne: { cookie: '', csrf: '' },
};

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Testcafé Gastro', 1, 'pickup', ?1, ?1),
              (2, 'Testkunde Privat', 1, 'pickup', ?1, ?1),
              (3, 'Testkunde ohne Preisgruppe', 1, 'pickup', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen',    99999, 'Stück', 1, 10, ?1, ?1),
              (2, 'Beispiel Hochzeitstorte',99999, 'Torte', 1, 20, ?1, ?1),
              (3, 'Beispiel Obsttorte',     99999, 'Torte', 1, 30, ?1, ?1),
              (4, 'Beispiel Petits Fours',  99999, 'Platte',1, 40, ?1, ?1),
              (5, 'Beispiel Baumkuchen',    99999, 'Stück', 1, 50, ?1, ?1)`,
    ).bind(NOW),
  ]);

  /**
   * products.price_cents steht oben absichtlich auf 99999 — also 999,99 €.
   * Verwendet irgendjemand den alten Einheitspreis doch noch, ist das kein
   * knapper Unterschied, sondern ein Betrag, der in jeder Zusicherung auffällt.
   */
  await priceProduct(env.DB, { productId: KAESEKUCHEN, gastro: 1000, privat: 1500 });
  await priceProduct(env.DB, {
    productId: HOCHZEITSTORTE,
    gastro: { type: 'on_request' },
    privat: { type: 'on_request' },
  });
  await priceProduct(env.DB, {
    productId: OBSTTORTE,
    gastro: { type: 'from', minPriceCents: 5500 },
    privat: { type: 'from', minPriceCents: 6900 },
  });
  await priceProduct(env.DB, {
    productId: PETITFOURS,
    gastro: { type: 'range', minPriceCents: 5500, maxPriceCents: 7500 },
  });
  // BAUMKUCHEN bleibt ohne Katalogbezug — priceProduct wird für ihn nicht gerufen.

  await assignPriceGroup(env.DB, 1, GASTRO);
  await assignPriceGroup(env.DB, 2, PRIVAT);
  await assignPriceGroup(env.DB, 3, null);

  const credential = await deriveCredential(PIN, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (1, 'gastro', 'customer', 1, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1),
            (2, 'privat', 'customer', 2, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1),
            (3, 'ohne',   'customer', 3, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
  )
    .bind(NOW, credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex)
    .run();

  sitzungen.gastro = await anmelden('gastro');
  sitzungen.privat = await anmelden('privat');
  sitzungen.ohne = await anmelden('ohne');
});

/**
 * §27 DES AUFTRAGS — DER ZENTRALE TEST.
 *
 * Zwei Kunden, dasselbe Produkt, zwei Preise. Beide bestellen über denselben
 * Endpunkt mit demselben Anfragekörper; der einzige Unterschied ist, wer
 * angemeldet ist.
 */
describe('Zwei Kunden, dasselbe Produkt, zwei Preise', () => {
  it('zeigt dem Gastrokunden 10,00 € und dem Privatkunden 15,00 €', async () => {
    const gastroSeite = await bestellseite(sitzungen.gastro);
    const privatSeite = await bestellseite(sitzungen.privat);

    expect(gastroSeite).toContain('10,00 €');
    expect(gastroSeite).not.toContain('15,00 €');

    expect(privatSeite).toContain('15,00 €');
    expect(privatSeite).not.toContain('10,00 €');
  });

  it('speichert für jeden Kunden den Preis SEINER Preisliste', async () => {
    const gastro = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 2 }],
    });
    const privat = await bestellen(sitzungen.privat, {
      items: [{ product_id: KAESEKUCHEN, quantity: 2 }],
    });

    expect(gastro.status).toBe(201);
    expect(privat.status).toBe(201);

    const g = await gespeichert(gastro.body.order_number);
    const p = await gespeichert(privat.body.order_number);

    expect(g.results[0]).toMatchObject({
      customer_id: 1,
      unit_price_cents: 1000,
      quantity: 2,
      line_total_cents: 2000,
      total_amount_cents: 2000,
    });
    expect(p.results[0]).toMatchObject({
      customer_id: 2,
      unit_price_cents: 1500,
      quantity: 2,
      line_total_cents: 3000,
      total_amount_cents: 3000,
    });
  });

  it('nennt in der Antwort den tatsächlich gespeicherten Serverpreis', async () => {
    const gastro = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 3 }],
    });

    expect(gastro.body.total_cents).toBe(3000);

    const gespeicherteSumme = await env.DB.prepare(
      'SELECT total_amount_cents FROM orders WHERE order_number = ?',
    )
      .bind(gastro.body.order_number)
      .first<{ total_amount_cents: number }>();

    expect(gastro.body.total_cents).toBe(gespeicherteSumme?.total_amount_cents);
  });

  /**
   * §12 UND §25/§26 DER TESTMATRIX: Beide Bestellungen bleiben stehen, was
   * sie waren — auch nachdem beide Katalogpreise geändert und beide Kunden
   * umgruppiert wurden.
   */
  it('lässt beide Bestellungen von späteren Preis- und Gruppenänderungen unberührt', async () => {
    const gastro = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });
    const privat = await bestellen(sitzungen.privat, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    const katalogId = 1000 + KAESEKUCHEN;
    await changeCatalogPrice(env.DB, katalogId, GASTRO, 9900);
    await changeCatalogPrice(env.DB, katalogId, PRIVAT, 100);
    await assignPriceGroup(env.DB, 1, PRIVAT);
    await assignPriceGroup(env.DB, 2, GASTRO);

    expect((await gespeichert(gastro.body.order_number)).results[0]).toMatchObject({
      unit_price_cents: 1000,
      total_amount_cents: 1000,
    });
    expect((await gespeichert(privat.body.order_number)).results[0]).toMatchObject({
      unit_price_cents: 1500,
      total_amount_cents: 1500,
    });
  });

  /** §14: Der Server rechnet beim SCHREIBEN, nicht beim Rendern. */
  it('nimmt beim Absenden den inzwischen geänderten Preis, nicht den angezeigten', async () => {
    const seite = await bestellseite(sitzungen.gastro);
    expect(seite).toContain('10,00 €');

    await changeCatalogPrice(env.DB, 1000 + KAESEKUCHEN, GASTRO, 1200);

    const bestellung = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(bestellung.body.total_cents).toBe(1200);
    expect((await gespeichert(bestellung.body.order_number)).results[0]?.unit_price_cents).toBe(1200);
  });
});

/**
 * §16 / §30 / §31 DER TESTMATRIX: Die Trennung der Preiswelten ist
 * vollständig — auch in dem, was NICHT auf der Seite steht.
 */
describe('Preiswelten bleiben getrennt', () => {
  it('zeigt dem Gastrokunden nirgends einen Privatpreis', async () => {
    const html = await bestellseite(sitzungen.gastro);

    // Die Privatpreise des Sortiments: 15,00 € und ab 69,00 €.
    expect(html).not.toContain('15,00');
    expect(html).not.toContain('69,00');
  });

  it('zeigt dem Privatkunden nirgends einen Gastropreis', async () => {
    const html = await bestellseite(sitzungen.privat);

    expect(html).not.toContain('10,00');
    expect(html).not.toContain('55,00');
  });

  it('nennt weder Preislisten-ID noch Preislistencode noch interne Spaltennamen', async () => {
    const html = await bestellseite(sitzungen.gastro);

    for (const intern of [
      'price_list', 'priceListId', 'catalog_product', 'price_type',
      'min_price_cents', 'gastro', 'private',
    ]) {
      expect(html).not.toContain(intern);
    }
  });

  it('zeigt einem Privatkunden ein nur in der Gastroliste bepreistes Produkt als nicht bestellbar', async () => {
    const html = await bestellseite(sitzungen.privat);

    // Petits Fours haben nur einen Gastropreis.
    expect(html).toContain('Beispiel Petits Fours');
    expect(html).not.toContain('55,00–75,00 €');
  });
});

/**
 * §28 DES AUFTRAGS: NICHT-FESTPREISE.
 *
 * Sichtbar ja, bestellbar nein — und zwar auch dann nicht, wenn jemand die
 * Position von Hand in den Anfragekörper schreibt. Die Oberfläche bietet die
 * Mengenauswahl gar nicht erst an; das ist Bedienbarkeit. Die Ablehnung hier
 * ist die Sicherheit.
 */
describe('Nicht-Festpreise sind sichtbar, aber nicht bestellbar', () => {
  it('zeigt „ab …", eine Spanne und „Auf Anfrage" quelltreu', async () => {
    const html = await bestellseite(sitzungen.gastro);

    expect(html).toContain('ab 55,00 €');
    expect(html).toContain('55,00–75,00 €');
    expect(html).toContain('Auf Anfrage');
  });

  it('bietet für sie keine Mengenauswahl an', async () => {
    const html = await bestellseite(sitzungen.gastro);

    // Fünf Produkte, aber nur der Käsekuchen hat einen Festpreis.
    expect(html.match(/data-quantity/g)).toHaveLength(1);
    expect(html.match(/data-unorderable/g)).toHaveLength(4);
  });

  for (const [name, productId] of [
    ['„ab …"', OBSTTORTE],
    ['eine Preisspanne', PETITFOURS],
    ['„Auf Anfrage"', HOCHZEITSTORTE],
    ['ein unverknüpftes Produkt', BAUMKUCHEN],
  ] as const) {
    it(`lehnt eine direkte API-Bestellung über ${name} ab und speichert nichts`, async () => {
      const antwort = await bestellen(sitzungen.gastro, {
        items: [{ product_id: productId, quantity: 2 }],
      });

      expect(antwort.status).toBe(422);
      expect(antwort.body.error).toBe('validation_failed');
      expect(antwort.body.errors).toHaveProperty('items.0.product_id');

      expect(await anzahlBestellungen()).toBe(0);
      const positionen = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items').first<{ n: number }>();
      expect(positionen?.n).toBe(0);
    });
  }

  it('nennt in der Ablehnung keinen Betrag aus der Preisangabe', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [{ product_id: OBSTTORTE, quantity: 1 }],
    });

    const meldung = JSON.stringify(antwort.body);
    expect(meldung).not.toContain('5500');
    expect(meldung).not.toContain('55,00');
  });

  /**
   * §30 DES AUFTRAGS: KEINE HALBE BESTELLUNG.
   *
   * Vier gültige Positionen und eine ungültige ergeben KEINE Bestellung mit
   * vier Positionen — und auch keine leere Hülle.
   */
  it('speichert eine gemischte Bestellung gar nicht, statt sie zu beschneiden', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [
        { product_id: KAESEKUCHEN, quantity: 4 },
        { product_id: HOCHZEITSTORTE, quantity: 1 },
      ],
    });

    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('items.1.product_id');
    expect(antwort.body.errors).not.toHaveProperty('items.0.product_id');

    expect(await anzahlBestellungen()).toBe(0);
  });
});

/**
 * §8, §9 UND §21 DER TESTMATRIX: Kunden ohne nutzbare Preiswelt.
 */
describe('Kunde ohne Preisgruppe', () => {
  it('darf sich anmelden und die Seite sehen — nur nicht bestellen', async () => {
    const html = await bestellseite(sitzungen.ohne);

    expect(html).toContain('Testkunde ohne Preisgruppe');
    expect(html).toContain('data-price-group-notice');
    expect(html).toContain('Buschmann 1846');
  });

  it('bekommt kein einziges Preisschild und keine Mengenauswahl', async () => {
    const html = await bestellseite(sitzungen.ohne);

    expect(html).not.toContain('data-quantity');
    expect(html).not.toContain('10,00 €');
    expect(html).not.toContain('15,00 €');
    // §38: erst recht nicht als Nullpreis.
    expect(html).not.toContain('0,00 € /');
  });

  it('wird bei einer direkten API-Bestellung abgewiesen', async () => {
    const antwort = await bestellen(sitzungen.ohne, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('price_list');
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('bekommt KEINEN Gastro- und KEINEN Privatpreis untergeschoben', async () => {
    const antwort = await bestellen(sitzungen.ohne, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(antwort.status).toBe(422);
    expect(JSON.stringify(antwort.body)).not.toContain('1000');
    expect(JSON.stringify(antwort.body)).not.toContain('1500');
  });
});

describe('Kunde mit stillgelegter Preisgruppe', () => {
  beforeEach(async () => {
    await deactivatePriceList(env.DB, GASTRO);
  });

  it('fällt NICHT auf die Privatpreisliste zurück', async () => {
    const html = await bestellseite(sitzungen.gastro);

    expect(html).toContain('data-price-group-notice');
    expect(html).not.toContain('15,00 €');
    expect(html).not.toContain('10,00 €');
  });

  it('kann auch direkt über die API nicht bestellen', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(antwort.status).toBe(422);
    expect(antwort.body.errors).toHaveProperty('price_list');
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('lässt den Privatkunden unbehelligt weiterbestellen', async () => {
    const antwort = await bestellen(sitzungen.privat, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(antwort.status).toBe(201);
    expect(antwort.body.total_cents).toBe(1500);
  });

  /**
   * Die Zuordnung selbst bleibt bestehen — sie ist eine kaufmännische
   * Entscheidung und wird nicht still aufgelöst (siehe 0013).
   */
  it('löst die bestehende Zuordnung nicht auf', async () => {
    await bestellseite(sitzungen.gastro);

    const row = await env.DB.prepare('SELECT price_list_id FROM customers WHERE id = 1').first<{
      price_list_id: number | null;
    }>();
    expect(row?.price_list_id).toBe(GASTRO);
  });
});

/**
 * §17, §18 UND §23 DES AUFTRAGS: DER SERVER IST DIE EINZIGE PREISAUTORITÄT.
 *
 * Jeder dieser Tests schickt eine vollständig gültige Bestellung UND einen
 * Manipulationsversuch im selben Körper. Erwartet wird nicht etwa eine
 * Ablehnung, sondern eine ganz normale Bestellung zum RICHTIGEN Preis: Die
 * Felder werden nicht verworfen, sie werden nie gelesen.
 */
describe('Der Client bestimmt keinen Preis', () => {
  async function trotzManipulation(extra: Record<string, unknown>) {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 2, ...(extra['items_extra'] as object ?? {}) }],
      ...extra,
    });
    expect(antwort.status).toBe(201);
    return (await gespeichert(antwort.body.order_number)).results[0];
  }

  it('ignoriert einen mitgesendeten Einzelpreis', async () => {
    const row = await trotzManipulation({ items_extra: { unit_price_cents: 1 } });
    expect(row).toMatchObject({ unit_price_cents: 1000, line_total_cents: 2000 });
  });

  it('ignoriert einen mitgesendeten Positionsbetrag', async () => {
    const row = await trotzManipulation({ items_extra: { line_total_cents: 3 } });
    expect(row?.line_total_cents).toBe(2000);
  });

  it('ignoriert eine mitgesendete Bestellsumme', async () => {
    const row = await trotzManipulation({ total_amount_cents: 1, total: '0.01' });
    expect(row?.total_amount_cents).toBe(2000);
  });

  it('ignoriert eine mitgesendete Preislisten-ID', async () => {
    const row = await trotzManipulation({ price_list_id: PRIVAT, price_list: 'private' });
    expect(row?.unit_price_cents).toBe(1000);
  });

  it('ignoriert eine mitgesendete Kunden-ID', async () => {
    const row = await trotzManipulation({ customer_id: 2 });
    expect(row).toMatchObject({ customer_id: 1, unit_price_cents: 1000 });
  });

  it('ignoriert eine mitgesendete Rolle', async () => {
    const row = await trotzManipulation({ role: 'admin' });
    expect(row?.unit_price_cents).toBe(1000);
  });

  it('ignoriert einen mitgesendeten Preistyp', async () => {
    const row = await trotzManipulation({ price_type: 'fixed', items_extra: { price_type: 'fixed' } });
    expect(row?.unit_price_cents).toBe(1000);
  });

  it('macht aus einem „fixed" im Körper keinen Festpreis für ein on-request-Produkt', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [
        { product_id: HOCHZEITSTORTE, quantity: 1, price_type: 'fixed', unit_price_cents: 5000 },
      ],
    });

    expect(antwort.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  /**
   * Der Kunde kommt aus der SITZUNG. Ein Gastrokunde, der die Kunden-ID des
   * Privatkunden mitschickt, bestellt weiterhin für sich selbst und zu
   * seinen Preisen — es gibt keinen Parameter, über den er die fremde
   * Preisliste erreichen könnte.
   */
  it('lässt einen Kunden die Preisliste eines anderen nicht wählen', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      customer_id: 2,
      price_list_id: PRIVAT,
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    });

    expect(antwort.status).toBe(201);
    const row = (await gespeichert(antwort.body.order_number)).results[0];
    expect(row).toMatchObject({ customer_id: 1, unit_price_cents: 1000 });
  });
});

/**
 * §13 UND §28 DER TESTMATRIX: Die Idempotenz aus Phase 2 bleibt intakt — und
 * eine wiederholte Absendung rechnet nicht zu einem inzwischen geänderten
 * Preis neu.
 */
describe('Idempotenz mit Preisen', () => {
  it('erzeugt bei derselben Absendekennung keine zweite Bestellung', async () => {
    const submissionId = `sub-${crypto.randomUUID()}`;
    const koerper = {
      submission_id: submissionId,
      fulfillment_date: MORGEN,
      items: [{ product_id: KAESEKUCHEN, quantity: 2 }],
    };

    const erste = await bestellen(sitzungen.gastro, koerper);
    const zweite = await bestellen(sitzungen.gastro, koerper);

    expect(erste.status).toBe(201);
    expect(zweite.status).toBe(200);
    expect(zweite.body.order_number).toBe(erste.body.order_number);
    expect(await anzahlBestellungen()).toBe(1);
  });

  it('rechnet eine Wiederholung NICHT zum inzwischen geänderten Preis neu', async () => {
    const submissionId = `sub-${crypto.randomUUID()}`;
    const koerper = {
      submission_id: submissionId,
      fulfillment_date: MORGEN,
      items: [{ product_id: KAESEKUCHEN, quantity: 2 }],
    };

    const erste = await bestellen(sitzungen.gastro, koerper);
    await changeCatalogPrice(env.DB, 1000 + KAESEKUCHEN, GASTRO, 9900);
    const zweite = await bestellen(sitzungen.gastro, koerper);

    expect(zweite.body.total_cents).toBe(2000);
    expect(zweite.body.order_number).toBe(erste.body.order_number);
    expect((await gespeichert(erste.body.order_number)).results[0]?.unit_price_cents).toBe(1000);
  });

  it('verbraucht keine zweite Bestellnummer', async () => {
    const submissionId = `sub-${crypto.randomUUID()}`;
    const koerper = {
      submission_id: submissionId,
      fulfillment_date: MORGEN,
      items: [{ product_id: KAESEKUCHEN, quantity: 1 }],
    };

    await bestellen(sitzungen.gastro, koerper);
    await bestellen(sitzungen.gastro, koerper);

    const row = await env.DB.prepare(
      'SELECT next_value FROM order_number_sequences WHERE year = 2026',
    ).first<{ next_value: number }>();
    /**
     * next_value hält die ZULETZT VERGEBENE Nummer (siehe
     * order-number-sequence.ts: RETURNING next_value nach dem Hochzählen).
     * Nach einer Bestellung steht dort deshalb 1 — und nach der Wiederholung
     * immer noch, weil sie keine zweite Nummer zieht.
     */
    expect(row?.next_value).toBe(1);
  });
});

/**
 * §31: Menge mal Preis darf nicht still überlaufen.
 */
describe('Mengen und Beträge', () => {
  it('lehnt eine unplausibel hohe Menge ab, ohne etwas zu speichern', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 1_000_000 }],
    });

    expect(antwort.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('rechnet an der zulässigen Mengenobergrenze exakt', async () => {
    const antwort = await bestellen(sitzungen.gastro, {
      items: [{ product_id: KAESEKUCHEN, quantity: 9999 }],
    });

    expect(antwort.status).toBe(201);
    expect(antwort.body.total_cents).toBe(9999 * 1000);

    const row = (await gespeichert(antwort.body.order_number)).results[0];
    expect(row?.line_total_cents).toBe(9999 * 1000);
    expect(row?.total_amount_cents).toBe(9999 * 1000);
  });
});
