import { InvalidArgumentError } from './errors';
import type { Product } from './product';

/**
 * Die Produkte, mit denen gerechnet werden darf.
 *
 * Dieser Typ ist Teil des Sicherheitsmodells, nicht bloß eine Sammlung: Er ist
 * die EINZIGE Quelle, aus der `placeOrder` Preise nimmt. Ein Preis, der nicht
 * aus einem Katalog stammt, kommt in keine Bestellung. Deshalb heißt die Klasse
 * so, wie sie heißt — man soll am Typ ablesen können, woher der Preis kommt.
 *
 * Aufgebaut wird der Katalog aus einer D1-Abfrage; siehe
 * infrastructure/d1/product-repository.ts.
 */
export class ProductCatalog {
  private constructor(private readonly byId: ReadonlyMap<number, Product>) {}

  static fromList(products: readonly Product[]): ProductCatalog {
    const byId = new Map<number, Product>();
    for (const product of products) {
      if (byId.has(product.id)) {
        throw new InvalidArgumentError('Der Produktkatalog enthält eine doppelte Produkt-ID.');
      }
      byId.set(product.id, product);
    }
    return new ProductCatalog(byId);
  }

  find(id: number): Product | null {
    return this.byId.get(id) ?? null;
  }

  get(id: number): Product {
    const product = this.find(id);
    if (product === null) {
      throw new InvalidArgumentError('Das Produkt ist nicht im Katalog enthalten.');
    }
    return product;
  }

  /**
   * Das vollständige bestellbare Sortiment in Anzeigereihenfolge.
   * Entspricht genau dem Index (is_active, sort_order, id) auf products.
   */
  orderable(): Product[] {
    return [...this.byId.values()]
      .filter((p) => p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  count(): number {
    return this.byId.size;
  }
}
