import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { generateAccessToken, hashAccessToken } from '../../src/domain/access-token';

/**
 * Der Bestell-Endpunkt an der HTTP-Grenze.
 *
 * Der Token steht hier im HEADER, nicht im Pfad — anders als bei der Seite.
 * Zwei Gründe: Kopfzeilen tauchen in Zugriffsprotokollen nicht auf, und ein
 * Header ist keine ambiente Autorität. Ein fremdes Formular kann ihn nicht
 * setzen, ein Cross-Origin-fetch scheitert am Preflight. CSRF ist damit
 * konstruktiv ausgeschlossen, nicht durch ein Token-Feld abgewehrt.
 */
const NOW = '2026-08-24T07:00:00.000Z';
const MORGEN = '2026-08-25';

const token = {
  gueltig: generateAccessToken(),
  widerrufen: generateAccessToken(),
  unbekannt: generateAccessToken(),
};

interface Options {
  token?: string | null;
  contentType?: string | null;
  body?: string;
  method?: string;
  headers?: Record<string, string>;
}

async function post(payload: unknown, options: Options = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.contentType !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  if (options.token !== null) {
    headers['x-order-token'] = options.token ?? token.gueltig;
  }

  const method = options.method ?? 'POST';
  // GET und HEAD dürfen laut fetch-Standard keinen Körper tragen — der
  // Konstruktor wirft sonst, bevor der Worker überhaupt gefragt wird.
  const init: RequestInit =
    method === 'GET' || method === 'HEAD'
      ? { method, headers }
      : { method, headers, body: options.body ?? JSON.stringify(payload) };

  return worker.fetch(new Request('https://bestellen.example/api/orders', init), env);
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submission_id: `sub-${crypto.randomUUID()}`,
    fulfillment_date: MORGEN,
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
}

async function countOrders(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  for (const table of [
    'order_items',
    'orders',
    'customer_access_tokens',
    'products',
    'customers',
    'order_number_sequences',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, email, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, internal_note, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'geheim@example.org', 'Beispielweg 1', '40213', 'Düsseldorf',
               1, 'delivery', 'Interner Hinweis', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (1, 'Beispiel Käsekuchen', 435, 'Stück', 1, 10, ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order, created_at, updated_at)
       VALUES (2, 'Beispiel Streuselblech', 280, 'Blech', 1, 20, ?1, ?1)`,
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
  ]);
});

describe('POST /api/orders — der gute Fall', () => {
  it('legt die Bestellung an und antwortet mit 201', async () => {
    const response = await post(payload());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      order_number: 'BUS-2026-000001',
      fulfillment_date: MORGEN,
      total_cents: 1305,
      items: [{ name: 'Beispiel Käsekuchen', quantity: 3, unit: 'Stück' }],
    });
  });

  it('bestätigt mehrere Positionen mit der richtigen Summe', async () => {
    const response = await post(
      payload({ items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 2 }] }),
    );

    const body = (await response.json()) as { total_cents: number; items: unknown[] };
    expect(body.total_cents).toBe(3 * 435 + 2 * 280);
    expect(body.items).toHaveLength(2);
  });

  /**
   * Die Bestätigung stammt aus der GESPEICHERTEN Bestellung, nicht aus der
   * Anfrage. Sonst würde sie bestätigen, was das Café geschickt hat, statt
   * was tatsächlich in der Datenbank steht.
   */
  it('bestätigt den Serverpreis, nicht den mitgesendeten', async () => {
    const response = await post(
      payload({
        items: [{ product_id: 1, quantity: 3, unit_price_cents: 1 }],
        total_amount_cents: 3,
      }),
    );

    expect(((await response.json()) as { total_cents: number }).total_cents).toBe(1305);
  });

  it('gibt keine internen Felder heraus', async () => {
    const text = await (await post(payload())).text();

    for (const leak of ['customer_id', 'submission_id', 'internal_note', 'Interner Hinweis',
                        'geheim@example.org', 'price_cents', 'status', 'created_at']) {
      expect(text).not.toContain(leak);
    }
  });

  it('trägt no-store, damit die Bestätigung nirgends liegen bleibt', async () => {
    const response = await post(payload());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('POST /api/orders — Zugang', () => {
  it('lehnt eine Anfrage ohne Token mit 401 ab', async () => {
    const response = await post(payload(), { token: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(await countOrders()).toBe(0);
  });

  it('lehnt einen unbekannten Token mit 401 ab', async () => {
    expect((await post(payload(), { token: token.unbekannt })).status).toBe(401);
  });

  it('lehnt einen widerrufenen Token mit 401 ab', async () => {
    expect((await post(payload(), { token: token.widerrufen })).status).toBe(401);
  });

  it('antwortet auf alle drei Fälle identisch', async () => {
    const bodies = await Promise.all(
      [null, token.unbekannt, token.widerrufen, 'zu-kurz'].map(async (t) =>
        (await post(payload(), { token: t })).text(),
      ),
    );
    expect(new Set(bodies).size).toBe(1);
  });

  /** Der Token gehört in den Header, nicht in den Körper. */
  it('nimmt einen Token aus dem Anfragekörper nicht an', async () => {
    const response = await post(payload({ token: token.gueltig }), { token: null });
    expect(response.status).toBe(401);
  });

  /**
   * Zugang VOR Eingabeprüfung. Andernfalls bekäme ein Aufrufer ohne gültigen
   * Token feldweise Rückmeldung darüber, wie eine richtige Anfrage aussähe —
   * und könnte den Endpunkt erkunden, ohne je einen Zugang zu haben.
   */
  it('prüft den Zugang, bevor es die Eingabe prüft', async () => {
    for (const body of [{}, { items: [] }, { submission_id: 'unbrauchbar' }]) {
      const response = await post(body, { token: token.unbekannt });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('POST /api/orders — die HTTP-Grenze', () => {
  it('antwortet auf GET mit 405 und nennt das erlaubte Verfahren', async () => {
    const response = await post(payload(), { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('lehnt einen falschen Content-Type mit 415 ab', async () => {
    const response = await post(payload(), { contentType: 'text/plain' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported_media_type' });
  });

  it('lehnt eine Anfrage ohne Content-Type mit 415 ab', async () => {
    expect((await post(payload(), { contentType: null })).status).toBe(415);
  });

  it('akzeptiert einen Content-Type mit Zeichensatzangabe', async () => {
    expect((await post(payload(), { contentType: 'application/json; charset=utf-8' })).status).toBe(201);
  });

  it('macht aus ungültigem JSON eine kontrollierte 400', async () => {
    const response = await post(null, { body: '{ "items": ' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('verrät bei ungültigem JSON nichts über den Parser', async () => {
    const text = await (await post(null, { body: '{,}' })).text();
    for (const leak of ['JSON', 'SyntaxError', 'position', 'Unexpected', 'token']) {
      expect(text).not.toContain(leak);
    }
  });

  it('lehnt einen leeren Körper mit 400 ab', async () => {
    expect((await post(null, { body: '' })).status).toBe(400);
  });

  it('lehnt ein Array und einen Skalar mit 400 ab', async () => {
    expect((await post(null, { body: '[]' })).status).toBe(400);
    expect((await post(null, { body: '"text"' })).status).toBe(400);
    expect((await post(null, { body: 'null' })).status).toBe(400);
  });

  it('lehnt einen zu großen Körper mit 413 ab', async () => {
    const response = await post(payload({ note: 'x'.repeat(70_000) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(await countOrders()).toBe(0);
  });

  it('lehnt eine angekündigte Übergröße ab, bevor gelesen wird', async () => {
    const response = await post(payload(), { headers: { 'content-length': '999999' } });
    expect(response.status).toBe(413);
  });
});

describe('POST /api/orders — Eingabefehler', () => {
  it('meldet Feldfehler als 422 mit Zuordnung', async () => {
    const response = await post(payload({ fulfillment_date: '2026-08-01' }));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; errors: Record<string, string> };
    expect(body.error).toBe('validation_failed');
    expect(body.errors['fulfillment_date']).toContain('Vergangenheit');
    expect(await countOrders()).toBe(0);
  });

  it('meldet eine Bestellung ohne Produkt', async () => {
    const body = (await (await post(payload({ items: [] }))).json()) as {
      errors: Record<string, string>;
    };
    expect(body.errors['items']).toBeTruthy();
  });

  it('meldet mehrere Fehler gemeinsam', async () => {
    const body = (await (
      await post(payload({ items: [], fulfillment_date: 'kein Datum', note: 'x'.repeat(501) }))
    ).json()) as { errors: Record<string, string> };

    expect(Object.keys(body.errors).length).toBeGreaterThanOrEqual(3);
  });

  it('lehnt eine fehlende Absendekennung ab', async () => {
    const response = await post({ fulfillment_date: MORGEN, items: [{ product_id: 1, quantity: 3 }] });
    expect(response.status).toBe(422);
    expect(await countOrders()).toBe(0);
  });

  it('gibt in Fehlermeldungen keine internen Einzelheiten preis', async () => {
    const text = await (await post(payload({ items: [{ product_id: 999, quantity: 1 }] }))).text();
    for (const leak of ['SQL', 'D1_', 'sqlite', 'constraint', 'at ']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('POST /api/orders — Doppelklick', () => {
  it('beantwortet die Wiederholung mit 200 und derselben Bestellnummer', async () => {
    const body = payload();

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await countOrders()).toBe(1);
  });

  it('erzeugt bei zwei gleichzeitigen Absendungen genau eine Bestellung', async () => {
    const body = payload();
    const [a, b] = await Promise.all([post(body), post(body)]);

    expect(await countOrders()).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });

  it('lässt eine neue Kennung wieder durch', async () => {
    await post(payload());
    expect((await post(payload())).status).toBe(201);
    expect(await countOrders()).toBe(2);
  });
});

describe('Routing', () => {
  it('beantwortet unbekannte Pfade weiterhin mit 404', async () => {
    const response = await worker.fetch(new Request('https://bestellen.example/gibt-es-nicht'), env);
    expect(response.status).toBe(404);
  });

  it('lässt den Health-Endpunkt unberührt', async () => {
    const response = await worker.fetch(new Request('https://bestellen.example/api/health'), env);
    expect(response.status).toBe(200);
  });
});
