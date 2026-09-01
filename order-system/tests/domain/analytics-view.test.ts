import { describe, expect, it } from 'vitest';
import { aggregateAnalytics, type AnalyticsInput } from '../../src/domain/analytics';
import { resolveReportingPeriod } from '../../src/domain/reporting-period';
import { toAnalyticsView } from '../../src/ui/analytics-view';
import { formatGermanMonthYear } from '../../src/ui/format';

const HEUTE = '2026-09-15';

function leer(): AnalyticsInput {
  return { orders: [], items: [], products: [], customers: [], segments: [] };
}

function order(day: string, over: Partial<AnalyticsInput['orders'][number]> = {}) {
  return {
    day,
    status: 'completed' as const,
    paymentStatus: 'paid_cash' as const,
    orderCount: 1,
    revenueCents: 10_000,
    ...over,
  };
}

function view(kind: Parameters<typeof resolveReportingPeriod>[0], input: AnalyticsInput, from?: string, to?: string) {
  const period = resolveReportingPeriod(kind, HEUTE, from ?? null, to ?? null);
  return toAnalyticsView(aggregateAnalytics(period, input), 'umsatz');
}

describe('Monatsname', () => {
  it('schreibt Monat und Jahr aus', () => {
    expect(formatGermanMonthYear('2026-09-01')).toBe('September 2026');
  });
});

describe('Zeitraumleiste', () => {
  it('führt fünf Wahlmöglichkeiten und markiert genau eine', () => {
    const v = view('monat', leer());
    expect(v.tabs.map((t) => t.label)).toEqual(['Heute', 'Woche', 'Monat', 'Jahr', 'Zeitraum']);
    expect(v.tabs.filter((t) => t.isActive).map((t) => t.kind)).toEqual(['monat']);
    expect(v.tabs[0]?.href).toBe('/admin/auswertung?period=heute');
  });

  it('behält die Kurvenwahl beim Zeitraumwechsel', () => {
    const period = resolveReportingPeriod('monat', HEUTE);
    const v = toAnalyticsView(aggregateAnalytics(period, leer()), 'bestellungen');
    expect(v.tabs[0]?.href).toBe('/admin/auswertung?period=heute&metric=bestellungen');
  });

  it('füllt die freie Spanne mit den gewählten Tagen', () => {
    const v = view('zeitraum', leer(), '2026-08-01', '2026-08-14');
    expect(v.custom).toMatchObject({ from: '2026-08-01', to: '2026-08-14', isActive: true });
  });

  it('schlägt für die freie Spanne den laufenden Monat vor, solange keine gewählt ist', () => {
    const v = view('monat', leer());
    expect(v.custom).toMatchObject({ from: '2026-09-01', to: '2026-09-15', isActive: false });
  });
});

describe('Zeitraumnamen', () => {
  it('nennt heute und gestern beim Namen', () => {
    const v = view('heute', leer());
    expect(v.rangeLabel).toBe('Heute, Dienstag, 15. September 2026');
    expect(v.previousLabel).toBe('Gestern, Montag, 14. September 2026');
  });

  it('sagt beim laufenden Monat, dass er noch läuft', () => {
    const v = view('monat', leer());
    expect(v.rangeLabel).toBe('September 2026 (bis heute)');
    expect(v.previousLabel).toBe('August 2026, gleicher Zeitraum (1.–15.)');
  });

  it('nennt einen abgeschlossenen Monat ohne Zusatz', () => {
    const period = resolveReportingPeriod('monat', '2026-09-30');
    const v = toAnalyticsView(aggregateAnalytics(period, leer()), 'umsatz');
    expect(v.rangeLabel).toBe('September 2026');
    expect(v.previousLabel).toBe('August 2026');
  });

  it('nennt das laufende Jahr und den Vorjahreszeitraum', () => {
    const v = view('jahr', leer());
    expect(v.rangeLabel).toBe('2026 (bis heute)');
    expect(v.previousLabel).toBe('2025, gleicher Zeitraum (bis 15.09.)');
  });

  it('nennt die Woche mit ihren Tagen', () => {
    const v = view('woche', leer());
    expect(v.rangeLabel).toBe('Diese Woche, 14.–15.09.2026');
    expect(v.previousLabel).toBe('Vorwoche, gleicher Zeitraum (07.–08.09.2026)');
  });

  it('nennt den Monat auch vorn, wenn die Woche über eine Monatsgrenze läuft', () => {
    // 2026-09-01 ist ein Dienstag; die Woche beginnt am 31. August.
    const period = resolveReportingPeriod('woche', '2026-09-01');
    const v = toAnalyticsView(aggregateAnalytics(period, leer()), 'umsatz');
    expect(v.rangeLabel).toBe('Diese Woche, 31.08.–01.09.2026');
  });

  it('nennt die freie Spanne mit ihren Grenzen', () => {
    const v = view('zeitraum', leer(), '2026-08-01', '2026-08-14');
    expect(v.rangeLabel).toBe('01.08.–14.08.2026');
    expect(v.previousLabel).toBe('Davor: 18.07.–31.07.2026');
  });
});

describe('Kennzahlen', () => {
  const eingabe: AnalyticsInput = {
    ...leer(),
    orders: [
      order('2026-09-05', { revenueCents: 1_248_000, orderCount: 184 }),
      order('2026-09-06', { revenueCents: 124_000, orderCount: 2, paymentStatus: 'unpaid' }),
      order('2026-08-05', { revenueCents: 1_151_000, orderCount: 172 }),
    ],
    items: [
      {
        day: '2026-09-05',
        status: 'completed',
        units: 426,
        knownCostCents: 850_000,
        itemCount: 300,
        missingItemCount: 0,
        orderCount: 184,
        missingOrderCount: 0,
      },
      {
        day: '2026-08-05',
        status: 'completed',
        units: 444,
        knownCostCents: 800_000,
        itemCount: 290,
        missingItemCount: 0,
        orderCount: 172,
        missingOrderCount: 0,
      },
    ],
  };

  it('führt genau sechs Kennzahlen in der festgelegten Reihenfolge', () => {
    const v = view('monat', eingabe);
    expect(v.kpis.map((k) => k.key)).toEqual([
      'umsatz',
      'bestellungen',
      'stueck',
      'schnitt',
      'offen',
      'deckungsbeitrag',
    ]);
    expect(v.kpis.map((k) => k.label)).toEqual([
      'Bestellumsatz',
      'Bestellungen',
      'Verkaufte Stück',
      'Ø pro Bestellung',
      'Noch offen',
      'Deckungsbeitrag',
    ]);
  });

  it('zeigt den Umsatz und den Unterschied zum Vormonat', () => {
    const v = view('monat', eingabe);
    const umsatz = v.kpis[0];
    expect(umsatz?.value).toBe('13.720,00 €');
    expect(umsatz?.delta?.arrow).toBe('↑');
    expect(umsatz?.delta?.tone).toBe('up');
    expect(umsatz?.delta?.label).toBe('19,2 % mehr als im Vormonat');
  });

  it('sagt bei den Zählwerten „mehr" und „weniger" statt Prozent', () => {
    const v = view('monat', eingabe);
    expect(v.kpis[1]?.delta?.label).toBe('14 Bestellungen mehr als im Vormonat');
    expect(v.kpis[2]?.delta?.label).toBe('18 Stück weniger als im Vormonat');
    expect(v.kpis[2]?.delta?.tone).toBe('down');
  });

  it('rechnet den Durchschnitt und den offenen Betrag aus', () => {
    const v = view('monat', eingabe);
    expect(v.kpis[3]?.value).toBe('73,76 €');
    expect(v.kpis[4]?.value).toBe('1.240,00 €');
    expect(v.kpis[4]?.hint).toBe('2 Bestellungen sind noch nicht bezahlt');
  });

  it('zeigt den Deckungsbeitrag mit Marge und erklärt ihn in einem Satz', () => {
    const v = view('monat', eingabe);
    const db = v.kpis[5];
    expect(db?.value).toBe('5.220,00 €');
    expect(db?.hint).toBe('Was nach bekannten Herstellkosten übrig bleibt · Marge 38,0 %');
    expect(db?.isMissing).toBe(false);
  });

  it('hält den Deckungsbeitrag zurück, wenn Kosten fehlen', () => {
    const v = view('monat', {
      ...leer(),
      orders: [order('2026-09-05')],
      items: [
        {
          day: '2026-09-05',
          status: 'completed',
          units: 4,
          knownCostCents: 100,
          itemCount: 5,
          missingItemCount: 3,
          orderCount: 1,
          missingOrderCount: 1,
        },
      ],
    });
    const db = v.kpis[5];
    expect(db?.value).toBe('Noch nicht vollständig');
    expect(db?.hint).toBe('Bei 3 Positionen fehlen die Herstellkosten');
    expect(db?.isMissing).toBe(true);
  });

  it('nennt eine einzelne fehlende Position in der Einzahl', () => {
    const v = view('monat', {
      ...leer(),
      orders: [order('2026-09-05')],
      items: [
        {
          day: '2026-09-05',
          status: 'completed',
          units: 4,
          knownCostCents: 100,
          itemCount: 5,
          missingItemCount: 1,
          orderCount: 1,
          missingOrderCount: 1,
        },
      ],
    });
    expect(v.kpis[5]?.hint).toBe('Bei 1 Position fehlen die Herstellkosten');
  });

  it('zeigt ohne Bestellung einen Strich statt eines Durchschnitts von null', () => {
    const v = view('monat', leer());
    expect(v.kpis[3]?.value).toBe('—');
  });

  it('zeigt ohne Bestellung auch beim Deckungsbeitrag einen Strich', () => {
    const v = view('monat', leer());
    expect(v.kpis[5]?.value).toBe('—');
    expect(v.kpis[5]?.isMissing).toBe(true);
    expect(v.kpis[5]?.hint).toBe('Bestellumsatz minus bekannte Herstellkosten');
  });

  it('sagt „Nichts offen", wenn nichts offen ist', () => {
    expect(view('monat', leer()).kpis[4]?.hint).toBe('Nichts offen');
    const bezahlt = view('monat', { ...leer(), orders: [order('2026-09-05', { paymentStatus: 'paid_bank' })] });
    expect(bezahlt.kpis[4]?.hint).toBe('Nichts offen');
  });

  it('sagt „Neu" statt eines Prozentwerts ohne Grundlage', () => {
    const v = view('monat', { ...leer(), orders: [order('2026-09-05')] });
    expect(v.kpis[0]?.delta).toMatchObject({ tone: 'new', label: 'Neu — kein Vormonat zum Vergleich' });
  });

  it('sagt bei fehlenden Vorjahresdaten, dass es sie nicht gibt', () => {
    const period = resolveReportingPeriod('jahr', HEUTE);
    const v = toAnalyticsView(aggregateAnalytics(period, { ...leer(), orders: [order('2026-03-01')] }), 'umsatz');
    expect(v.kpis[0]?.delta?.label).toBe('Neu — noch keine Vorjahresdaten');
  });

  it('sagt bei zwei leeren Zeiträumen, dass kein Vergleich möglich ist', () => {
    const v = view('monat', leer());
    expect(v.kpis[0]?.delta).toMatchObject({ tone: 'none', label: 'Kein Vergleich möglich', arrow: '' });
  });
});

describe('Kurve', () => {
  it('setzt Balkenhöhen als ganze Prozent des größten Werts', () => {
    const v = view('woche', {
      ...leer(),
      orders: [order('2026-09-14', { revenueCents: 4_000 }), order('2026-09-15', { revenueCents: 8_000 })],
    });
    expect(v.trend.bars.map((b) => b.heightPercent)).toEqual([50, 100]);
    expect(v.trend.bars.map((b) => b.barY)).toEqual([50, 0]);
  });

  it('gibt einem Wert über null mindestens einen sichtbaren Balken', () => {
    const v = view('woche', {
      ...leer(),
      orders: [order('2026-09-14', { revenueCents: 1 }), order('2026-09-15', { revenueCents: 100_000 })],
    });
    expect(v.trend.bars[0]?.heightPercent).toBe(1);
  });

  it('lässt einen leeren Tag ohne Balken', () => {
    const v = view('woche', { ...leer(), orders: [order('2026-09-15', { revenueCents: 100 })] });
    expect(v.trend.bars[0]).toMatchObject({ heightPercent: 0, barY: 100 });
  });

  it('bleibt bei einem Zeitraum ohne Umsatz eine ruhige Grundlinie', () => {
    const v = view('woche', leer());
    expect(v.trend.isEmpty).toBe(true);
    expect(v.trend.bars.every((b) => b.heightPercent === 0)).toBe(true);
  });

  it('schaltet zwischen Umsatz und Bestellungen um', () => {
    const period = resolveReportingPeriod('woche', HEUTE);
    const daten = { ...leer(), orders: [order('2026-09-15', { revenueCents: 5_000, orderCount: 4 })] };
    const umsatz = toAnalyticsView(aggregateAnalytics(period, daten), 'umsatz');
    const anzahl = toAnalyticsView(aggregateAnalytics(period, daten), 'bestellungen');

    expect(umsatz.trend.caption).toBe('Bestellumsatz je Tag');
    expect(umsatz.trend.bars[1]?.valueLabel).toBe('50,00 €');
    expect(anzahl.trend.caption).toBe('Bestellungen je Tag');
    expect(anzahl.trend.bars[1]?.valueLabel).toBe('4');
    expect(anzahl.trend.metricTabs.filter((t) => t.isActive).map((t) => t.key)).toEqual(['bestellungen']);
    expect(anzahl.trend.metricTabs[0]?.href).toBe('/admin/auswertung?period=woche&metric=umsatz');
  });

  it('nennt den größten Wert als Skala', () => {
    const v = view('woche', { ...leer(), orders: [order('2026-09-15', { revenueCents: 5_000 })] });
    expect(v.trend.maxLabel).toBe('50,00 €');
    expect(view('woche', leer()).trend.maxLabel).toBe('0,00 €');
  });

  it('beschriftet Monate im Jahr und Tage in der Woche', () => {
    expect(view('jahr', leer()).trend.bars.map((b) => b.axisLabel)).toEqual([
      'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep',
    ]);
    expect(view('woche', leer()).trend.bars.map((b) => b.axisLabel)).toEqual(['Mo', 'Di']);
  });

  it('hebt bei vielen Tagen nur jede fünfte Marke hervor', () => {
    const v = view('monat', leer());
    expect(v.trend.bars).toHaveLength(15);
    expect(v.trend.bars.filter((b) => b.axisEmphasis).map((b) => b.axisLabel)).toEqual([
      '01.09.', '06.09.', '11.09.', '15.09.',
    ]);
  });

  it('zeigt die Werte über den Balken nur, solange es wenige sind', () => {
    expect(view('woche', leer()).trend.showValues).toBe(true);
    // Ein Jahr hat neun bis zwölf Monatsbalken — die bekommen ihre Beträge.
    expect(view('jahr', leer()).trend.showValues).toBe(true);
    // Ein halber September hat fünfzehn Tagesbalken — die nicht mehr.
    expect(view('monat', leer()).trend.showValues).toBe(false);
  });

  it('trägt für jeden Balken eine vorlesbare Zeile mit beiden Reihen', () => {
    const v = view('woche', { ...leer(), orders: [order('2026-09-15', { revenueCents: 5_000, orderCount: 4 })] });
    expect(v.trend.bars[1]).toMatchObject({
      rangeLabel: 'Dienstag, 15. September 2026',
      revenueLabel: '50,00 €',
      ordersLabel: '4',
    });
  });
});

describe('Toplisten', () => {
  it('nummeriert Produkte und nennt Menge und Umsatz', () => {
    const v = view('monat', {
      ...leer(),
      products: [
        { productId: 1, name: 'Fiktiver Käsekuchen', unit: 'Ring 26', status: 'completed', latestItemId: 3, units: 12, revenueCents: 26_400 },
      ],
    });
    expect(v.topProducts).toEqual([
      { rank: 1, name: 'Fiktiver Käsekuchen', unit: 'Ring 26', unitsLabel: '12', revenueLabel: '264,00 €' },
    ]);
  });

  it('nummeriert Kunden und nennt Bestellungen und Umsatz', () => {
    const v = view('monat', {
      ...leer(),
      customers: [
        { customerId: 1, name: 'Fiktives Café Nord', status: 'completed', latestOrderId: 4, orderCount: 1, revenueCents: 8_000 },
      ],
    });
    expect(v.topCustomers).toEqual([
      { rank: 1, name: 'Fiktives Café Nord', ordersLabel: '1 Bestellung', revenueLabel: '80,00 €' },
    ]);
  });
});

describe('Vergleich', () => {
  it('stellt drei Karten mit beiden Zeiträumen nebeneinander', () => {
    const v = view('monat', {
      ...leer(),
      orders: [
        order('2026-09-05', { revenueCents: 1_248_000, orderCount: 184 }),
        order('2026-08-05', { revenueCents: 1_151_000, orderCount: 172 }),
      ],
    });
    expect(v.comparisonCards.map((c) => c.title)).toEqual([
      'Bestellumsatz',
      'Bestellungen',
      'Verkaufte Stück',
    ]);
    expect(v.comparisonCards[0]).toMatchObject({
      currentLabel: 'September 2026 (bis heute)',
      currentValue: '12.480,00 €',
      previousLabel: 'August 2026, gleicher Zeitraum (1.–15.)',
      previousValue: '11.510,00 €',
      deltaLabel: '+970,00 €',
      percentLabel: '+8,4 %',
      tone: 'up',
    });
  });

  it('sagt ohne Vergleichsdaten, dass nichts zu vergleichen ist', () => {
    const v = view('monat', leer());
    expect(v.comparisonCards[0]).toMatchObject({ deltaLabel: 'Kein Vergleich möglich', percentLabel: '', tone: 'none' });
  });
});

describe('Aufteilungen', () => {
  it('gibt jedem Teil eine Breite und einen Anteil', () => {
    const v = view('monat', {
      ...leer(),
      segments: [
        { fulfillmentType: 'delivery', priceGroupCode: 'gastro', status: 'completed', orderCount: 3, revenueCents: 7_500 },
        { fulfillmentType: 'pickup', priceGroupCode: 'private', status: 'completed', orderCount: 1, revenueCents: 2_500 },
      ],
    });
    expect(v.customerGroups.entries).toEqual([
      { key: 'gastro', label: 'Gastronomie', valueLabel: '75,00 €', shareLabel: '75,0 %', ordersLabel: '3 Bestellungen', widthPercent: 75 },
      { key: 'private', label: 'Privatkunden', valueLabel: '25,00 €', shareLabel: '25,0 %', ordersLabel: '1 Bestellung', widthPercent: 25 },
    ]);
    expect(v.fulfillment.entries.map((e) => e.label)).toEqual(['Lieferung', 'Abholung']);
    expect(v.customerGroups.isEmpty).toBe(false);
  });

  it('bleibt bei leerem Zeitraum leer', () => {
    const v = view('monat', leer());
    expect(v.customerGroups.isEmpty).toBe(true);
    expect(v.fulfillment.entries).toEqual([]);
  });
});

describe('Leerzustände', () => {
  it('sagt bei einem Zeitraum ohne Bestellungen einen ruhigen Satz', () => {
    const v = view('monat', leer());
    expect(v.isEmpty).toBe(true);
    expect(v.emptyText).toBe('In diesem Zeitraum gibt es noch keine Bestellungen.');
  });

  it('sagt bei einem Zeitraum in der Zukunft, dass er noch nicht begonnen hat', () => {
    const v = view('zeitraum', leer(), '2026-10-01', '2026-10-31');
    expect(v.hasStarted).toBe(false);
    expect(v.emptyText).toBe('Dieser Zeitraum hat noch nicht begonnen.');
  });
});
