import { describe, expect, it } from 'vitest';
import { renderAdminCatalogPage, type AdminCatalogPageView } from '../../src/ui/admin-catalog-html';

/**
 * Seit Phase 5D trägt dieselbe Seite einen zweiten Bereich. Diese Datei prüft
 * unverändert den ERSTEN — die read-only Katalogpreise; der Zuordnungsbereich
 * hat seine eigene Datei (admin-catalog-link-html.test.ts). Die drei neuen
 * Felder stehen hier leer, damit genau das sichtbar bleibt: Der Preisbereich
 * hängt an keinem von ihnen.
 */
const VIEW: AdminCatalogPageView = {
  loginIdentifier: 'admin@example.test',
  csrfToken: 'csrf-testwert',
  productLinks: [],
  catalogChoices: [],
  noticeCode: null,
  products: [
    {
      name: 'Fiktiver Kuchen',
      variant: 'Ring',
      unit: '26 cm Ring',
      gastroPrice: { type: 'fixed' as const, priceCents: 2100 },
      privatePrice: { type: 'from' as const, minPriceCents: 5500 },
    },
    {
      name: 'Fiktives Gebäck',
      variant: null,
      unit: '100 g',
      gastroPrice: null,
      privatePrice: { type: 'range' as const, minPriceCents: 300, maxPriceCents: 450 },
    },
    {
      name: 'Fiktive Saisontorte',
      variant: null,
      unit: 'Torte',
      gastroPrice: { type: 'on_request' as const },
      privatePrice: null,
    },
  ],
};

describe('Admin-Katalog HTML', () => {
  it('zeigt genau eine sinnvolle h1 und die read-only Spalten', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Sortiment &amp; Preise');
    for (const text of ['Produkt', 'Variante', 'Einheit', 'Gastronomie', 'Privatkunden']) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/>Bearbeiten<|>Löschen<|type="(text|number)"/);
  });

  it('formatiert jede Preisart ohne sie zu verfälschen', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html).toContain('21,00 €');
    expect(html).toContain('ab 55,00 €');
    expect(html).toContain('3,00–4,50 €');
    expect(html).toContain('Auf Anfrage');
  });

  it('zeigt fehlende Preise als Gedankenstrich statt null Euro', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html.match(/<span aria-label="Kein Preis hinterlegt">—<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('0,00 €');
  });

  it('zeigt eine in der Quelle fehlende Einheit eindeutig als fehlend', () => {
    const html = renderAdminCatalogPage({
      ...VIEW,
      products: [{ ...VIEW.products[0]!, unit: null }],
    });
    expect(html).toContain('<span aria-label="Keine Einheit angegeben">—</span>');
  });

  it('escaped Produktname, Variante und Einheit', () => {
    const html = renderAdminCatalogPage({
      ...VIEW,
      products: [{
        name: '<script>alert(1)</script>',
        variant: '<img src=x>',
        unit: 'Stück & Torte',
        gastroPrice: null,
        privatePrice: null,
      }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('Stück &amp; Torte');
  });

  it('zeigt einen klaren Leerzustand', () => {
    const html = renderAdminCatalogPage({ ...VIEW, products: [] });
    expect(html).toContain('Noch kein Sortiment importiert');
  });

  it('verlinkt Produktion und Sortiment in der gemeinsamen Adminnavigation', () => {
    const html = renderAdminCatalogPage(VIEW);
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/catalog"');
    expect(html).toContain('aria-current="page"');
  });

  it('benutzt das gemeinsame Listenmuster der Adminseiten', () => {
    const html = renderAdminCatalogPage({ ...VIEW, products: [] });
    expect(html).toContain('class="bereichskopf"');
    expect(html).toContain('class="leerzustand"');
  });
});
