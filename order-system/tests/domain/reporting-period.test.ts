import { describe, expect, it } from 'vitest';
import {
  REPORTING_PERIOD_KINDS,
  isReportingPeriodKind,
  resolveReportingPeriod,
} from '../../src/domain/reporting-period';
import { InvalidArgumentError, ValidationError } from '../../src/domain/errors';

const HEUTE = '2026-09-15';

describe('Zeitraumarten', () => {
  it('kennt genau fünf Arten in der Reihenfolge der Leiste', () => {
    expect(REPORTING_PERIOD_KINDS).toEqual(['heute', 'woche', 'monat', 'jahr', 'zeitraum']);
  });

  it('erkennt nur diese fünf', () => {
    expect(isReportingPeriodKind('monat')).toBe(true);
    expect(isReportingPeriodKind('quartal')).toBe(false);
    expect(isReportingPeriodKind(7)).toBe(false);
  });
});

describe('Heute', () => {
  it('umfasst genau einen Tag und vergleicht mit gestern', () => {
    const p = resolveReportingPeriod('heute', HEUTE);
    expect(p.start).toBe('2026-09-15');
    expect(p.end).toBe('2026-09-16');
    expect(p.previousStart).toBe('2026-09-14');
    expect(p.previousEnd).toBe('2026-09-15');
  });

  it('zeigt im Trend die letzten sieben Tage', () => {
    const p = resolveReportingPeriod('heute', HEUTE);
    expect(p.trendStart).toBe('2026-09-09');
    expect(p.trendEnd).toBe('2026-09-16');
    expect(p.granularity).toBe('day');
  });

  it('trägt über den Jahreswechsel', () => {
    const p = resolveReportingPeriod('heute', '2027-01-01');
    expect(p.previousStart).toBe('2026-12-31');
    expect(p.trendStart).toBe('2026-12-26');
  });
});

describe('Woche', () => {
  it('beginnt am Montag und endet nach dem heutigen Tag', () => {
    // 2026-09-15 ist ein Dienstag.
    const p = resolveReportingPeriod('woche', HEUTE);
    expect(p.start).toBe('2026-09-14');
    expect(p.end).toBe('2026-09-16');
    expect(p.isPartial).toBe(true);
  });

  it('vergleicht mit der gleich langen Anfangsspanne der Vorwoche', () => {
    const p = resolveReportingPeriod('woche', HEUTE);
    expect(p.previousStart).toBe('2026-09-07');
    expect(p.previousEnd).toBe('2026-09-09');
  });

  it('nimmt am Sonntag die ganze Woche und die ganze Vorwoche', () => {
    const p = resolveReportingPeriod('woche', '2026-09-20');
    expect(p.start).toBe('2026-09-14');
    expect(p.end).toBe('2026-09-21');
    expect(p.previousStart).toBe('2026-09-07');
    expect(p.previousEnd).toBe('2026-09-14');
    expect(p.isPartial).toBe(false);
  });
});

describe('Monat', () => {
  it('läuft vom Monatsersten bis einschließlich heute', () => {
    const p = resolveReportingPeriod('monat', HEUTE);
    expect(p.start).toBe('2026-09-01');
    expect(p.end).toBe('2026-09-16');
    expect(p.previousStart).toBe('2026-08-01');
    expect(p.previousEnd).toBe('2026-08-16');
    expect(p.granularity).toBe('day');
  });

  it('vergleicht am Monatsletzten zwei volle Monate', () => {
    const p = resolveReportingPeriod('monat', '2026-09-30');
    expect(p.end).toBe('2026-10-01');
    expect(p.previousStart).toBe('2026-08-01');
    expect(p.previousEnd).toBe('2026-09-01');
    expect(p.isPartial).toBe(false);
  });

  it('klemmt die Vergleichsspanne auf die Länge des kürzeren Vormonats', () => {
    // 31. März: der Februar 2026 hat nur 28 Tage.
    const p = resolveReportingPeriod('monat', '2026-03-31');
    expect(p.start).toBe('2026-03-01');
    expect(p.end).toBe('2026-04-01');
    expect(p.previousStart).toBe('2026-02-01');
    expect(p.previousEnd).toBe('2026-03-01');
  });

  it('trägt über den Jahreswechsel zurück in den Dezember', () => {
    const p = resolveReportingPeriod('monat', '2027-01-10');
    expect(p.start).toBe('2027-01-01');
    expect(p.previousStart).toBe('2026-12-01');
    expect(p.previousEnd).toBe('2026-12-11');
  });
});

describe('Jahr', () => {
  it('läuft vom 1. Januar bis einschließlich heute und vergleicht mit dem Vorjahr', () => {
    const p = resolveReportingPeriod('jahr', HEUTE);
    expect(p.start).toBe('2026-01-01');
    expect(p.end).toBe('2026-09-16');
    expect(p.previousStart).toBe('2025-01-01');
    expect(p.previousEnd).toBe('2025-09-16');
    expect(p.granularity).toBe('month');
  });

  it('vergleicht am Silvesterabend zwei volle Jahre', () => {
    const p = resolveReportingPeriod('jahr', '2026-12-31');
    expect(p.end).toBe('2027-01-01');
    expect(p.previousStart).toBe('2025-01-01');
    expect(p.previousEnd).toBe('2026-01-01');
    expect(p.isPartial).toBe(false);
  });

  it('verschiebt den 29. Februar im Vergleichsjahr auf den 28.', () => {
    const p = resolveReportingPeriod('jahr', '2028-02-29');
    expect(p.end).toBe('2028-03-01');
    expect(p.previousStart).toBe('2027-01-01');
    expect(p.previousEnd).toBe('2027-03-01');
  });
});

describe('Zeitraum', () => {
  it('nimmt von und bis einschließlich und vergleicht mit der Spanne davor', () => {
    const p = resolveReportingPeriod('zeitraum', HEUTE, '2026-08-01', '2026-08-14');
    expect(p.start).toBe('2026-08-01');
    expect(p.end).toBe('2026-08-15');
    expect(p.previousStart).toBe('2026-07-18');
    expect(p.previousEnd).toBe('2026-08-01');
  });

  it('schneidet ein Bis in der Zukunft bei heute ab', () => {
    const p = resolveReportingPeriod('zeitraum', HEUTE, '2026-09-01', '2026-12-31');
    expect(p.end).toBe('2026-09-16');
    expect(p.isPartial).toBe(true);
  });

  it('meldet einen Zeitraum, der noch nicht begonnen hat', () => {
    const p = resolveReportingPeriod('zeitraum', HEUTE, '2026-10-01', '2026-10-31');
    expect(p.hasStarted).toBe(false);
    expect(p.start).toBe('2026-10-01');
    expect(p.end).toBe('2026-10-01');
  });

  it('wählt die Körnung nach der Länge', () => {
    expect(resolveReportingPeriod('zeitraum', HEUTE, '2026-08-01', '2026-08-20').granularity).toBe('day');
    expect(resolveReportingPeriod('zeitraum', HEUTE, '2026-05-01', '2026-08-14').granularity).toBe('week');
    expect(resolveReportingPeriod('zeitraum', '2027-06-01', '2025-01-01', '2026-12-31').granularity).toBe('month');
  });

  it('weist ein Bis vor dem Von zurück', () => {
    expect(() => resolveReportingPeriod('zeitraum', HEUTE, '2026-08-14', '2026-08-01')).toThrow(
      ValidationError,
    );
  });

  it('verlangt beide Grenzen', () => {
    expect(() => resolveReportingPeriod('zeitraum', HEUTE, '2026-08-01', null)).toThrow(
      ValidationError,
    );
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() => resolveReportingPeriod('zeitraum', HEUTE, '2026-02-30', '2026-03-01')).toThrow(
      ValidationError,
    );
  });

  it('weist einen unmöglichen heutigen Tag zurück', () => {
    expect(() => resolveReportingPeriod('heute', '2026-13-01')).toThrow(InvalidArgumentError);
  });
});

describe('Abfragebereich', () => {
  it('umfasst Trend, Vergleichszeitraum und Zeitraum in einem Stück', () => {
    const p = resolveReportingPeriod('monat', HEUTE);
    expect(p.queryStart).toBe('2026-08-01');
    expect(p.queryEnd).toBe('2026-09-16');
  });

  it('beginnt bei Heute sieben Tage vor dem heutigen Tag', () => {
    const p = resolveReportingPeriod('heute', HEUTE);
    expect(p.queryStart).toBe('2026-09-09');
    expect(p.queryEnd).toBe('2026-09-16');
  });
});
