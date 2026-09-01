import { describe, expect, it } from 'vitest';
import { aggregateAnalytics, type AnalyticsInput } from '../../src/domain/analytics';
import { resolveReportingPeriod } from '../../src/domain/reporting-period';

const HEUTE = '2026-09-15';

function leer(): AnalyticsInput {
  return { orders: [], items: [], products: [], customers: [], segments: [] };
}

function bestellung(over: Partial<AnalyticsInput['orders'][number]> = {}) {
  return {
    day: '2026-09-10',
    status: 'completed' as const,
    paymentStatus: 'paid_cash' as const,
    orderCount: 1,
    revenueCents: 10_000,
    ...over,
  };
}

function positionen(over: Partial<AnalyticsInput['items'][number]> = {}) {
  return {
    day: '2026-09-10',
    status: 'completed' as const,
    units: 5,
    knownCostCents: 4_000,
    itemCount: 1,
    missingItemCount: 0,
    orderCount: 1,
    missingOrderCount: 0,
    ...over,
  };
}

const MONAT = resolveReportingPeriod('monat', HEUTE);

describe('Bestellumsatz', () => {
  it('summiert nicht stornierte Bestellungen des Zeitraums', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ revenueCents: 10_000 }),
        bestellung({ day: '2026-09-11', status: 'new', revenueCents: 2_500 }),
      ],
    });
    expect(a.current.revenueCents).toBe(12_500);
    expect(a.current.orderCount).toBe(2);
  });

  it('lässt stornierte Bestellungen ganz weg', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ revenueCents: 10_000 }),
        bestellung({ status: 'cancelled', revenueCents: 9_900, orderCount: 3 }),
      ],
    });
    expect(a.current.revenueCents).toBe(10_000);
    expect(a.current.orderCount).toBe(1);
  });

  it('zählt Tage außerhalb des Zeitraums nicht mit', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ day: '2026-08-31', revenueCents: 50_000 }),
        bestellung({ day: '2026-09-16', revenueCents: 70_000 }),
        bestellung({ day: '2026-09-15', revenueCents: 1_000 }),
      ],
    });
    // 31.08. gehört in den Vergleichszeitraum, 16.09. liegt hinter dem Schnitt.
    expect(a.current.revenueCents).toBe(1_000);
  });

  it('zählt den ersten und den letzten Tag des Zeitraums mit', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ day: '2026-09-01', revenueCents: 100 }),
        bestellung({ day: '2026-09-15', revenueCents: 200 }),
      ],
    });
    expect(a.current.revenueCents).toBe(300);
  });
});

describe('Verkaufte Stück', () => {
  it('summiert die aktiven Mengen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      items: [positionen({ units: 5 }), positionen({ day: '2026-09-11', units: 3 })],
    });
    expect(a.current.units).toBe(8);
  });

  it('zählt Positionen stornierter Bestellungen nicht', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      items: [positionen({ units: 5 }), positionen({ status: 'cancelled', units: 40 })],
    });
    expect(a.current.units).toBe(5);
  });
});

describe('Ø pro Bestellung', () => {
  it('teilt Umsatz durch Bestellungen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ revenueCents: 10_000, orderCount: 3 })],
    });
    expect(a.current.averageOrderCents).toBe(3_333);
  });

  it('gibt ohne Bestellungen keinen Wert und keine Null', () => {
    expect(aggregateAnalytics(MONAT, leer()).current.averageOrderCents).toBeNull();
  });
});

describe('Noch offen', () => {
  it('folgt dem gespeicherten Zahlungsstand', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ paymentStatus: 'unpaid', revenueCents: 4_000 }),
        bestellung({ paymentStatus: 'paid_bank', revenueCents: 6_000 }),
      ],
    });
    expect(a.current.unpaidCents).toBe(4_000);
    expect(a.current.unpaidCount).toBe(1);
    expect(a.current.revenueCents).toBe(10_000);
  });

  it('zählt offene Beträge stornierter Bestellungen nicht', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ status: 'cancelled', paymentStatus: 'unpaid', revenueCents: 4_000 })],
    });
    expect(a.current.unpaidCents).toBe(0);
  });
});

describe('Deckungsbeitrag', () => {
  it('rechnet bei vollständiger Kostenbasis', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ revenueCents: 10_000 })],
      items: [positionen({ knownCostCents: 4_000, itemCount: 2 })],
    });
    expect(a.current.costs.complete).toBe(true);
    expect(a.current.costs.grossProfitCents).toBe(6_000);
    expect(a.current.costs.marginTenthsPercent).toBe(600);
  });

  it('hält den Deckungsbeitrag zurück, wenn Kosten fehlen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ revenueCents: 10_000 })],
      items: [positionen({ knownCostCents: 4_000, itemCount: 3, missingItemCount: 3, missingOrderCount: 1 })],
    });
    expect(a.current.costs.complete).toBe(false);
    expect(a.current.costs.grossProfitCents).toBeNull();
    expect(a.current.costs.marginTenthsPercent).toBeNull();
    expect(a.current.costs.missingItemCount).toBe(3);
  });

  it('nimmt Kosten stornierter Bestellungen nicht auf', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ revenueCents: 10_000 })],
      items: [
        positionen({ knownCostCents: 4_000, itemCount: 1 }),
        positionen({ status: 'cancelled', knownCostCents: 0, itemCount: 1, missingItemCount: 1 }),
      ],
    });
    expect(a.current.costs.complete).toBe(true);
    expect(a.current.costs.grossProfitCents).toBe(6_000);
  });
});

describe('Vergleich', () => {
  it('nennt Unterschied und Prozentwert', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ day: '2026-09-05', revenueCents: 12_000 }),
        bestellung({ day: '2026-08-05', revenueCents: 10_000 }),
      ],
    });
    expect(a.previous.revenueCents).toBe(10_000);
    expect(a.comparison.revenue).toEqual({ kind: 'value', absolute: 2_000, tenthsPercent: 200 });
  });

  it('meldet einen Rückgang mit Vorzeichen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ day: '2026-09-05', revenueCents: 8_000 }),
        bestellung({ day: '2026-08-05', revenueCents: 10_000 }),
      ],
    });
    expect(a.comparison.revenue).toEqual({ kind: 'value', absolute: -2_000, tenthsPercent: -200 });
  });

  it('sagt „Neu" statt eines unendlichen Prozentwerts', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [bestellung({ day: '2026-09-05', revenueCents: 8_000 })],
    });
    expect(a.comparison.revenue).toEqual({ kind: 'new' });
    expect(a.comparison.previousHasData).toBe(false);
  });

  it('sagt bei zwei leeren Zeiträumen, dass es nichts zu vergleichen gibt', () => {
    const a = aggregateAnalytics(MONAT, leer());
    expect(a.comparison.revenue).toEqual({ kind: 'none' });
    expect(a.comparison.orders).toEqual({ kind: 'none' });
    expect(a.comparison.units).toEqual({ kind: 'none' });
  });

  it('meldet fehlende Vorjahresdaten', () => {
    const jahr = resolveReportingPeriod('jahr', HEUTE);
    const a = aggregateAnalytics(jahr, {
      ...leer(),
      orders: [bestellung({ day: '2026-03-05', revenueCents: 8_000 })],
    });
    expect(a.comparison.previousHasData).toBe(false);
  });

  it('vergleicht Bestellungen und Stück ebenso', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      orders: [
        bestellung({ day: '2026-09-05', orderCount: 12, revenueCents: 1 }),
        bestellung({ day: '2026-08-05', orderCount: 10, revenueCents: 1 }),
      ],
      items: [
        positionen({ day: '2026-09-05', units: 40 }),
        positionen({ day: '2026-08-05', units: 50 }),
      ],
    });
    expect(a.comparison.orders).toEqual({ kind: 'value', absolute: 2, tenthsPercent: 200 });
    expect(a.comparison.units).toEqual({ kind: 'value', absolute: -10, tenthsPercent: -200 });
  });
});

describe('Kurve', () => {
  it('legt für jeden Tag des Zeitraums einen Punkt an, auch für leere', () => {
    const a = aggregateAnalytics(resolveReportingPeriod('woche', HEUTE), {
      ...leer(),
      orders: [bestellung({ day: '2026-09-15', revenueCents: 700 })],
    });
    expect(a.trend.map((p) => p.key)).toEqual(['2026-09-14', '2026-09-15']);
    expect(a.trend.map((p) => p.revenueCents)).toEqual([0, 700]);
  });

  it('gruppiert das Jahr in Monate', () => {
    const a = aggregateAnalytics(resolveReportingPeriod('jahr', HEUTE), {
      ...leer(),
      orders: [
        bestellung({ day: '2026-03-05', revenueCents: 100 }),
        bestellung({ day: '2026-03-28', revenueCents: 200 }),
      ],
    });
    expect(a.trend).toHaveLength(9);
    expect(a.trend[0]?.key).toBe('2026-01');
    expect(a.trend[2]).toMatchObject({ key: '2026-03', revenueCents: 300, orderCount: 2 });
  });

  it('gruppiert eine lange freie Spanne in Wochen ab Montag', () => {
    const p = resolveReportingPeriod('zeitraum', HEUTE, '2026-05-01', '2026-08-14');
    const a = aggregateAnalytics(p, {
      ...leer(),
      orders: [bestellung({ day: '2026-05-01', revenueCents: 100 })],
    });
    expect(p.granularity).toBe('week');
    expect(a.trend[0]?.key).toBe('2026-04-27');
    expect(a.trend[0]?.revenueCents).toBe(100);
  });

  it('zeigt bei „Heute" die letzten sieben Tage', () => {
    const a = aggregateAnalytics(resolveReportingPeriod('heute', HEUTE), {
      ...leer(),
      orders: [bestellung({ day: '2026-09-09', revenueCents: 100 })],
    });
    expect(a.trend).toHaveLength(7);
    expect(a.trend[0]?.key).toBe('2026-09-09');
    expect(a.trend[0]?.revenueCents).toBe(100);
    // Die Kennzahl bleibt der eine Tag.
    expect(a.current.revenueCents).toBe(0);
  });

  it('nimmt stornierte Bestellungen auch aus der Kurve heraus', () => {
    const a = aggregateAnalytics(resolveReportingPeriod('woche', HEUTE), {
      ...leer(),
      orders: [bestellung({ day: '2026-09-15', status: 'cancelled', revenueCents: 700 })],
    });
    expect(a.trend.map((p) => p.revenueCents)).toEqual([0, 0]);
  });
});

describe('Top-Produkte', () => {
  const produkt = (over: Partial<AnalyticsInput['products'][number]> = {}) => ({
    productId: 1,
    name: 'Fiktiver Käsekuchen',
    unit: 'Ring 26',
    status: 'completed' as const,
    latestItemId: 10,
    units: 4,
    revenueCents: 4_000,
    ...over,
  });

  it('sortiert nach Bestellumsatz und begrenzt die Liste', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      products: [
        produkt({ productId: 1, name: 'A', revenueCents: 1_000, units: 9 }),
        produkt({ productId: 2, name: 'B', revenueCents: 5_000, units: 2 }),
        produkt({ productId: 3, name: 'C', revenueCents: 3_000, units: 3 }),
      ],
    });
    expect(a.topProducts.map((p) => p.name)).toEqual(['B', 'C', 'A']);
    expect(a.topProducts[0]).toMatchObject({ units: 2, revenueCents: 5_000 });
  });

  it('lässt stornierte Bestellungen weg', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      products: [
        produkt({ productId: 1, name: 'A', revenueCents: 1_000 }),
        produkt({ productId: 2, name: 'B', status: 'cancelled', revenueCents: 9_000 }),
      ],
    });
    expect(a.topProducts.map((p) => p.name)).toEqual(['A']);
  });

  it('fasst dasselbe Produkt über Status zusammen und nimmt den neuesten Namen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      products: [
        produkt({ productId: 1, name: 'Alter Name', latestItemId: 4, units: 2, revenueCents: 200 }),
        produkt({ productId: 1, name: 'Neuer Name', status: 'new', latestItemId: 9, units: 3, revenueCents: 300 }),
      ],
    });
    expect(a.topProducts).toHaveLength(1);
    expect(a.topProducts[0]).toMatchObject({ name: 'Neuer Name', units: 5, revenueCents: 500 });
  });

  it('führt höchstens sechs Einträge', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      products: Array.from({ length: 9 }, (_, i) =>
        produkt({ productId: i + 1, name: `P${i}`, revenueCents: (i + 1) * 100 }),
      ),
    });
    expect(a.topProducts).toHaveLength(6);
    expect(a.topProducts[0]?.name).toBe('P8');
  });
});

describe('Top-Kunden', () => {
  const kunde = (over: Partial<AnalyticsInput['customers'][number]> = {}) => ({
    customerId: 1,
    name: 'Fiktives Café Nord',
    status: 'completed' as const,
    latestOrderId: 10,
    orderCount: 2,
    revenueCents: 4_000,
    ...over,
  });

  it('sortiert nach Bestellumsatz und nennt keine Kennungen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      customers: [
        kunde({ customerId: 1, name: 'A', revenueCents: 1_000, orderCount: 5 }),
        kunde({ customerId: 2, name: 'B', revenueCents: 8_000, orderCount: 1 }),
      ],
    });
    expect(a.topCustomers).toEqual([
      { name: 'B', orderCount: 1, revenueCents: 8_000 },
      { name: 'A', orderCount: 5, revenueCents: 1_000 },
    ]);
  });

  it('lässt stornierte Bestellungen weg und fasst denselben Kunden zusammen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      customers: [
        kunde({ customerId: 1, name: 'Alt', latestOrderId: 3, orderCount: 1, revenueCents: 1_000 }),
        kunde({ customerId: 1, name: 'Neu', status: 'new', latestOrderId: 8, orderCount: 2, revenueCents: 2_000 }),
        kunde({ customerId: 2, name: 'Storno', status: 'cancelled', orderCount: 4, revenueCents: 9_000 }),
      ],
    });
    expect(a.topCustomers).toEqual([{ name: 'Neu', orderCount: 3, revenueCents: 3_000 }]);
  });
});

describe('Aufteilungen', () => {
  const segment = (over: Partial<AnalyticsInput['segments'][number]> = {}) => ({
    fulfillmentType: 'delivery' as const,
    priceGroupCode: 'gastro' as string | null,
    status: 'completed' as const,
    orderCount: 1,
    revenueCents: 6_000,
    ...over,
  });

  it('teilt nach Gastro und Privat auf', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      segments: [
        segment({ priceGroupCode: 'gastro', revenueCents: 7_500 }),
        segment({ priceGroupCode: 'private', revenueCents: 2_500 }),
      ],
    });
    expect(a.customerGroups.totalCents).toBe(10_000);
    expect(a.customerGroups.entries).toEqual([
      { key: 'gastro', label: 'Gastronomie', orderCount: 1, revenueCents: 7_500, shareTenthsPercent: 750 },
      { key: 'private', label: 'Privatkunden', orderCount: 1, revenueCents: 2_500, shareTenthsPercent: 250 },
    ]);
  });

  it('nennt Kunden ohne Preisgruppe beim Namen', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      segments: [segment({ priceGroupCode: null, revenueCents: 1_000 })],
    });
    expect(a.customerGroups.entries[0]).toMatchObject({ key: 'ohne', label: 'Ohne Preisgruppe' });
  });

  it('teilt nach Lieferung und Abholung auf', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      segments: [
        segment({ fulfillmentType: 'delivery', revenueCents: 3_000 }),
        segment({ fulfillmentType: 'pickup', revenueCents: 1_000 }),
      ],
    });
    expect(a.fulfillment.entries).toEqual([
      { key: 'delivery', label: 'Lieferung', orderCount: 1, revenueCents: 3_000, shareTenthsPercent: 750 },
      { key: 'pickup', label: 'Abholung', orderCount: 1, revenueCents: 1_000, shareTenthsPercent: 250 },
    ]);
  });

  it('lässt stornierte Bestellungen weg und bleibt bei leerem Zeitraum leer', () => {
    const a = aggregateAnalytics(MONAT, {
      ...leer(),
      segments: [segment({ status: 'cancelled' })],
    });
    expect(a.fulfillment.entries).toEqual([]);
    expect(a.customerGroups.entries).toEqual([]);
    expect(a.fulfillment.totalCents).toBe(0);
  });
});

describe('Leerer Zeitraum', () => {
  it('meldet ihn ausdrücklich', () => {
    const a = aggregateAnalytics(MONAT, leer());
    expect(a.isEmpty).toBe(true);
    expect(a.current.revenueCents).toBe(0);
    expect(a.current.costs.complete).toBe(true);
  });

  it('ist nicht leer, sobald eine Bestellung darin liegt', () => {
    const a = aggregateAnalytics(MONAT, { ...leer(), orders: [bestellung()] });
    expect(a.isEmpty).toBe(false);
  });
});
