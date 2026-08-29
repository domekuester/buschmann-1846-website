import { describe, expect, it } from 'vitest';
import { aggregateDashboardDay, type DashboardOrder } from '../../src/domain/dashboard-day';
import { dashboardActions } from '../../src/domain/dashboard-actions';
import type { OrderStatus } from '../../src/domain/order-status';
import type { PaymentStatus } from '../../src/domain/payment-status';

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

/** Die Aktionen des Tages, aus der ECHTEN Aggregation gebildet. */
function aktionen(orders: readonly DashboardOrder[]) {
  return dashboardActions(aggregateDashboardDay(TAG, orders));
}

function schluessel(orders: readonly DashboardOrder[]): readonly string[] {
  return aktionen(orders).map((aktion) => aktion.key);
}

function eine(orders: readonly DashboardOrder[], key: string) {
  return aktionen(orders).find((aktion) => aktion.key === key);
}

describe('dashboardActions — neue Bestellungen', () => {
  it('meldet die Anzahl der Bestellungen im Status new', () => {
    expect(eine([bestellung(), bestellung(), bestellung()], 'new_orders')).toEqual({
      key: 'new_orders',
      count: 3,
      amountCents: null,
    });
  });

  it('meldet nichts, wenn keine Bestellung neu ist', () => {
    expect(schluessel([bestellung({ status: 'confirmed' })])).not.toContain('new_orders');
  });

  it('zählt eine stornierte Bestellung nicht als neu', () => {
    expect(schluessel([bestellung({ status: 'cancelled' })])).not.toContain('new_orders');
  });
});

describe('dashboardActions — offene Produktion', () => {
  it('meldet die Bestellungen, die noch nicht abgeschlossen sind', () => {
    const orders = [
      bestellung({ status: 'new' }),
      bestellung({ status: 'confirmed' }),
      bestellung({ status: 'in_production' }),
      bestellung({ status: 'completed' }),
    ];

    expect(eine(orders, 'open_production')).toEqual({
      key: 'open_production',
      count: 3,
      amountCents: null,
    });
  });

  it('meldet nichts, wenn alle Bestellungen abgeschlossen sind', () => {
    const orders = [bestellung({ status: 'completed' }), bestellung({ status: 'completed' })];

    expect(schluessel(orders)).not.toContain('open_production');
  });

  it('zählt eine stornierte Bestellung nicht als offene Produktion', () => {
    expect(schluessel([bestellung({ status: 'cancelled' })])).not.toContain('open_production');
  });

  it('folgt derselben Statusregel wie die Kennzahl „Offen / in Arbeit"', () => {
    const orders = [
      bestellung({ status: 'new' }),
      bestellung({ status: 'in_production' }),
      bestellung({ status: 'completed' }),
      bestellung({ status: 'cancelled' }),
    ];
    const tag = aggregateDashboardDay(TAG, orders);
    const aktion = dashboardActions(tag).find((a) => a.key === 'open_production');

    expect(aktion?.count).toBe(tag.openCount);
  });
});

describe('dashboardActions — offene Zahlungen', () => {
  it('meldet Anzahl und Snapshotbetrag der offenen Zahlungen', () => {
    const orders = [
      bestellung({ paymentStatus: 'unpaid', totalCents: 4350 }),
      bestellung({ paymentStatus: 'unpaid', totalCents: 2610 }),
    ];

    expect(eine(orders, 'unpaid')).toEqual({
      key: 'unpaid',
      count: 2,
      amountCents: 6960,
    });
  });

  it('lässt eine bezahlte Bestellung aus der Aktion heraus', () => {
    const orders = [
      bestellung({ paymentStatus: 'paid_cash', totalCents: 4350 }),
      bestellung({ paymentStatus: 'unpaid', totalCents: 1000 }),
    ];

    expect(eine(orders, 'unpaid')).toEqual({ key: 'unpaid', count: 1, amountCents: 1000 });
  });

  it('meldet nichts, wenn alles bezahlt ist', () => {
    expect(schluessel([bestellung({ paymentStatus: 'paid_card' })])).not.toContain('unpaid');
  });

  it('lässt eine stornierte unbezahlte Bestellung vollständig heraus', () => {
    const orders = [
      bestellung({ status: 'cancelled', paymentStatus: 'unpaid', totalCents: 9999 }),
      bestellung({ status: 'completed', paymentStatus: 'unpaid', totalCents: 1000 }),
    ];

    expect(eine(orders, 'unpaid')).toEqual({ key: 'unpaid', count: 1, amountCents: 1000 });
  });

  it('zählt eine abgeschlossene, unbezahlte Bestellung mit', () => {
    const orders = [bestellung({ status: 'completed', paymentStatus: 'unpaid', totalCents: 4350 })];

    expect(eine(orders, 'unpaid')).toEqual({ key: 'unpaid', count: 1, amountCents: 4350 });
  });
});

describe('dashboardActions — Reihenfolge und Ruhezustand', () => {
  it('ordnet neu, dann offene Produktion, dann offene Zahlung', () => {
    const orders = [
      bestellung({ status: 'new', paymentStatus: 'unpaid' }),
      bestellung({ status: 'in_production', paymentStatus: 'unpaid' }),
    ];

    expect(schluessel(orders)).toEqual(['new_orders', 'open_production', 'unpaid']);
  });

  it('lässt eine leere Kategorie aus, ohne die Reihenfolge zu verschieben', () => {
    const orders = [bestellung({ status: 'completed', paymentStatus: 'unpaid' })];

    expect(schluessel(orders)).toEqual(['unpaid']);
  });

  it('gibt für einen erledigten Tag gar keine Aktion zurück', () => {
    const orders = [
      bestellung({ status: 'completed', paymentStatus: 'paid_cash' }),
      bestellung({ status: 'cancelled', paymentStatus: 'unpaid' }),
    ];

    expect(aktionen(orders)).toEqual([]);
  });

  it('gibt für einen Tag ohne Bestellungen gar keine Aktion zurück', () => {
    expect(aktionen([])).toEqual([]);
  });

  it('kennt genau drei Kategorien und keine vierte', () => {
    const orders = [
      bestellung({ status: 'new', paymentStatus: 'unpaid' }),
      bestellung({ status: 'confirmed', paymentStatus: 'unpaid' }),
      bestellung({ status: 'cancelled', paymentStatus: 'unpaid' }),
    ];

    expect(aktionen(orders)).toHaveLength(3);
  });
});
