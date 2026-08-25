import { describe, expect, it } from 'vitest';
import { businessDay, isCalendarDay, plusDays, toUtcTimestamp } from '../../src/domain/clock';

/**
 * Das Zeitmodell ist die Stelle, an der ein Bestellsystem am unauffälligsten
 * falsch sein kann: Ein Fehler um einen Tag fällt elf Monate lang nicht auf
 * und dann an einem Freitag um Mitternacht.
 */
describe('businessDay', () => {
  it('liefert den Kalendertag in Europe/Berlin, nicht in UTC', () => {
    // 22:30 UTC ist in Düsseldorf bereits der Folgetag (Sommerzeit, UTC+2).
    expect(businessDay(new Date('2026-08-24T22:30:00Z'))).toBe('2026-08-25');
  });

  it('liefert im Winter denselben Tag um 23:30 UTC nicht mehr', () => {
    // Winterzeit ist UTC+1: 23:30 UTC ist in Düsseldorf 00:30 des Folgetags.
    expect(businessDay(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('bleibt am Vortag, solange es in Düsseldorf noch der Vortag ist', () => {
    expect(businessDay(new Date('2026-08-24T21:30:00Z'))).toBe('2026-08-24');
  });
});

describe('plusDays', () => {
  it('zählt einen Tag weiter', () => {
    expect(plusDays('2026-08-24', 1)).toBe('2026-08-25');
  });

  it('kommt über einen Monatswechsel', () => {
    expect(plusDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('kommt über einen Jahreswechsel', () => {
    expect(plusDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('kennt den Schalttag', () => {
    expect(plusDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(plusDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('liefert bei 0 denselben Tag', () => {
    expect(plusDays('2026-08-24', 0)).toBe('2026-08-24');
  });

  it('rechnet ein ganzes Jahr weiter', () => {
    expect(plusDays('2026-08-24', 365)).toBe('2027-08-24');
  });

  it('rechnet auch rückwärts', () => {
    expect(plusDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('lehnt einen Tag ab, der keiner ist', () => {
    expect(() => plusDays('24.08.2026', 1)).toThrow();
    expect(() => plusDays('2026-02-30', 1)).toThrow();
  });
});

describe('toUtcTimestamp', () => {
  it('liefert feste Länge in ISO-8601-UTC', () => {
    const value = toUtcTimestamp(new Date('2026-08-24T07:00:00Z'));
    expect(value).toBe('2026-08-24T07:00:00.000Z');
    expect(value).toHaveLength(24);
  });
});

/**
 * Die Prüfung „ist das ein Tag, den es gibt?" — an EINER Stelle.
 *
 * Sie stand vorher zweimal wörtlich in FulfillmentDate und wird jetzt auch
 * vom Produktionstag-Endpunkt gebraucht. Drei Kopien derselben Regel wären
 * drei Gelegenheiten, dass eine davon den 30. Februar durchlässt.
 *
 * WICHTIG: Diese Funktion prüft die FORM eines Kalendertags und sonst nichts.
 * Kein „nicht in der Vergangenheit", kein Mindestjahr, keine Vorlaufzeit —
 * das sind Regeln des Bestellens, nicht des Datums.
 */
describe('isCalendarDay', () => {
  it('erkennt gültige Kalendertage', () => {
    for (const tag of ['2026-08-26', '2026-01-01', '2026-12-31', '2000-01-01', '1999-06-15']) {
      expect(isCalendarDay(tag)).toBe(true);
    }
  });

  it('erkennt den 29. Februar im Schaltjahr', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
  });

  /**
   * Der Fall, den eine reine Formatprüfung durchlässt: '2026-02-29' passt auf
   * JJJJ-MM-TT und existiert trotzdem nicht. JavaScript rollt ihn still auf
   * den 1. März weiter — der Rückvergleich fängt genau das ab.
   */
  it('erkennt den 29. Februar im Nichtschaltjahr als ungültig', () => {
    expect(isCalendarDay('2026-02-29')).toBe(false);
  });

  it('lehnt unmögliche Kalendertage ab', () => {
    for (const tag of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-32']) {
      expect(isCalendarDay(tag)).toBe(false);
    }
  });

  it('lehnt nicht zweistellige Monate und Tage ab', () => {
    for (const tag of ['2026-8-26', '2026-08-6', '26-08-26']) {
      expect(isCalendarDay(tag)).toBe(false);
    }
  });

  it('lehnt andere Datumsformate ab', () => {
    for (const tag of ['25.08.2026', '2026/08/25', '08/25/2026', '20260825']) {
      expect(isCalendarDay(tag)).toBe(false);
    }
  });

  it('lehnt Datumssprache ab', () => {
    for (const tag of ['tomorrow', 'heute', 'morgen', 'now']) {
      expect(isCalendarDay(tag)).toBe(false);
    }
  });

  /** Ein Zeitpunkt ist kein Tag — das ist der Kern des Zeitmodells. */
  it('lehnt Zeitstempel ab', () => {
    for (const wert of ['2026-08-26T10:00:00Z', '2026-08-26 10:00', '2026-08-26T00:00:00.000Z']) {
      expect(isCalendarDay(wert)).toBe(false);
    }
  });

  it('lehnt Leeres und Nichtzeichenketten ab', () => {
    for (const wert of ['', '   ', null, undefined, 42, {}, [], ['2026-08-26']]) {
      expect(isCalendarDay(wert)).toBe(false);
    }
  });
});
