import { describe, expect, it } from 'vitest';
import { renderCancelOrderPage } from '../../src/ui/cancel-order-html';

function render(overrides: Partial<Parameters<typeof renderCancelOrderPage>[0]> = {}): string {
  return renderCancelOrderPage({
    csrfToken: 'csrf-token-nur-fuer-tests-0123456789',
    orderNumber: 'BUS-2026-000123',
    customerName: 'Testcafé Nord',
    fulfillmentDate: '2026-09-26',
    workspace: 'production',
    ...overrides,
  });
}

describe('renderCancelOrderPage', () => {
  it('escapet Kundenname und Bestellnummer in sichtbarem Text', () => {
    const html = render({
      customerName: '<img src=x onerror=alert(1)>',
      orderNumber: 'BUS-2026-000123"><script>alert(1)</script>',
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('BUS-2026-000123&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapet das Datum im serverseitig erzeugten Zurück-Link', () => {
    const html = render({ fulfillmentDate: '2026-09-26&next=//angreifer.test' });

    expect(html).toContain('href="/admin/production?date=2026-09-26&amp;next=//angreifer.test"');
    expect(html).not.toContain('href="//angreifer.test');
  });

  it('bleibt bei einer Stornierung aus Bestellungen im Bestellbereich', () => {
    const html = render({ workspace: 'orders' });

    expect(html).toContain('href="/admin/orders?date=2026-09-26"');
    expect(html).toContain('Zurück zu Bestellungen');
    expect(html).not.toContain('Zurück zum Produktionstag');
    expect(html).toContain('action="/api/admin/orders/BUS-2026-000123/status?workspace=orders"');
  });

  it('kommt ohne JavaScript und ohne Preise oder interne IDs aus', () => {
    const html = render();

    expect(html).not.toContain('<script');
    expect(html).not.toContain('price');
    expect(html).not.toContain('customer_id');
    expect(html).not.toContain('account_id');
  });
});
