import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatEuro,
  formatGermanDate,
  formatGermanDayMonthYear,
  formatGermanNumericDate,
  formatGermanShortDate,
  formatGermanWeekday,
  formatPercentFromTenths,
  formatSignedEuro,
} from '../../src/ui/format';

describe('formatEuro', () => {
  it('setzt das deutsche Dezimalkomma', () => {
    expect(formatEuro(435)).toBe('4,35 €');
  });

  it('füllt fehlende Cent auf', () => {
    expect(formatEuro(2400)).toBe('24,00 €');
    expect(formatEuro(2405)).toBe('24,05 €');
  });

  it('behandelt Beträge unter einem Euro', () => {
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(5)).toBe('0,05 €');
    expect(formatEuro(99)).toBe('0,99 €');
  });

  it('gruppiert Tausender mit einem Punkt', () => {
    expect(formatEuro(123456)).toBe('1.234,56 €');
    expect(formatEuro(100000)).toBe('1.000,00 €');
    expect(formatEuro(123456789)).toBe('1.234.567,89 €');
  });

  /**
   * Der Grund, warum hier nicht Intl.NumberFormat steht: Intl nimmt eine
   * Fließkommazahl entgegen. Cent/100 wäre genau der Fließkommawert, den
   * Money.ts im ganzen System vermeidet — auch wenn er „nur für die Anzeige"
   * entstünde.
   */
  it('erzeugt auf dem Weg keine Fließkommazahl', () => {
    expect(formatEuro(10)).toBe('0,10 €');
    expect(formatEuro(3)).toBe('0,03 €');
    expect(formatEuro(9999999999)).toBe('99.999.999,99 €');
  });

  it('lehnt ab, was kein Cent-Betrag ist', () => {
    expect(() => formatEuro(4.35)).toThrow();
    expect(() => formatEuro(-1)).toThrow();
  });
});

describe('escapeHtml', () => {
  it('entschärft die fünf Zeichen, die aus Text Markup machen', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"zitat"')).toBe('&quot;zitat&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('lässt aus einem Angriff keinen spitzen Klammerausdruck übrig', () => {
    const escaped = escapeHtml('<img src=x onerror="alert(1)">');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
  });

  it('escapt das kaufmännische Und zuerst', () => {
    // Sonst würde aus '&' erst '&amp;' und daraus '&amp;amp;'.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('lässt Umlaute, Eszett und Zeichensetzung unangetastet', () => {
    expect(escapeHtml('Käsekuchen für Düsseldorf — 3 Stück, groß')).toBe(
      'Käsekuchen für Düsseldorf — 3 Stück, groß',
    );
  });

  it('kommt mit leerem Text zurecht', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('formatGermanDate', () => {
  it('schreibt Wochentag und Monat aus', () => {
    expect(formatGermanDate('2026-08-25')).toBe('Dienstag, 25. August 2026');
  });

  it('lässt die führende Null im Tag weg', () => {
    expect(formatGermanDate('2026-01-05')).toBe('Montag, 5. Januar 2026');
  });

  /**
   * Der Tag wird als UTC gelesen, nicht in der Zone des Systems. Sonst wäre
   * '2026-08-25' auf einem Rechner westlich von Greenwich der 24. August.
   */
  it('verschiebt den Tag nicht über eine Zeitzone', () => {
    expect(formatGermanDate('2026-08-01')).toBe('Samstag, 1. August 2026');
    expect(formatGermanDate('2026-12-31')).toBe('Donnerstag, 31. Dezember 2026');
  });

  it('lehnt ab, was kein Kalendertag ist', () => {
    expect(() => formatGermanDate('25.08.2026')).toThrow();
    expect(() => formatGermanDate('2026-02-30')).toThrow();
  });
});

describe('formatGermanWeekday', () => {
  it('nennt den Wochentag', () => {
    expect(formatGermanWeekday('2026-08-24')).toBe('Montag');
    expect(formatGermanWeekday('2026-08-30')).toBe('Sonntag');
  });

  it('verschiebt den Tag nicht über die Zeitzone', () => {
    // Mitternacht UTC, in Berlin bereits der 25. — der Wochentag bleibt der
    // des Liefertages und nicht der einer Umrechnung.
    expect(formatGermanWeekday('2026-08-25')).toBe('Dienstag');
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() => formatGermanWeekday('2026-02-30')).toThrow();
  });
});

describe('formatGermanDayMonthYear', () => {
  it('schreibt den Tag ohne Wochentag', () => {
    expect(formatGermanDayMonthYear('2026-08-24')).toBe('24. August 2026');
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() => formatGermanDayMonthYear('nicht-ein-tag')).toThrow();
  });
});

/**
 * PHASE 7C — die kurze Schreibweise MIT Jahr.
 *
 * Sie steht neben formatGermanShortDate() und nicht an ihrer Stelle: Die
 * Wochenzeile braucht kein Jahr, weil die Woche vollständig in der
 * Überschrift darübersteht. Eine Bestellhistorie hat keine solche
 * Überschrift — dort reichte „24.08." über einen Jahreswechsel hinweg nicht
 * aus, um zwei Bestellungen auseinanderzuhalten.
 */
describe('formatGermanNumericDate', () => {
  it('schreibt Tag, Monat und Jahr zweistellig beziehungsweise vierstellig', () => {
    expect(formatGermanNumericDate('2026-08-27')).toBe('27.08.2026');
    expect(formatGermanNumericDate('2026-09-01')).toBe('01.09.2026');
  });

  it('verschiebt einen Tag nicht über die Zeitzone', () => {
    expect(formatGermanNumericDate('2026-01-01')).toBe('01.01.2026');
    expect(formatGermanNumericDate('2026-12-31')).toBe('31.12.2026');
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() => formatGermanNumericDate('2026-02-30')).toThrow();
    expect(() => formatGermanNumericDate('27.08.2026')).toThrow();
  });
});

describe('formatGermanShortDate', () => {
  it('schreibt den Tag zweistellig und ohne Jahr', () => {
    expect(formatGermanShortDate('2026-08-24')).toBe('24.08.');
    expect(formatGermanShortDate('2026-09-01')).toBe('01.09.');
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() => formatGermanShortDate('2026-13-01')).toThrow();
  });
});

/**
 * PHASE 7B — die beiden Schreibweisen, die es vorher nicht gab.
 *
 * Sie stehen neben formatEuro() und nicht an seiner Stelle: Der Rohertrag
 * ist die einzige Zahl dieses Systems, die unter null etwas bedeutet, und
 * die Marge die einzige mit einem Prozentzeichen.
 */
describe('formatSignedEuro', () => {
  it('schreibt einen positiven Betrag wie formatEuro', () => {
    expect(formatSignedEuro(72_970)).toBe('729,70 €');
    expect(formatSignedEuro(0)).toBe('0,00 €');
  });

  it('setzt ein Minus vor einen negativen Betrag', () => {
    expect(formatSignedEuro(-2000)).toBe('-20,00 €');
  });

  it('gruppiert auch negative Tausender', () => {
    expect(formatSignedEuro(-123_456)).toBe('-1.234,56 €');
  });

  it('behält die Nachkommastellen eines negativen Betrags', () => {
    expect(formatSignedEuro(-5)).toBe('-0,05 €');
  });

  it('weist eine gebrochene Zahl zurück', () => {
    expect(() => formatSignedEuro(12.5)).toThrow();
  });

  /**
   * DIE GEGENPROBE ZUR ARBEITSTEILUNG: formatEuro() bleibt streng. Wäre es
   * das nicht, könnte ein negativer Umsatz unbemerkt auf einer Seite landen.
   */
  it('lässt formatEuro streng bleiben', () => {
    expect(() => formatEuro(-1)).toThrow();
  });
});

describe('formatPercentFromTenths', () => {
  it('schreibt Zehntel Prozent mit deutschem Komma', () => {
    expect(formatPercentFromTenths(588)).toBe('58,8 %');
  });

  it('schreibt eine glatte Zahl mit einer Nachkommastelle', () => {
    expect(formatPercentFromTenths(600)).toBe('60,0 %');
    expect(formatPercentFromTenths(1000)).toBe('100,0 %');
  });

  it('schreibt null als 0,0 %', () => {
    expect(formatPercentFromTenths(0)).toBe('0,0 %');
  });

  it('schreibt eine negative Marge mit Minus', () => {
    expect(formatPercentFromTenths(-200)).toBe('-20,0 %');
    expect(formatPercentFromTenths(-5)).toBe('-0,5 %');
  });

  it('trennt den Prozentwert mit einem Leerzeichen vom Zeichen', () => {
    expect(formatPercentFromTenths(123)).toMatch(/^12,3 %$/);
  });

  it('weist eine gebrochene Eingabe zurück', () => {
    /**
     * Der Rundungsschritt gehört in die Domäne (cost-summary.ts) und ist
     * dort geprüft. Käme eine Fließkommazahl hier an, stünde die
     * Rundungsregel an zwei Stellen.
     */
    expect(() => formatPercentFromTenths(58.8)).toThrow();
  });
});
