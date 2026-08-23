import { describe, expect, it } from 'vitest';
import { Address } from '../../src/domain/address';
import { InvalidArgumentError } from '../../src/domain/errors';

describe('Address', () => {
  it('behält ihre Teile und trimmt sie', () => {
    const a = new Address('  Akademiestraße 8 ', ' 40213 ', ' Düsseldorf ');
    expect(a.street).toBe('Akademiestraße 8');
    expect(a.postalCode).toBe('40213');
    expect(a.city).toBe('Düsseldorf');
  });

  it('liefert eine Zeile für den Bestell-Snapshot', () => {
    const a = new Address('Akademiestraße 8', '40213', 'Düsseldorf');
    expect(a.toSingleLine()).toBe('Akademiestraße 8, 40213 Düsseldorf');
  });

  it('verlangt alle drei Teile', () => {
    const incomplete: Array<[string, string, string]> = [
      ['', '40213', 'Düsseldorf'],
      ['Straße 1', '', 'Düsseldorf'],
      ['Straße 1', '40213', ''],
      ['   ', '40213', 'Düsseldorf'],
    ];
    for (const parts of incomplete) {
      expect(() => new Address(...parts)).toThrow(InvalidArgumentError);
    }
  });

  it('lehnt zu lange Teile ab', () => {
    expect(() => new Address('a'.repeat(161), '40213', 'Düsseldorf')).toThrow(InvalidArgumentError);
    expect(() => new Address('Straße 1', '1'.repeat(11), 'Düsseldorf')).toThrow(InvalidArgumentError);
    expect(() => new Address('Straße 1', '40213', 'a'.repeat(101))).toThrow(InvalidArgumentError);
  });

  /**
   * Bewusst KEINE Formatprüfung: Eine PLZ-Regex im Domänenkern ist eine
   * klassische Überprüfungsfalle. Formathinweise gehören in die Eingabemaske.
   */
  it('akzeptiert nichtdeutsche Postleitzahlformate', () => {
    expect(new Address('Rue de la Paix 1', '1211', 'Genève').postalCode).toBe('1211');
  });

  /** Die Längen zählen Zeichen, nicht Bytes — sonst kippt jeder Umlaut die Grenze. */
  it('misst Längen in Zeichen, nicht in Bytes', () => {
    const city = 'ü'.repeat(100);
    expect(new Address('Straße 1', '40213', city).city).toBe(city);
  });
});
