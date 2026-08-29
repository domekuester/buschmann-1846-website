import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { businessDay, plusDays, weekdayIndex } from '../../src/domain/clock';
import { WEEKDAY_KEYS, type OrderPolicy } from '../../src/domain/order-policy';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { saveOrderPolicy } from '../../src/infrastructure/d1/order-policy-repository';
import { GASTRO, PRICING_TABLES, assignPriceGroup, priceProduct, resetPriceLists } from '../support/pricing';

/**
 * DER SERVER IST DIE AUTORITÄT — geprüft an der HTTP-Grenze.
 *
 * Diese Datei stellt genau eine Frage, immer wieder: Kommt trotz der Regel
 * eine Bestellung in die Datenbank? Sie prüft deshalb nach jeder Ablehnung
 * die Anzahl der Zeilen in `orders` und nicht bloß den Statuscode — eine
 * abweisende Antwort, hinter der trotzdem geschrieben wurde, wäre der
 * schlimmste denkbare Ausgang und der am schwersten zu bemerkende.
 *
 * DIE UHR IST HIER DIE ECHTE. Der Worker bekommt keinen Zeitpunkt übergeben;
 * er ruft `new Date()`. Alle Tage dieser Datei werden deshalb ZUR LAUFZEIT
 * aus businessDay(new Date()) gerechnet und nicht fest hingeschrieben — ein
 * hart codiertes '2026-08-25' wäre morgen rot, und zwar aus einem Grund, der
 * mit der Sache nichts zu tun hat.
 *
 * DIE REGELN SIND SO GEWÄHLT, DASS SIE ZU JEDER TAGESZEIT GELTEN:
 *
 *   „Bestellschluss vorbei" wird mit 30 Tagen Vorlauf auf MORGEN erzeugt —
 *   der Schluss lag dann vor 29 Tagen, egal wie spät es gerade ist.
 *
 *   „noch offen" wird mit einem Tag Vorlauf auf ÜBERMORGEN und 23:59 Uhr
 *   erzeugt — der Schluss liegt dann frühestens morgen um 23:59.
 */

const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-24T07:00:00.000Z';
const PIN = '01234567';
const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

const HEUTE = businessDay(new Date());
const MORGEN = plusDays(HEUTE, 1);
const UEBERMORGEN = plusDays(HEUTE, 2);

const ALLE_TAGE: OrderPolicy['weekdays'] = [true, true, true, true, true, true, true];

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

const sitzung = { cookie: '', csrf: '' };

async function anmelden(identifier: string, secret: string): Promise<{ cookie: string; csrf: string }> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error('Anmeldung im Testaufbau fehlgeschlagen');
  return { cookie: `__Host-buschmann_session=${ergebnis.token}`, csrf: ergebnis.csrfToken };
}

async function post(payload: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sitzung.cookie,
      'x-csrf-token': sitzung.csrf,
      origin: ORIGIN,
      ...extra,
    },
    body: JSON.stringify(payload),
  }), umgebung());
}

function bestellung(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submission_id: `sub-${crypto.randomUUID()}`,
    fulfillment_date: MORGEN,
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
}

async function anzahlBestellungen(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

async function fehler(response: Response): Promise<Record<string, string>> {
  const koerper = await response.json<{ errors?: Record<string, string> }>();
  return koerper.errors ?? {};
}

/** Alle Wochentage außer dem des genannten Tages. */
function ohneWochentagVon(tag: string): OrderPolicy['weekdays'] {
  const flags = [true, true, true, true, true, true, true];
  flags[weekdayIndex(tag)] = false;
  return flags as unknown as OrderPolicy['weekdays'];
}

async function regel(overrides: Partial<OrderPolicy>): Promise<void> {
  await saveOrderPolicy(
    env.DB,
    { weekdays: ALLE_TAGE, cutoffEnabled: false, leadDays: 1, cutoffTime: '12:00', ...overrides },
    new Date(),
  );
}

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare('DELETE FROM order_policy').run();
  await env.DB.prepare('INSERT INTO order_policy (id) VALUES (1)').run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 1, 'pickup', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW),
  ]);

  await resetPriceLists(env.DB);
  await priceProduct(env.DB, { productId: 1, gastro: 435, privat: 520 });
  await assignPriceGroup(env.DB, 1, GASTRO);

  const credential = await deriveCredential(PIN, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (1, 'testcafe', 'customer', 1, ?2, ?3, ?4, ?5, 1, 0, ?1, ?1)`,
  ).bind(NOW, credential.algorithm, credential.iterations, credential.saltHex, credential.verifierHex).run();

  Object.assign(sitzung, await anmelden('testcafe', PIN));
});

describe('Voreinstellung — das bisherige Verhalten bleibt', () => {
  /** §19.25 */
  it('nimmt eine Bestellung für morgen an', async () => {
    const response = await post(bestellung());

    expect(response.status).toBe(201);
    expect(await anzahlBestellungen()).toBe(1);
  });

  it('nimmt sie auch für einen Sonntag in zwei Wochen an', async () => {
    const response = await post(bestellung({ fulfillment_date: plusDays(HEUTE, 14) }));

    expect(response.status).toBe(201);
    expect(await anzahlBestellungen()).toBe(1);
  });
});

describe('Abgeschalteter Wochentag', () => {
  /** §19.26 */
  it('lehnt die Bestellung ab und schreibt nichts', async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN) });

    const response = await post(bestellung());

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  /** §10 — die Meldung ist für ein Café geschrieben, nicht für ein Log. */
  it('erklärt es verständlich und nennt den nächsten möglichen Tag', async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN) });

    const felder = await fehler(await post(bestellung()));
    const meldung = felder['fulfillment_date'] ?? '';

    expect(meldung).toContain('Für diesen Tag können wir leider keine Bestellung annehmen.');
    expect(meldung).toContain('Nächster möglicher Produktionstag:');
    expect(meldung).not.toMatch(/lead_days|policy|cutoff|weekday|invalid|422/i);
  });

  it('nimmt einen erlaubten Tag derselben Regel weiterhin an', async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN) });

    // Derselbe Wochentag eine Woche später ist ebenfalls gesperrt; der Tag
    // danach ist es nicht.
    const response = await post(bestellung({ fulfillment_date: UEBERMORGEN }));

    expect(response.status).toBe(201);
    expect(await anzahlBestellungen()).toBe(1);
  });

  it('verbietet bei sieben abgeschalteten Tagen jede Bestellung', async () => {
    await regel({ weekdays: [false, false, false, false, false, false, false] });

    const response = await post(bestellung());

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
    // Ohne möglichen Tag wird auch keiner genannt — es wird nicht geraten.
    expect((await fehler(await post(bestellung())))['fulfillment_date'])
      .toBe('Für diesen Tag können wir leider keine Bestellung annehmen.');
  });
});

describe('Bestellschluss', () => {
  /** §19.27 */
  it('lehnt eine Bestellung nach dem Bestellschluss ab und schreibt nichts', async () => {
    // 30 Tage Vorlauf auf morgen: Der Schluss lag vor 29 Tagen.
    await regel({ cutoffEnabled: true, leadDays: 30, cutoffTime: '12:00' });

    const response = await post(bestellung());

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('erklärt den verpassten Bestellschluss verständlich', async () => {
    await regel({ cutoffEnabled: true, leadDays: 30, cutoffTime: '12:00' });

    const meldung = (await fehler(await post(bestellung())))['fulfillment_date'] ?? '';

    expect(meldung).toContain('Der Bestellschluss für');
    expect(meldung).toContain('ist bereits vorbei.');
    expect(meldung).not.toMatch(/lead_days|policy|cutoff|422/i);
  });

  it('nimmt eine Bestellung vor dem Bestellschluss an', async () => {
    // Ein Tag Vorlauf auf übermorgen, Schluss um 23:59 — frühestens morgen.
    await regel({ cutoffEnabled: true, leadDays: 1, cutoffTime: '23:59' });

    const response = await post(bestellung({ fulfillment_date: UEBERMORGEN }));

    expect(response.status).toBe(201);
    expect(await anzahlBestellungen()).toBe(1);
  });

  /**
   * OHNE HAKEN GILT KEIN BESTELLSCHLUSS — auch dann nicht, wenn Vorlauf und
   * Uhrzeit gespeichert sind. Der Schalter ist die Regel, nicht die Zahl.
   */
  it('ignoriert Vorlauf und Uhrzeit, solange der Schalter aus ist', async () => {
    await regel({ cutoffEnabled: false, leadDays: 30, cutoffTime: '00:01' });

    const response = await post(bestellung());

    expect(response.status).toBe(201);
    expect(await anzahlBestellungen()).toBe(1);
  });
});

/**
 * §19.28 — DER DIREKTE, MANIPULIERTE POST.
 *
 * Das ist der Kern von §5: Kein Weg an der Oberfläche vorbei darf eine
 * verbotene Bestellung erzeugen. Der Client hat hier keine Seite geladen, hält
 * sich an kein `min`, sendet Felder, die es nicht gibt, und behauptet Dinge
 * über sich selbst. Nichts davon hilft ihm.
 */
describe('Manipulierte Anfragen', () => {
  beforeEach(async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN), cutoffEnabled: true, leadDays: 30, cutoffTime: '12:00' });
  });

  it('lässt sich durch erfundene Felder im Körper nicht umstimmen', async () => {
    const response = await post(bestellung({
      policy_ok: true,
      ignore_policy: true,
      override: 'admin',
      allowed: true,
      lead_days: 0,
      cutoff_time: '23:59',
      order_policy: { monday_enabled: 1, cutoff_enabled: 0 },
      status: 'ready',
      total_cents: 1,
    }));

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('lässt sich durch erfundene Kopfzeilen nicht umstimmen', async () => {
    const response = await post(bestellung(), {
      'x-ignore-policy': '1',
      'x-admin': 'true',
      'x-forwarded-date': '2000-01-01',
    });

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });

  it('verbraucht bei einer Ablehnung keine Bestellnummer', async () => {
    await post(bestellung());
    await post(bestellung());

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_number_sequences')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  /**
   * DIE REGEL WIRD BEIM SCHREIBEN GELESEN UND NICHT BEIM RENDERN.
   *
   * Hier wird die Bestellseite geladen, DANACH die Regel geändert und erst
   * dann abgesendet — genau der Ablauf, den §16 beschreibt. Der POST gewinnt.
   */
  it('prüft die Regel beim Absenden und nicht beim Aufruf der Seite', async () => {
    await regel({ weekdays: ALLE_TAGE, cutoffEnabled: false });

    const seite = await worker.fetch(new Request(`${ORIGIN}/bestellen`, {
      headers: { cookie: sitzung.cookie, origin: ORIGIN },
    }), umgebung());
    expect(seite.status).toBe(200);

    // Zwischen Anzeige und Absenden schaltet der Betrieb den Tag ab.
    await regel({ weekdays: ohneWochentagVon(MORGEN) });

    const response = await post(bestellung());
    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });
});

/**
 * §19.29 und §19.30 — WAS 6F NICHT ANFASSEN DARF.
 */
describe('Bestehendes Verhalten bleibt unberührt', () => {
  it('behält die Idempotenz derselben Absendekennung', async () => {
    const payload = bestellung();

    const erste = await post(payload);
    const zweite = await post(payload);

    expect(erste.status).toBe(201);
    expect(zweite.status).toBe(200);
    expect(await anzahlBestellungen()).toBe(1);
  });

  it('behält die Idempotenz auch bei aktivem Bestellschluss', async () => {
    await regel({ cutoffEnabled: true, leadDays: 1, cutoffTime: '23:59' });
    const payload = bestellung({ fulfillment_date: UEBERMORGEN });

    expect((await post(payload)).status).toBe(201);
    expect((await post(payload)).status).toBe(200);
    expect(await anzahlBestellungen()).toBe(1);
  });

  it('bepreist die Bestellung weiterhin aus der Preisliste des Kunden', async () => {
    await regel({ cutoffEnabled: true, leadDays: 1, cutoffTime: '23:59' });

    const response = await post(bestellung({ fulfillment_date: UEBERMORGEN }));
    const koerper = await response.json<{ total_cents: number }>();

    // 3 × 4,35 € aus der Gastronomie-Liste — nicht aus der Anfrage.
    expect(koerper.total_cents).toBe(1305);
  });

  it('lehnt einen Tag in der Vergangenheit weiterhin ab', async () => {
    const response = await post(bestellung({ fulfillment_date: plusDays(HEUTE, -1) }));

    expect(response.status).toBe(422);
    expect(await anzahlBestellungen()).toBe(0);
  });
});

/**
 * §9 — DIE BESTELLSEITE BIETET NUR AN, WAS DER SERVER AUCH ANNÄHME.
 */
describe('GET /bestellen', () => {
  async function seite(): Promise<string> {
    const response = await worker.fetch(new Request(`${ORIGIN}/bestellen`, {
      headers: { cookie: sitzung.cookie, origin: ORIGIN },
    }), umgebung());
    return response.text();
  }

  it('sagt mit der Voreinstellung nichts über Bestelltage', async () => {
    const html = await seite();

    expect(html).toContain(`min="${HEUTE}"`);
    expect(html).toContain(`value="${MORGEN}"`);
    expect(html).not.toContain('Wir nehmen Bestellungen für');
    expect(html).not.toContain('Bestellschluss ist');
  });

  it('nennt die erlaubten Wochentage, sobald welche fehlen', async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN) });
    const html = await seite();

    expect(html).toContain('Wir nehmen Bestellungen für');
  });

  it('nennt den Bestellschluss, sobald einer gilt', async () => {
    await regel({ cutoffEnabled: true, leadDays: 1, cutoffTime: '12:00' });
    const html = await seite();

    expect(html).toContain('Bestellschluss ist einen Tag vorher um 12:00 Uhr.');
  });

  it('rückt die untere Grenze des Datumsfeldes auf den ersten möglichen Tag', async () => {
    // 30 Tage Vorlauf: Vor Ablauf von 30 Tagen geht nichts mehr.
    await regel({ cutoffEnabled: true, leadDays: 30, cutoffTime: '12:00' });
    const html = await seite();

    expect(html).not.toContain(`min="${HEUTE}"`);
    expect(html).not.toContain(`min="${MORGEN}"`);
    expect(html).toMatch(/min="\d{4}-\d{2}-\d{2}"/);
  });

  it('belegt das Feld mit einem Tag vor, den der Server auch annimmt', async () => {
    await regel({ weekdays: ohneWochentagVon(MORGEN) });

    const html = await seite();
    const treffer = /value="(\d{4}-\d{2}-\d{2})"/.exec(html);
    expect(treffer).not.toBeNull();

    const response = await post(bestellung({ fulfillment_date: treffer?.[1] }));
    expect(response.status).toBe(201);
  });

  it('bringt kein Skript und keine Regel in den Browser', async () => {
    await regel({ cutoffEnabled: true, leadDays: 1, cutoffTime: '12:00' });
    const html = await seite();

    for (const verboten of WEEKDAY_KEYS) {
      expect(html).not.toContain(`"${verboten}"`);
    }
    expect(html).not.toContain('lead_days');
    expect(html).not.toContain('cutoff_enabled');
  });
});
