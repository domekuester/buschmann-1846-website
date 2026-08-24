import { describe, expect, it } from 'vitest';
import { toCatalogView } from '../../src/application/catalog-view';
import { Money } from '../../src/domain/money';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';

function product(overrides: Partial<ConstructorParameters<typeof Product>[0]> = {}): Product {
  return new Product({
    id: 1,
    name: 'Beispiel Käsekuchen',
    description: null,
    unitPrice: Money.fromCents(435),
    unit: 'Stück',
    isActive: true,
    sortOrder: 10,
    ...overrides,
  });
}

/**
 * Die Projektion ist die Grenze zwischen dem, was Buschmann über ein Produkt
 * weiß, und dem, was ein Café davon zu sehen bekommt. Sie ist deshalb eine
 * eigene, direkt geprüfte Funktion und keine Schleife im Seitengerüst.
 */
describe('toCatalogView', () => {
  it('liefert die Felder, die eine Bestellzeile braucht', () => {
    const view = toCatalogView(ProductCatalog.fromList([product({ description: 'Mit Sahne' })]));

    expect(view).toEqual([
      {
        id: 1,
        name: 'Beispiel Käsekuchen',
        description: 'Mit Sahne',
        priceCents: 435,
        unit: 'Stück',
      },
    ]);
  });

  it('liefert nur aktive Produkte', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([
        product({ id: 1, name: 'Aktiv', isActive: true }),
        product({ id: 2, name: 'Saisonartikel', isActive: false, sortOrder: 20 }),
      ]),
    );

    expect(view.map((p) => p.name)).toEqual(['Aktiv']);
  });

  it('sortiert nach sortOrder, bei Gleichstand nach id', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([
        product({ id: 7, name: 'Drittes', sortOrder: 30 }),
        product({ id: 3, name: 'Zweites b', sortOrder: 20 }),
        product({ id: 2, name: 'Zweites a', sortOrder: 20 }),
        product({ id: 9, name: 'Erstes', sortOrder: 10 }),
      ]),
    );

    expect(view.map((p) => p.name)).toEqual(['Erstes', 'Zweites a', 'Zweites b', 'Drittes']);
  });

  /**
   * Der eigentliche Zweck dieses Tests: Er scheitert, sobald jemand ein Feld
   * hinzufügt. Ein `expect(...).toMatchObject(...)` täte das nicht — und
   * genau so gerät ein is_active oder ein Zeitstempel in eine Antwort.
   */
  it('liefert exakt fünf Felder und kein internes', () => {
    const [item] = toCatalogView(ProductCatalog.fromList([product()]));

    expect(Object.keys(item ?? {}).sort()).toEqual([
      'description',
      'id',
      'name',
      'priceCents',
      'unit',
    ]);
  });

  it('liefert bei leerem Sortiment eine leere Liste', () => {
    expect(toCatalogView(ProductCatalog.fromList([]))).toEqual([]);
  });

  it('behält ganzzahlige Cent — keine Euro, keine Fließkommazahl', () => {
    const [item] = toCatalogView(ProductCatalog.fromList([product({ unitPrice: Money.fromCents(2400) })]));

    expect(item?.priceCents).toBe(2400);
    expect(Number.isInteger(item?.priceCents)).toBe(true);
  });
});
