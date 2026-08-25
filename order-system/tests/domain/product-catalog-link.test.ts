import { describe, expect, it } from 'vitest';
import { catalogProductLabel } from '../../src/domain/product-catalog-link';

/**
 * Das Label, mit dem ein Admin ein Katalogprodukt in einer Auswahlliste
 * WIEDERERKENNT — §8 des Auftrags.
 *
 * Es ist eine reine Funktion über drei bereits vorhandene Katalogfelder und
 * lebt deshalb in der Domäne: Sie ist ohne D1, ohne Request und ohne HTML
 * prüfbar, und genau diese Tests sind die Stelle, an der über die Form des
 * Labels entschieden wird.
 *
 * ALLE NAMEN HIER SIND FREI ERFUNDEN.
 */
describe('catalogProductLabel', () => {
  it('nennt Name und Variante — der Regelfall aus §8', () => {
    expect(catalogProductLabel({ name: 'Käsekuchen', variant: '26-cm-Ring', unit: null }))
      .toBe('Käsekuchen · 26-cm-Ring');
  });

  it('nennt Name und Einheit, wenn es keine Variante gibt', () => {
    expect(catalogProductLabel({ name: 'Butterkuchen', variant: null, unit: 'Blech' }))
      .toBe('Butterkuchen · Blech');
  });

  it('nennt beides, wenn beides da ist — Eindeutigkeit geht vor Kürze', () => {
    expect(catalogProductLabel({ name: 'Mamorkuchen', variant: 'Kasten', unit: '30 cm' }))
      .toBe('Mamorkuchen · Kasten · 30 cm');
  });

  it('bleibt beim bloßen Namen, wenn der Katalog nichts weiter hergibt', () => {
    expect(catalogProductLabel({ name: 'Baumkuchen', variant: null, unit: null }))
      .toBe('Baumkuchen');
  });

  it('behandelt leere und nur aus Leerraum bestehende Zusätze wie fehlende', () => {
    expect(catalogProductLabel({ name: 'Streuselkuchen', variant: '', unit: '   ' }))
      .toBe('Streuselkuchen');
  });

  it('räumt Leerraum an den Rändern weg, ohne das Innere anzutasten', () => {
    expect(catalogProductLabel({ name: '  Nusskuchen ', variant: ' halbes Blech ', unit: null }))
      .toBe('Nusskuchen · halbes Blech');
  });

  /**
   * DIE ZEILEN-ID GEHÖRT NICHT INS LABEL — §8. Sie ist ein interner Wert; sie
   * steht im value der Option, wo der Server sie braucht, und nicht in dem,
   * was ein Mensch liest.
   *
   * Geprüft wird das an einem Katalogprodukt, dessen drei Felder KEINE Ziffer
   * enthalten: Taucht im Label trotzdem eine auf, kann sie nur aus einem
   * technischen Wert stammen. („26-cm-Ring" wäre für diese Frage untauglich —
   * dort sind Ziffern Teil der Fachsprache.)
   */
  it('trägt keine Datenbank-ID', () => {
    const label = catalogProductLabel({
      name: 'Käsekuchen',
      variant: 'grosser Ring',
      unit: 'Stück',
    });
    expect(label).toBe('Käsekuchen · grosser Ring · Stück');
    expect(label).not.toMatch(/\d/);
  });
});
