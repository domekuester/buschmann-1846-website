import { describe, expect, it } from 'vitest';
import { normalizeLoginIdentifier } from '../../src/domain/login-identifier';

/**
 * Die Normalisierung entscheidet, WELCHER Account gemeint ist. Sie muss
 * deshalb eindeutig, dokumentiert und stabil sein — und sie darf niemals
 * raten.
 */
describe('normalizeLoginIdentifier — Kundencode und E-Mail', () => {
  it('schreibt einen Kundencode klein', () => {
    expect(normalizeLoginIdentifier('CAFE27')).toBe('cafe27');
    expect(normalizeLoginIdentifier('TESTCAFE')).toBe('testcafe');
  });

  it('trimmt eine E-Mail-Adresse und schreibt sie klein', () => {
    expect(normalizeLoginIdentifier('  Admin@Example.test  ')).toBe('admin@example.test');
  });

  it('lässt Punkt, Plus, Bindestrich und Unterstrich stehen', () => {
    expect(normalizeLoginIdentifier('vor.nach+tag@example.test')).toBe('vor.nach+tag@example.test');
    expect(normalizeLoginIdentifier('CAFE-27_NORD')).toBe('cafe-27_nord');
  });

  /**
   * KEIN Fuzzy-Matching. Punkte in E-Mail-Adressen werden nicht entfernt,
   * '+tag'-Suffixe nicht abgeschnitten. Beides wäre eine Annahme darüber, wie
   * ein fremder Mailserver Adressen behandelt — und im Zweifel eine Anmeldung
   * als jemand anderes.
   */
  it('behandelt Adressen mit und ohne Punkt als verschieden', () => {
    expect(normalizeLoginIdentifier('a.b@example.test')).not.toBe(
      normalizeLoginIdentifier('ab@example.test'),
    );
  });

  it('behandelt Adressen mit und ohne Tag als verschieden', () => {
    expect(normalizeLoginIdentifier('a+x@example.test')).not.toBe(
      normalizeLoginIdentifier('a@example.test'),
    );
  });
});

describe('normalizeLoginIdentifier — unsichtbare Zeichen', () => {
  it('entfernt Zero-Width Space und BOM', () => {
    expect(normalizeLoginIdentifier('CAFE\u200b27')).toBe('cafe27');
    expect(normalizeLoginIdentifier('\ufeffCAFE27\ufeff')).toBe('cafe27');
  });

  it('entfernt Richtungsmarkierungen', () => {
    expect(normalizeLoginIdentifier('\u200eCAFE27\u200f')).toBe('cafe27');
  });

  it('trimmt auch Unicode-Whitespace', () => {
    expect(normalizeLoginIdentifier('\u00a0CAFE27\u2009')).toBe('cafe27');
  });

  it('vereinheitlicht Vollbreitenzeichen über NFKC', () => {
    expect(normalizeLoginIdentifier('ＣＡＦＥ２７')).toBe('cafe27');
  });
});

describe('normalizeLoginIdentifier — Ablehnung', () => {
  it('lehnt Leeres ab', () => {
    for (const value of ['', '   ', '\t\n', '\u200b\ufeff']) {
      expect(normalizeLoginIdentifier(value)).toBeNull();
    }
  });

  it('lehnt Steuerzeichen ab', () => {
    expect(normalizeLoginIdentifier('CAFE\u000027')).toBeNull();
    expect(normalizeLoginIdentifier('CAFE\u001b27')).toBeNull();
    expect(normalizeLoginIdentifier('CAFE\n27')).toBeNull();
  });

  it('lehnt zu lange Kennungen ab', () => {
    expect(normalizeLoginIdentifier('a'.repeat(190))).toHaveLength(190);
    expect(normalizeLoginIdentifier('a'.repeat(191))).toBeNull();
  });

  it('lehnt alles ab, was keine Zeichenkette ist', () => {
    for (const value of [null, undefined, 42, true, {}, [], () => 'x']) {
      expect(normalizeLoginIdentifier(value)).toBeNull();
    }
  });

  /**
   * Der Zeichenvorrat ist eine Allowlist, keine Blocklist. Ein kyrillisches
   * 'а' sieht aus wie ein lateinisches 'a' und wäre sonst ein zweiter,
   * unsichtbar verschiedener Account mit demselben Aussehen.
   */
  it('lehnt Zeichen außerhalb des Vorrats ab', () => {
    for (const value of ['cafe27!', 'café27', 'саfe27', 'cafe 27', 'cafe/27', 'cafe#27', 'cafe%27']) {
      expect(normalizeLoginIdentifier(value)).toBeNull();
    }
  });

  it('lehnt ein Zeichen ab, dessen Kleinschreibung ein kombinierendes Zeichen erzeugt', () => {
    // U+0130 wird zu 'i' + U+0307. Das Ergebnis ist nicht im Vorrat und damit
    // eindeutig abgelehnt statt stillschweigend zu 'i' verkürzt.
    expect(normalizeLoginIdentifier('\u0130')).toBeNull();
  });

  it('wirft nie', () => {
    for (const value of [null, undefined, {}, [], Symbol('x'), 42n]) {
      expect(() => normalizeLoginIdentifier(value)).not.toThrow();
    }
  });
});

describe('normalizeLoginIdentifier — Stabilität', () => {
  /**
   * Ohne diese Eigenschaft wäre ein bei der Provisionierung geschriebener
   * Wert nicht zwingend gleich dem beim Login berechneten — und der Account
   * wäre unauffindbar.
   */
  it('ist idempotent', () => {
    const beispiele = [
      'CAFE27',
      '  Admin@Example.test  ',
      'ＣＡＦＥ２７',
      'CAFE\u200b27',
      'vor.nach+tag@example.test',
      'CAFE-27_NORD',
      'I',
    ];

    for (const beispiel of beispiele) {
      const einmal = normalizeLoginIdentifier(beispiel);
      expect(einmal).not.toBeNull();
      expect(normalizeLoginIdentifier(einmal)).toBe(einmal);
    }
  });

  /**
   * toLowerCase(), nicht toLocaleLowerCase(): In türkischem Locale würde 'I'
   * zu 'ı' (dotless i) und derselbe Kundencode je nach Serverlocale zu einem
   * anderen Account führen.
   */
  it('schreibt locale-unabhängig klein', () => {
    expect(normalizeLoginIdentifier('I')).toBe('i');
    expect(normalizeLoginIdentifier('CAFEI')).toBe('cafei');
  });
});
