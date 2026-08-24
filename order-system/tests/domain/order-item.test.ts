import { describe, expect, it } from 'vitest';
import { OrderItem } from '../../src/domain/order-item';
import { Product } from '../../src/domain/product';
import { InvalidArgumentError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';

function product(cents = 435): Product {
  return new Product({
    id: 1,
    name: 'Zitronen-Cheesecake',
    description: null,
    unitPrice: Money.fromCents(cents),
    unit: 'Stück',
    isActive: true,
    sortOrder: 10,
  });
}

describe('OrderItem', () => {
  it('nimmt seinen Snapshot aus dem Produkt', () => {
    const item = OrderItem.forProduct(product(), 3);
    expect(item.productId).toBe(1);
    expect(item.productNameSnapshot).toBe('Zitronen-Cheesecake');
    expect(item.productUnitSnapshot).toBe('Stück');
    expect(item.unitPrice.cents).toBe(435);
    expect(item.quantity).toBe(3);
  });

  /** Regel 6/7: Der Positionsbetrag wird berechnet, nicht entgegengenommen. */
  it('berechnet den Positionsbetrag aus Preis und Menge', () => {
    expect(OrderItem.forProduct(product(), 3).lineTotal.cents).toBe(1305);
    expect(OrderItem.forProduct(product(), 1).lineTotal.cents).toBe(435);
    expect(OrderItem.forProduct(product(), 10).lineTotal.cents).toBe(4350);
  });

  /**
   * Der Konstruktor hat gar kein Feld für den Positionsbetrag. Es gibt damit
   * im gesamten Code keinen Weg, einen abweichenden Betrag zu setzen — auch
   * nicht versehentlich, auch nicht durch einen späteren Entwickler.
   */
  it('kennt kein Feld, über das ein Betrag gesetzt werden könnte', () => {
    const item = OrderItem.forProduct(product(), 3);
    const smuggled = { productId: 1, quantity: 3, lineTotal: Money.fromCents(1), lineTotalCents: 1 };
    const rebuilt = new OrderItem({
      productId: smuggled.productId,
      productNameSnapshot: 'Zitronen-Cheesecake',
      productUnitSnapshot: 'Stück',
      unitPrice: Money.fromCents(435),
      quantity: smuggled.quantity,
    });
    expect(rebuilt.lineTotal.cents).toBe(1305);
    expect(item.lineTotal.cents).toBe(1305);
  });

  /** Regel 2: Menge muss größer als 0 sein. */
  it('verlangt eine Menge größer als null', () => {
    for (const bad of [0, -1, 2.5]) {
      expect(() => OrderItem.forProduct(product(), bad)).toThrow(InvalidArgumentError);
    }
  });

  it('begrenzt die Menge nach oben', () => {
    expect(OrderItem.forProduct(product(), OrderItem.MAX_QUANTITY).quantity).toBe(OrderItem.MAX_QUANTITY);
    expect(() => OrderItem.forProduct(product(), OrderItem.MAX_QUANTITY + 1)).toThrow(InvalidArgumentError);
  });

  it('verlangt die Snapshots', () => {
    const base = {
      productId: 1,
      productNameSnapshot: 'Kuchen',
      productUnitSnapshot: 'Stück',
      unitPrice: Money.fromCents(100),
      quantity: 1,
    };
    expect(() => new OrderItem({ ...base, productNameSnapshot: '  ' })).toThrow(InvalidArgumentError);
    expect(() => new OrderItem({ ...base, productUnitSnapshot: '' })).toThrow(InvalidArgumentError);
    expect(() => new OrderItem({ ...base, productId: 0 })).toThrow(InvalidArgumentError);
  });

  it('erlaubt einen Preis von null', () => {
    expect(OrderItem.forProduct(product(0), 4).lineTotal.cents).toBe(0);
  });
});
