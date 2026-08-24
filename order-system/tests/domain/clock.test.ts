import { describe, expect, it } from 'vitest';
import { businessDay, plusDays, toUtcTimestamp } from '../../src/domain/clock';

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
