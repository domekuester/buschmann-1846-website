import { describe, expect, it } from 'vitest';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';
import { InvalidArgumentError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';

function product(id: number, name: string, isActive = true, sortOrder = 0): Product {
  return new Product({
    id,
    name,
    description: null,
    unitPrice: Money.fromCents(400),
    unit: 'Stück',
    isActive,
    sortOrder,
  });
}

describe('ProductCatalog', () => {
  it('findet Produkte über ihre ID', () => {
    const catalog = ProductCatalog.fromList([product(1, 'A'), product(2, 'B')]);
    expect(catalog.get(2).name).toBe('B');
    expect(catalog.count()).toBe(2);
  });

  it('liefert null für unbekannte Produkte', () => {
    expect(ProductCatalog.fromList([product(1, 'A')]).find(99)).toBeNull();
  });

  /** get() ist für Stellen, an denen ein fehlendes Produkt ein Fehler ist. */
  it('wirft bei get() für unbekannte Produkte', () => {
    const catalog = ProductCatalog.fromList([product(1, 'A')]);
    expect(() => catalog.get(99)).toThrow(InvalidArgumentError);
  });

  /**
   * Die Bestellseite braucht das gesamte aktive Sortiment in Anzeigereihenfolge
   * in einem Zugriff — sonst ist der 20-Sekunden-Flow nicht zu halten.
   */
  it('liefert bestellbare Produkte aktiv und sortiert', () => {
    const catalog = ProductCatalog.fromList([
      product(3, 'Drittes', true, 30),
      product(1, 'Erstes', true, 10),
      product(9, 'Inaktives', false, 5),
      product(2, 'Zweites', true, 20),
    ]);
    expect(catalog.orderable().map((p) => p.name)).toEqual(['Erstes', 'Zweites', 'Drittes']);
  });

  it('sortiert bei gleicher Reihenfolge stabil über die ID', () => {
    const catalog = ProductCatalog.fromList([product(7, 'Sieben', true, 10), product(3, 'Drei', true, 10)]);
    expect(catalog.orderable().map((p) => p.name)).toEqual(['Drei', 'Sieben']);
  });

  it('hält inaktive Produkte auffindbar, aber nicht bestellbar', () => {
    const catalog = ProductCatalog.fromList([product(9, 'Inaktiv', false)]);
    expect(catalog.find(9)).not.toBeNull();
    expect(catalog.orderable()).toHaveLength(0);
  });

  it('lehnt doppelte Produkt-IDs ab', () => {
    expect(() => ProductCatalog.fromList([product(1, 'A'), product(1, 'B')])).toThrow(InvalidArgumentError);
  });

  it('erlaubt einen leeren Katalog', () => {
    const catalog = ProductCatalog.fromList([]);
    expect(catalog.count()).toBe(0);
    expect(catalog.orderable()).toHaveLength(0);
  });
});
