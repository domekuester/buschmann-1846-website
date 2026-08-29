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
 *
 * SEIT PHASE 5C WIRD price_cents NICHT MEHR GELESEN.
 *
 * Die Spalte steht weiterhin in der Tabelle — sie zu entfernen hieße, products
 * in SQLite neu aufzubauen, und dafür gibt es keinen Anlass. Sie ist hier
 * bloß nicht mehr AUSGEWÄHLT, und das ist die wirksamere Form derselben
 * Aussage: Was nicht geladen wird, kann nicht versehentlich als Preis
 * verwendet werden. Ein Rückfall auf den alten Einheitspreis müsste diese
 * Abfrage ändern, und das fällt in einem Diff auf.
 *
 * Der Preis eines Produkts kommt ab 5C aus loadCustomerPriceBook — also aus
 * der Preisliste des angemeldeten Kunden.
 */
export async function loadCatalog(db: D1Database): Promise<ProductCatalog> {
  const { results } = await db
    .prepare(
      `SELECT id, name, description, unit, is_active, sort_order
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
    unit: row.unit,
    isActive: toBoolean(row.is_active),
    sortOrder: row.sort_order,
  });
}
