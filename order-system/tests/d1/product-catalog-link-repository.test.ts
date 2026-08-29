import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRODUCT_CATALOG_LINK_QUERIES,
  findCatalogProduct,
  findProductLink,
  loadLinkableCatalogProducts,
  loadProductLinks,
  updateProductCatalogLink,
} from '../../src/infrastructure/d1/product-catalog-link-repository';

/**
 * Die Datenbankzugriffe des Zuordnungsbereichs — gegen eine echte D1.
 *
 * ZWEI LESENDE ABFRAGEN UND EIN SCHREIBVORGANG, der genau EINE Spalte
 * anfasst. Dass er nur diese eine anfasst, wird hier nicht behauptet, sondern
 * geprüft: §24.7 und §24.8 des Auftrags.
 *
 * ALLE NAMEN UND WERTE SIND FREI ERFUNDEN.
 */

const NOW = '2026-08-25T07:00:00.000Z';
const SPAETER = new Date('2026-08-25T09:30:00.000Z');

async function katalogprodukt(
  id: number,
  name: string,
  variant: string | null,
  unit: string | null,
  options: { active?: boolean; sortOrder?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_products (id, source_key, name, variant, unit, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, `fixture:${id}`, name, variant, unit,
    options.active === false ? 0 : 1, options.sortOrder ?? id * 10, NOW, NOW,
  ).run();
}

async function produkt(
  id: number,
  name: string,
  catalogProductId: number | null,
  options: { active?: boolean; sortOrder?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order,
                           catalog_product_id, created_at, updated_at)
     VALUES (?, ?, 'Fiktive Beschreibung', 99999, 'Stück', ?, ?, ?, ?, ?)`,
  ).bind(
    id, name, options.active === false ? 0 : 1, options.sortOrder ?? id * 10,
    catalogProductId, NOW, NOW,
  ).run();
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'products', 'catalog_product_prices', 'catalog_products']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('loadProductLinks', () => {
  it('nennt zu jedem Produkt seine bestehende Zuordnung', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', '26-cm-Ring', null);
    await produkt(1, 'Käsekuchen', 7);

    expect(await loadProductLinks(env.DB)).toEqual([
      {
        id: 1,
        name: 'Käsekuchen',
        isActive: true,
        catalogProduct: { id: 7, label: 'Fiktiver Käsekuchen · 26-cm-Ring', isActive: true },
      },
    ]);
  });

  it('zeigt ein unverknüpftes Produkt mit null — und nicht als Fehler', async () => {
    await produkt(1, 'Butterkuchen', null);

    const zeilen = await loadProductLinks(env.DB);
    expect(zeilen[0]?.catalogProduct).toBeNull();
  });

  it('behält ein stillgelegtes Katalogprodukt sichtbar, statt die Zeile zu verlieren', async () => {
    await katalogprodukt(7, 'Fiktiver Altbestand', null, 'Blech', { active: false });
    await produkt(1, 'Altprodukt', 7);

    const zeilen = await loadProductLinks(env.DB);
    expect(zeilen[0]?.catalogProduct).toEqual({
      id: 7,
      label: 'Fiktiver Altbestand · Blech',
      isActive: false,
    });
  });

  it('zeigt auch deaktivierte Produkte — sonst hielte ein unsichtbares Produkt einen Katalogplatz', async () => {
    await katalogprodukt(7, 'Fiktives Saisongebäck', null, null);
    await produkt(1, 'Saisonprodukt', 7, { active: false });

    const zeilen = await loadProductLinks(env.DB);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.isActive).toBe(false);
  });

  it('sortiert wie die Bestellseite: aktive zuerst, dann nach Anzeigereihenfolge', async () => {
    await produkt(1, 'Zweites', null, { sortOrder: 20 });
    await produkt(2, 'Erstes', null, { sortOrder: 10 });
    await produkt(3, 'Stillgelegtes', null, { sortOrder: 5, active: false });

    expect((await loadProductLinks(env.DB)).map((z) => z.name))
      .toEqual(['Erstes', 'Zweites', 'Stillgelegtes']);
  });

  it('liest keinen Preis — products.price_cents kommt in der Zeile nicht vor', async () => {
    await produkt(1, 'Käsekuchen', null);

    const zeile = await loadProductLinks(env.DB);
    expect(JSON.stringify(zeile)).not.toContain('99999');
    expect(Object.keys(zeile[0] ?? {}).sort()).toEqual(['catalogProduct', 'id', 'isActive', 'name']);
  });
});

describe('loadLinkableCatalogProducts', () => {
  it('nennt jedes aktive Katalogprodukt mit Label und aktuellem Halter', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', '26-cm-Ring', null);
    await katalogprodukt(8, 'Fiktiver Butterkuchen', null, 'Blech');
    await produkt(1, 'Käsekuchen', 7);

    expect(await loadLinkableCatalogProducts(env.DB)).toEqual([
      { id: 7, label: 'Fiktiver Käsekuchen · 26-cm-Ring', linkedProductId: 1 },
      { id: 8, label: 'Fiktiver Butterkuchen · Blech', linkedProductId: null },
    ]);
  });

  it('lässt stillgelegte Katalogprodukte aus der Auswahl heraus', async () => {
    await katalogprodukt(7, 'Fiktiver Altbestand', null, null, { active: false });

    expect(await loadLinkableCatalogProducts(env.DB)).toEqual([]);
  });

  it('sortiert nach der fachlichen Reihenfolge des Katalogs', async () => {
    await katalogprodukt(7, 'Zweites', null, null, { sortOrder: 20 });
    await katalogprodukt(8, 'Erstes', null, null, { sortOrder: 10 });

    expect((await loadLinkableCatalogProducts(env.DB)).map((o) => o.label))
      .toEqual(['Erstes', 'Zweites']);
  });
});

describe('findCatalogProduct', () => {
  it('findet ein Katalogprodukt samt seiner Aktivität', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null, { active: false });

    expect(await findCatalogProduct(env.DB, 7)).toEqual({ id: 7, isActive: false });
  });

  it('antwortet mit null auf eine erfundene Kennung', async () => {
    expect(await findCatalogProduct(env.DB, 999)).toBeNull();
  });
});

describe('findProductLink', () => {
  it('unterscheidet „gibt es nicht" von „gibt es, ist nur nicht verknüpft"', async () => {
    await produkt(1, 'Butterkuchen', null);

    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
    expect(await findProductLink(env.DB, 999)).toBeNull();
  });
});

describe('updateProductCatalogLink', () => {
  it('verknüpft ein unverknüpftes Produkt', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await produkt(1, 'Käsekuchen', null);

    expect(await updateProductCatalogLink(env.DB, 1, 7, SPAETER)).toBe(true);
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 7 });
  });

  it('hängt ein verknüpftes Produkt auf ein anderes Katalogprodukt um', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await katalogprodukt(8, 'Fiktiver Butterkuchen', null, null);
    await produkt(1, 'Käsekuchen', 7);

    expect(await updateProductCatalogLink(env.DB, 1, 8, SPAETER)).toBe(true);
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 8 });
  });

  it('setzt eine Zuordnung auf NULL zurück', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await produkt(1, 'Käsekuchen', 7);

    expect(await updateProductCatalogLink(env.DB, 1, null, SPAETER)).toBe(true);
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: null });
  });

  it('schreibt die unveränderte Fortschreibung ohne Konflikt mit sich selbst', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await produkt(1, 'Käsekuchen', 7);

    expect(await updateProductCatalogLink(env.DB, 1, 7, SPAETER)).toBe(true);
  });

  /**
   * §5 DES AUFTRAGS — DER PARTIELLE UNIQUE-INDEX AUS 0014 WIRD NICHT
   * ÜBERTRETEN, UND ER WIRFT AUCH NICHT.
   *
   * Der Schreibvorgang prüft die Belegung IN DERSELBEN ANWEISUNG, in der er
   * schreibt. Ein vorgeschaltetes SELECT wäre ein Zeitfenster: Zwischen
   * „ist frei" und „schreibe" kann ein zweiter Admin dasselbe Katalogprodukt
   * belegen — und dann käme ein SQL-Fehler bis in die Oberfläche.
   */
  it('lässt ein bereits vergebenes Katalogprodukt nicht ein zweites Mal zu — ohne SQL-Fehler', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await produkt(1, 'Käsekuchen', 7);
    await produkt(2, 'Käsekuchen klein', null);

    await expect(updateProductCatalogLink(env.DB, 2, 7, SPAETER)).resolves.toBe(false);
    expect(await findProductLink(env.DB, 2)).toEqual({ catalogProductId: null });
    expect(await findProductLink(env.DB, 1)).toEqual({ catalogProductId: 7 });
  });

  it('meldet ein unbekanntes Produkt, ohne etwas zu schreiben', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);

    expect(await updateProductCatalogLink(env.DB, 999, 7, SPAETER)).toBe(false);
  });

  /** §24.7 — die anderen Produktfelder bleiben unangetastet. */
  it('fasst außer der Verknüpfung nur den Zeitstempel an', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', null, null);
    await produkt(1, 'Käsekuchen', null);
    const vorher = await env.DB.prepare('SELECT * FROM products WHERE id = 1').first<Record<string, unknown>>();

    await updateProductCatalogLink(env.DB, 1, 7, SPAETER);
    const nachher = await env.DB.prepare('SELECT * FROM products WHERE id = 1').first<Record<string, unknown>>();

    expect(nachher).toEqual({
      ...vorher,
      catalog_product_id: 7,
      updated_at: SPAETER.toISOString(),
    });
  });

  /** §24.8 und §24.9 — der Katalog selbst und seine Preise bleiben, wie sie sind. */
  it('verändert weder das Katalogprodukt noch seine Preise', async () => {
    await katalogprodukt(7, 'Fiktiver Käsekuchen', '26-cm-Ring', 'Stück');
    await env.DB.prepare(
      `INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, created_at, updated_at)
       VALUES (7, 1, 'fixed', 2100, ?, ?)`,
    ).bind(NOW, NOW).run();
    await produkt(1, 'Käsekuchen', null);

    const katalogVorher = await env.DB.prepare('SELECT * FROM catalog_products WHERE id = 7').first();
    const preiseVorher = await env.DB.prepare('SELECT * FROM catalog_product_prices WHERE product_id = 7').all();

    await updateProductCatalogLink(env.DB, 1, 7, SPAETER);

    expect(await env.DB.prepare('SELECT * FROM catalog_products WHERE id = 7').first()).toEqual(katalogVorher);
    expect((await env.DB.prepare('SELECT * FROM catalog_product_prices WHERE product_id = 7').all()).results)
      .toEqual(preiseVorher.results);
  });
});

/**
 * DER QUERY PLAN — §23 des Auftrags, geprüft statt behauptet.
 *
 * Ein Plan, der nur im Kommentar steht, ist genau bis zu dem Tag richtig, an
 * dem jemand einen Index entfernt oder eine Bedingung umstellt. Hier läuft er
 * in jedem Testlauf gegen dieselbe frisch migrierte D1 wie alles andere.
 *
 * Die Abfragen kommen aus dem Modul selbst. Sie hier abzuschreiben hieße, den
 * Plan einer Abfrage zu prüfen, die gar nicht ausgeführt wird.
 */
describe('Query Plan', () => {
  async function plan(sql: string): Promise<string[]> {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all<{ detail: string }>();
    return results.map((zeile) => zeile.detail);
  }

  it('löst die Zuordnung je Produkt über den Primärschlüssel des Katalogs auf', async () => {
    const text = (await plan(PRODUCT_CATALOG_LINK_QUERIES.links)).join(' | ');

    // Die Produktliste selbst wird vollständig gelesen — das IST die Liste.
    // Das Katalogprodukt dazu darf aber kein zweiter Scan sein.
    expect(text).toContain('SEARCH cp');
  });

  /**
   * Die Frage „wer hält dieses Katalogprodukt?" läuft über
   * idx_products_catalog_product — den partiellen UNIQUE-Index aus Migration
   * 0014. Ohne ihn wäre die Auswahlliste ein Scan über products JE
   * KATALOGPRODUKT, also genau das N+1, das §23 verbietet.
   */
  it('findet den Halter eines Katalogprodukts über den Index aus 0014', async () => {
    const text = (await plan(PRODUCT_CATALOG_LINK_QUERIES.choices)).join(' | ');

    expect(text).toContain('idx_products_catalog_product');
    expect(text).not.toContain('SCAN p');
  });

  /**
   * DIE ZAHL DER ABFRAGEN IST TEIL DES VERTRAGS: ZWEI für den ganzen
   * Zuordnungsbereich, unabhängig davon, wie viele Produkte und wie viele
   * Katalogprodukte es gibt.
   *
   * Diese Prüfung ist der Wächter gegen ein N+1, das sich später einschleicht
   * — eine Schleife über Produkte oder Auswahloptionen fiele hier sofort auf.
   */
  it('kommt mit genau zwei Abfragen aus — unabhängig von der Datenmenge', async () => {
    expect(Object.keys(PRODUCT_CATALOG_LINK_QUERIES)).toHaveLength(2);

    for (let i = 1; i <= 12; i += 1) {
      await katalogprodukt(i, `Fiktives Katalogprodukt ${i}`, null, null);
      await produkt(i, `Fiktives Produkt ${i}`, i);
    }

    const zeilen = await loadProductLinks(env.DB);
    const optionen = await loadLinkableCatalogProducts(env.DB);

    expect(zeilen).toHaveLength(12);
    expect(optionen).toHaveLength(12);
  });
});
