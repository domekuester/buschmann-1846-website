import { describe, expect, it } from 'vitest';
import {
  aggregateDashboardWeek,
  type DashboardWeekOrder,
} from '../../src/domain/dashboard-week';
import { toDashboardWeekView } from '../../src/ui/dashboard-week-view';

const MONTAG = '2026-08-24';
const HEUTE = '2026-08-26';

function bestellung(overrides: Partial<DashboardWeekOrder> = {}): DashboardWeekOrder {
  return {
    day: MONTAG,
    status: 'new',
    paymentStatus: 'unpaid',
    totalCents: 1000,
    ...overrides,
  };
}

function ansicht(orders: readonly DashboardWeekOrder[] = [], today = HEUTE) {
  return toDashboardWeekView(aggregateDashboardWeek(MONTAG, orders), today);
}

describe('toDashboardWeekView — der Rahmen', () => {
  it('nennt den Zeitraum ausgeschrieben', () => {
    expect(ansicht().rangeLabel).toBe('24. August 2026 – 30. August 2026');
  });

  it('nennt denselben Zeitraum für die Steuerleiste kurz', () => {
    expect(ansicht().compactRangeLabel).toBe('24.08. – 30.08.2026');
  });

  it('nennt in der Kurzform das Jahr des Sonntags', () => {
    expect(toDashboardWeekView(aggregateDashboardWeek('2026-12-28', []), HEUTE).compactRangeLabel)
      .toBe('28.12. – 03.01.2027');
  });

  it('zeigt sieben Tage mit Wochentag und Datum', () => {
    const tage = ansicht().days;

    expect(tage).toHaveLength(7);
    expect(tage[0]).toMatchObject({ weekdayLabel: 'Montag', dateLabel: '24.08.' });
    expect(tage[6]).toMatchObject({ weekdayLabel: 'Sonntag', dateLabel: '30.08.' });
  });

  it('verlinkt jeden Tag auf seine eigene Tagesansicht', () => {
    expect(ansicht().days.map((tag) => tag.href)).toEqual([
      '/admin/dashboard?date=2026-08-24',
      '/admin/dashboard?date=2026-08-25',
      '/admin/dashboard?date=2026-08-26',
      '/admin/dashboard?date=2026-08-27',
      '/admin/dashboard?date=2026-08-28',
      '/admin/dashboard?date=2026-08-29',
      '/admin/dashboard?date=2026-08-30',
    ]);
  });

  it('markiert den heutigen Tag und nur ihn', () => {
    expect(ansicht().days.map((tag) => tag.isToday)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('markiert gar keinen Tag, wenn heute außerhalb der Woche liegt', () => {
    expect(ansicht([], '2026-09-15').days.some((tag) => tag.isToday)).toBe(false);
  });

  it('führt die Pfeile auf die Wochen davor und danach', () => {
    const woche = ansicht();

    expect(woche.previousWeek.href).toBe('/admin/dashboard?date=2026-08-17&view=week');
    expect(woche.nextWeek.href).toBe('/admin/dashboard?date=2026-08-31&view=week');
  });

  it('markiert in der Schnellwahl die Woche als aktiv', () => {
    const woche = ansicht();

    expect(woche.quickDays.week.isCurrent).toBe(true);
    expect(woche.quickDays.today.href).toBe('/admin/dashboard?date=2026-08-26');
  });
});

describe('toDashboardWeekView — die Tageszeile', () => {
  it('beschriftet einen vollen Tag', () => {
    const tag = ansicht([
      bestellung({ day: MONTAG, totalCents: 42050, status: 'new', paymentStatus: 'unpaid' }),
      bestellung({
        day: MONTAG,
        totalCents: 3500,
        status: 'completed',
        paymentStatus: 'paid_cash',
      }),
    ]).days[0];

    expect(tag).toMatchObject({
      ordersLabel: '2',
      revenueLabel: '455,50 €',
      openLabel: '1 offen',
      unpaidLabel: '420,50 € offen',
      isEmpty: false,
    });
  });

  it('sagt „erledigt", wenn nichts mehr offen ist', () => {
    const tag = ansicht([
      bestellung({ day: MONTAG, status: 'completed', paymentStatus: 'paid_card' }),
    ]).days[0];

    expect(tag).toMatchObject({ openLabel: 'erledigt', unpaidLabel: 'bezahlt' });
  });

  it('setzt für einen Tag ohne Bestellung einen Strich statt eines Urteils', () => {
    const tag = ansicht().days[3];

    expect(tag).toMatchObject({
      ordersLabel: '0',
      revenueLabel: '0,00 €',
      openLabel: '—',
      unpaidLabel: '—',
      isEmpty: true,
      cancelledLabel: '',
    });
  });

  it('gilt ein Tag mit nur einer stornierten Bestellung nicht als leer', () => {
    const tag = ansicht([bestellung({ day: MONTAG, status: 'cancelled' })]).days[0];

    expect(tag).toMatchObject({
      isEmpty: false,
      ordersLabel: '0',
      revenueLabel: '0,00 €',
      openLabel: 'erledigt',
      cancelledLabel: 'zusätzlich 1 storniert',
    });
  });

  it('setzt die Einzahl bei einer einzelnen offenen Bestellung', () => {
    const tag = ansicht([bestellung({ day: MONTAG, status: 'confirmed' })]).days[0];

    expect(tag?.openLabel).toBe('1 offen');
  });
});

describe('toDashboardWeekView — die Wochensumme', () => {
  it('beschriftet die Summe wie eine Tageszeile', () => {
    const woche = ansicht([
      bestellung({ day: '2026-08-24', totalCents: 42050, paymentStatus: 'unpaid' }),
      bestellung({
        day: '2026-08-26',
        totalCents: 31000,
        status: 'completed',
        paymentStatus: 'paid_bank',
      }),
      bestellung({ day: '2026-08-30', totalCents: 9999, status: 'cancelled' }),
    ]);

    expect(woche.total).toEqual({
      ordersLabel: '2',
      revenueLabel: '730,50 €',
      openLabel: '1 offen',
      unpaidLabel: '420,50 € offen',
      cancelledLabel: 'zusätzlich 1 storniert',
    });
  });

  it('bleibt an einer leeren Woche ruhig', () => {
    expect(ansicht().total).toEqual({
      ordersLabel: '0',
      revenueLabel: '0,00 €',
      openLabel: 'erledigt',
      unpaidLabel: 'bezahlt',
      cancelledLabel: '',
    });
  });
});
