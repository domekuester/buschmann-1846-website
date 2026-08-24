import { describe, expect, it } from 'vitest';
import { OrderNumber } from '../../src/domain/order-number';
import { InvalidArgumentError } from '../../src/domain/errors';

describe('OrderNumber', () => {
  it('besteht aus Präfix, Jahr und sechs Ziffern', () => {
    expect(OrderNumber.fromYearAndSequence(2026, 123).value).toBe('BUS-2026-000123');
    expect(OrderNumber.fromYearAndSequence(2026, 1).value).toBe('BUS-2026-000001');
    expect(OrderNumber.fromYearAndSequence(2026, 999999).value).toBe('BUS-2026-999999');
  });

  it('liest sein eigenes Format', () => {
    const n = OrderNumber.fromString('BUS-2026-000123');
    expect(n.year).toBe(2026);
    expect(n.sequence).toBe(123);
    expect(n.value).toBe('BUS-2026-000123');
  });

  it('lehnt fremde oder fehlerhafte Nummern ab', () => {
    for (const bad of [
      '', 'BUS-2026-123', 'bus-2026-000123', 'BUS-26-000123', 'BUS-2026-0001234',
      'XYZ-2026-000123', 'BUS_2026_000123', 'BUS-2026-000000', ' BUS-2026-000123',
    ]) {
      expect(() => OrderNumber.fromString(bad)).toThrow(InvalidArgumentError);
    }
  });

  it('beginnt bei eins und hat eine Obergrenze', () => {
    for (const bad of [0, -1, 1_000_000, 1.5]) {
      expect(() => OrderNumber.fromYearAndSequence(2026, bad)).toThrow(InvalidArgumentError);
    }
  });

  it('verlangt ein plausibles Jahr', () => {
    for (const bad of [1999, 10000, 2026.5]) {
      expect(() => OrderNumber.fromYearAndSequence(bad, 1)).toThrow(InvalidArgumentError);
    }
  });

  it('vergleicht den Wert', () => {
    expect(OrderNumber.fromYearAndSequence(2026, 7).equals(OrderNumber.fromString('BUS-2026-000007'))).toBe(true);
    expect(OrderNumber.fromYearAndSequence(2026, 7).equals(OrderNumber.fromYearAndSequence(2027, 7))).toBe(false);
  });

  /**
   * Am Telefon: „B-U-S, zweitausendsechsundzwanzig, null null null eins zwei
   * drei." Feste Länge, weil Menschen gleichlange Ziffernblöcke schneller
   * vorlesen und abgleichen.
   */
  it('hat immer dieselbe Länge', () => {
    expect(OrderNumber.fromYearAndSequence(2026, 1).value).toHaveLength(15);
    expect(OrderNumber.fromYearAndSequence(2026, 999999).value).toHaveLength(15);
  });
});
