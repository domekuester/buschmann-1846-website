import { describe, expect, it } from 'vitest';
import {
  businessDay,
  isCalendarDay,
  plusDays,
  toUtcTimestamp,
  weekStart,
} from '../../src/domain/clock';

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

/**
 * DIE KALENDERWOCHE — Montag bis Sonntag.
 *
 * Sie steht hier und nicht im Wochen-Lesemodell: Sie ist eine Regel über
 * Kalendertage, wie plusDays() eine ist, und wer eines Tages eine zweite
 * Ansicht mit Wochenbezug baut, sucht sie genau hier.
 */
describe('weekStart', () => {
  it('gibt für einen Montag denselben Tag zurück', () => {
    expect(weekStart('2026-08-24')).toBe('2026-08-24');
  });

  it('gibt für einen Mittwoch den Montag davor zurück', () => {
    expect(weekStart('2026-08-26')).toBe('2026-08-24');
  });

  it('rechnet den Sonntag zur Woche davor und nicht zur folgenden', () => {
    expect(weekStart('2026-08-30')).toBe('2026-08-24');
  });

  it('greift über einen Monatswechsel hinweg', () => {
    // Dienstag, 1. September 2026 → Montag, 31. August 2026.
    expect(weekStart('2026-09-01')).toBe('2026-08-31');
  });

  it('greift über einen Jahreswechsel hinweg', () => {
    // Freitag, 1. Januar 2027 → Montag, 28. Dezember 2026.
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });

  it('greift über den 29. Februar eines Schaltjahres hinweg', () => {
    // Montag, 1. März 2027 ist kein Schaltjahr; 2028 ist eines:
    // Mittwoch, 1. März 2028 → Montag, 28. Februar 2028, mit dem 29. dazwischen.
    expect(weekStart('2028-03-01')).toBe('2028-02-28');
    expect(plusDays(weekStart('2028-03-01'), 1)).toBe('2028-02-29');
  });

  it('weist einen Wert zurück, der kein Kalendertag ist', () => {
    expect(() => weekStart('2026-02-30')).toThrow();
    expect(() => weekStart('nicht-ein-tag')).toThrow();
  });

  it('liefert einen Montag, für jeden Tag eines ganzen Jahres', () => {
    let tag = '2026-01-01';

    for (let i = 0; i < 365; i += 1) {
      const montag = weekStart(tag);

      expect(new Date(`${montag}T00:00:00Z`).getUTCDay()).toBe(1);
      // Der Montag liegt nie in der Zukunft und nie mehr als sechs Tage zurück.
      expect(montag <= tag).toBe(true);
      expect(plusDays(montag, 6) >= tag).toBe(true);

      tag = plusDays(tag, 1);
    }
  });
});
