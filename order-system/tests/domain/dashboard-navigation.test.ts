import { describe, expect, it } from 'vitest';
import { aggregateDashboardDay, type DashboardOrder } from '../../src/domain/dashboard-day';
import type { OrderStatus } from '../../src/domain/order-status';
import type { PaymentStatus } from '../../src/domain/payment-status';
import {
  toDashboardView,
  toOrderListView,
  toQuickDaysView,
  type DashboardDayView,
} from '../../src/ui/dashboard-view';

const TAG = '2026-08-28';

let laufendeNummer = 0;

function bestellung(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
  laufendeNummer += 1;
  return {
    orderNumber: `BUS-2026-${String(laufendeNummer).padStart(6, '0')}`,
    customerId: 1,
    customerName: 'Fiktives Café Nord',
    status: 'new' as OrderStatus,
    paymentStatus: 'unpaid' as PaymentStatus,
    fulfillmentType: 'pickup',
    totalCents: 1000,
    createdAt: '2026-08-25T07:00:00.000Z',
    items: [],
    ...overrides,
  };
}

function ansicht(orders: readonly DashboardOrder[]): DashboardDayView {
  return toDashboardView(aggregateDashboardDay(TAG, orders));
}

describe('toDashboardView — Handlungsbedarf', () => {
  it('beschriftet die neuen Bestellungen mit Anzahl, Text und Ziel', () => {
    const [aktion] = ansicht([bestellung(), bestellung(), bestellung()]).actions;

    expect(aktion).toMatchObject({
      key: 'new_orders',
      count: 3,
      countLabel: '3',
      title: 'Neue Bestellungen',
      detail: 'warten auf Bestätigung',
      amountLabel: '',
      linkLabel: 'Zur Produktion',
      href: `/admin/production?date=${TAG}`,
    });
  });

  it('setzt die Einzahl, wo es eine ist', () => {
    const [aktion] = ansicht([bestellung()]).actions;

    expect(aktion).toMatchObject({ title: 'Neue Bestellung', detail: 'wartet auf Bestätigung' });
  });

  it('führt die offene Produktion auf die Produktionsansicht DIESES Tages', () => {
    const aktionen = ansicht([bestellung({ status: 'in_production' })]).actions;

    expect(aktionen[0]).toMatchObject({
      key: 'open_production',
      href: `/admin/production?date=${TAG}`,
      linkLabel: 'Produktion öffnen',
    });
  });

  it('nennt bei den offenen Zahlungen den Snapshotbetrag', () => {
    const aktionen = ansicht([
      bestellung({ status: 'completed', paymentStatus: 'unpaid', totalCents: 4350 }),
      bestellung({ status: 'completed', paymentStatus: 'unpaid', totalCents: 2610 }),
    ]).actions;

    expect(aktionen[0]).toMatchObject({
      key: 'unpaid',
      count: 2,
      title: 'Zahlungen offen',
      amountLabel: '69,60 €',
      href: `/admin/orders?date=${TAG}&orders=unpaid#bestellungen`,
      linkLabel: 'Offene Zahlungen anzeigen',
    });
  });

  it('gibt an einem erledigten Tag keine Aktion aus', () => {
    expect(ansicht([bestellung({ status: 'completed', paymentStatus: 'paid_cash' })]).actions)
      .toEqual([]);
  });

  it('nennt jedes Ziel mit dem Datum des betrachteten Tages', () => {
    const aktionen = ansicht([bestellung(), bestellung({ status: 'completed' })]).actions;

    for (const aktion of aktionen) {
      expect(aktion.href).toContain(TAG);
    }
  });
});

describe('toQuickDaysView', () => {
  const HEUTE = '2026-08-26';

  it('führt „Heute" auf das Geschäftsdatum', () => {
    expect(toQuickDaysView(HEUTE, TAG, 'day').today).toEqual({
      label: 'Heute',
      href: '/admin?date=2026-08-26',
      isCurrent: false,
    });
  });

  it('führt „Morgen" auf den Tag danach', () => {
    expect(toQuickDaysView(HEUTE, TAG, 'day').tomorrow).toMatchObject({
      label: 'Morgen',
      href: '/admin?date=2026-08-27',
    });
  });

  it('rechnet „Morgen" über einen Monatswechsel hinweg', () => {
    expect(toQuickDaysView('2026-08-31', TAG, 'day').tomorrow.href).toBe(
      '/admin?date=2026-09-01',
    );
  });

  it('rechnet „Morgen" über einen Jahreswechsel hinweg', () => {
    expect(toQuickDaysView('2026-12-31', TAG, 'day').tomorrow.href).toBe(
      '/admin?date=2027-01-01',
    );
  });

  it('markiert „Heute", wenn der betrachtete Tag heute ist', () => {
    const schnellwahl = toQuickDaysView(HEUTE, HEUTE, 'day');

    expect(schnellwahl.today.isCurrent).toBe(true);
    expect(schnellwahl.tomorrow.isCurrent).toBe(false);
  });

  it('markiert „Morgen", wenn der betrachtete Tag morgen ist', () => {
    expect(toQuickDaysView(HEUTE, '2026-08-27', 'day').tomorrow.isCurrent).toBe(true);
  });

  it('markiert die Woche auf der Wochenansicht und dort allein', () => {
    expect(toQuickDaysView(HEUTE, HEUTE, 'week').week.isCurrent).toBe(true);
    expect(toQuickDaysView(HEUTE, HEUTE, 'week').today.isCurrent).toBe(false);
    expect(toQuickDaysView(HEUTE, HEUTE, 'day').week.isCurrent).toBe(false);
  });

  it('führt „Woche" auf die Kalenderwoche des BETRACHTETEN Tages', () => {
    // Freitag, 28. August 2026 — die Woche beginnt am Montag, dem 24.
    expect(toQuickDaysView(HEUTE, TAG, 'day').week).toEqual({
      label: 'Woche',
      href: '/admin?date=2026-08-24&view=week',
      isCurrent: false,
    });
  });

  it('nennt für einen Sonntag den Montag DAVOR', () => {
    expect(toQuickDaysView(HEUTE, '2026-08-30', 'day').week.href).toBe(
      '/admin?date=2026-08-24&view=week',
    );
  });
});

describe('toOrderListView — ungefiltert', () => {
  it('zeigt alle Bestellungen, stornierte eingeschlossen', () => {
    const liste = toOrderListView(
      ansicht([bestellung(), bestellung({ status: 'cancelled' })]),
      'all',
    );

    expect(liste.rows).toHaveLength(2);
    expect(liste.isFiltered).toBe(false);
    expect(liste.title).toBe('Bestellungen');
  });

  it('sagt am leeren Tag, dass nichts vorliegt', () => {
    const liste = toOrderListView(ansicht([]), 'all');

    expect(liste.rows).toEqual([]);
    expect(liste.emptyText).toContain('noch keine Bestellung');
  });
});

describe('toOrderListView — offene Zahlungen', () => {
  it('zeigt ausschließlich die unbezahlten Bestellungen', () => {
    const liste = toOrderListView(
      ansicht([
        bestellung({ orderNumber: 'BUS-2026-000001', paymentStatus: 'unpaid' }),
        bestellung({ orderNumber: 'BUS-2026-000002', paymentStatus: 'paid_cash' }),
      ]),
      'unpaid',
    );

    expect(liste.rows.map((zeile) => zeile.orderNumber)).toEqual(['BUS-2026-000001']);
    expect(liste.isFiltered).toBe(true);
    expect(liste.title).toBe('Offene Zahlungen');
  });

  it('lässt eine stornierte unbezahlte Bestellung heraus', () => {
    const liste = toOrderListView(
      ansicht([
        bestellung({ orderNumber: 'BUS-2026-000001', status: 'cancelled', paymentStatus: 'unpaid' }),
        bestellung({ orderNumber: 'BUS-2026-000002', paymentStatus: 'unpaid' }),
      ]),
      'unpaid',
    );

    expect(liste.rows.map((zeile) => zeile.orderNumber)).toEqual(['BUS-2026-000002']);
  });

  it('behält die Reihenfolge der Abfrage', () => {
    const liste = toOrderListView(
      ansicht([
        bestellung({ orderNumber: 'BUS-2026-000001', paymentStatus: 'unpaid' }),
        bestellung({ orderNumber: 'BUS-2026-000002', paymentStatus: 'paid_card' }),
        bestellung({ orderNumber: 'BUS-2026-000003', paymentStatus: 'unpaid' }),
      ]),
      'unpaid',
    );

    expect(liste.rows.map((zeile) => zeile.orderNumber)).toEqual([
      'BUS-2026-000001',
      'BUS-2026-000003',
    ]);
  });

  it('bietet den Weg zurück zu allen Bestellungen', () => {
    const liste = toOrderListView(ansicht([bestellung()]), 'unpaid');

    expect(liste.allHref).toBe(`/admin/orders?date=${TAG}#bestellungen`);
  });

  it('sagt, wenn nichts offen ist, statt einen leeren Rahmen zu zeigen', () => {
    const liste = toOrderListView(ansicht([bestellung({ paymentStatus: 'paid_bank' })]), 'unpaid');

    expect(liste.rows).toEqual([]);
    expect(liste.emptyText).toContain('keine Zahlung offen');
  });

  it('ändert die Kennzahlen des Tages nicht', () => {
    const tag = ansicht([
      bestellung({ paymentStatus: 'unpaid', totalCents: 1000 }),
      bestellung({ paymentStatus: 'paid_cash', totalCents: 2000 }),
    ]);

    toOrderListView(tag, 'unpaid');

    expect(tag.orderCount).toBe(2);
    expect(tag.revenueLabel).toBe('30,00 €');
  });
});
