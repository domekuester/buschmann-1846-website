import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Customer } from '../../src/domain/customer';
import {
  CUSTOMER_PRICE_BOOK_QUERIES,
  loadCustomerPriceBook,
} from '../../src/infrastructure/d1/customer-price-book-repository';

/**
 * Der Weg von einem angemeldeten Kunden zu den Preisen, mit denen für ihn
 * gerechnet werden darf — gegen eine echte D1, nicht gegen eine Attrappe.
 */

const NOW = '2026-08-25T07:00:00.000Z';
const GASTRO = 1;
const PRIVAT = 2;

function kunde(priceListId: number | null): Customer {
  return new Customer({
    id: 1,
    name: 'Testcafé',
    contactPerson: null,
    email: null,
    phone: null,
    deliveryAddress: null,
    isActive: true,
    defaultFulfillment: 'pickup',
    internalNote: null,
    priceListId,
  });
}

async function katalogprodukt(id: number, sourceKey: string, aktiv = 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 10, ?, ?)`,
  ).bind(id, sourceKey, `Katalog ${id}`, aktiv, NOW, NOW).run();
}

async function produkt(id: number, catalogProductId: number | null, aktiv = 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, price_cents, unit, is_active, sort_order,
                           catalog_product_id, created_at, updated_at)
     VALUES (?, ?, 99999, 'Stück', ?, 10, ?, ?, ?)`,
  ).bind(id, `Produkt ${id}`, aktiv, catalogProductId, NOW, NOW).run();
}

async function katalogpreis(
  catalogProductId: number,
  priceListId: number,
  typ: string,
  fest: number | null = null,
  min: number | null = null,
  max: number | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_product_prices
       (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(catalogProductId, priceListId, typ, fest, min, max, NOW, NOW).run();
}

beforeEach(async () => {
  for (const t of ['order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('UPDATE price_lists SET is_active = 1').run();
});

describe('loadCustomerPriceBook', () => {
  it('löst den Festpreis der zugewiesenen Preisliste auf', async () => {
    await katalogprodukt(10, 'kuchen-a');
    await produkt(1, 10);
    await katalogpreis(10, GASTRO, 'fixed', 1000);
    await katalogpreis(10, PRIVAT, 'fixed', 1500);

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));
    const preis = buch.priceFor(1);

    expect(preis.kind === 'fixed' && preis.unitPrice.cents).toBe(1000);
  });

  it('gibt demselben Produkt für die andere Preisliste den anderen Preis', async () => {
    await katalogprodukt(10, 'kuchen-a');
    await produkt(1, 10);
    await katalogpreis(10, GASTRO, 'fixed', 1000);
    await katalogpreis(10, PRIVAT, 'fixed', 1500);

    const buch = await loadCustomerPriceBook(env.DB, kunde(PRIVAT));
    const preis = buch.priceFor(1);

    expect(preis.kind === 'fixed' && preis.unitPrice.cents).toBe(1500);
  });

  it('fragt für einen Kunden ohne Preisgruppe die Datenbank gar nicht erst', async () => {
    const buch = await loadCustomerPriceBook(env.DB, kunde(null));

    expect(buch.priceFor(1)).toEqual({ kind: 'price_list_unassigned' });
    expect(buch.isResolvable()).toBe(false);
  });

  it('löst für eine stillgelegte Preisliste nichts auf — und fällt auf keine andere zurück', async () => {
    await katalogprodukt(10, 'kuchen-a');
    await produkt(1, 10);
    await katalogpreis(10, GASTRO, 'fixed', 1000);
    await katalogpreis(10, PRIVAT, 'fixed', 1500);
    await env.DB.prepare('UPDATE price_lists SET is_active = 0 WHERE id = ?').bind(GASTRO).run();

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1)).toEqual({ kind: 'price_list_inactive' });
  });

  it('meldet ein unverknüpftes Produkt als nicht bepreist — NICHT mit products.price_cents', async () => {
    await produkt(1, null);

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1)).toEqual({ kind: 'product_not_priced' });
  });

  it('meldet ein verknüpftes Produkt ohne Preis in DIESER Liste als nicht bepreist', async () => {
    await katalogprodukt(10, 'nur-privat');
    await produkt(1, 10);
    await katalogpreis(10, PRIVAT, 'fixed', 1500);

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1)).toEqual({ kind: 'product_not_priced' });
  });

  it('macht ein stillgelegtes Katalogprodukt unbepreisbar', async () => {
    await katalogprodukt(10, 'saison', 0);
    await produkt(1, 10);
    await katalogpreis(10, GASTRO, 'fixed', 1000);

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1)).toEqual({ kind: 'product_not_priced' });
  });

  it('reicht from, range und on_request quelltreu durch, ohne daraus einen Betrag zu machen', async () => {
    await katalogprodukt(10, 'ab');
    await katalogprodukt(11, 'bereich');
    await katalogprodukt(12, 'anfrage');
    await produkt(1, 10);
    await produkt(2, 11);
    await produkt(3, 12);
    await katalogpreis(10, GASTRO, 'from', null, 5500);
    await katalogpreis(11, GASTRO, 'range', null, 5500, 7500);
    await katalogpreis(12, GASTRO, 'on_request');

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1)).toEqual({
      kind: 'price_not_fixed',
      catalogPrice: { type: 'from', minPriceCents: 5500 },
    });
    expect(buch.priceFor(2)).toEqual({
      kind: 'price_not_fixed',
      catalogPrice: { type: 'range', minPriceCents: 5500, maxPriceCents: 7500 },
    });
    expect(buch.priceFor(3)).toEqual({
      kind: 'price_not_fixed',
      catalogPrice: { type: 'on_request' },
    });
  });

  it('behält den Preis auch für ein deaktiviertes Produkt — Bestellbarkeit entscheidet die Domäne', async () => {
    await katalogprodukt(10, 'saison');
    await produkt(1, 10, 0);
    await katalogpreis(10, GASTRO, 'fixed', 1000);

    const buch = await loadCustomerPriceBook(env.DB, kunde(GASTRO));

    expect(buch.priceFor(1).kind).toBe('fixed');
  });
});

/**
 * §20 DES AUFTRAGS: KEIN N+1.
 *
 * Die Bestellseite kann viele Produkte tragen. Eine Preisabfrage je Produkt
 * wäre bei 26 Artikeln 26 Roundtrips gegen D1 — und würde mit dem Sortiment
 * wachsen, ohne dass es jemandem auffiele. Deshalb wird die Anzahl der
 * Abfragen hier GEZÄHLT und nicht behauptet.
 */
describe('Abfrageanzahl', () => {
  async function zaehle(fn: (db: D1Database) => Promise<unknown>): Promise<number> {
    let n = 0;
    const spion = new Proxy(env.DB, {
      get(ziel, name, empfaenger) {
        if (name === 'prepare') {
          return (sql: string) => {
            n += 1;
            return Reflect.get(ziel, name, empfaenger).call(ziel, sql);
          };
        }
        if (name === 'batch') {
          return (statements: D1PreparedStatement[]) =>
            Reflect.get(ziel, name, empfaenger).call(ziel, statements);
        }
        const wert = Reflect.get(ziel, name, empfaenger);
        return typeof wert === 'function' ? wert.bind(ziel) : wert;
      },
    }) as D1Database;

    await fn(spion);
    return n;
  }

  it('braucht für ein Sortiment jeder Größe dieselbe konstante Anzahl Abfragen', async () => {
    await katalogprodukt(10, 'a');
    await produkt(1, 10);
    await katalogpreis(10, GASTRO, 'fixed', 1000);

    const beiEinem = await zaehle((db) => loadCustomerPriceBook(db, kunde(GASTRO)));

    for (let i = 2; i <= 26; i += 1) {
      await katalogprodukt(10 + i, `a${i}`);
      await produkt(i, 10 + i);
      await katalogpreis(10 + i, GASTRO, 'fixed', 1000 + i);
    }

    const beiVielen = await zaehle((db) => loadCustomerPriceBook(db, kunde(GASTRO)));

    expect(beiEinem).toBe(beiVielen);
    expect(beiVielen).toBeLessThanOrEqual(2);
  });

  it('braucht für einen Kunden ohne Preisgruppe keine einzige Abfrage', async () => {
    expect(await zaehle((db) => loadCustomerPriceBook(db, kunde(null)))).toBe(0);
  });
});

describe('Query Plan', () => {
  it('sucht die Katalogpreise über Indizes statt das Sortiment zu scannen', async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${CUSTOMER_PRICE_BOOK_QUERIES.prices}`,
    )
      .bind(GASTRO)
      .all<{ detail: string }>();

    const text = results.map((z) => z.detail).join(' | ');

    // catalog_product_prices wird über den UNIQUE-Index (product_id, price_list_id)
    // gefunden, catalog_products über seinen Primärschlüssel.
    expect(text).not.toMatch(/SCAN catalog_product_prices/);
    expect(text).not.toMatch(/SCAN catalog_products/);
  });

  it('findet die Preisliste über ihren Primärschlüssel', async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${CUSTOMER_PRICE_BOOK_QUERIES.priceList}`,
    )
      .bind(GASTRO)
      .all<{ detail: string }>();

    expect(results.map((z) => z.detail).join(' | ')).not.toMatch(/SCAN price_lists/);
  });
});
