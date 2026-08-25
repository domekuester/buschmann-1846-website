import { describe, expect, it } from 'vitest';
import { renderProductionSummary } from '../../src/ui/production-day-html';
import type { ProductionDayView, ProductionLineView, ProductionOrderView } from '../../src/ui/production-day-view';

/**
 * Die Renderer der Produktionsansicht.
 *
 * Geprüft wird das ERZEUGTE HTML und nicht eine Zwischenstruktur. Ein Test
 * auf einem Implementierungsdetail bliebe grün, während die Seite kaputt ist.
 */

function zeile(over: Partial<ProductionLineView> = {}): ProductionLineView {
  return { name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 11, renamed: false, ...over };
}

function bestellung(over: Partial<ProductionOrderView> = {}): ProductionOrderView {
  return {
    orderNumber: 'BUS-2026-000123',
    customerName: 'Testcafé Nord',
    statusLabel: 'Bestätigt',
    fulfillmentLabel: 'Lieferung',
    note: null,
    items: [{ name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 }],
    ...over,
  };
}

function ansicht(over: Partial<ProductionDayView> = {}): ProductionDayView {
  return {
    day: '2026-08-25',
    dayLabel: 'Dienstag, 25. August 2026',
    previousDay: '2026-08-24',
    previousDayLabel: 'Montag, 24. August 2026',
    nextDay: '2026-08-26',
    nextDayLabel: 'Mittwoch, 26. August 2026',
    orderCount: 1,
    totalUnits: 3,
    products: [zeile()],
    orders: [bestellung()],
    isEmpty: false,
    ...over,
  };
}

describe('renderProductionSummary — Backliste', () => {
  it('zeigt Produktname und Menge mit der Einheit aus dem Snapshot', () => {
    const html = renderProductionSummary(ansicht({ products: [zeile({ unit: 'Blech', quantity: 3 })] }));

    expect(html).toContain('Beispiel Käsekuchen');
    expect(html).toContain('3');
    expect(html).toContain('Blech');
  });

  it('setzt die Backliste als semantische Tabelle', () => {
    const html = renderProductionSummary(ansicht());

    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('<th scope="row"');
  });

  it('behält die Reihenfolge des Ansichtsmodells bei', () => {
    const html = renderProductionSummary(
      ansicht({
        products: [
          zeile({ name: 'Zuerst', quantity: 1 }),
          zeile({ name: 'Danach', quantity: 2 }),
          zeile({ name: 'Zuletzt', quantity: 3 }),
        ],
      }),
    );

    expect(html.indexOf('Zuerst')).toBeLessThan(html.indexOf('Danach'));
    expect(html.indexOf('Danach')).toBeLessThan(html.indexOf('Zuletzt'));
  });

  it('zeigt jede Zeile mit ihrer eigenen Menge', () => {
    const html = renderProductionSummary(
      ansicht({
        products: [
          zeile({ name: 'Beispiel Käsekuchen', quantity: 11, unit: 'Stück' }),
          zeile({ name: 'Beispiel Carrot Cake', quantity: 8, unit: 'Stück' }),
          zeile({ name: 'Beispiel Streusel', quantity: 3, unit: 'Blech' }),
        ],
      }),
    );

    expect(html).toMatch(/Beispiel Käsekuchen[\s\S]*?>11<[\s\S]*?Stück/);
    expect(html).toMatch(/Beispiel Carrot Cake[\s\S]*?>8<[\s\S]*?Stück/);
    expect(html).toMatch(/Beispiel Streusel[\s\S]*?>3<[\s\S]*?Blech/);
  });

  /**
   * Die Einheit stammt aus dem Snapshot der Bestellung. Alles künstlich
   * „Stück" zu nennen wäre eine Falschaussage über die Produktion.
   */
  it('erfindet keine Einheit, sondern nimmt die des Snapshots', () => {
    const html = renderProductionSummary(ansicht({ products: [zeile({ unit: 'Blech' })] }));

    expect(html).toContain('Blech');
    expect(html).not.toContain('Stück');
  });

  it('zeigt keine Preise und keine Beträge', () => {
    const html = renderProductionSummary(ansicht());

    for (const verboten of ['€', 'Preis', 'preis', 'cents', 'Betrag', 'Summe']) {
      expect(html).not.toContain(verboten);
    }
  });

  /** Eine interne Kennung hat in der Backstube keinen Nutzen. */
  it('zeigt keine Produkt-ID', () => {
    const html = renderProductionSummary(ansicht());

    expect(html).not.toContain('product-id');
    expect(html).not.toContain('productId');
    expect(html).not.toContain('data-product');
  });
});

describe('renderProductionSummary — Umbenennungsfall', () => {
  it('kennzeichnet die abweichende Zeile verständlich', () => {
    const html = renderProductionSummary(
      ansicht({
        products: [
          zeile({ name: 'Beispiel Käsekuchen', quantity: 11 }),
          zeile({ name: 'Klassischer Käsekuchen', quantity: 3, renamed: true }),
        ],
      }),
    );

    expect(html).toContain('Abweichende Bezeichnung aus einer Bestellung');
  });

  it('bindet den Hinweis für Screenreader an die betroffene Zeile', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile(), zeile({ name: 'Klassischer Käsekuchen', renamed: true })] }),
    );

    const treffer = /aria-describedby="([^"]+)"/.exec(html);
    expect(treffer).not.toBeNull();
    expect(html).toContain(`id="${treffer?.[1]}"`);
  });

  it('lässt beide Bezeichnungen stehen und führt sie nicht zusammen', () => {
    const html = renderProductionSummary(
      ansicht({
        products: [
          zeile({ name: 'Beispiel Käsekuchen', quantity: 11 }),
          zeile({ name: 'Klassischer Käsekuchen', quantity: 3, renamed: true }),
        ],
      }),
    );

    expect(html).toContain('Beispiel Käsekuchen');
    expect(html).toContain('Klassischer Käsekuchen');
    expect(html).toContain('>11<');
    expect(html).toContain('>3<');
    // Keine zusammengefasste 14 — das waere die Falschaussage.
    expect(html).not.toContain('>14<');
  });

  it('kennzeichnet eine unauffällige Liste nicht', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile({ name: 'A' }), zeile({ name: 'B' })] }),
    );

    expect(html).not.toContain('Abweichende Bezeichnung');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('renderProductionSummary — Escaping', () => {
  it('escapet HTML im Produktnamen', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile({ name: '<i>Kuchen</i>' })] }),
    );

    expect(html).toContain('&lt;i&gt;Kuchen&lt;/i&gt;');
    expect(html).not.toContain('<i>Kuchen</i>');
  });

  it('escapet HTML in der Einheit', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile({ unit: '<b>Blech</b>' })] }),
    );

    expect(html).toContain('&lt;b&gt;Blech&lt;/b&gt;');
    expect(html).not.toContain('<b>Blech</b>');
  });

  it('escapet ein Skript im Produktnamen', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile({ name: '<script>alert(1)</script>' })] }),
    );

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapet Ampersand und Anführungszeichen', () => {
    const html = renderProductionSummary(
      ansicht({ products: [zeile({ name: `Müller & Söhne "Extra" 'fein'` })] }),
    );

    expect(html).toContain('Müller &amp; Söhne &quot;Extra&quot; &#39;fein&#39;');
  });
});

describe('renderProductionSummary — leerer Tag', () => {
  it('erklärt einen Tag ohne Bestellungen in verständlichen Worten', () => {
    const html = renderProductionSummary(
      ansicht({ isEmpty: true, products: [], orders: [], orderCount: 0, totalUnits: 0 }),
    );

    expect(html).toContain('Für diesen Tag sind keine offenen Bestellungen vorhanden.');
  });

  it('nennt einen leeren Tag nicht Fehler und warnt nicht', () => {
    const html = renderProductionSummary(
      ansicht({ isEmpty: true, products: [], orders: [], orderCount: 0, totalUnits: 0 }),
    );

    for (const verboten of ['Fehler', 'fehlgeschlagen', 'ungültig', '⚠', 'banner']) {
      expect(html).not.toContain(verboten);
    }
  });

  it('rendert bei einem leeren Tag keine Tabelle', () => {
    const html = renderProductionSummary(
      ansicht({ isEmpty: true, products: [], orders: [], orderCount: 0, totalUnits: 0 }),
    );

    expect(html).not.toContain('<table');
  });
});
