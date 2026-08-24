import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateAccessToken, hashAccessToken } from '../../src/domain/access-token';
import { findCustomerByAccessToken } from '../../src/infrastructure/d1/access-token-repository';

/**
 * Die Zugangsprüfung ist die einzige Stelle des Systems, an der aus einem
 * Geheimnis eine Identität wird. Alles, was danach passiert — welche Preise
 * gelten, für wen bestellt wird, welche Adresse in die Bestellung geht —
 * hängt an dieser einen Auflösung.
 */
const NOW = '2026-08-24T07:00:00.000Z';

/** Café A, Café B, ein deaktiviertes Café. */
const tokens = {
  cafeA: generateAccessToken(),
  cafeB: generateAccessToken(),
  widerrufen: generateAccessToken(),
  inaktivesCafe: generateAccessToken(),
  unbekannt: generateAccessToken(),
};

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'customer_access_tokens', 'products', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, internal_note, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
               'Platzhalter — betrieblicher Hinweis', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Testcafé Süd', 'Beispielallee 22', '40215', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (3, 'Ehemaliges Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', ?1, ?1)`,
    ).bind(NOW),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at)
       VALUES (1, ?, 1, ?)`,
    ).bind(await hashAccessToken(tokens.cafeA), NOW),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at)
       VALUES (2, ?, 1, ?)`,
    ).bind(await hashAccessToken(tokens.cafeB), NOW),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at, revoked_at)
       VALUES (1, ?, 0, ?, ?)`,
    ).bind(await hashAccessToken(tokens.widerrufen), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at)
       VALUES (3, ?, 1, ?)`,
    ).bind(await hashAccessToken(tokens.inaktivesCafe), NOW),
  ]);
});

describe('findCustomerByAccessToken', () => {
  it('findet über einen gültigen Token den richtigen Kunden', async () => {
    const customer = await findCustomerByAccessToken(env.DB, tokens.cafeA);

    expect(customer?.id).toBe(1);
    expect(customer?.name).toBe('Testcafé Nord');
    expect(customer?.defaultFulfillment).toBe('delivery');
    expect(customer?.deliveryAddress?.toSingleLine()).toBe('Beispielweg 1, 40213 Düsseldorf');
  });

  it('lehnt einen unbekannten Token ab', async () => {
    expect(await findCustomerByAccessToken(env.DB, tokens.unbekannt)).toBeNull();
  });

  it('lehnt einen widerrufenen Token ab', async () => {
    expect(await findCustomerByAccessToken(env.DB, tokens.widerrufen)).toBeNull();
  });

  /**
   * Der Zugang ist gültig, das Café ist es nicht. Ohne diese Bedingung
   * bekäme ein ehemaliges Café weiterhin eine Bestellseite und liefe erst
   * beim Absenden in eine Ablehnung.
   */
  it('lehnt den Token eines deaktivierten Cafés ab', async () => {
    expect(await findCustomerByAccessToken(env.DB, tokens.inaktivesCafe)).toBeNull();
  });

  /** Die Kernzusage: Ein Token gehört zu genau einem Café. */
  it('lädt mit dem Token von Café A niemals Café B', async () => {
    expect((await findCustomerByAccessToken(env.DB, tokens.cafeA))?.id).toBe(1);
    expect((await findCustomerByAccessToken(env.DB, tokens.cafeB))?.id).toBe(2);
  });

  it('lehnt formal ungültige Werte ab', async () => {
    expect(await findCustomerByAccessToken(env.DB, '')).toBeNull();
    expect(await findCustomerByAccessToken(env.DB, 'zu-kurz')).toBeNull();
    expect(await findCustomerByAccessToken(env.DB, 'a'.repeat(65))).toBeNull();
    expect(await findCustomerByAccessToken(env.DB, "' OR 1=1 --" + 'a'.repeat(40))).toBeNull();
  });

  /**
   * Die Zusage aus Abschnitt 5.2, gegen die echte Datenbank geprüft: Der
   * Klartext steht dort nicht — auch nicht in irgendeiner anderen Spalte.
   */
  it('speichert den Klartext-Token nirgends', async () => {
    const { results } = await env.DB.prepare(
      'SELECT id, customer_id, token_hash, is_active, created_at, revoked_at FROM customer_access_tokens',
    ).all<Record<string, unknown>>();

    const dump = JSON.stringify(results);
    for (const token of Object.values(tokens)) {
      expect(dump).not.toContain(token);
    }
    expect(results).toHaveLength(4);
    for (const row of results) {
      expect(row['token_hash']).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
