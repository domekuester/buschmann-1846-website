import { describe, expect, it } from 'vitest';
import { renderAdminCatalogPage, type AdminCatalogPageView } from '../../src/ui/admin-catalog-html';

const VIEW: AdminCatalogPageView = {
  loginIdentifier: 'admin@example.test',
  csrfToken: 'csrf-testwert',
  noticeCode: null,
  products: [{
    id: 7,
    orderableProductId: 3,
    name: 'Fiktiver Käsekuchen',
    unit: '26 cm Ring',
    isActive: true,
    gastroPrice: { type: 'fixed', priceCents: 2400 },
    privatePrice: { type: 'range', minPriceCents: 4000, maxPriceCents: 4600 },
    unitCostCents: null,
    updatedAt: '2026-08-28T10:00:00.000Z',
  }],
};

describe('Angebot als Produktarbeitsplatz', () => {
  it('zeigt genau eine h1, den Create-Flow und alle Operatorfelder', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('operator-arbeitsplatz');
    expect(html).toContain('operator-editor-pane');
    expect(html).toContain('Produkte und Preise');
    for (const text of [
      'Neues Produkt', 'Produktname', 'Einheit / Format', 'Gastronomiepreis',
      'Privatkundenpreis', 'Preisform', 'Herstellkosten', 'Produkt ist aktiv', 'Speichern',
    ]) expect(html).toContain(text);
    expect(html).toContain('action="/api/admin/products"');
  });

  it('übersetzt alle Preisformen in normales deutsches Geschäftsvokabular', () => {
    const html = renderAdminCatalogPage(VIEW);
    for (const text of ['Festpreis', 'Ab-Preis', 'Preisspanne', 'Preis auf Anfrage']) {
      expect(html).toContain(text);
    }
  });

  it('rendert einen kohärenten Edit-Save mit Concurrency-Token', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html).toContain('action="/api/admin/products/7"');
    expect(html).toContain('name="expected_updated_at" value="2026-08-28T10:00:00.000Z"');
    expect(html).toContain('name="gastro_price" value="24,00"');
    expect(html).toContain('name="private_max_price" value="46,00"');
    expect(html).toContain('checked');
  });

  it('zeigt NULL-Herstellkosten als nicht gepflegt und gepflegte 0 als 0,00', () => {
    const without = renderAdminCatalogPage(VIEW);
    expect(without).toContain('Herstellkosten</dt><dd>Nicht gepflegt');
    expect(without).toContain('name="unit_cost" value=""');

    const zero = renderAdminCatalogPage({
      ...VIEW,
      products: [{ ...VIEW.products[0]!, unitCostCents: 0 }],
    });
    expect(zero).toContain('name="unit_cost" value="0,00"');
  });

  it('zeigt Aktiv/Inaktiv als Worte und bietet kein Löschen', () => {
    const html = renderAdminCatalogPage({
      ...VIEW,
      products: [{ ...VIEW.products[0]!, isActive: false }],
    });
    expect(html).toContain('>Inaktiv<');
    expect(html).not.toMatch(/>Löschen<|delete/i);
  });

  it('entfernt Produktverknüpfung vollständig aus dem normalen Angebot', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html).not.toContain('Bestellprodukte verknüpfen');
    expect(html).not.toContain('catalog-link');
    expect(html).toContain('Produktverknüpfung entstehen automatisch');
  });

  it('escaped Produktdaten in Zusammenfassung und Formular', () => {
    const html = renderAdminCatalogPage({
      ...VIEW,
      products: [{ ...VIEW.products[0]!, name: '<script>alert(1)</script>', unit: 'Stück & Torte' }],
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Stück &amp; Torte');
  });

  it('zeigt kontrollierte deutsche Rückmeldungen und keine fremden Notice-Texte', () => {
    expect(renderAdminCatalogPage({ ...VIEW, noticeCode: 'product_created' })).toContain(
      'intern vollständig verknüpft',
    );
    expect(renderAdminCatalogPage({ ...VIEW, noticeCode: '<script>fremd</script>' })).not.toContain(
      '&lt;script&gt;fremd',
    );
  });

  it('bleibt ohne JavaScript und hat einen verständlichen Leerzustand', () => {
    const html = renderAdminCatalogPage({ ...VIEW, products: [] });
    expect(html).not.toContain('<script');
    expect(html).toContain('Noch keine Produkte');
  });
});
