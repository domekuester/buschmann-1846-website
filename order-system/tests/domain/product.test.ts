import { describe, expect, it } from 'vitest';
import { Product } from '../../src/domain/product';
import { InvalidArgumentError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';

function product(overrides: Partial<ConstructorParameters<typeof Product>[0]> = {}): Product {
  return new Product({
    id: 1,
    name: 'Zitronen-Cheesecake',
    description: null,
    unitPrice: Money.fromCents(435),
    unit: 'Stück',
    isActive: true,
    sortOrder: 10,
    ...overrides,
  });
}

describe('Product', () => {
  it('behält seine Daten', () => {
    const p = product();
    expect(p.id).toBe(1);
    expect(p.name).toBe('Zitronen-Cheesecake');
    expect(p.unitPrice.cents).toBe(435);
    expect(p.unit).toBe('Stück');
    expect(p.isActive).toBe(true);
    expect(p.sortOrder).toBe(10);
    expect(p.description).toBeNull();
  });

  it('macht aus einer leeren Beschreibung null', () => {
    expect(product({ description: '   ' }).description).toBeNull();
    expect(product({ description: ' Mürbeteig ' }).description).toBe('Mürbeteig');
  });

  it('verlangt einen Namen', () => {
    expect(() => product({ name: '  ' })).toThrow(InvalidArgumentError);
    expect(() => product({ name: 'a'.repeat(121) })).toThrow(InvalidArgumentError);
  });

  it('verlangt eine Einheit', () => {
    expect(() => product({ unit: '' })).toThrow(InvalidArgumentError);
    expect(() => product({ unit: 'a'.repeat(21) })).toThrow(InvalidArgumentError);
  });

  /** Die Einheit ist ein freies Anzeigelabel — keine Enum, keine Migration je Einheit. */
  it('akzeptiert jede sinnvolle Einheitenbezeichnung', () => {
    for (const unit of ['Stück', 'Blech', 'kg', 'Torte', 'Portion']) {
      expect(product({ unit }).unit).toBe(unit);
    }
  });

  it('verlangt eine positive ID', () => {
    for (const id of [0, -1, 1.5]) {
      expect(() => product({ id })).toThrow(InvalidArgumentError);
    }
  });

  it('lässt keine negative Sortierreihenfolge zu', () => {
    expect(() => product({ sortOrder: -1 })).toThrow(InvalidArgumentError);
    expect(() => product({ sortOrder: 2.5 })).toThrow(InvalidArgumentError);
  });

  it('begrenzt die Länge der Beschreibung', () => {
    expect(() => product({ description: 'a'.repeat(501) })).toThrow(InvalidArgumentError);
  });
});
