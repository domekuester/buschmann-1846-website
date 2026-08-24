import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { generateAccessToken, hashAccessToken } from '../../src/domain/access-token';

/**
 * Die Bestellseite an der HTTP-Grenze. Geprüft wird, was tatsächlich über die
 * Leitung geht — Status, Kopfzeilen und Körper —, nicht was eine Funktion
 * zurückgibt.
 */
const NOW = '2026-08-24T07:00:00.000Z';

const token = {
  gueltig: generateAccessToken(),
  widerrufen: generateAccessToken(),
  inaktivesCafe: generateAccessToken(),
  unbekannt: generateAccessToken(),
};

async function call(path: string, method = 'GET'): Promise<Response> {
  return worker.fetch(new Request(`https://bestellen.example${path}`, { method }), env);
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'customer_access_tokens', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

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
       VALUES (2, 'Ehemaliges Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', ?1, ?1)`,
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

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at) VALUES (1, ?, 1, ?)`,
    ).bind(await hashAccessToken(token.gueltig), NOW),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at, revoked_at)
       VALUES (1, ?, 0, ?, ?)`,
    ).bind(await hashAccessToken(token.widerrufen), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at) VALUES (2, ?, 1, ?)`,
    ).bind(await hashAccessToken(token.inaktivesCafe), NOW),
  ]);
});

describe('GET /o/<token> — gültiger Zugang', () => {
  it('liefert die Bestellseite des richtigen Cafés', async () => {
    const response = await call(`/o/${token.gueltig}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Testcafé Nord');
  });

  it('zeigt das aktive Sortiment und nichts darüber hinaus', async () => {
    const html = await (await call(`/o/${token.gueltig}`)).text();

    expect(html).toContain('Beispiel Käsekuchen');
    expect(html).toContain('Beispiel Streuselblech');
    expect(html).not.toContain('Beispiel Saisontorte');
  });

  it('zeigt die Preise aus der Datenbank', async () => {
    const html = await (await call(`/o/${token.gueltig}`)).text();
    expect(html).toContain('4,35 €');
    expect(html).toContain('2,80 €');
  });

  /** Jede Seite bekommt ihre eigene Kennung, sonst schützt sie nichts. */
  it('gibt bei jedem Aufruf eine neue Absendekennung mit', async () => {
    const first = (await (await call(`/o/${token.gueltig}`)).text()).match(/data-submission-id="([^"]+)"/);
    const second = (await (await call(`/o/${token.gueltig}`)).text()).match(/data-submission-id="([^"]+)"/);

    expect(first?.[1]).toBeTruthy();
    expect(first?.[1]).not.toBe(second?.[1]);
  });

  it('gibt keine internen Kundendaten preis', async () => {
    const html = await (await call(`/o/${token.gueltig}`)).text();

    expect(html).not.toContain('Interner Hinweis');
    expect(html).not.toContain('geheim@example.org');
    expect(html).not.toContain('0211 1234567');
    expect(html).not.toContain('Beispielperson');
  });

  it('enthält den Token nicht im Dokument', async () => {
    const html = await (await call(`/o/${token.gueltig}`)).text();
    expect(html).not.toContain(token.gueltig);
  });
});

describe('GET /o/<token> — Schutzkopfzeilen', () => {
  it('verbietet jedes Zwischenspeichern der privaten Antwort', async () => {
    const response = await call(`/o/${token.gueltig}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('verhindert, dass der Token als Referer abfließt', async () => {
    const response = await call(`/o/${token.gueltig}`);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('setzt eine CSP ohne unsafe-inline', async () => {
    const csp = (await call(`/o/${token.gueltig}`)).headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('verbietet MIME-Raten, Einbettung und Indexierung', async () => {
    const response = await call(`/o/${token.gueltig}`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('trägt dieselben Kopfzeilen auch auf der Ablehnung', async () => {
    const response = await call(`/o/${token.unbekannt}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('GET /o/<token> — Ablehnung ohne Auskunft', () => {
  /**
   * Die Kernzusage: Ein Angreifer darf aus der Antwort nicht ablesen, ob ein
   * Zugang existiert, widerrufen wurde oder das Café stillgelegt ist.
   */
  it('antwortet auf alle vier ungültigen Fälle Zeichen für Zeichen gleich', async () => {
    const responses = await Promise.all([
      call(`/o/${token.unbekannt}`),
      call(`/o/${token.widerrufen}`),
      call(`/o/${token.inaktivesCafe}`),
      call('/o/zu-kurz'),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.text()));

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/html');
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('nicht mehr gültig');
  });

  it('nennt auf der Ablehnung kein Café und kein Sortiment', async () => {
    const html = await (await call(`/o/${token.unbekannt}`)).text();
    expect(html).not.toContain('Testcafé Nord');
    expect(html).not.toContain('Beispiel Käsekuchen');
  });

  it('lehnt einen leeren Token ab', async () => {
    expect((await call('/o/')).status).toBe(404);
  });

  it('lehnt einen zusammengesetzten Pfad ab', async () => {
    expect((await call(`/o/${token.gueltig}/extra`)).status).toBe(404);
  });
});

describe('GET /o/<token> — Verfahren', () => {
  it('antwortet auf POST mit 405 und nennt das erlaubte Verfahren', async () => {
    const response = await call(`/o/${token.gueltig}`, 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('antwortet auf DELETE mit 405', async () => {
    expect((await call(`/o/${token.gueltig}`, 'DELETE')).status).toBe(405);
  });

  /** HEAD ist GET ohne Körper und wird von der Runtime abgeleitet. */
  it('beantwortet HEAD wie GET', async () => {
    const response = await call(`/o/${token.gueltig}`, 'HEAD');
    expect(response.status).toBe(200);
  });
});
