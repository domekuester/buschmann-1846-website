import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { GASTRO, PRICING_TABLES, PRIVAT, assignPriceGroup, priceProduct, resetPriceLists } from '../support/pricing';

/**
 * Die Bestellseite an der HTTP-Grenze. Geprüft wird, was tatsächlich über die
 * Leitung geht — Status, Kopfzeilen und Körper —, nicht was eine Funktion
 * zurückgibt.
 *
 * SEIT PHASE 3A LIEGT SIE UNTER /bestellen UND NICHT MEHR UNTER /o/<token>.
 *
 * Der Unterschied ist mehr als eine Adresse: Das Café kommt jetzt aus einer
 * geprüften Sitzung statt aus einem Link. Damit gibt es keinen Pfadbestandteil
 * mehr, der ein Geheimnis wäre — und keine Möglichkeit, durch Raten an einer
 * URL bei einem fremden Café zu landen.
 */
const NOW = '2026-08-24T07:00:00.000Z';
const ORIGIN = 'https://bestellen.example';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

const CONFIG: AppConfig = { environment: 'production', appOrigin: ORIGIN, pepper: PEPPER };

function umgebung(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'production' };
}

const sitzung = { cafe: '', ehemalig: '', admin: '' };

/**
 * WICHTIG: Die Sitzung wird auf die ECHTE Uhr geprägt, nicht auf NOW.
 *
 * NOW ist ein fester Zeitpunkt für die Testdaten. Der Worker prüft eine
 * Sitzung aber gegen `new Date()` — er bekommt keine Uhr übergeben. Eine
 * Adminsitzung läuft 12 Stunden; wäre sie auf NOW = 07:00 UTC geprägt,
 * schlüge dieser Test ab 19:00 UTC fehl und davor nicht. Genau das ist hier
 * einmal passiert.
 */
async function anmelden(identifier: string, secret: string): Promise<string> {
  const ergebnis = await logIn(env.DB, CONFIG, {
    identifier,
    secret,
    now: new Date(),
    existingSessionToken: null,
  });
  if (ergebnis === null) throw new Error(`Anmeldung von ${identifier} im Testaufbau fehlgeschlagen`);
  return `__Host-buschmann_session=${ergebnis.token}`;
}

async function call(path: string, cookie: string | null = null, method = 'GET'): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie !== null) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers }), umgebung());
}

async function seedKonto(
  id: number,
  identifier: string,
  role: 'customer' | 'admin',
  secret: string,
  customerId: number | null,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations, credential_salt,
                                credential_verifier, is_active, failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      identifier,
      role,
      customerId,
      credential.algorithm,
      credential.iterations,
      credential.saltHex,
      credential.verifierHex,
      NOW,
      NOW,
    )
    .run();
}

beforeEach(async () => {
  for (const table of PRICING_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await resetPriceLists(env.DB);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, email, phone, contact_person, delivery_street,
                              delivery_postal_code, delivery_city, is_active, default_fulfillment,
                              internal_note, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'geheim@example.org', '0211 1234567', 'Beispielperson',
               'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
               'Interner Hinweis — Lieferung an der Rückseite', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Ehemaliges Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen', 'Platzhalter', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Beispiel Streuselblech', 280, 'Blech', 1, 20, ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (9, 'Beispiel Saisontorte', 350, 'Torte', 0, 50, ?1, ?1)`,
    ).bind(NOW),
  ]);

  // Phase 5C: dieselben Beträge, aber aus der Gastronomie-Preisliste.
  await priceProduct(env.DB, { productId: 1, gastro: 435, privat: 520 });
  await priceProduct(env.DB, { productId: 2, gastro: 280, privat: 330 });
  await priceProduct(env.DB, { productId: 9, gastro: 350 });
  const { results: kunden } = await env.DB.prepare('SELECT id FROM customers').all<{ id: number }>();
  for (const row of kunden) {
    await assignPriceGroup(env.DB, row.id, GASTRO);
  }

  await seedKonto(1, 'testcafe', 'customer', PIN, 1);
  await seedKonto(2, 'ehemalig', 'customer', PIN, 2);
  await seedKonto(3, 'admin@example.test', 'admin', PASSWORT, null);

  sitzung.cafe = await anmelden('testcafe', PIN);
  sitzung.ehemalig = await anmelden('ehemalig', PIN);
  sitzung.admin = await anmelden('admin@example.test', PASSWORT);
});

describe('GET /bestellen — gültige Kundensitzung', () => {
  it('liefert die Bestellseite des richtigen Cafés', async () => {
    const response = await call('/bestellen', sitzung.cafe);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Testcafé Nord');
  });

  /**
   * Jede Sitzung sieht ihr eigenes Café. Es gibt keinen Parameter, über den
   * sich das beeinflussen ließe — der Kunde kommt aus der Sitzung.
   */
  it('zeigt jeder Sitzung ihr eigenes Café', async () => {
    expect(await (await call('/bestellen', sitzung.cafe)).text()).toContain('Testcafé Nord');
    expect(await (await call('/bestellen', sitzung.ehemalig)).text()).toContain('Ehemaliges Testcafé');
  });

  it('zeigt das aktive Sortiment und nichts darüber hinaus', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).toContain('Beispiel Käsekuchen');
    expect(html).toContain('Beispiel Streuselblech');
    expect(html).not.toContain('Beispiel Saisontorte');
  });

  it('zeigt die Preise aus der Datenbank', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();
    expect(html).toContain('4,35 €');
    expect(html).toContain('2,80 €');
  });

  it('zeigt den serverseitigen Geschäftskunden- und Lieferkontext', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).toContain('Geschäftskundenpreise');
    expect(html).toContain('Lieferung');
  });

  it('zeigt Privatkunden- und Abholkontext nur aus dem angemeldeten Konto', async () => {
    await assignPriceGroup(env.DB, 1, PRIVAT);
    await env.DB.prepare("UPDATE customers SET default_fulfillment = 'pickup' WHERE id = 1").run();

    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).toContain('Privatkundenpreise');
    expect(html).toContain('Abholung');
    expect(html).not.toContain('name="price');
    expect(html).not.toContain('name="fulfillment_type"');
  });

  /** Jede Seite bekommt ihre eigene Kennung, sonst schützt sie nichts. */
  it('gibt bei jedem Aufruf eine neue Absendekennung mit', async () => {
    const first = (await (await call('/bestellen', sitzung.cafe)).text()).match(
      /data-submission-id="([^"]+)"/,
    );
    const second = (await (await call('/bestellen', sitzung.cafe)).text()).match(
      /data-submission-id="([^"]+)"/,
    );

    expect(first?.[1]).toBeTruthy();
    expect(first?.[1]).not.toBe(second?.[1]);
  });

  it('gibt keine internen Kundendaten preis', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).not.toContain('Interner Hinweis');
    expect(html).not.toContain('geheim@example.org');
    expect(html).not.toContain('0211 1234567');
    expect(html).not.toContain('Beispielperson');
  });
});

describe('GET /bestellen — Sitzungstoken und CSRF-Token', () => {
  /**
   * Der Sitzungstoken liegt HttpOnly im Cookie und darf im Dokument nirgends
   * auftauchen — auch nicht im Abmeldeformular.
   */
  it('schreibt den Sitzungstoken nicht ins Dokument', async () => {
    const token = sitzung.cafe.split('=')[1] as string;
    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).not.toContain(token);
  });

  /**
   * Der CSRF-Token dagegen MUSS im Dokument stehen: Das Client-Skript liest
   * ihn und sendet ihn beim Absenden zurück.
   */
  it('gibt den CSRF-Token der Sitzung mit', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();
    const treffer = /data-csrf="([^"]+)"/.exec(html);

    expect(treffer?.[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gibt zwei Sitzungen verschiedene CSRF-Token', async () => {
    const eins = /data-csrf="([^"]+)"/.exec(await (await call('/bestellen', sitzung.cafe)).text());
    const zwei = /data-csrf="([^"]+)"/.exec(
      await (await call('/bestellen', sitzung.ehemalig)).text(),
    );

    expect(eins?.[1]).not.toBe(zwei?.[1]);
  });

  it('bietet eine Abmeldung als echtes Formular an', async () => {
    const html = await (await call('/bestellen', sitzung.cafe)).text();

    expect(html).toContain('<form method="post" action="/logout"');
    expect(html).toContain('name="csrf_token"');
  });
});

describe('GET /bestellen — Zugang', () => {
  it('schickt ohne Sitzung zum Login', async () => {
    const response = await call('/bestellen');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('schickt eine unbekannte Sitzung zum Login', async () => {
    const response = await call('/bestellen', `__Host-buschmann_session=${'x'.repeat(43)}`);
    expect(response.status).toBe(303);
  });

  /**
   * Ein Admin ist kein Café. Er hat keinen Kundenbezug und könnte hier gar
   * nicht bestellen — die Ablehnung ist 403 und nicht etwa eine leere
   * Bestellseite.
   */
  it('lehnt eine Adminsitzung mit 403 ab', async () => {
    const response = await call('/bestellen', sitzung.admin);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Beispiel Käsekuchen');
  });

  /**
   * Ein deaktiviertes Café sieht die Seite SOFORT nicht mehr — nicht erst
   * beim Absenden. Die Sitzung wird bei jedem Aufruf frisch geprüft.
   */
  it('sperrt ein deaktiviertes Café sofort aus', async () => {
    expect((await call('/bestellen', sitzung.ehemalig)).status).toBe(200);

    await env.DB.prepare('UPDATE customers SET is_active = 0 WHERE id = 2').run();

    const response = await call('/bestellen', sitzung.ehemalig);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('sperrt ein deaktiviertes Konto sofort aus', async () => {
    await env.DB.prepare('UPDATE auth_accounts SET is_active = 0 WHERE id = 1').run();

    expect((await call('/bestellen', sitzung.cafe)).status).toBe(303);
  });
});

describe('GET /bestellen — Schutzkopfzeilen', () => {
  it('verbietet jedes Zwischenspeichern der privaten Antwort', async () => {
    expect((await call('/bestellen', sitzung.cafe)).headers.get('cache-control')).toBe('no-store');
  });

  it('sendet keinen Referer an fremde Hosts', async () => {
    expect((await call('/bestellen', sitzung.cafe)).headers.get('referrer-policy')).toBe(
      'same-origin',
    );
  });

  it('setzt eine CSP ohne unsafe-inline', async () => {
    const csp = (await call('/bestellen', sitzung.cafe)).headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Seit Phase 3A gibt es echte Formulare — 'self' ist die kleinste
    // Erlaubnis, die sie zulässt.
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('verbietet MIME-Raten, Einbettung und Indexierung', async () => {
    const response = await call('/bestellen', sitzung.cafe);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('trägt dieselben Kopfzeilen auch auf der Ablehnung', async () => {
    const response = await call('/bestellen', sitzung.admin);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });
});

describe('GET /bestellen — Verfahren', () => {
  it('antwortet auf POST mit 405 und nennt das erlaubte Verfahren', async () => {
    const response = await call('/bestellen', sitzung.cafe, 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('antwortet auf DELETE mit 405', async () => {
    expect((await call('/bestellen', sitzung.cafe, 'DELETE')).status).toBe(405);
  });

  /** HEAD ist GET ohne Körper und wird von der Runtime abgeleitet. */
  it('beantwortet HEAD wie GET', async () => {
    expect((await call('/bestellen', sitzung.cafe, 'HEAD')).status).toBe(200);
  });
});

describe('Der Capability-Link ist kein Weg mehr', () => {
  /**
   * Phase 2 lieferte unter /o/<token> eine vollständige Bestellseite aus. Der
   * Pfad existiert nicht mehr — und zwar nicht als „ungültiger Link", sondern
   * als unbekannte Route.
   */
  it('kennt /o/<token> nicht mehr', async () => {
    for (const pfad of ['/o/' + 'a'.repeat(43), '/o/beliebig', '/o/']) {
      const response = await call(pfad, sitzung.cafe);
      expect(response.status).toBe(404);
    }
  });
});
