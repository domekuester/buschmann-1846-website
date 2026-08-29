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
    /** Ohne Position — also nichts zu kalkulieren und keine Lücke. */
    items: [],
    ...overrides,
  };
}

/** Eine Position, wie die Woche sie sieht: Menge und Kostenwert. */
function position(unitCostCents: number | null, quantity = 1) {
  return { quantity, unitCostCents };
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
      '/admin?date=2026-08-24',
      '/admin?date=2026-08-25',
      '/admin?date=2026-08-26',
      '/admin?date=2026-08-27',
      '/admin?date=2026-08-28',
      '/admin?date=2026-08-29',
      '/admin?date=2026-08-30',
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

    expect(woche.previousWeek.href).toBe('/admin?date=2026-08-17&view=week');
    expect(woche.nextWeek.href).toBe('/admin?date=2026-08-31&view=week');
  });

  it('markiert in der Schnellwahl die Woche als aktiv', () => {
    const woche = ansicht();

    expect(woche.quickDays.week.isCurrent).toBe(true);
    expect(woche.quickDays.today.href).toBe('/admin?date=2026-08-26');
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
      /**
       * Die Bestellungen dieses Falls tragen keine Positionen — es fehlt
       * also kein Kostenwert, und die Woche gilt als kalkuliert. Ohne
       * Kosten ist der Rohertrag der ganze Umsatz. Ein Fall aus der
       * Testvorgabe und keiner aus dem Betrieb; die Margenfälle stehen
       * weiter unten mit echten Positionen.
       */
      marginLabel: '100,0 %',
      marginIsMissing: false,
    });
  });

  it('bleibt an einer leeren Woche ruhig', () => {
    expect(ansicht().total).toEqual({
      ordersLabel: '0',
      revenueLabel: '0,00 €',
      openLabel: 'erledigt',
      unpaidLabel: 'bezahlt',
      cancelledLabel: '',
      // Kein Umsatz, also keine Marge — und kein Kostenhinweis, weil nichts fehlt.
      marginLabel: '—',
      marginIsMissing: false,
    });
  });
});

/**
 * PHASE 7B — DIE MARGENSPALTE DER WOCHENÜBERSICHT.
 *
 * §10 und §20 des Auftrags: eine Angabe je Tag, und nur dann eine ZAHL, wenn
 * der Tag vollständig kalkuliert ist.
 */
describe('§20.22 — die Marge eines vollständig kalkulierten Tages', () => {
  it('steht als Prozentwert in der Tageszeile', () => {
    const tage = ansicht([
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(450)] }),
    ]).days;

    expect(tage[0]?.marginLabel).toBe('55,0 %');
    expect(tage[0]?.marginIsMissing).toBe(false);
  });

  it('steht neben dem Umsatz desselben Tages', () => {
    const montag = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
    ]).days[0];

    expect(montag?.revenueLabel).toBe('420,00 €');
    expect(montag?.marginLabel).toBe('55,0 %');
  });

  it('bleibt bei jedem Tag bei seiner eigenen Zahl', () => {
    const tage = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
      bestellung({ day: '2026-08-26', totalCents: 84_000, items: [position(32_760)] }),
    ]).days;

    expect(tage[0]?.marginLabel).toBe('55,0 %');
    expect(tage[2]?.marginLabel).toBe('61,0 %');
  });
});

describe('§20.23 — der Tag mit fehlenden Kosten', () => {
  const gemischt = () => [
    bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
    bestellung({ day: '2026-08-25', totalCents: 31_000, items: [position(null)] }),
  ];

  it('sagt „Kosten fehlen" statt einer Teilmarge', () => {
    const dienstag = ansicht(gemischt()).days[1];

    expect(dienstag?.marginLabel).toBe('Kosten fehlen');
    expect(dienstag?.marginIsMissing).toBe(true);
  });

  it('zeigt den Umsatz dieses Tages trotzdem', () => {
    expect(ansicht(gemischt()).days[1]?.revenueLabel).toBe('310,00 €');
  });

  it('lässt die übrigen Tage ihre Marge behalten', () => {
    const tage = ansicht(gemischt()).days;

    expect(tage[0]?.marginLabel).toBe('55,0 %');
    expect(tage[0]?.marginIsMissing).toBe(false);
  });

  it('ergibt das Bild aus §10 des Auftrags', () => {
    const tage = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
      bestellung({ day: '2026-08-25', totalCents: 31_000, items: [position(null)] }),
      bestellung({ day: '2026-08-26', totalCents: 84_000, items: [position(32_760)] }),
    ]).days;

    expect([tage[0], tage[1], tage[2]].map((t) => [t?.revenueLabel, t?.marginLabel])).toEqual([
      ['420,00 €', '55,0 %'],
      ['310,00 €', 'Kosten fehlen'],
      ['840,00 €', '61,0 %'],
    ]);
  });
});

describe('Der Tag ohne Bestellung', () => {
  it('bekommt einen Strich und keinen Kostenhinweis', () => {
    const tag = ansicht().days[3];

    expect(tag?.marginLabel).toBe('—');
    expect(tag?.marginIsMissing).toBe(false);
    expect(tag?.isEmpty).toBe(true);
  });

  it('bekommt auch dann einen Strich, wenn alles storniert wurde', () => {
    /**
     * Ein Tag mit Umsatz null hat keine Marge — und „Kosten fehlen" wäre
     * dort die falsche Erklärung: Es fehlt nichts, es ist nur nichts übrig.
     */
    const tag = ansicht([
      bestellung({ day: MONTAG, status: 'cancelled', totalCents: 5000, items: [position(null)] }),
    ]).days[0];

    expect(tag?.marginLabel).toBe('—');
    expect(tag?.marginIsMissing).toBe(false);
    expect(tag?.isEmpty).toBe(false);
  });
});

describe('§20.24 und §20.25 — die Wochensumme', () => {
  it('zeigt die Wochenmarge, wenn die ganze Woche kalkuliert ist', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
      bestellung({ day: '2026-08-26', totalCents: 84_000, items: [position(32_760)] }),
    ]);

    expect(view.total.revenueLabel).toBe('1.260,00 €');
    expect(view.total.marginLabel).toBe('59,0 %');
    expect(view.total.marginIsMissing).toBe(false);
  });

  it('lässt die Wochenmarge bei einem einzigen unvollständigen Tag aus', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
      bestellung({ day: '2026-08-25', totalCents: 31_000, items: [position(null)] }),
      bestellung({ day: '2026-08-26', totalCents: 84_000, items: [position(32_760)] }),
    ]);

    expect(view.total.marginLabel).toBe('Kosten fehlen');
    expect(view.total.marginIsMissing).toBe(true);
  });

  it('zeigt den Wochenumsatz auch dann vollständig', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 42_000, items: [position(18_900)] }),
      bestellung({ day: '2026-08-25', totalCents: 31_000, items: [position(null)] }),
    ]);

    expect(view.total.revenueLabel).toBe('730,00 €');
  });

  /** §22.G — die Wochenmarge ist kein Mittelwert der Tagesmargen. */
  it('gewichtet die Wochenmarge nach Umsatz', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(100)] }),
      bestellung({ day: '2026-08-29', totalCents: 10_000, items: [position(7000)] }),
    ]);

    expect(view.days[0]?.marginLabel).toBe('90,0 %');
    expect(view.days[5]?.marginLabel).toBe('30,0 %');
    expect(view.total.marginLabel).toBe('35,5 %');
    expect(view.total.marginLabel).not.toBe('60,0 %');
  });

  it('gibt einer leeren Woche einen Strich in der Summenzeile', () => {
    expect(ansicht().total.marginLabel).toBe('—');
  });

  it('zeigt eine negative Wochenmarge mit Vorzeichen', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 10_000, items: [position(12_000)] }),
    ]);

    expect(view.total.marginLabel).toBe('-20,0 %');
  });
});

describe('Die Wochenübersicht bleibt karg', () => {
  it('zeigt je Tag genau eine kaufmännische Angabe', () => {
    /**
     * §10 — EXTREM KOMPAKT. Herstellkosten und Rohertrag stehen bewusst
     * NICHT je Tag: Wer sie braucht, klickt den Tag an.
     */
    const tag = ansicht([
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(450)] }),
    ]).days[0];

    expect(Object.keys(tag ?? {}).sort()).toEqual([
      'cancelledLabel',
      'date',
      'dateLabel',
      'href',
      'isEmpty',
      'isToday',
      'marginIsMissing',
      'marginLabel',
      'openLabel',
      'ordersLabel',
      'revenueLabel',
      'unpaidLabel',
      'weekdayLabel',
    ]);
  });

  it('führt keinen Vergleich zur Vorwoche und keinen Trend', () => {
    const view = ansicht([
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(450)] }),
    ]);

    const alsText = JSON.stringify(view);
    expect(alsText).not.toMatch(/trend/i);
    expect(alsText).not.toMatch(/vorwoche/i);
    expect(alsText).not.toContain('↑');
    expect(alsText).not.toContain('↓');
  });
});
