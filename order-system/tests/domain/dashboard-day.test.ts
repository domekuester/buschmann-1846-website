import { describe, expect, it } from 'vitest';
import {
  TOP_PRODUCTS_LIMIT,
  aggregateDashboardDay,
  type DashboardOrder,
  type DashboardOrderItem,
} from '../../src/domain/dashboard-day';
import { ORDER_STATUSES, type OrderStatus } from '../../src/domain/order-status';
import type { PaymentStatus } from '../../src/domain/payment-status';

const TAG = '2026-08-28';

let laufendeNummer = 0;

function position(overrides: Partial<DashboardOrderItem> = {}): DashboardOrderItem {
  return {
    productId: 1,
    productName: 'Fiktiver Käsekuchen',
    productUnit: 'Stück',
    sortOrder: 10,
    quantity: 2,
    ...overrides,
  };
}

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
    items: [position()],
    ...overrides,
  };
}

describe('aggregateDashboardDay — der leere Tag', () => {
  it('gibt für einen Tag ohne Bestellungen überall null zurück', () => {
    expect(aggregateDashboardDay(TAG, [])).toEqual({
      date: TAG,
      orderCount: 0,
      cancelledCount: 0,
      revenueCents: 0,
      openCount: 0,
      customerCount: 0,
      totalUnits: 0,
      unpaidCents: 0,
      unpaidCount: 0,
      paidCents: 0,
      paidCount: 0,
      statusCounts: {
        new: 0,
        confirmed: 0,
        in_production: 0,
        completed: 0,
        cancelled: 0,
      },
      orders: [],
      topProducts: [],
    });
  });

  /**
   * DIE AUFTEILUNG NACH STATUS HAT AUCH AN EINEM LEEREN TAG FÜNF EINTRÄGE.
   *
   * Sie wird aus ORDER_STATUSES aufgebaut und nicht aus den vorkommenden
   * Status. Eine Aufteilung, die an ruhigen Tagen Einträge weglässt, ist von
   * Tag zu Tag nicht vergleichbar — und eine Anzeige darüber müsste raten,
   * ob eine fehlende Zahl „null" oder „unbekannt" heißt.
   */
  it('kennt jeden Status auch dann, wenn er an diesem Tag nicht vorkommt', () => {
    const tag = aggregateDashboardDay(TAG, []);
    expect(Object.keys(tag.statusCounts).sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe('aggregateDashboardDay — Aufteilungen für die Anzeige', () => {
  /**
   * DIE AUFTEILUNG DARF DER SUMME NICHT WIDERSPRECHEN.
   *
   * `paidCents` und `unpaidCents` entstehen im selben Durchlauf und hinter
   * demselben Stornofilter wie `revenueCents`. Dieser Test hält genau das
   * fest: Wer später einen der drei Zweige verschiebt, sieht es hier und
   * nicht erst auf dem Dashboard.
   */
  it('teilt den Umsatz vollständig in bezahlt und offen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ paymentStatus: 'paid_cash', totalCents: 1500 }),
      bestellung({ paymentStatus: 'unpaid', totalCents: 2500 }),
      bestellung({ paymentStatus: 'paid_bank', totalCents: 1000 }),
    ]);

    expect(tag.paidCents + tag.unpaidCents).toBe(tag.revenueCents);
    expect(tag.paidCount + tag.unpaidCount).toBe(tag.orderCount);
    expect(tag.paidCents).toBe(2500);
    expect(tag.paidCount).toBe(2);
  });

  /**
   * EINE STORNIERTE BESTELLUNG IST IN KEINER ZAHLUNGSHÄLFTE — sie hat keinen
   * Zahlungsanspruch, und der Umsatz kennt sie nicht. In der Aufteilung nach
   * PRODUKTIONSSTATUS taucht sie dagegen auf: Dort ist sie ein Status wie
   * jeder andere.
   */
  it('lässt eine stornierte Bestellung aus beiden Zahlungshälften heraus', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ paymentStatus: 'unpaid', totalCents: 2500 }),
      bestellung({ status: 'cancelled', paymentStatus: 'unpaid', totalCents: 9900 }),
    ]);

    expect(tag.paidCount + tag.unpaidCount).toBe(1);
    expect(tag.unpaidCents).toBe(2500);
    expect(tag.statusCounts.cancelled).toBe(1);
  });

  /**
   * Die Aufteilung nach Status zählt ALLE Bestellungen des Tages — und
   * `statusCounts.cancelled` ist dieselbe Zahl wie `cancelledCount`. Zwei
   * Zahlen für dieselbe Sache dürfen nicht auseinanderlaufen.
   */
  it('zählt in der Statusaufteilung jede Bestellung des Tages genau einmal', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ status: 'new' }),
      bestellung({ status: 'in_production' }),
      bestellung({ status: 'completed' }),
      bestellung({ status: 'cancelled' }),
      bestellung({ status: 'cancelled' }),
    ]);

    const summe = ORDER_STATUSES.reduce((s, status) => s + tag.statusCounts[status], 0);

    expect(summe).toBe(tag.orderCount + tag.cancelledCount);
    expect(summe).toBe(5);
    expect(tag.statusCounts.cancelled).toBe(tag.cancelledCount);
    expect(tag.statusCounts.new).toBe(1);
  });
});

describe('aggregateDashboardDay — Umsatz', () => {
  it('summiert die gespeicherten Bestellbeträge', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350 }),
      bestellung({ totalCents: 1290 }),
    ]);

    expect(tag.revenueCents).toBe(5640);
  });

  it('zählt eine stornierte Bestellung NICHT zum Umsatz', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350 }),
      bestellung({ totalCents: 9999, status: 'cancelled' }),
    ]);

    expect(tag.revenueCents).toBe(4350);
  });

  it('zählt eine abgeschlossene Bestellung zum Umsatz', () => {
    const tag = aggregateDashboardDay(TAG, [bestellung({ totalCents: 4350, status: 'completed' })]);
    expect(tag.revenueCents).toBe(4350);
  });

  it('lässt den Zahlungsstatus den Umsatz nicht verändern', () => {
    const offen = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350, paymentStatus: 'unpaid' }),
    ]);
    const bezahlt = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350, paymentStatus: 'paid_cash' }),
    ]);

    expect(offen.revenueCents).toBe(bezahlt.revenueCents);
  });
});

describe('aggregateDashboardDay — Bestellungen und Storno', () => {
  it('zählt nur nicht stornierte Bestellungen als Bestellungen des Tages', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung(),
      bestellung(),
      bestellung({ status: 'cancelled' }),
    ]);

    expect(tag.orderCount).toBe(2);
    expect(tag.cancelledCount).toBe(1);
  });

  it('behält die stornierte Bestellung in der Liste', () => {
    const storniert = bestellung({ status: 'cancelled' });
    const tag = aggregateDashboardDay(TAG, [bestellung(), storniert]);

    expect(tag.orders).toHaveLength(2);
    expect(tag.orders.map((o) => o.orderNumber)).toContain(storniert.orderNumber);
  });

  it('übernimmt die Reihenfolge der Eingabe unverändert', () => {
    const a = bestellung();
    const b = bestellung();
    const tag = aggregateDashboardDay(TAG, [b, a]);

    expect(tag.orders.map((o) => o.orderNumber)).toEqual([b.orderNumber, a.orderNumber]);
  });
});

describe('aggregateDashboardDay — offene Bestellungen', () => {
  it('zählt neu, bestätigt und in Produktion als offen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ status: 'new' }),
      bestellung({ status: 'confirmed' }),
      bestellung({ status: 'in_production' }),
    ]);

    expect(tag.openCount).toBe(3);
  });

  it('zählt abgeschlossen und storniert nicht als offen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ status: 'completed' }),
      bestellung({ status: 'cancelled' }),
    ]);

    expect(tag.openCount).toBe(0);
  });
});

describe('aggregateDashboardDay — Kunden', () => {
  it('zählt jeden Kunden einmal, auch bei mehreren Bestellungen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ customerId: 1 }),
      bestellung({ customerId: 1 }),
      bestellung({ customerId: 2 }),
    ]);

    expect(tag.customerCount).toBe(2);
  });

  it('zählt einen Kunden nicht, der an diesem Tag nur storniert hat', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ customerId: 1 }),
      bestellung({ customerId: 2, status: 'cancelled' }),
    ]);

    expect(tag.customerCount).toBe(1);
  });
});

describe('aggregateDashboardDay — Einheiten', () => {
  it('summiert die Mengen aller Positionen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ items: [position({ quantity: 3 }), position({ productId: 2, quantity: 4 })] }),
      bestellung({ items: [position({ quantity: 5 })] }),
    ]);

    expect(tag.totalUnits).toBe(12);
  });

  it('zählt die Positionen einer stornierten Bestellung nicht mit', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ items: [position({ quantity: 3 })] }),
      bestellung({ status: 'cancelled', items: [position({ quantity: 99 })] }),
    ]);

    expect(tag.totalUnits).toBe(3);
  });
});

describe('aggregateDashboardDay — noch nicht bezahlt', () => {
  it('summiert die Beträge offener Bestellungen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350, paymentStatus: 'unpaid' }),
      bestellung({ totalCents: 1290, paymentStatus: 'unpaid' }),
      bestellung({ totalCents: 9999, paymentStatus: 'paid_cash' }),
    ]);

    expect(tag.unpaidCents).toBe(5640);
    expect(tag.unpaidCount).toBe(2);
  });

  it('zählt eine stornierte offene Bestellung nicht als ausstehend', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350, paymentStatus: 'unpaid' }),
      bestellung({ totalCents: 9999, paymentStatus: 'unpaid', status: 'cancelled' }),
    ]);

    expect(tag.unpaidCents).toBe(4350);
    expect(tag.unpaidCount).toBe(1);
  });

  it('zählt eine abgeschlossene, aber unbezahlte Bestellung als ausstehend', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ totalCents: 4350, status: 'completed', paymentStatus: 'unpaid' }),
    ]);

    expect(tag.unpaidCents).toBe(4350);
    expect(tag.unpaidCount).toBe(1);
  });

  it('lässt jede bezahlte Zahlart aus der offenen Summe heraus', () => {
    for (const bezahlt of ['paid_cash', 'paid_card', 'paid_bank', 'paid_other'] as const) {
      const tag = aggregateDashboardDay(TAG, [
        bestellung({ totalCents: 4350, paymentStatus: bezahlt }),
      ]);
      expect(tag.unpaidCents).toBe(0);
    }
  });
});

describe('aggregateDashboardDay — Top-Produkte', () => {
  it('sortiert nach bestellter Menge, absteigend', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({
        items: [
          position({ productId: 1, productName: 'Fiktiver Käsekuchen', quantity: 2 }),
          position({ productId: 2, productName: 'Fiktive Tarte', quantity: 7 }),
        ],
      }),
    ]);

    expect(tag.topProducts.map((p) => p.productName)).toEqual([
      'Fiktive Tarte',
      'Fiktiver Käsekuchen',
    ]);
  });

  it('fasst dasselbe Produkt über mehrere Bestellungen zusammen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ items: [position({ productId: 1, quantity: 2 })] }),
      bestellung({ items: [position({ productId: 1, quantity: 3 })] }),
    ]);

    expect(tag.topProducts).toHaveLength(1);
    expect(tag.topProducts[0]?.quantity).toBe(5);
  });

  it('lässt die Positionen einer stornierten Bestellung außen vor', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ items: [position({ productId: 1, quantity: 2 })] }),
      bestellung({
        status: 'cancelled',
        items: [position({ productId: 2, productName: 'Fiktive Tarte', quantity: 99 })],
      }),
    ]);

    expect(tag.topProducts.map((p) => p.productName)).toEqual(['Fiktiver Käsekuchen']);
  });

  it('zeigt höchstens fünf Produkte', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      position({ productId: i + 1, productName: `Produkt ${i + 1}`, quantity: i + 1 }),
    );
    const tag = aggregateDashboardDay(TAG, [bestellung({ items })]);

    expect(TOP_PRODUCTS_LIMIT).toBe(5);
    expect(tag.topProducts).toHaveLength(5);
    expect(tag.topProducts.map((p) => p.quantity)).toEqual([8, 7, 6, 5, 4]);
  });

  it('trennt gleiche Mengen über die Sortierung des Sortiments', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({
        items: [
          position({ productId: 2, productName: 'B-Produkt', sortOrder: 20, quantity: 4 }),
          position({ productId: 1, productName: 'A-Produkt', sortOrder: 10, quantity: 4 }),
        ],
      }),
    ]);

    expect(tag.topProducts.map((p) => p.productName)).toEqual(['A-Produkt', 'B-Produkt']);
  });

  it('trennt dieselbe Produkt-ID mit abweichendem Namen in zwei Zeilen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({ items: [position({ productId: 1, productName: 'Alter Name', quantity: 2 })] }),
      bestellung({ items: [position({ productId: 1, productName: 'Neuer Name', quantity: 3 })] }),
    ]);

    expect(tag.topProducts).toHaveLength(2);
    expect(tag.topProducts.map((p) => p.productName)).toEqual(['Neuer Name', 'Alter Name']);
  });
});

describe('aggregateDashboardDay — der Schlüssel der Zusammenfassung', () => {
  /**
   * Der Trennzeichenfall: Zwei verschiedene Produkte dürfen nicht deshalb zu
   * einer Zeile verschmelzen, weil sich ihre Merkmale mit dem Trennzeichen zu
   * derselben Zeichenkette verkleben lassen. Mit einem Leerzeichen als
   * Trenner ergäben „Käsekuchen mit Guss"/„Stück" und „Käsekuchen"/„mit Guss
   * Stück" denselben Schlüssel.
   */
  it('verklebt zwei Produkte nicht über das Trennzeichen', () => {
    const tag = aggregateDashboardDay(TAG, [
      bestellung({
        items: [
          position({ productId: 7, productName: 'Kuchen mit Guss', productUnit: 'Stück', quantity: 2 }),
          position({ productId: 7, productName: 'Kuchen', productUnit: 'mit Guss Stück', quantity: 3 }),
        ],
      }),
    ]);

    expect(tag.topProducts).toHaveLength(2);
  });
});
