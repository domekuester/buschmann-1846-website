import { describe, expect, it } from 'vitest';
import {
  aggregateDashboardWeek,
  type DashboardWeekOrder,
} from '../../src/domain/dashboard-week';
import type { OrderStatus } from '../../src/domain/order-status';
import type { PaymentStatus } from '../../src/domain/payment-status';

const MONTAG = '2026-08-24';
const SONNTAG = '2026-08-30';

function bestellung(overrides: Partial<DashboardWeekOrder> = {}): DashboardWeekOrder {
  return {
    day: MONTAG,
    status: 'new' as OrderStatus,
    paymentStatus: 'unpaid' as PaymentStatus,
    totalCents: 1000,
    ...overrides,
  };
}

describe('aggregateDashboardWeek — der Ausschnitt', () => {
  it('hat immer genau sieben Tage', () => {
    expect(aggregateDashboardWeek(MONTAG, []).days).toHaveLength(7);
  });

  it('nennt Montag bis Sonntag in dieser Reihenfolge', () => {
    expect(aggregateDashboardWeek(MONTAG, []).days.map((tag) => tag.date)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('nennt den Montag und den Sonntag der Woche', () => {
    const woche = aggregateDashboardWeek(MONTAG, []);

    expect(woche.monday).toBe(MONTAG);
    expect(woche.sunday).toBe(SONNTAG);
  });

  it('behält sieben Tage, auch wenn die Woche über einen Monatswechsel geht', () => {
    const woche = aggregateDashboardWeek('2026-08-31', []);

    expect(woche.days.map((tag) => tag.date)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(woche.sunday).toBe('2026-09-06');
  });

  it('behält sieben Tage über den Jahreswechsel', () => {
    const woche = aggregateDashboardWeek('2026-12-28', []);

    expect(woche.sunday).toBe('2027-01-03');
    expect(woche.days).toHaveLength(7);
  });

  it('weist einen Tag zurück, der kein Montag ist', () => {
    expect(() => aggregateDashboardWeek('2026-08-25', [])).toThrow();
  });
});

describe('aggregateDashboardWeek — die Zahlen je Tag', () => {
  it('ordnet jede Bestellung ihrem eigenen Liefertag zu', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: '2026-08-24' }),
      bestellung({ day: '2026-08-26' }),
      bestellung({ day: '2026-08-26' }),
    ]);

    expect(woche.days.map((tag) => tag.orderCount)).toEqual([1, 0, 2, 0, 0, 0, 0]);
  });

  it('summiert den Snapshotbetrag der Bestellungen eines Tages', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: '2026-08-24', totalCents: 4350 }),
      bestellung({ day: '2026-08-24', totalCents: 1290 }),
    ]);

    expect(woche.days[0]?.revenueCents).toBe(5640);
  });

  it('lässt eine stornierte Bestellung aus dem Umsatz heraus und weist sie getrennt aus', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 4350 }),
      bestellung({ day: MONTAG, totalCents: 9999, status: 'cancelled' }),
    ]);

    expect(woche.days[0]).toMatchObject({
      orderCount: 1,
      cancelledCount: 1,
      revenueCents: 4350,
    });
  });

  it('zählt die offene Produktion nach derselben Statusregel wie der Tag', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, status: 'new' }),
      bestellung({ day: MONTAG, status: 'confirmed' }),
      bestellung({ day: MONTAG, status: 'in_production' }),
      bestellung({ day: MONTAG, status: 'completed' }),
      bestellung({ day: MONTAG, status: 'cancelled' }),
    ]);

    expect(woche.days[0]?.openCount).toBe(3);
  });

  it('summiert die offenen Zahlungen ohne die stornierten', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, paymentStatus: 'unpaid', totalCents: 3500 }),
      bestellung({ day: MONTAG, paymentStatus: 'paid_cash', totalCents: 4350 }),
      bestellung({ day: MONTAG, paymentStatus: 'unpaid', totalCents: 9999, status: 'cancelled' }),
    ]);

    expect(woche.days[0]).toMatchObject({ unpaidCents: 3500, unpaidCount: 1 });
  });

  it('zählt eine abgeschlossene, unbezahlte Bestellung als offene Zahlung', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, status: 'completed', paymentStatus: 'unpaid', totalCents: 4350 }),
    ]);

    expect(woche.days[0]).toMatchObject({ openCount: 0, unpaidCents: 4350, unpaidCount: 1 });
  });

  it('gibt einem Tag ohne Bestellungen überall null', () => {
    expect(aggregateDashboardWeek(MONTAG, []).days[3]).toEqual({
      date: '2026-08-27',
      orderCount: 0,
      cancelledCount: 0,
      revenueCents: 0,
      openCount: 0,
      unpaidCents: 0,
      unpaidCount: 0,
    });
  });

  it('lässt eine Bestellung außerhalb der Woche vollständig unberücksichtigt', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: '2026-08-23', totalCents: 9999 }),
      bestellung({ day: '2026-08-31', totalCents: 8888 }),
      bestellung({ day: MONTAG, totalCents: 1000 }),
    ]);

    expect(woche.total.revenueCents).toBe(1000);
    expect(woche.total.orderCount).toBe(1);
  });
});

describe('aggregateDashboardWeek — die Wochensumme', () => {
  it('ist die Summe der sieben Tageswerte', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: '2026-08-24', totalCents: 4350, status: 'new', paymentStatus: 'unpaid' }),
      bestellung({
        day: '2026-08-26',
        totalCents: 1290,
        status: 'completed',
        paymentStatus: 'paid_cash',
      }),
      bestellung({
        day: '2026-08-30',
        totalCents: 2000,
        status: 'in_production',
        paymentStatus: 'unpaid',
      }),
      bestellung({ day: '2026-08-30', totalCents: 9999, status: 'cancelled' }),
    ]);

    const summe = (auswahl: (tag: (typeof woche.days)[number]) => number) =>
      woche.days.reduce((wert, tag) => wert + auswahl(tag), 0);

    expect(woche.total).toEqual({
      orderCount: summe((tag) => tag.orderCount),
      cancelledCount: summe((tag) => tag.cancelledCount),
      revenueCents: summe((tag) => tag.revenueCents),
      openCount: summe((tag) => tag.openCount),
      unpaidCents: summe((tag) => tag.unpaidCents),
      unpaidCount: summe((tag) => tag.unpaidCount),
    });

    expect(woche.total).toEqual({
      orderCount: 3,
      cancelledCount: 1,
      revenueCents: 7640,
      openCount: 2,
      unpaidCents: 6350,
      unpaidCount: 2,
    });
  });

  it('ist an einer leeren Woche überall null', () => {
    expect(aggregateDashboardWeek(MONTAG, []).total).toEqual({
      orderCount: 0,
      cancelledCount: 0,
      revenueCents: 0,
      openCount: 0,
      unpaidCents: 0,
      unpaidCount: 0,
    });
  });

  it('nimmt den gespeicherten Betrag und rechnet ihn nicht aus Positionen nach', () => {
    // Es gibt in DashboardWeekOrder überhaupt keine Positionen und keinen
    // Einzelpreis — der Betrag KANN hier nicht neu gebildet werden.
    const woche = aggregateDashboardWeek(MONTAG, [bestellung({ totalCents: 7 })]);

    expect(woche.total.revenueCents).toBe(7);
    expect(Object.keys(bestellung())).toEqual(['day', 'status', 'paymentStatus', 'totalCents']);
  });
});
