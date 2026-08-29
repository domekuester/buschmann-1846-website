import type { CatalogPrice } from '../../src/domain/catalog-pricing';

/**
 * Testhilfen für die Preiswelt aus Phase 5C.
 *
 * Sie stehen in EINER Datei, weil die Verknüpfung products → catalog_products
 * → catalog_product_prices in jedem Bestelltest gebraucht wird. Sechs
 * abgeschriebene INSERT-Blöcke wären sechs Stellen, an denen jemand die
 * Verknüpfung anders herstellt als der Produktionscode sie erwartet.
 *
 * ALLE WERTE HIER SIND FREI ERFUNDEN. Die echten Buschmann-Preise stehen in
 * source-data/ und kommen in keinem Test vor.
 */

export const GASTRO = 1;
export const PRIVAT = 2;

/** Ein Preis, kurz notiert: eine Zahl meint einen Festpreis in Cent. */
export type PriceInput = number | CatalogPrice;

export interface PriceProductOptions {
  /** Das bestehende bestellbare Produkt (products.id). Muss schon existieren. */
  productId: number;
  /** Preis in der Gastronomie-Liste. Fehlt er, hat das Produkt dort keinen. */
  gastro?: PriceInput;
  /** Preis in der Privatkunden-Liste. */
  privat?: PriceInput;
  /** Ob das Katalogprodukt aktiv ist. Standard: ja. */
  catalogActive?: boolean;
  /** Nur nötig, wenn ein Test eine bestimmte Katalog-ID braucht. */
  catalogProductId?: number;
}

const TS = '2026-08-25T06:00:00.000Z';

function toPrice(input: PriceInput): CatalogPrice {
  return typeof input === 'number' ? { type: 'fixed', priceCents: input } : input;
}

function columns(price: CatalogPrice): [string, number | null, number | null, number | null] {
  switch (price.type) {
    case 'fixed':
      return ['fixed', price.priceCents, null, null];
    case 'from':
      return ['from', null, price.minPriceCents, null];
    case 'range':
      return ['range', null, price.minPriceCents, price.maxPriceCents];
    default:
      return ['on_request', null, null, null];
  }
}

/**
 * Legt zu einem bestehenden Produkt ein Katalogprodukt an, verknüpft beide
 * über products.catalog_product_id und hinterlegt die gewünschten Preise.
 *
 * Gibt die Katalog-ID zurück, damit ein Test den Preis später ändern kann —
 * genau das braucht die Snapshot-Prüfung.
 */
export async function priceProduct(
  db: D1Database,
  options: PriceProductOptions,
): Promise<number> {
  const catalogProductId = options.catalogProductId ?? 1000 + options.productId;
  const active = options.catalogActive === false ? 0 : 1;

  await db
    .prepare(
      `INSERT INTO catalog_products (id, source_key, name, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 10, ?, ?)`,
    )
    .bind(catalogProductId, `test-${catalogProductId}`, `Katalogprodukt ${catalogProductId}`, active, TS, TS)
    .run();

  await db
    .prepare('UPDATE products SET catalog_product_id = ? WHERE id = ?')
    .bind(catalogProductId, options.productId)
    .run();

  for (const [priceListId, input] of [
    [GASTRO, options.gastro],
    [PRIVAT, options.privat],
  ] as const) {
    if (input === undefined) continue;
    const [type, fest, min, max] = columns(toPrice(input));
    await db
      .prepare(
        `INSERT INTO catalog_product_prices
           (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(catalogProductId, priceListId, type, fest, min, max, TS, TS)
      .run();
  }

  return catalogProductId;
}

/**
 * Ordnet einen Kunden einer Preisgruppe zu.
 *
 * `null` entzieht sie wieder — den Zustand braucht jeder Test, der prüft, dass
 * ein nicht zugeordneter Kunde NICHT auf eine Standardgruppe zurückfällt.
 */
export async function assignPriceGroup(
  db: D1Database,
  customerId: number,
  priceListId: number | null,
): Promise<void> {
  await db
    .prepare('UPDATE customers SET price_list_id = ? WHERE id = ?')
    .bind(priceListId, customerId)
    .run();
}

/** Legt eine Preisliste still, ohne die bestehenden Zuordnungen anzufassen. */
export async function deactivatePriceList(db: D1Database, priceListId: number): Promise<void> {
  await db.prepare('UPDATE price_lists SET is_active = 0 WHERE id = ?').bind(priceListId).run();
}

/**
 * Ändert einen bestehenden Katalogpreis — der Vorgang, gegen den die
 * Snapshot-Invariante aus §12 antritt.
 */
export async function changeCatalogPrice(
  db: D1Database,
  catalogProductId: number,
  priceListId: number,
  priceCents: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE catalog_product_prices SET price_cents = ?, price_type = 'fixed',
              min_price_cents = NULL, max_price_cents = NULL
        WHERE product_id = ? AND price_list_id = ?`,
    )
    .bind(priceCents, catalogProductId, priceListId)
    .run();
}

/**
 * Setzt die internen Herstellkosten eines Katalogprodukts — der Vorgang,
 * gegen den die Kosten-Snapshot-Invariante aus Phase 7A antritt.
 *
 * `null` entfernt einen gepflegten Wert wieder. Die Funktion schreibt
 * AUSSCHLIESSLICH catalog_products.unit_cost_cents und fasst weder einen
 * Preis noch eine Bestellung an — genau wie der Produktionscode.
 */
export async function setProductCost(
  db: D1Database,
  catalogProductId: number,
  unitCostCents: number | null,
): Promise<void> {
  await db
    .prepare('UPDATE catalog_products SET unit_cost_cents = ? WHERE id = ?')
    .bind(unitCostCents, catalogProductId)
    .run();
}

/**
 * Die Tabellen, die ein Bestelltest leeren muss — IN DIESER REIHENFOLGE.
 *
 * products hängt seit 0014 an catalog_products; wer zuerst den Katalog leert,
 * bekommt einen Fremdschlüsselfehler statt einer leeren Datenbank.
 */
export const PRICING_TABLES = [
  'order_items',
  'orders',
  'auth_sessions',
  'auth_accounts',
  'products',
  'catalog_product_prices',
  'catalog_products',
  'customers',
  'order_number_sequences',
] as const;

/** Setzt die von 0012 eingespielten Preislisten wieder auf aktiv. */
export async function resetPriceLists(db: D1Database): Promise<void> {
  await db.prepare('UPDATE price_lists SET is_active = 1').run();
}
