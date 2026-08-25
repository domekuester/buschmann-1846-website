import { describe, expect, it } from 'vitest';
import { renderOrderBreakdown, renderProductionSummary } from '../../src/ui/production-day-html';
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

describe('renderOrderBreakdown — Bestellungen', () => {
  it('zeigt Kundenname, Bestellnummer, Status und Art der Übergabe', () => {
    const html = renderOrderBreakdown(ansicht());

    expect(html).toContain('Testcafé Nord');
    expect(html).toContain('BUS-2026-000123');
    expect(html).toContain('Bestätigt');
    expect(html).toContain('Lieferung');
  });

  it('zeigt Abholung, wenn nicht geliefert wird', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ fulfillmentLabel: 'Abholung' })] }),
    );

    expect(html).toContain('Abholung');
    expect(html).not.toContain('Lieferung');
  });

  it('zeigt jeden offenen Status mit seinem deutschen Namen', () => {
    for (const label of ['Neu', 'Bestätigt', 'In Produktion']) {
      const html = renderOrderBreakdown(
        ansicht({ orders: [bestellung({ statusLabel: label })] }),
      );
      expect(html).toContain(label);
    }
  });

  it('zeigt die Positionen einer Bestellung mit Menge und Einheit', () => {
    const html = renderOrderBreakdown(
      ansicht({
        orders: [
          bestellung({
            items: [
              { name: 'Beispiel Käsekuchen', unit: 'Stück', quantity: 3 },
              { name: 'Beispiel Streusel', unit: 'Blech', quantity: 2 },
            ],
          }),
        ],
      }),
    );

    expect(html).toContain('3 Stück × Beispiel Käsekuchen');
    expect(html).toContain('2 Blech × Beispiel Streusel');
  });

  it('rendert jede Bestellung als eigene Sektion mit eigener Überschrift', () => {
    const html = renderOrderBreakdown(
      ansicht({
        orders: [
          bestellung({ customerName: 'Testcafé Nord', orderNumber: 'BUS-2026-000001' }),
          bestellung({ customerName: 'Testcafé Süd', orderNumber: 'BUS-2026-000002' }),
        ],
      }),
    );

    expect(html.match(/<h3/g)).toHaveLength(2);
    expect(html).toContain('Testcafé Nord');
    expect(html).toContain('Testcafé Süd');
    expect(html).toContain('BUS-2026-000001');
    expect(html).toContain('BUS-2026-000002');
  });

  /**
   * Phase 3C liest. Eine Schaltfläche oder ein Auswahlfeld waere der Anfang
   * einer Schreiboperation, die es nicht gibt.
   */
  it('bietet keine Bedienelemente zum Ändern an', () => {
    const html = renderOrderBreakdown(ansicht());

    for (const verboten of ['<button', '<select', '<input', '<form']) {
      expect(html).not.toContain(verboten);
    }
  });

  it('zeigt weder Preise noch Kontaktdaten', () => {
    const html = renderOrderBreakdown(ansicht());

    for (const verboten of ['€', 'cents', '@', 'Telefon', 'Adresse', 'Straße']) {
      expect(html).not.toContain(verboten);
    }
  });

  it('gibt ohne Bestellungen gar nichts aus', () => {
    const html = renderOrderBreakdown(
      ansicht({ isEmpty: true, orders: [], products: [], orderCount: 0, totalUnits: 0 }),
    );

    expect(html).toBe('');
  });
});

describe('renderOrderBreakdown — Notiz', () => {
  it('zeigt eine vorhandene Notiz klar sichtbar', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: 'Bitte vor 10 Uhr anliefern' })] }),
    );

    expect(html).toContain('Hinweis');
    expect(html).toContain('Bitte vor 10 Uhr anliefern');
  });

  /**
   * DER TEST GEGEN LEEREN PLATZ: Ohne Notiz darf kein Notizblock im Dokument
   * stehen — auch keiner mit leerem Inhalt.
   */
  it('rendert ohne Notiz keinen Notizblock', () => {
    const html = renderOrderBreakdown(ansicht({ orders: [bestellung({ note: null })] }));

    expect(html).not.toContain('Hinweis');
    expect(html).not.toContain('notiz');
  });

  it('escapet ein Skript in der Notiz', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: '<script>alert(1)</script>' })] }),
    );

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapet ein Bild mit onerror in der Notiz', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: '<img src=x onerror=alert(1)>' })] }),
    );

    // Der Text 'onerror=alert(1)' STEHT in der Antwort — als Text. Genau das
    // ist richtig: Die Notiz wird angezeigt, wie sie eingegeben wurde. Worauf
    // es ankommt, ist, dass daraus kein Element wird: Ohne < und > gibt es
    // kein Tag, an dem ein Attribut haengen koennte.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapet Anführungszeichen, die aus einem Attribut ausbrechen könnten', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: `" onmouseover="alert(1)` })] }),
    );

    expect(html).not.toContain('onmouseover="alert');
    expect(html).toContain('&quot;');
  });

  it('escapet Ampersand und einfache Anführungszeichen', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: `Müller & Söhne 'fein'` })] }),
    );

    expect(html).toContain('Müller &amp; Söhne &#39;fein&#39;');
  });

  /** Eine bereits escapete Entity darf nicht ein zweites Mal escapet werden. */
  it('verdoppelt keine bestehende HTML-Entity zu Unkenntlichkeit', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ note: 'A &amp; B' })] }),
    );

    expect(html).toContain('A &amp;amp; B');
    expect(html).not.toContain('A &amp; B<');
  });
});

describe('renderOrderBreakdown — Escaping von Stammdaten', () => {
  it('escapet HTML im Kundennamen', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ customerName: '<b>Testcafé Nord</b>' })] }),
    );

    expect(html).toContain('&lt;b&gt;Testcafé Nord&lt;/b&gt;');
    expect(html).not.toContain('<b>Testcafé Nord</b>');
  });

  it('escapet HTML im Produktnamen einer Position', () => {
    const html = renderOrderBreakdown(
      ansicht({
        orders: [
          bestellung({ items: [{ name: '<i>Kuchen</i>', unit: 'Stück', quantity: 1 }] }),
        ],
      }),
    );

    expect(html).toContain('&lt;i&gt;Kuchen&lt;/i&gt;');
  });

  it('escapet die Bestellnummer', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ orderNumber: 'BUS-<2026>' })] }),
    );

    expect(html).toContain('BUS-&lt;2026&gt;');
  });

  it('escapet Status- und Übergabelabel', () => {
    const html = renderOrderBreakdown(
      ansicht({ orders: [bestellung({ statusLabel: '<s>Neu</s>', fulfillmentLabel: '<u>Lieferung</u>' })] }),
    );

    expect(html).toContain('&lt;s&gt;Neu&lt;/s&gt;');
    expect(html).toContain('&lt;u&gt;Lieferung&lt;/u&gt;');
  });
});
