import { describe, expect, it } from 'vitest';
import {
  renderAdminOrderEditPage,
  toOrderEditItemView,
  type AdminOrderEditPageView,
  type OrderEditItemView,
} from '../../src/ui/admin-order-edit-html';

/**
 * Die Bearbeitungsseite als HTML — ohne Worker, ohne Datenbank.
 *
 * Geprüft wird hier, was die Integrationstests NICHT zeigen können: dass
 * jeder Wert, der aus der Datenbank kommt, maskiert in die Seite geht, und
 * dass in einer Meldung nichts stehen kann, was nicht in der Oberfläche im
 * Quelltext steht.
 */

const POSITION: OrderEditItemView = {
  id: 1,
  productName: 'New York Cheesecake Classic',
  productUnit: 'Stück',
  unitPriceLabel: '22,00 €',
  quantity: 5,
  lineTotalLabel: '110,00 €',
  cancelled: false,
};

function view(overrides: Partial<AdminOrderEditPageView> = {}): AdminOrderEditPageView {
  return {
    csrfToken: 'test-csrf-token',
    orderNumber: 'BUS-2026-000001',
    customerName: 'Fiktives Café Nord',
    fulfillmentDate: '2026-09-04',
    statusLabel: 'Bestätigt',
    totalLabel: '110,00 €',
    version: '2026-09-01T06:00:00.000Z',
    items: [POSITION],
    isPaid: false,
    confirmingCancellation: null,
    noticeCode: null,
    backHref: '/admin/orders?date=2026-09-04',
    ...overrides,
  };
}

describe('renderAdminOrderEditPage — Maskierung', () => {
  /**
   * Der Produktname ist ein SNAPSHOT aus der Bestellung und stammt damit
   * mittelbar aus einer Eingabe im Adminbereich. Er geht maskiert in die
   * Seite — hier, im Formularfeld-Label und in der Stornobestätigung.
   */
  it('maskiert einen Produktnamen mit spitzen Klammern', () => {
    const html = renderAdminOrderEditPage(
      view({ items: [{ ...POSITION, productName: '<script>alert(1)</script>' }] }),
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('maskiert einen Kundennamen mit Anführungszeichen', () => {
    const html = renderAdminOrderEditPage(view({ customerName: 'Café "Zum Eck" & Co' }));

    expect(html).not.toContain('Café "Zum Eck" & Co');
    expect(html).toContain('&quot;Zum Eck&quot;');
  });

  it('maskiert den CSRF-Token', () => {
    const html = renderAdminOrderEditPage(view({ csrfToken: 'a"><b>' }));

    expect(html).not.toContain('a"><b>');
  });

  it('maskiert die Einheit einer Position', () => {
    const html = renderAdminOrderEditPage(
      view({ items: [{ ...POSITION, productUnit: '"><img src=x>' }] }),
    );

    expect(html).not.toContain('"><img src=x>');
  });

  it('maskiert den Produktnamen auch in der Stornobestätigung', () => {
    const boese = { ...POSITION, productName: '"><img src=x onerror=1>' };
    const html = renderAdminOrderEditPage(
      view({ items: [boese], confirmingCancellation: boese }),
    );

    expect(html).not.toContain('"><img src=x onerror=1>');
  });
});

describe('renderAdminOrderEditPage — Meldungen', () => {
  it('zeigt eine bekannte Meldung', () => {
    expect(renderAdminOrderEditPage(view({ noticeCode: 'items_saved' }))).toContain(
      'Die Mengen wurden gespeichert.',
    );
  });

  /**
   * DER HINWEISCODE STEHT IN DER ADRESSZEILE und kommt damit vom Aufrufer.
   * Er wird NACHGESCHLAGEN und niemals angezeigt: Was nicht in der Tabelle
   * dieser Datei steht, erscheint gar nicht.
   */
  it('zeigt einen erfundenen Code nicht an', () => {
    const html = renderAdminOrderEditPage(view({ noticeCode: 'Ihre Bestellung wurde gelöscht' }));

    expect(html).not.toContain('Ihre Bestellung wurde gelöscht');
  });

  it('zeigt auch einen Code aus dem Prototyp von Object nicht an', () => {
    const html = renderAdminOrderEditPage(view({ noticeCode: 'constructor' }));

    expect(html).not.toContain('role="status"');
  });

  it('stellt Erfolg anders dar als Fehlschlag', () => {
    expect(renderAdminOrderEditPage(view({ noticeCode: 'items_saved' }))).toContain(
      'kundenmeldung--erfolg',
    );
    expect(renderAdminOrderEditPage(view({ noticeCode: 'items_conflict' }))).toContain('banner');
  });
});

describe('renderAdminOrderEditPage — Bedienbarkeit', () => {
  it('gibt jedem Mengenfeld ein Label, das die Position benennt', () => {
    const html = renderAdminOrderEditPage(view());

    expect(html).toContain('for="menge-1"');
    expect(html).toContain('id="menge-1"');
    expect(html).toContain('Menge für New York Cheesecake Classic');
  });

  it('begrenzt das Mengenfeld auf ganze Zahlen ab 1', () => {
    const html = renderAdminOrderEditPage(view());

    expect(html).toMatch(/min="1"/);
    expect(html).toMatch(/step="1"/);
    expect(html).toMatch(/max="9999"/);
  });

  it('bietet keine Speichern-Schaltfläche, wenn keine Position mehr aktiv ist', () => {
    const html = renderAdminOrderEditPage(
      view({ items: [{ ...POSITION, cancelled: true }], totalLabel: '0,00 €' }),
    );

    expect(html).not.toContain('Änderungen speichern');
    expect(html).toContain('Alle Positionen dieser Bestellung sind storniert.');
  });
});

describe('toOrderEditItemView', () => {
  it('formatiert Stückpreis und Positionsbetrag als Euro', () => {
    const zeile = toOrderEditItemView({
      id: 3,
      productName: 'Brownie',
      productUnit: 'Stück',
      unitPriceCents: 400,
      quantity: 3,
      lineTotalCents: 1200,
      cancelledAt: null,
    });

    expect(zeile).toEqual({
      id: 3,
      productName: 'Brownie',
      productUnit: 'Stück',
      unitPriceLabel: '4,00 €',
      quantity: 3,
      lineTotalLabel: '12,00 €',
      cancelled: false,
    });
  });

  it('erkennt eine stornierte Position an ihrem Zeitpunkt', () => {
    const zeile = toOrderEditItemView({
      id: 3,
      productName: 'Brownie',
      productUnit: 'Stück',
      unitPriceCents: 400,
      quantity: 3,
      lineTotalCents: 1200,
      cancelledAt: '2026-09-01T09:30:00.000Z',
    });

    expect(zeile.cancelled).toBe(true);
  });
});
