import type { AdminProductInput, AdminProductView } from '../../domain/admin-product';
import type { CatalogPrice } from '../../domain/catalog-pricing';

interface AdminProductRow {
  catalog_id: number;
  orderable_id: number | null;
  name: string;
  unit: string | null;
  catalog_active: number;
  orderable_active: number | null;
  unit_cost_cents: number | null;
  updated_at: string;
  price_list_code: 'gastro' | 'private';
  price_type: CatalogPrice['type'] | null;
  price_cents: number | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
}

export type AdminProductUpdateResult = 'updated' | 'conflict';

/** One query for the whole product workspace, independent of catalog size. */
export async function loadAdminProducts(db: D1Database): Promise<AdminProductView[]> {
  const { results } = await db.prepare(
    `SELECT cp.id AS catalog_id, p.id AS orderable_id, cp.name, cp.unit,
            cp.is_active AS catalog_active, p.is_active AS orderable_active,
            cp.unit_cost_cents, cp.updated_at, l.code AS price_list_code,
            cpp.price_type, cpp.price_cents, cpp.min_price_cents, cpp.max_price_cents
       FROM catalog_products cp
       CROSS JOIN price_lists l
       LEFT JOIN products p ON p.catalog_product_id = cp.id
       LEFT JOIN catalog_product_prices cpp
         ON cpp.product_id = cp.id AND cpp.price_list_id = l.id
      WHERE l.code IN ('gastro', 'private')
      ORDER BY cp.sort_order, cp.id, l.sort_order`,
  ).all<AdminProductRow>();

  const products = new Map<number, AdminProductView>();
  for (const row of results) {
    const current = products.get(row.catalog_id) ?? {
      id: row.catalog_id,
      orderableProductId: row.orderable_id,
      name: row.name,
      unit: row.unit ?? '',
      isActive: row.catalog_active === 1 && row.orderable_active === 1,
      gastroPrice: null,
      privatePrice: null,
      unitCostCents: row.unit_cost_cents,
      updatedAt: row.updated_at,
    };
    const parsed = toPrice(row);
    products.set(row.catalog_id, row.price_list_code === 'gastro'
      ? { ...current, gastroPrice: parsed }
      : { ...current, privatePrice: parsed });
  }
  return [...products.values()];
}

/**
 * Creates the catalog identity, both price-list rows and the internal
 * orderable relation in one D1 transaction. The source key is generated on
 * the server and is never an operator field.
 */
export async function createAdminProduct(
  db: D1Database,
  input: AdminProductInput,
  now: string,
): Promise<void> {
  const sourceKey = `admin:${crypto.randomUUID()}`;
  const legacyPrice = fixedFallback(input);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO catalog_products
         (source_key, name, variant, unit, category, is_active, sort_order,
          unit_cost_cents, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, ?,
               (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM catalog_products),
               ?, ?, ?)`,
    ).bind(sourceKey, input.name, input.unit, bool(input.isActive), input.unitCostCents, now, now),
  ];

  addCreatePrice(statements, db, sourceKey, 'gastro', input.gastroPrice, now);
  addCreatePrice(statements, db, sourceKey, 'private', input.privatePrice, now);
  statements.push(
    db.prepare(
      `INSERT INTO products
         (name, description, price_cents, unit, is_active, sort_order,
          catalog_product_id, created_at, updated_at)
       SELECT cp.name, NULL, ?, cp.unit, ?, cp.sort_order, cp.id, ?, ?
         FROM catalog_products cp WHERE cp.source_key = ?`,
    ).bind(legacyPrice, bool(input.isActive), now, now, sourceKey),
  );

  await db.batch(statements);
}

/**
 * Updates every current-data table coherently. All statements after the
 * compare-and-set are conditional on the new timestamp, so a stale first
 * statement makes the rest no-ops inside the same D1 transaction.
 */
export async function updateAdminProduct(
  db: D1Database,
  catalogProductId: number,
  expectedUpdatedAt: string,
  input: AdminProductInput,
  now: string,
): Promise<AdminProductUpdateResult> {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE catalog_products
          SET name = ?, unit = ?, is_active = ?, unit_cost_cents = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
    ).bind(
      input.name,
      input.unit,
      bool(input.isActive),
      input.unitCostCents,
      now,
      catalogProductId,
      expectedUpdatedAt,
    ),
  ];

  addUpdatePrice(statements, db, catalogProductId, now, 'gastro', input.gastroPrice);
  addUpdatePrice(statements, db, catalogProductId, now, 'private', input.privatePrice);
  statements.push(
    db.prepare(
      `INSERT INTO products
         (name, description, price_cents, unit, is_active, sort_order,
          catalog_product_id, created_at, updated_at)
       SELECT cp.name, NULL, ?, cp.unit, ?, cp.sort_order, cp.id, ?, ?
         FROM catalog_products cp
        WHERE cp.id = ? AND cp.updated_at = ?
          AND NOT EXISTS (SELECT 1 FROM products p WHERE p.catalog_product_id = cp.id)`,
    ).bind(fixedFallback(input), bool(input.isActive), now, now, catalogProductId, now),
    db.prepare(
      `UPDATE products
          SET name = ?, unit = ?, price_cents = ?, is_active = ?, updated_at = ?
        WHERE catalog_product_id = ?
          AND EXISTS (
            SELECT 1 FROM catalog_products cp WHERE cp.id = ? AND cp.updated_at = ?
          )`,
    ).bind(
      input.name,
      input.unit,
      fixedFallback(input),
      bool(input.isActive),
      now,
      catalogProductId,
      catalogProductId,
      now,
    ),
  );

  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
}

function addCreatePrice(
  statements: D1PreparedStatement[],
  db: D1Database,
  sourceKey: string,
  listCode: 'gastro' | 'private',
  price: CatalogPrice | null,
  now: string,
): void {
  if (price === null) return;
  const shape = columns(price);
  statements.push(
    db.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents,
          min_price_cents, max_price_cents, created_at, updated_at)
       SELECT cp.id, l.id, ?, ?, ?, ?, ?, ?
         FROM catalog_products cp CROSS JOIN price_lists l
        WHERE cp.source_key = ? AND l.code = ?`,
    ).bind(price.type, shape.exact, shape.minimum, shape.maximum, now, now, sourceKey, listCode),
  );
}

function addUpdatePrice(
  statements: D1PreparedStatement[],
  db: D1Database,
  productId: number,
  now: string,
  listCode: 'gastro' | 'private',
  price: CatalogPrice | null,
): void {
  if (price === null) {
    statements.push(
      db.prepare(
        `DELETE FROM catalog_product_prices
          WHERE product_id = ?
            AND price_list_id = (SELECT id FROM price_lists WHERE code = ?)
            AND EXISTS (
              SELECT 1 FROM catalog_products cp WHERE cp.id = ? AND cp.updated_at = ?
            )`,
      ).bind(productId, listCode, productId, now),
    );
    return;
  }

  const shape = columns(price);
  statements.push(
    db.prepare(
      `INSERT INTO catalog_product_prices
         (product_id, price_list_id, price_type, price_cents,
          min_price_cents, max_price_cents, created_at, updated_at)
       SELECT cp.id, l.id, ?, ?, ?, ?, ?, ?
         FROM catalog_products cp CROSS JOIN price_lists l
        WHERE cp.id = ? AND cp.updated_at = ? AND l.code = ?
       ON CONFLICT(product_id, price_list_id) DO UPDATE SET
         price_type = excluded.price_type,
         price_cents = excluded.price_cents,
         min_price_cents = excluded.min_price_cents,
         max_price_cents = excluded.max_price_cents,
         updated_at = excluded.updated_at`,
    ).bind(price.type, shape.exact, shape.minimum, shape.maximum, now, now, productId, now, listCode),
  );
}

function columns(price: CatalogPrice): {
  readonly exact: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
} {
  if (price.type === 'fixed') return { exact: price.priceCents, minimum: null, maximum: null };
  if (price.type === 'from') return { exact: null, minimum: price.minPriceCents, maximum: null };
  if (price.type === 'range') return {
    exact: null,
    minimum: price.minPriceCents,
    maximum: price.maxPriceCents,
  };
  return { exact: null, minimum: null, maximum: null };
}

function fixedFallback(input: AdminProductInput): number {
  if (input.gastroPrice?.type === 'fixed') return input.gastroPrice.priceCents;
  if (input.privatePrice?.type === 'fixed') return input.privatePrice.priceCents;
  return 0;
}

function toPrice(row: AdminProductRow): CatalogPrice | null {
  if (row.price_type === null) return null;
  if (row.price_type === 'fixed' && row.price_cents !== null) {
    return { type: 'fixed', priceCents: row.price_cents };
  }
  if (row.price_type === 'from' && row.min_price_cents !== null) {
    return { type: 'from', minPriceCents: row.min_price_cents };
  }
  if (row.price_type === 'range' && row.min_price_cents !== null && row.max_price_cents !== null) {
    return { type: 'range', minPriceCents: row.min_price_cents, maxPriceCents: row.max_price_cents };
  }
  return row.price_type === 'on_request' ? { type: 'on_request' } : null;
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}
