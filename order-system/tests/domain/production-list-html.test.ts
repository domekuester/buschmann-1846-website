import { describe, expect, it } from 'vitest';
import type { ProductionDay } from '../../src/domain/production-day';
import { renderProductionListPage } from '../../src/ui/production-list-html';

const day = (overrides: Partial<ProductionDay> = {}): ProductionDay => ({
  date: '2026-08-28',
  orderCount: 2,
  totalUnits: 12,
  products: [
    { productId: 1, productName: 'Käsekuchen', productUnit: '26-cm-Ring', quantity: 8 },
    { productId: 2, productName: 'Butterkuchen', productUnit: 'Blech', quantity: 4 },
  ],
  orders: [
    {
      orderNumber: 'BUS-2026-000123', customerName: 'Café Beispiel', status: 'confirmed',
      fulfillmentType: 'pickup', note: 'Bitte bis 10 Uhr bereitstellen.', lastStatusChange: null,
      items: [],
    },
    {
      orderNumber: 'BUS-2026-000124', customerName: 'Kunde <X>', status: 'new',
      fulfillmentType: 'pickup', note: 'Ohne <Dekor> & "Kerzen".', lastStatusChange: null,
      items: [],
    },
  ],
  ...overrides,
});

const render = (productionDay = day()) => renderProductionListPage({
  day: productionDay,
});

describe('Produktionsliste — Druckinhalt', () => {
  it('zeigt Tag, aggregierte Produkte, Einheiten und Summenzeile ohne Geldwerte', () => {
    const html = render();

    expect(html).toContain('<h1>Produktionsliste</h1>');
    expect(html).toContain('Freitag, 28. August 2026');
    expect(html).toContain('Käsekuchen');
    expect(html).toContain('26-cm-Ring');
    expect(html).toContain('>8<');
    expect(html).toContain('2 Produktarten');
    expect(html).toContain('12 Einheiten');
    for (const forbidden of ['€', 'Preis', 'Zahlung', 'unit_price', 'total_amount']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('zeigt nur nicht-leere Notes und escapet Kundeninhalt', () => {
    const html = render(day({
      orders: [
        ...day().orders,
        { ...day().orders[0]!, orderNumber: 'BUS-2026-000125', note: '   ' },
      ],
    }));

    expect(html).toContain('Besondere Hinweise');
    expect(html).toContain('BUS-2026-000123');
    expect(html).toContain('Bitte bis 10 Uhr bereitstellen.');
    expect(html).toContain('Kunde &lt;X&gt;');
    expect(html).toContain('Ohne &lt;Dekor&gt; &amp; &quot;Kerzen&quot;.');
    expect(html).not.toContain('BUS-2026-000125');
  });

  it('rendert einen eindeutigen leeren Produktionstag ohne leere Tabelle', () => {
    const html = render(day({ orderCount: 0, totalUnits: 0, products: [], orders: [] }));

    expect(html).toContain('Für diesen Produktionstag ist aktuell nichts mehr zu produzieren.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('Besondere Hinweise');
  });

  it('liefert echte Screen-Controls und markiert alles Bedienende als print-irrelevant', () => {
    const html = render();

    expect(html).toContain('href="/admin/production?date=2026-08-28"');
    expect(html).toContain('<button type="button" class="drucktaste" data-print-trigger>Drucken</button>');
    expect(html).toContain('<script type="module" src="/assets/print.js"></script>');
    expect(html).toContain('class="druckkopf screen-only"');
  });
});
