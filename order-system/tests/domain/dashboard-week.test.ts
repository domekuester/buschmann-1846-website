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
    /**
     * OHNE POSITION UND DAMIT OHNE KOSTENLÜCKE — das ist die neutrale
     * Vorgabe für alle Tests, die von Phase 7B nichts wissen wollen: Wo
     * keine Position steht, fehlt auch kein Kostenwert. Tests, die es um
     * Kosten geht, setzen `items` ausdrücklich.
     */
    items: [],
    ...overrides,
  };
}

/** Eine Position, wie die Woche sie sieht: Menge und Kostenwert. */
function position(unitCostCents: number | null, quantity = 1) {
  return { quantity, unitCostCents };
}

/**
 * Die Kostenbasis eines Zeitraums, in dem es nichts zu kalkulieren gab.
 *
 * Vollständig, denn es fehlt nichts. Der Rohertrag ist dann der ganze
 * Umsatz, und die Marge ist 100 % — oder gar nichts, wenn auch der Umsatz
 * null ist: Durch null wird nicht geteilt.
 *
 * Der Fall entsteht in dieser Testdatei, weil die Standardbestellung
 * absichtlich ohne Positionen kommt; in der Wirklichkeit hat jede Bestellung
 * welche.
 */
function leereKosten(revenueCents = 0) {
  return {
    revenueCents,
    knownCostCents: 0,
    itemCount: 0,
    missingItemCount: 0,
    orderCount: 0,
    missingOrderCount: 0,
    complete: true,
    grossProfitCents: revenueCents,
    marginTenthsPercent: revenueCents === 0 ? null : 1000,
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
      /**
       * Seit Phase 7B trägt jeder Tag seine Kostenbasis mit. An einem Tag
       * ohne Bestellung ist sie vollständig und leer — und ausdrücklich
       * ohne Marge.
       */
      costs: leereKosten(),
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

    /**
     * DIE KOSTENBASIS WIRD HIER ABGETRENNT und in der Gruppe zur Marge
     * geprüft: Sie ist keine Summe von Zahlen, sondern eine
     * Zusammenfassung, deren abgeleitete Felder für das Ganze NEU gebildet
     * werden. Die sechs Zähler daneben sind und bleiben schlichte Summen.
     */
    const { costs, ...zahlen } = woche.total;

    expect(zahlen).toEqual({
      orderCount: summe((tag) => tag.orderCount),
      cancelledCount: summe((tag) => tag.cancelledCount),
      revenueCents: summe((tag) => tag.revenueCents),
      openCount: summe((tag) => tag.openCount),
      unpaidCents: summe((tag) => tag.unpaidCents),
      unpaidCount: summe((tag) => tag.unpaidCount),
    });

    expect(zahlen).toEqual({
      orderCount: 3,
      cancelledCount: 1,
      revenueCents: 7640,
      openCount: 2,
      unpaidCents: 6350,
      unpaidCount: 2,
    });

    // Die Bestellungen dieses Falls tragen keine Positionen — also nichts,
    // was zu kalkulieren wäre, und deshalb auch keine Lücke.
    expect(costs).toEqual({ ...leereKosten(7640), orderCount: 3 });
  });

  it('ist an einer leeren Woche überall null', () => {
    expect(aggregateDashboardWeek(MONTAG, []).total).toEqual({
      orderCount: 0,
      cancelledCount: 0,
      revenueCents: 0,
      openCount: 0,
      unpaidCents: 0,
      unpaidCount: 0,
      costs: leereKosten(),
    });
  });

  it('nimmt den gespeicherten Betrag und rechnet ihn nicht aus Positionen nach', () => {
    /**
     * SEIT PHASE 7B GIBT ES POSITIONEN — ABER KEINEN EINZELPREIS.
     *
     * Genau daran hängt diese Zusicherung: Eine Wochenposition trägt Menge
     * und Kostenwert und sonst nichts. Der Umsatz KANN hier deshalb nach wie
     * vor nicht aus den Positionen nachgerechnet werden; er ist und bleibt
     * der gespeicherte Betrag der Bestellung.
     */
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ totalCents: 7, items: [position(3, 2)] }),
    ]);

    expect(woche.total.revenueCents).toBe(7);
    expect(Object.keys(bestellung())).toEqual([
      'day',
      'status',
      'paymentStatus',
      'totalCents',
      'items',
    ]);
    expect(Object.keys(position(3, 2)).sort()).toEqual(['quantity', 'unitCostCents']);
  });
});

/**
 * PHASE 7B — DIE MARGE JE TAG UND FÜR DIE WOCHE.
 *
 * Die Rechenregeln stehen in tests/domain/cost-summary.test.ts. Hier geht es
 * um die Wochenmechanik: dass jeder Tag seine eigene Kostenbasis hat, dass
 * ein unvollständiger Tag die Woche mitnimmt, und dass die Wochenmarge aus
 * den SUMMEN entsteht und nicht aus den Tagesprozenten.
 */
describe('aggregateDashboardWeek — Kosten und Marge je Tag', () => {
  it('rechnet die Marge eines Tages aus seinen eigenen Zahlen', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
    ]);

    expect(woche.days[0]?.costs.knownCostCents).toBe(400);
    expect(woche.days[0]?.costs.grossProfitCents).toBe(600);
    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(600);
  });

  it('hält die Tage auseinander', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: '2026-08-26', totalCents: 2000, items: [position(1000)] }),
    ]);

    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(600);
    expect(woche.days[2]?.costs.marginTenthsPercent).toBe(500);
    expect(woche.days[1]?.costs.marginTenthsPercent).toBeNull();
  });

  it('gibt einem Tag ohne Bestellung eine vollständige, leere Kostenbasis', () => {
    const tag = aggregateDashboardWeek(MONTAG, []).days[3];

    expect(tag?.costs.complete).toBe(true);
    expect(tag?.costs.orderCount).toBe(0);
    expect(tag?.costs.marginTenthsPercent).toBeNull();
  });

  /** §20.23 — ein Tag mit fehlenden Kosten bekommt keine Teilmarge. */
  it('lässt die Marge eines unvollständigen Tages weg', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: MONTAG, totalCents: 500, items: [position(null)] }),
    ]);

    expect(woche.days[0]?.costs.complete).toBe(false);
    expect(woche.days[0]?.costs.knownCostCents).toBe(400);
    expect(woche.days[0]?.costs.grossProfitCents).toBeNull();
    expect(woche.days[0]?.costs.marginTenthsPercent).toBeNull();
  });

  it('nennt die Zahl der Bestellungen mit fehlenden Kosten je Tag', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: MONTAG, totalCents: 500, items: [position(null), position(null)] }),
    ]);

    expect(woche.days[0]?.costs.orderCount).toBe(2);
    expect(woche.days[0]?.costs.missingOrderCount).toBe(1);
    expect(woche.days[0]?.costs.missingItemCount).toBe(2);
  });

  it('bezieht die Tagesmarge auf denselben Umsatz wie die Tageszeile', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1234, items: [position(100)] }),
      bestellung({ day: MONTAG, totalCents: 4321, items: [position(100)] }),
    ]);

    expect(woche.days[0]?.costs.revenueCents).toBe(woche.days[0]?.revenueCents);
    expect(woche.days[0]?.costs.revenueCents).toBe(5555);
  });
});

describe('aggregateDashboardWeek — die Wochenmarge', () => {
  /** §20.24 — eine vollständig kalkulierte Woche bekommt eine Wochenmarge. */
  it('entsteht, wenn jeder Tag vollständig kalkuliert ist', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: '2026-08-26', totalCents: 3000, items: [position(1000, 2)] }),
    ]);

    expect(woche.total.costs.complete).toBe(true);
    expect(woche.total.costs.knownCostCents).toBe(2400);
    expect(woche.total.costs.grossProfitCents).toBe(1600);
    expect(woche.total.costs.marginTenthsPercent).toBe(400);
  });

  /**
   * §22.G — DIE WOCHENMARGE ENTSTEHT AUS DEN SUMMEN.
   *
   * Der Aufbau ist so gewählt, dass der ungewichtete Mittelwert der beiden
   * Tagesmargen (90,0 % und 30,0 % → 60,0 %) deutlich von der richtigen
   * Antwort abweicht: 11.000 € Umsatz, 7.100 € Kosten → 35,5 %.
   */
  it('ist umsatzgewichtet und kein Mittelwert der Tagesmargen', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(100)] }),
      bestellung({ day: '2026-08-29', totalCents: 10_000, items: [position(7000)] }),
    ]);

    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(900);
    expect(woche.days[5]?.costs.marginTenthsPercent).toBe(300);

    expect(woche.total.costs.marginTenthsPercent).toBe(355);
    expect(woche.total.costs.marginTenthsPercent).not.toBe(600);
  });

  /** §20.25 — ein einziger unvollständiger Tag nimmt die Woche mit. */
  it('bleibt aus, wenn ein einziger Tag unvollständig ist', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: '2026-08-26', totalCents: 2000, items: [position(800)] }),
      bestellung({ day: '2026-08-30', totalCents: 500, items: [position(null)] }),
    ]);

    expect(woche.days[0]?.costs.marginTenthsPercent).toBe(600);
    expect(woche.days[2]?.costs.marginTenthsPercent).toBe(600);
    expect(woche.days[6]?.costs.complete).toBe(false);

    expect(woche.total.costs.complete).toBe(false);
    expect(woche.total.costs.grossProfitCents).toBeNull();
    expect(woche.total.costs.marginTenthsPercent).toBeNull();
  });

  it('zählt die fehlenden Bestellungen der ganzen Woche zusammen', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 500, items: [position(null)] }),
      bestellung({ day: '2026-08-27', totalCents: 500, items: [position(null)] }),
      bestellung({ day: '2026-08-30', totalCents: 1000, items: [position(200)] }),
    ]);

    expect(woche.total.costs.orderCount).toBe(3);
    expect(woche.total.costs.missingOrderCount).toBe(2);
    expect(woche.total.costs.missingItemCount).toBe(2);
  });

  /** §20.26 — stornierte Bestellungen bleiben auch in der Woche draußen. */
  it('lässt stornierte Bestellungen aus Kosten und Marge heraus', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({
        day: MONTAG,
        status: 'cancelled' as OrderStatus,
        totalCents: 9999,
        items: [position(900, 40)],
      }),
    ]);

    expect(woche.days[0]?.costs.knownCostCents).toBe(400);
    expect(woche.days[0]?.costs.orderCount).toBe(1);
    expect(woche.total.costs.knownCostCents).toBe(400);
    expect(woche.total.costs.marginTenthsPercent).toBe(600);
  });

  it('wird von einer stornierten Bestellung ohne Kostenwert nicht unvollständig', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({
        day: '2026-08-28',
        status: 'cancelled' as OrderStatus,
        totalCents: 500,
        items: [position(null)],
      }),
    ]);

    expect(woche.total.costs.complete).toBe(true);
    expect(woche.total.costs.marginTenthsPercent).toBe(600);
  });

  it('zählt eine unbezahlte Bestellung in die Wochenkosten', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({
        day: MONTAG,
        paymentStatus: 'unpaid' as PaymentStatus,
        totalCents: 1000,
        items: [position(400)],
      }),
    ]);

    expect(woche.total.costs.knownCostCents).toBe(400);
    expect(woche.total.costs.grossProfitCents).toBe(600);
  });

  it('bezieht die Wochenmarge auf den Umsatz der Summenzeile', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(100)] }),
      bestellung({ day: '2026-08-29', totalCents: 10_000, items: [position(7000)] }),
    ]);

    expect(woche.total.costs.revenueCents).toBe(woche.total.revenueCents);
    expect(woche.total.costs.revenueCents).toBe(11_000);
  });

  it('ergibt für eine leere Woche keine Marge und keinen Fehler', () => {
    const woche = aggregateDashboardWeek(MONTAG, []);

    expect(woche.total.costs.complete).toBe(true);
    expect(woche.total.costs.grossProfitCents).toBe(0);
    expect(woche.total.costs.marginTenthsPercent).toBeNull();
  });

  it('lässt die Wochenmarge negativ werden', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 10_000, items: [position(12_000)] }),
    ]);

    expect(woche.total.costs.grossProfitCents).toBe(-2000);
    expect(woche.total.costs.marginTenthsPercent).toBe(-200);
  });

  /**
   * §20.27 — eine Bestellung außerhalb der sieben Tage zählt in keiner
   * Kostensumme mit. Sie kommt aus der Abfrage nicht, aber das Lesemodell
   * darf an ihr auch nicht falsch rechnen.
   */
  it('lässt eine Bestellung außerhalb der Woche auch aus den Kosten heraus', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(400)] }),
      bestellung({ day: '2026-09-01', totalCents: 5000, items: [position(null)] }),
    ]);

    expect(woche.total.costs.orderCount).toBe(1);
    expect(woche.total.costs.complete).toBe(true);
    expect(woche.total.costs.knownCostCents).toBe(400);
  });

  it('summiert die Kostenzähler der Tage genau einmal', () => {
    const woche = aggregateDashboardWeek(MONTAG, [
      bestellung({ day: MONTAG, totalCents: 1000, items: [position(100), position(200)] }),
      bestellung({ day: SONNTAG, totalCents: 1000, items: [position(300)] }),
    ]);

    const ausDenTagen = woche.days.reduce((summe, tag) => summe + tag.costs.knownCostCents, 0);
    expect(woche.total.costs.knownCostCents).toBe(ausDenTagen);
    expect(woche.total.costs.itemCount).toBe(3);
  });
});
