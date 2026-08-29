import { describe, expect, it } from 'vitest';
import { Money } from '../../src/domain/money';
import { InvalidArgumentError } from '../../src/domain/errors';

describe('Money', () => {
  it('speichert ganzzahlige Cent exakt', () => {
    expect(Money.fromCents(1499).cents).toBe(1499);
    expect(Money.zero().cents).toBe(0);
  });

  it('lehnt negative Beträge ab', () => {
    expect(() => Money.fromCents(-1)).toThrow(InvalidArgumentError);
  });

  /**
   * Neu gegenüber der PHP-Fassung: PHP hatte int, TypeScript hat nur number.
   * Ein Bruchteil eines Cents ist genau der Fehler, den dieses Modell
   * ausschließen soll — er muss an der Grenze scheitern, nicht später leise
   * runden.
   */
  it('lehnt Nicht-Ganzzahlen ab', () => {
    for (const bad of [1.5, 0.1, -0.5, 1e-3]) {
      expect(() => Money.fromCents(bad)).toThrow(InvalidArgumentError);
    }
  });

  it('lehnt NaN und Unendlich ab', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => Money.fromCents(bad)).toThrow(InvalidArgumentError);
    }
  });

  it('lehnt Beträge oberhalb der Obergrenze ab', () => {
    expect(Money.fromCents(Money.MAX_CENTS).cents).toBe(Money.MAX_CENTS);
    expect(() => Money.fromCents(Money.MAX_CENTS + 1)).toThrow(InvalidArgumentError);
  });

  it('erkennt Überlauf bei Addition und Multiplikation', () => {
    const max = Money.fromCents(Money.MAX_CENTS);
    expect(() => max.plus(Money.fromCents(1))).toThrow(InvalidArgumentError);
    expect(() => max.multipliedBy(2)).toThrow(InvalidArgumentError);
  });

  /** Die Obergrenze muss weit unterhalb von Number.MAX_SAFE_INTEGER liegen. */
  it('bleibt mit der Obergrenze im exakt darstellbaren Zahlenbereich', () => {
    expect(Number.isSafeInteger(Money.MAX_CENTS)).toBe(true);
    expect(Money.MAX_CENTS * 2).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('addiert exakt, wo Fließkomma es nicht täte', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // die Rechnung, die dieses Modell verhindert
    expect(Money.fromCents(10).plus(Money.fromCents(20)).cents).toBe(30);
  });

  it('multipliziert exakt mit einer Menge', () => {
    expect(Money.fromCents(435).multipliedBy(3).cents).toBe(1305);
    expect(Money.fromCents(435).multipliedBy(0).cents).toBe(0);
    expect(Money.fromCents(0).multipliedBy(7).cents).toBe(0);
  });

  it('summiert viele kleine Beträge ohne Abweichung', () => {
    let sum = Money.zero();
    for (let i = 0; i < 100; i++) {
      sum = sum.plus(Money.fromCents(7));
    }
    expect(sum.cents).toBe(700);
  });

  it('lehnt negative und nicht ganzzahlige Faktoren ab', () => {
    expect(() => Money.fromCents(100).multipliedBy(-1)).toThrow(InvalidArgumentError);
    expect(() => Money.fromCents(100).multipliedBy(2.5)).toThrow(InvalidArgumentError);
  });

  it('vergleicht den Wert, nicht die Instanz', () => {
    expect(Money.fromCents(1499).equals(Money.fromCents(1499))).toBe(true);
    expect(Money.fromCents(1499).equals(Money.fromCents(1500))).toBe(false);
    expect(Money.zero().isZero()).toBe(true);
  });

  /** Anzeige- und Protokollformat. In die Datenbank gehen ausschließlich Cent. */
  it('formatiert mit zwei Nachkommastellen', () => {
    expect(Money.fromCents(1305).toDecimalString()).toBe('13.05');
    expect(Money.fromCents(1500).toDecimalString()).toBe('15.00');
    expect(Money.fromCents(5).toDecimalString()).toBe('0.05');
    expect(Money.zero().toDecimalString()).toBe('0.00');
    expect(Money.fromCents(Money.MAX_CENTS).toDecimalString()).toBe('99999999.99');
  });
});
