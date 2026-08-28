import { describe, expect, it } from 'vitest';
import type { AdminProductView } from '../../src/domain/admin-product';
import { renderAdminCatalogPage } from '../../src/ui/admin-catalog-html';

const PRODUCT: AdminProductView = {
  id: 1,
  orderableProductId: 12,
  name: 'Fiktiver Käsekuchen',
  unit: '26 cm Ring',
  isActive: true,
  gastroPrice: { type: 'fixed', priceCents: 2400 },
  privatePrice: { type: 'fixed', priceCents: 4200 },
  unitCostCents: 850,
  updatedAt: '2026-08-28T10:00:00.000Z',
};

function page(products: readonly AdminProductView[] = [PRODUCT]): string {
  return renderAdminCatalogPage({
    loginIdentifier: 'admin@example.test', csrfToken: 'csrf-test', products, noticeCode: null,
  });
}

describe('interne Produktverknüpfung bleibt aus dem Operator-UI entfernt', () => {
  it('zeigt ausschließlich das zusammengeführte Produktaggregat', () => {
    const html = page();
    expect(html).toContain('Fiktiver Käsekuchen');
    expect(html).toContain('Gastronomiepreis');
    expect(html).toContain('Privatkundenpreis');
    expect(html).not.toContain('Bestellprodukte verknüpfen');
    expect(html).not.toContain('catalog-link');
    expect(html).not.toContain('catalog_product_id');
    expect(html).not.toContain('Nicht verknüpft');
  });

  it('erklärt beim Anlegen, dass die interne Relation automatisch entsteht', () => {
    const html = page([]);
    expect(html).toContain('Neues Produkt');
    expect(html).toContain('Produktverknüpfung entstehen automatisch');
    expect(html).toContain('action="/api/admin/products"');
  });

  it('rendert ohne JavaScript und escapet Produktdaten', () => {
    const html = page([{ ...PRODUCT, name: '<img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
