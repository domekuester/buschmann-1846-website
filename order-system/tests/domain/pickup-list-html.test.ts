import { describe, expect, it } from 'vitest';
import type { ProductionDay } from '../../src/domain/production-day';
import { renderPickupListPage } from '../../src/ui/pickup-list-html';

const day = (overrides: Partial<ProductionDay> = {}): ProductionDay => ({
  date: '2026-08-28',
  orderCount: 2,
  totalUnits: 10,
  products: [],
  orders: [
    {
      orderNumber: 'BUS-2026-000123', customerName: 'Café Beispiel', status: 'confirmed',
      fulfillmentType: 'pickup', note: 'Bitte bis 10 Uhr <bereitstellen>.', lastStatusChange: null,
      items: [
        { productId: 1, productName: 'Käsekuchen Snapshot', productUnit: '26-cm-Ring', sortOrder: 10, quantity: 2 },
        { productId: 2, productName: 'Butterkuchen Snapshot', productUnit: 'Blech', sortOrder: 20, quantity: 3 },
      ],
    },
    {
      orderNumber: 'BUS-2026-000124', customerName: 'Café Beispiel', status: 'new',
      fulfillmentType: 'pickup', note: null, lastStatusChange: null,
      items: [
        { productId: 3, productName: 'Obsttorte Snapshot', productUnit: 'Stück', sortOrder: 30, quantity: 5 },
      ],
    },
  ],
  ...overrides,
});

describe('Abholliste — Bestellblöcke', () => {
  it('rendert jede Bestellung desselben Kunden als eigenen Block mit ihren Snapshot-Artikeln', () => {
    const html = renderPickupListPage({ day: day() });

    expect(html).toContain('<h1>Abholliste</h1>');
    expect(html).toContain('Freitag, 28. August 2026');
    expect(html.match(/class="abholliste__bestellung"/g)).toHaveLength(2);
    expect(html).toContain('BUS-2026-000123');
    expect(html).toContain('BUS-2026-000124');
    expect(html).toContain('2 <span aria-hidden="true">×</span> Käsekuchen Snapshot <span aria-hidden="true">·</span> 26-cm-Ring');
    expect(html).toContain('3 <span aria-hidden="true">×</span> Butterkuchen Snapshot <span aria-hidden="true">·</span> Blech');
    expect(html).toContain('5 <span aria-hidden="true">×</span> Obsttorte Snapshot <span aria-hidden="true">·</span> Stück');
    expect(html).toContain('2 Bestellungen <span aria-hidden="true">·</span> 10 Einheiten');
  });

  it('zeigt eine nicht-leere Note beim zugehörigen Block und escapet alle Snapshots', () => {
    const html = renderPickupListPage({ day: day({
      orders: [{
        ...day().orders[0]!,
        customerName: 'Kunde <Intern>',
        orderNumber: 'BUS-2026-<script>',
        note: 'Ohne <Dekor> & "Kerzen".',
        items: [{ ...day().orders[0]!.items[0]!, productName: 'Torte <Spezial>', productUnit: 'Ring & Form' }],
      }],
      orderCount: 1,
      totalUnits: 2,
    }) });

    expect(html).toContain('Kunde &lt;Intern&gt;');
    expect(html).toContain('BUS-2026-&lt;script&gt;');
    expect(html).toContain('Torte &lt;Spezial&gt;');
    expect(html).toContain('Ring &amp; Form');
    expect(html).toContain('<strong>Hinweis:</strong>');
    expect(html).toContain('Ohne &lt;Dekor&gt; &amp; &quot;Kerzen&quot;.');
    expect(html).not.toContain('<script>');
  });

  it('enthält weder Kontakt-, Preis- noch interne Identitätsfelder', () => {
    const html = renderPickupListPage({ day: day() });

    for (const forbidden of ['E-Mail', 'Telefon', 'Adresse', 'Customer ID', 'Auth ID', 'Preis', 'Zahlung', '€']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('rendert für einen leeren Tag nur den eindeutigen Empty State', () => {
    const html = renderPickupListPage({ day: day({ orders: [], products: [], orderCount: 0, totalUnits: 0 }) });

    expect(html).toContain('Für diesen Produktionstag gibt es aktuell keine bestätigten Abholbestellungen.');
    expect(html).not.toContain('class="abholliste__bestellung"');
    expect(html).not.toContain('0 Bestellungen');
  });

  it('verwendet die bestehende Druckaktion und führt datumstreu zur Produktion zurück', () => {
    const html = renderPickupListPage({ day: day() });

    expect(html).toContain('href="/admin/production?date=2026-08-28"');
    expect(html).toContain('data-print-trigger>Drucken</button>');
    expect(html).toContain('<script type="module" src="/assets/print.js"></script>');
    expect(html).toContain('class="druckkopf screen-only"');
  });
});
