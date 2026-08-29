import { describe, expect, it } from 'vitest';
import { toCatalogView } from '../../src/application/catalog-view';
import type { CatalogPrice } from '../../src/domain/catalog-pricing';
import { CustomerPriceBook } from '../../src/domain/order-pricing';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';

function product(overrides: Partial<ConstructorParameters<typeof Product>[0]> = {}): Product {
  return new Product({
    id: 1,
    name: 'Beispiel Käsekuchen',
    description: null,
    unit: 'Stück',
    isActive: true,
    sortOrder: 10,
    ...overrides,
  });
}

function buch(prices: Record<number, CatalogPrice> = { 1: { type: 'fixed', priceCents: 435 } }, id = 1) {
  return CustomerPriceBook.forPriceList(
    id,
    new Map(Object.entries(prices).map(([k, v]) => [Number(k), v])),
  );
}

/**
 * Die Projektion ist die Grenze zwischen dem, was Buschmann über ein Produkt
 * weiß, und dem, was ein Café davon zu sehen bekommt. Sie ist deshalb eine
 * eigene, direkt geprüfte Funktion und keine Schleife im Seitengerüst.
 *
 * SEIT PHASE 5C IST SIE KUNDENABHÄNGIG: Dieselbe Produktliste ergibt für
 * einen Gastronomie- und einen Privatkunden verschiedene Ansichten. Der Preis
 * ist deshalb kein `priceCents` mehr, sondern eine Preisform — denn „ab
 * 55,00 €" ist keine Zahl, und „auf Anfrage" erst recht nicht.
 */
describe('toCatalogView', () => {
  it('liefert die Felder, die eine Bestellzeile braucht', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([product({ description: 'Mit Sahne' })]),
      buch(),
    );

    expect(view).toEqual([
      {
        id: 1,
        name: 'Beispiel Käsekuchen',
        description: 'Mit Sahne',
        unit: 'Stück',
        price: { kind: 'fixed', priceCents: 435 },
      },
    ]);
  });

  it('liefert nur aktive Produkte', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([
        product({ id: 1, name: 'Aktiv', isActive: true }),
        product({ id: 2, name: 'Saisonartikel', isActive: false, sortOrder: 20 }),
      ]),
      buch(),
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
      buch(),
    );

    expect(view.map((p) => p.name)).toEqual(['Erstes', 'Zweites a', 'Zweites b', 'Drittes']);
  });

  /**
   * Der eigentliche Zweck dieses Tests: Er scheitert, sobald jemand ein Feld
   * hinzufügt. Ein `expect(...).toMatchObject(...)` täte das nicht — und
   * genau so gerät ein is_active oder ein Zeitstempel in eine Antwort.
   */
  it('liefert exakt fünf Felder und kein internes', () => {
    const [item] = toCatalogView(ProductCatalog.fromList([product()]), buch());

    expect(Object.keys(item ?? {}).sort()).toEqual(['description', 'id', 'name', 'price', 'unit']);
  });

  /** §39: Die interne Preislisten-ID darf die Anwendungsschicht nicht verlassen. */
  it('trägt die Preislisten-ID nicht nach außen', () => {
    const [item] = toCatalogView(ProductCatalog.fromList([product()]), buch(undefined, 2));

    expect(JSON.stringify(item)).not.toContain('priceListId');
    expect(item?.price).toEqual({ kind: 'fixed', priceCents: 435 });
  });

  it('liefert bei leerem Sortiment eine leere Liste', () => {
    expect(toCatalogView(ProductCatalog.fromList([]), buch())).toEqual([]);
  });

  it('behält ganzzahlige Cent — keine Euro, keine Fließkommazahl', () => {
    const [item] = toCatalogView(
      ProductCatalog.fromList([product()]),
      buch({ 1: { type: 'fixed', priceCents: 2400 } }),
    );

    expect(item?.price).toEqual({ kind: 'fixed', priceCents: 2400 });
  });
});

describe('toCatalogView — Preisformen', () => {
  it('zeigt dieselbe Produktliste je Preisliste mit anderen Preisen', () => {
    const catalog = ProductCatalog.fromList([product()]);

    const gastro = toCatalogView(catalog, buch({ 1: { type: 'fixed', priceCents: 1000 } }, 1));
    const privat = toCatalogView(catalog, buch({ 1: { type: 'fixed', priceCents: 1500 } }, 2));

    expect(gastro[0]?.price).toEqual({ kind: 'fixed', priceCents: 1000 });
    expect(privat[0]?.price).toEqual({ kind: 'fixed', priceCents: 1500 });
  });

  it('reicht „ab" quelltreu durch, ohne daraus einen Festpreis zu machen', () => {
    const [item] = toCatalogView(
      ProductCatalog.fromList([product()]),
      buch({ 1: { type: 'from', minPriceCents: 5500 } }),
    );

    expect(item?.price).toEqual({ kind: 'from', minPriceCents: 5500 });
  });

  it('reicht eine Preisspanne quelltreu durch', () => {
    const [item] = toCatalogView(
      ProductCatalog.fromList([product()]),
      buch({ 1: { type: 'range', minPriceCents: 5500, maxPriceCents: 7500 } }),
    );

    expect(item?.price).toEqual({ kind: 'range', minPriceCents: 5500, maxPriceCents: 7500 });
  });

  it('reicht „auf Anfrage" durch', () => {
    const [item] = toCatalogView(
      ProductCatalog.fromList([product()]),
      buch({ 1: { type: 'on_request' } }),
    );

    expect(item?.price).toEqual({ kind: 'on_request' });
  });

  /** §38: Ein fehlender Preis ist NICHT 0,00 €. */
  it('macht aus einem fehlenden Preis kein Nullpreis, sondern „nicht verfügbar"', () => {
    const [item] = toCatalogView(ProductCatalog.fromList([product()]), buch({}));

    expect(item?.price).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(item)).not.toContain('priceCents');
  });

  it('zeigt einem Kunden ohne Preisgruppe kein einziges Preisschild', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([product({ id: 1 }), product({ id: 2, sortOrder: 20 })]),
      CustomerPriceBook.unassigned(),
    );

    expect(view.map((p) => p.price)).toEqual([{ kind: 'unavailable' }, { kind: 'unavailable' }]);
  });

  it('zeigt bei stillgelegter Preisgruppe kein einziges Preisschild', () => {
    const view = toCatalogView(
      ProductCatalog.fromList([product()]),
      CustomerPriceBook.inactive(1),
    );

    expect(view.map((p) => p.price)).toEqual([{ kind: 'unavailable' }]);
  });
});
