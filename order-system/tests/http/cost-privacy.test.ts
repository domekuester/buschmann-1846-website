import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { businessDay, plusDays } from '../../src/domain/clock';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import {
  GASTRO,
  PRICING_TABLES,
  assignPriceGroup,
  priceProduct,
  resetPriceLists,
  setProductCost,
} from '../support/pricing';

/**
 * §11, §12 und §17 — DIE HERSTELLKOSTEN VERLASSEN DEN ADMINBEREICH NIE.
 *
 * Diese Datei ist die Probe darauf, und sie prüft nicht die Absicht, sondern
 * das AUSGELIEFERTE BYTE: Jede kundenseitige Antwort und jeder Ausdruck wird
 * nach dem Kostenwert durchsucht — nach der Zahl in Cent, nach ihrer
 * deutschen Schreibweise, nach dem Wort und nach jedem Feldnamen, unter dem
 * sie reisen könnte.
 *
 * DER KOSTENWERT IST DESHALB EINE ZAHL, DIE SONST NIRGENDS VORKOMMT: 771 Cent
 * (7,71 €). Er kann in keiner Antwort zufällig auftauchen, weder als Preis
 * noch als Menge noch als Summe.
 *
 * ALLE NAMEN, PREISE UND KOSTEN SIND FREI ERFUNDEN.
 */

const NOW = '2026-08-24T07:00:00.000Z';
const MORGEN = plusDays(businessDay(new Date()), 1);
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const PIN = '01234567';

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

/** Der Kostenwert, nach dem gefahndet wird. Kommt sonst nirgends vor. */
const KOSTEN_CENTS = 771;
const KATALOG_KAESE = 1001;

/** Jede Schreibweise, in der der Kostenwert entwischen könnte. */
const KOSTENSPUREN: readonly (string | RegExp)[] = [
  '771',
  '7,71',
  '7.71',
  'unit_cost',
  'unitCost',
  'cost_cents',
  'costCents',
  'unit_cost_cents',
  'unit_cost_cents_snapshot',
  'unitCostSnapshot',
  'Herstellkosten',
  /\bcost\b/i,
  /\bmargin\b/i,
  /\bmarge\b/i,
  /rohertrag/i,
];

function frei(text: string): void {
  for (const spur of KOSTENSPUREN) {
    expect(text).not.toMatch(spur instanceof RegExp ? spur : new RegExp(spur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

interface Sitzung {
  cookie: string;
  csrf: string;
}

async function anmelden(identifier: string): Promise<Sitzung> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier, secret: PIN, now: new Date(), existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error(`Anmeldung fehlgeschlagen: ${identifier}`);
  return { cookie: `__Host-buschmann_session=${ergebnis.token}`, csrf: ergebnis.csrfToken };
}

async function hole(pfad: string, sitzung: Sitzung): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${pfad}`, { headers: { cookie: sitzung.cookie } }),
    umgebung(),
  );
}

async function bestellen(sitzung: Sitzung): Promise<Response> {
  return worker.fetch(
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
        items: [{ product_id: 1, quantity: 3 }],
      }),
    }),
    umgebung(),
  );
}

const sitzung: Record<'kunde' | 'admin', Sitzung> = {
  kunde: { cookie: '', csrf: '' },
  admin: { cookie: '', csrf: '' },
};

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Fiktiver Käsekuchen', 'Frei erfunden', 99999, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW),
  ]);

  await priceProduct(env.DB, { productId: 1, gastro: 1000, privat: 1500 });
  await assignPriceGroup(env.DB, 1, GASTRO);
  await setProductCost(env.DB, KATALOG_KAESE, KOSTEN_CENTS);

  const credential = await deriveCredential(PIN, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (1, 'fiktivescafe', 'customer', 1, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1),
            (2, 'fiktiveradmin@example.test', 'admin', NULL, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
  ).bind(NOW, credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex)
    .run();

  sitzung.kunde = await anmelden('fiktivescafe');
  sitzung.admin = await anmelden('fiktiveradmin@example.test');
});

describe('Die Kosten sind wirklich gepflegt', () => {
  /**
   * DIE VORAUSSETZUNG ALLER ANDEREN TESTS DIESER DATEI. Ohne sie wären sie
   * grün, weil gar nichts zu leaken war.
   */
  it('steht in der Datenbank und landet im Snapshot der Bestellung', async () => {
    expect(await bestellen(sitzung.kunde)).toBeTruthy();

    const row = await env.DB.prepare(
      `SELECT cp.unit_cost_cents AS katalog, oi.unit_cost_cents_snapshot AS snapshot
         FROM catalog_products cp, order_items oi
        WHERE cp.id = ?`,
    ).bind(KATALOG_KAESE).first<{ katalog: number; snapshot: number }>();

    expect(row?.katalog).toBe(KOSTEN_CENTS);
    expect(row?.snapshot).toBe(KOSTEN_CENTS);
  });
});

describe('§17.16 — die Bestellseite des Cafés', () => {
  it('enthält die Herstellkosten nicht', async () => {
    const antwort = await hole('/bestellen', sitzung.kunde);
    expect(antwort.status).toBe(200);

    const html = await antwort.text();
    expect(html).toContain('10,00 €'); // der Gastropreis steht sehr wohl drin
    frei(html);
  });

  it('enthält sie auch nicht, nachdem bereits bestellt wurde', async () => {
    await bestellen(sitzung.kunde);
    frei(await (await hole('/bestellen', sitzung.kunde)).text());
  });
});

describe('§17.17 — die Bestellantwort', () => {
  it('enthält die Herstellkosten nicht', async () => {
    const antwort = await bestellen(sitzung.kunde);
    expect(antwort.status).toBe(201);

    const roh = JSON.stringify(await antwort.json());
    // Der VERKAUFSbetrag steht sehr wohl drin — 3 × 10,00 €.
    expect(roh).toContain('3000');
    frei(roh);
  });

  /** Auch die wiederholte Absendung derselben Bestellung sagt nichts. */
  it('enthält sie auch bei einer Wiederholung nicht', async () => {
    const kennung = `sub-${crypto.randomUUID()}`;
    const koerper = JSON.stringify({
      submission_id: kennung,
      fulfillment_date: MORGEN,
      items: [{ product_id: 1, quantity: 3 }],
    });
    const anfrage = () =>
      worker.fetch(
        new Request(`${ORIGIN}/api/orders`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: sitzung.kunde.cookie,
            'x-csrf-token': sitzung.kunde.csrf,
            origin: ORIGIN,
          },
          body: koerper,
        }),
        umgebung(),
      );

    await anfrage();
    frei(JSON.stringify(await (await anfrage()).json()));
  });

  it('enthält die Sitzungsauskunft keine Kosten', async () => {
    frei(await (await hole('/api/auth/session', sitzung.kunde)).text());
  });
});

describe('§17.18 — die Produktionsliste (6D bleibt unverändert)', () => {
  it('enthält die Herstellkosten nicht', async () => {
    await bestellen(sitzung.kunde);

    const antwort = await hole(`/admin/production-list?date=${MORGEN}`, sitzung.admin);
    expect(antwort.status).toBe(200);

    const html = await antwort.text();
    expect(html).toContain('Fiktiver Käsekuchen'); // die Mengenfrage wird beantwortet
    frei(html);
  });

  it('enthält auch die Produktionsansicht keine Kosten', async () => {
    await bestellen(sitzung.kunde);

    frei(await (await hole(`/admin?date=${MORGEN}`, sitzung.admin)).text());
    frei(await (await hole(`/api/admin/production-day?date=${MORGEN}`, sitzung.admin)).text());
  });
});

describe('§17.19 — die Abholliste (6E bleibt unverändert)', () => {
  it('enthält die Herstellkosten nicht', async () => {
    await bestellen(sitzung.kunde);

    const antwort = await hole(`/admin/abholliste?date=${MORGEN}`, sitzung.admin);
    expect(antwort.status).toBe(200);

    frei(await antwort.text());
  });
});

describe('§13 und §17.20 — Dashboard und öffentliche Antworten', () => {
  /** §13 — das Dashboard sieht in 7A identisch aus. Keine Kosten, keine Marge. */
  it('zeigt im Tagesüberblick keine Kosten', async () => {
    await bestellen(sitzung.kunde);
    frei(await (await hole(`/admin/dashboard?date=${MORGEN}`, sitzung.admin)).text());
  });

  it('zeigt in der Wochenübersicht keine Kosten', async () => {
    await bestellen(sitzung.kunde);
    frei(await (await hole(`/admin/dashboard?week=${MORGEN}`, sitzung.admin)).text());
  });

  it('nennt in den öffentlichen Antworten keine Kosten', async () => {
    for (const pfad of ['/api/health', '/login']) {
      const antwort = await worker.fetch(new Request(`${ORIGIN}${pfad}`), umgebung());
      frei(await antwort.text());
    }
  });

  /** Auch die Abweisung eines Cafés am Adminbereich sagt nichts. */
  it('verrät auch in einer Ablehnung nichts', async () => {
    frei(await (await hole('/admin/catalog', sitzung.kunde)).text());
    frei(await (await hole(`/admin/abholliste?date=${MORGEN}`, sitzung.kunde)).text());
  });
});

describe('§11 — die einzige Oberfläche, die die Kosten zeigt', () => {
  /**
   * DIE GEGENPROBE. Ohne sie könnte die ganze Datei grün sein, weil der Wert
   * nirgends gespeichert ist. Der Adminkatalog — und nur er — zeigt ihn.
   */
  it('ist der Adminkatalog', async () => {
    const antwort = await hole('/admin/catalog', sitzung.admin);
    expect(antwort.status).toBe(200);

    const html = await antwort.text();
    expect(html).toContain('Herstellkosten');
    expect(html).toContain('value="7,71"');
  });
});

describe('§10 — der Client kann keine Kosten liefern', () => {
  /**
   * MITGESCHICKTE KOSTENFELDER SIND KEINE AUTORITÄT. Der Server liest die
   * Herstellkosten ausschließlich aus D1; was im Anfragekörper steht, wird
   * nicht einmal gelesen.
   */
  it('ignoriert Kostenfelder im Bestellkörper', async () => {
    const antwort = await worker.fetch(
      new Request(`${ORIGIN}/api/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sitzung.kunde.cookie,
          'x-csrf-token': sitzung.kunde.csrf,
          origin: ORIGIN,
        },
        body: JSON.stringify({
          submission_id: `sub-${crypto.randomUUID()}`,
          fulfillment_date: MORGEN,
          items: [{
            product_id: 1,
            quantity: 3,
            unit_cost: 1,
            cost: 1,
            cost_cents: 1,
            unit_cost_cents: 1,
            unit_cost_cents_snapshot: 1,
            margin: 9999,
          }],
          unit_cost_cents: 1,
          margin: 9999,
        }),
      }),
      umgebung(),
    );

    expect(antwort.status).toBe(201);

    const row = await env.DB.prepare(
      'SELECT unit_cost_cents_snapshot AS wert, unit_price_cents FROM order_items',
    ).first<{ wert: number; unit_price_cents: number }>();

    // Der Wert aus D1 — nicht die 1 aus der Anfrage.
    expect(row?.wert).toBe(KOSTEN_CENTS);
    expect(row?.unit_price_cents).toBe(1000);
  });

  /**
   * UND OHNE GEPFLEGTE KOSTEN BLEIBT ES NULL, egal was der Client behauptet.
   * Ein Client, der sich seine eigenen Herstellkosten setzen könnte, wäre die
   * gefährlichere Variante desselben Fehlers.
   */
  it('erfindet aus einem Kostenfeld des Clients keinen Snapshot', async () => {
    await setProductCost(env.DB, KATALOG_KAESE, null);

    const antwort = await worker.fetch(
      new Request(`${ORIGIN}/api/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sitzung.kunde.cookie,
          'x-csrf-token': sitzung.kunde.csrf,
          origin: ORIGIN,
        },
        body: JSON.stringify({
          submission_id: `sub-${crypto.randomUUID()}`,
          fulfillment_date: MORGEN,
          items: [{ product_id: 1, quantity: 3, unit_cost: 500, unit_cost_cents: 500 }],
        }),
      }),
      umgebung(),
    );

    expect(antwort.status).toBe(201);

    const row = await env.DB.prepare(
      'SELECT unit_cost_cents_snapshot AS wert FROM order_items',
    ).first<{ wert: number | null }>();

    expect(row?.wert).toBeNull();
  });
});
