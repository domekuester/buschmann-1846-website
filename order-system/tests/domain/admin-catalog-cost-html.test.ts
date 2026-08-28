import { describe, expect, it } from 'vitest';
import { renderAdminCatalogPage, type AdminCatalogPageView } from '../../src/ui/admin-catalog-html';

const view: AdminCatalogPageView = {
  loginIdentifier: 'admin@example.test',
  csrfToken: 'csrf-testwert',
  noticeCode: null,
  products: [{
    id: 1,
    orderableProductId: 1,
    name: 'Fiktives Produkt',
    unit: 'Stück',
    isActive: true,
    gastroPrice: { type: 'fixed', priceCents: 500 },
    privatePrice: null,
    unitCostCents: 210,
    updatedAt: '2026-08-28T10:00:00.000Z',
  }],
};

describe('Herstellkosten im Angebot', () => {
  it('kennzeichnet Kosten sichtbar als intern und rendert sie editierbar', () => {
    const html = renderAdminCatalogPage(view);
    expect(html).toContain('Herstellkosten bleiben intern');
    expect(html).toContain('name="unit_cost" value="2,10"');
  });

  it('trägt CSRF, aber keine Credential- oder Konto-Interna', () => {
    const html = renderAdminCatalogPage(view);
    expect(html).toContain('name="csrf_token" value="csrf-testwert"');
    expect(html).not.toMatch(/credential_|verifier|salt|algorithm|account_id/);
  });

  it('zeigt weder Marge noch Rohertrag im Produktformular', () => {
    const html = renderAdminCatalogPage(view);
    expect(html).not.toMatch(/Marge|Rohertrag/);
  });
});
