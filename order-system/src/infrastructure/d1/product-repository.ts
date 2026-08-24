import { Money } from '../../domain/money';
import { Product } from '../../domain/product';
import { ProductCatalog } from '../../domain/product-catalog';
import { toBoolean, type ProductRow } from './rows';

/**
 * Lädt das gesamte Sortiment in EINEM Zugriff.
 *
 * Bewusst nicht nur die aktiven Produkte: Eine bestehende Bestellung kann ein
 * inaktives Produkt enthalten, und der Katalog muss es dann noch auflösen
 * können. Welche Produkte neu bestellbar sind, entscheidet orderable() — also
 * die Domäne, nicht die Abfrage.
 *
 * Die Sortierung entspricht dem Index idx_products_orderable.
 */
export async function loadCatalog(db: D1Database): Promise<ProductCatalog> {
  const { results } = await db
    .prepare(
      `SELECT id, name, description, price_cents, unit, is_active, sort_order
         FROM products
        ORDER BY is_active DESC, sort_order, id`,
    )
    .all<ProductRow>();

  return ProductCatalog.fromList(results.map(toProduct));
}

function toProduct(row: ProductRow): Product {
  return new Product({
    id: row.id,
    name: row.name,
    description: row.description,
    unitPrice: Money.fromCents(row.price_cents),
    unit: row.unit,
    isActive: toBoolean(row.is_active),
    sortOrder: row.sort_order,
  });
}
