import { describe, expect, it } from 'vitest';
import { aggregateAnalytics, type AnalyticsInput } from '../../src/domain/analytics';
import { resolveReportingPeriod } from '../../src/domain/reporting-period';
import { toAnalyticsView } from '../../src/ui/analytics-view';
import {
  renderAdminAnalyticsPage,
  renderAnalyticsUnavailablePage,
} from '../../src/ui/admin-analytics-html';

const HEUTE = '2026-09-15';
const KOPF = { loginIdentifier: 'admin@example.test', csrfToken: 'csrf-token' };

function leer(): AnalyticsInput {
  return { orders: [], items: [], products: [], customers: [], segments: [] };
}

function seite(input: AnalyticsInput, kind: 'heute' | 'woche' | 'monat' | 'jahr' = 'monat') {
  const period = resolveReportingPeriod(kind, HEUTE);
  return renderAdminAnalyticsPage({
    ...KOPF,
    analytics: toAnalyticsView(aggregateAnalytics(period, input), 'umsatz'),
  });
}

const VOLL: AnalyticsInput = {
  orders: [
    { day: '2026-09-05', status: 'completed', paymentStatus: 'paid_cash', orderCount: 3, revenueCents: 24_000 },
    { day: '2026-09-06', status: 'new', paymentStatus: 'unpaid', orderCount: 1, revenueCents: 6_000 },
    { day: '2026-08-05', status: 'completed', paymentStatus: 'paid_bank', orderCount: 2, revenueCents: 20_000 },
  ],
  items: [
    { day: '2026-09-05', status: 'completed', units: 12, knownCostCents: 9_000, itemCount: 4, missingItemCount: 0, orderCount: 3, missingOrderCount: 0 },
    { day: '2026-09-06', status: 'new', units: 3, knownCostCents: 2_000, itemCount: 1, missingItemCount: 0, orderCount: 1, missingOrderCount: 0 },
  ],
  products: [
    { productId: 1, name: 'Fiktiver Käsekuchen', unit: 'Ring 26', status: 'completed', latestItemId: 4, units: 9, revenueCents: 19_800 },
    { productId: 2, name: 'Fiktive Apfeltarte', unit: 'Ring 26', status: 'new', latestItemId: 6, units: 6, revenueCents: 10_200 },
  ],
  customers: [
    { customerId: 1, name: 'Fiktives Café Nord', status: 'completed', latestOrderId: 9, orderCount: 3, revenueCents: 24_000 },
    { customerId: 2, name: 'Fiktive Konditorei Süd', status: 'new', latestOrderId: 11, orderCount: 1, revenueCents: 6_000 },
  ],
  segments: [
    { fulfillmentType: 'delivery', priceGroupCode: 'gastro', status: 'completed', orderCount: 3, revenueCents: 24_000 },
    { fulfillmentType: 'pickup', priceGroupCode: 'private', status: 'new', orderCount: 1, revenueCents: 6_000 },
  ],
};

describe('Seitengerüst', () => {
  it('läuft im Adminbereich „Auswertung" und markiert ihn in der Navigation', () => {
    const html = seite(VOLL);
    expect(html).toContain('adminseite--analytics');
    expect(html).toContain('<a href="/admin/auswertung" aria-current="page">Auswertung</a>');
  });

  it('trägt genau eine Hauptüberschrift', () => {
    expect(seite(VOLL).match(/<h1[\s>]/g)).toHaveLength(1);
    expect(seite(VOLL)).toContain('Auswertung');
  });

  it('trägt kein Skript und keinen Inline-Stil', () => {
    const html = seite(VOLL);
    expect(html).not.toContain('<script');
    expect(html).not.toContain(' style="');
    expect(html).not.toContain('onclick');
  });

  it('nennt das Berichtsdatum, damit niemand raten muss', () => {
    expect(seite(VOLL)).toContain('Liefer- und Abholtag');
  });
});

describe('Zeitraumleiste', () => {
  it('führt fünf Wahlmöglichkeiten als echte Links', () => {
    const html = seite(VOLL);
    for (const kind of ['heute', 'woche', 'monat', 'jahr', 'zeitraum']) {
      expect(html).toContain(`href="/admin/auswertung?period=${kind}`);
    }
    expect(html.match(/class="zeitwahl__ziel[^"]*"/g)).toHaveLength(5);
  });

  it('markiert die aktive Wahl auch ohne Farbe', () => {
    const html = seite(VOLL);
    const leiste = /<nav class="zeitwahl"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(leiste.match(/aria-current="page"/g)).toHaveLength(1);
    expect(leiste).toContain('zeitwahl__ziel--aktiv');
  });

  it('bietet ein echtes Formular für die freie Spanne', () => {
    const html = seite(VOLL);
    expect(html).toContain('<form class="zeitwahl__spanne" method="get" action="/admin/auswertung">');
    expect(html).toContain('<input type="hidden" name="period" value="zeitraum">');
    expect(html).toContain('type="date" id="zeitraum-von" name="from" value="2026-09-01"');
    expect(html).toContain('type="date" id="zeitraum-bis" name="to" value="2026-09-15"');
    expect(html).toContain('Anwenden');
  });
});

describe('Kennzahlen', () => {
  it('stellt sechs Zellen in eine Tafel', () => {
    const html = seite(VOLL);
    expect(html.match(/class="auswertkarte(?:\s|")/g)).toHaveLength(6);
    expect(html).toContain('Bestellumsatz');
    expect(html).toContain('Deckungsbeitrag');
  });

  it('setzt Pfeil und Wort nebeneinander, nie die Farbe allein', () => {
    const html = seite(VOLL);
    expect(html).toContain('mehr als im Vormonat');
    expect(html).toContain('aria-hidden="true">↑</span>');
  });

  it('sagt beim unvollständigen Deckungsbeitrag, wie viele Positionen fehlen', () => {
    const html = seite({
      ...VOLL,
      items: [
        { day: '2026-09-05', status: 'completed', units: 12, knownCostCents: 9_000, itemCount: 4, missingItemCount: 2, orderCount: 3, missingOrderCount: 1 },
      ],
    });
    expect(html).toContain('Noch nicht vollständig');
    expect(html).toContain('Bei 2 Positionen fehlen die Herstellkosten');
  });
});

describe('Kurve', () => {
  it('zeichnet je Balken ein SVG mit Geometrie als Attribut', () => {
    const html = seite(VOLL);
    expect(html).toContain('viewBox="0 0 10 100"');
    expect(html).toMatch(/<rect class="kurve__balken" x="0" y="\d+" width="10" height="\d+"/);
    expect(html).not.toContain('style="height');
  });

  it('bietet den Umschalter zwischen den beiden Reihen an', () => {
    const html = seite(VOLL);
    expect(html).toContain('href="/admin/auswertung?period=monat&amp;metric=bestellungen"');
    expect(html).toContain('href="/admin/auswertung?period=monat&amp;metric=umsatz"');
  });

  it('setzt über einen Balken ohne Umsatz keine Null', () => {
    const html = seite(VOLL, 'woche');
    // Die Woche des 15.09. hat nur am 14. und 15. Balken — beide ohne Umsatz
    // in diesem Bestand. Es steht dann auch keine Null darüber.
    expect(html).not.toContain('<span class="kurve__wert">0,00 €</span>');
  });

  it('trägt eine vorlesbare Tabelle mit beiden Reihen', () => {
    const html = seite(VOLL);
    const tabelle = /<div class="nur-vorlesen">\s*<table class="kurve__tabelle">[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
    expect(tabelle).toContain('<th scope="col">Bestellumsatz</th>');
    expect(tabelle).toContain('<th scope="col">Bestellungen</th>');
    expect(tabelle).toContain('Samstag, 5. September 2026');
  });

  it('bleibt bei einem Zeitraum ohne Umsatz eine ruhige Grundlinie mit Satz', () => {
    const html = seite(leer());
    expect(html).toContain('In diesem Zeitraum gibt es noch keine Bestellungen.');
  });
});

describe('Toplisten', () => {
  it('führt Produkte mit Rang, Menge und Umsatz', () => {
    const html = seite(VOLL);
    expect(html).toContain('Das verkauft sich am besten');
    expect(html).toContain('Fiktiver Käsekuchen');
    expect(html).toContain('198,00 €');
  });

  it('führt Kunden ohne technische Kennung', () => {
    const html = seite(VOLL);
    expect(html).toContain('Diese Kunden bestellen am meisten');
    expect(html).toContain('Fiktive Konditorei Süd');
    expect(html).not.toContain('customerId');
    expect(html).not.toMatch(/Kunde\s*#/);
  });

  it('zeigt bei leeren Listen einen ruhigen Satz statt einer leeren Tafel', () => {
    const html = seite(leer());
    expect(html).toContain('In diesem Zeitraum wurde noch nichts verkauft.');
    expect(html).toContain('In diesem Zeitraum hat noch niemand bestellt.');
  });
});

describe('Vergleich', () => {
  it('stellt beide Zeiträume mit Namen nebeneinander', () => {
    const html = seite(VOLL);
    expect(html).toContain('Vergleich');
    expect(html).toContain('September 2026 (bis heute)');
    expect(html).toContain('August 2026, gleicher Zeitraum (1.–15.)');
    expect(html).toContain('+100,00 €');
  });
});

describe('Aufteilungen', () => {
  it('zeichnet waagerechte Balken mit Breite als Attribut', () => {
    const html = seite(VOLL);
    expect(html).toContain('Gastronomie');
    expect(html).toContain('Lieferung');
    expect(html).toMatch(/<rect class="anteil__balken" x="0" y="0" width="80" height="10"/);
  });
});

describe('Escaping', () => {
  it('maskiert Namen aus der Datenbank', () => {
    const html = seite({
      ...VOLL,
      products: [
        { productId: 1, name: '<script>alert(1)</script>', unit: '"><b>', status: 'completed', latestItemId: 4, units: 1, revenueCents: 100 },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('Störungsseite', () => {
  it('nennt keine Technik und behält die Navigation', () => {
    const html = renderAnalyticsUnavailablePage({
      ...KOPF,
      analytics: toAnalyticsView(aggregateAnalytics(resolveReportingPeriod('monat', HEUTE), leer()), 'umsatz'),
    });
    expect(html).toContain('konnten gerade nicht geladen werden');
    expect(html).toContain('/admin/production');
    expect(html).not.toMatch(/SQL|D1_ERROR|SELECT/);
  });
});
