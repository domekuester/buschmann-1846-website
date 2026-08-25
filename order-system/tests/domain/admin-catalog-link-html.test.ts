import { describe, expect, it } from 'vitest';
import { renderAdminCatalogPage, type AdminCatalogPageView } from '../../src/ui/admin-catalog-html';

/**
 * Der Zuordnungsbereich von /admin/catalog — §26 des Auftrags.
 *
 * Er wird hier ohne D1, ohne Request und ohne Browser geprüft: Das HTML ist
 * eine reine Funktion über das Lesemodell, und genau deshalb ist jede Regel
 * aus §7, §8, §19, §20 und §22 als einzelne Zusicherung formulierbar.
 *
 * ALLE NAMEN SIND FREI ERFUNDEN.
 */

const BASIS: AdminCatalogPageView = {
  loginIdentifier: 'admin@example.test',
  csrfToken: 'fiktiver-csrf-token',
  products: [],
  productLinks: [
    {
      id: 1,
      name: 'Käsekuchen',
      isActive: true,
      catalogProduct: { id: 7, label: 'Fiktiver Käsekuchen · 26-cm-Ring', isActive: true },
    },
    { id: 2, name: 'Butterkuchen', isActive: true, catalogProduct: null },
  ],
  catalogChoices: [
    { id: 7, label: 'Fiktiver Käsekuchen · 26-cm-Ring', linkedProductId: 1 },
    { id: 8, label: 'Fiktiver Butterkuchen · Blech', linkedProductId: null },
  ],
  noticeCode: null,
};

function render(overrides: Partial<AdminCatalogPageView> = {}): string {
  return renderAdminCatalogPage({ ...BASIS, ...overrides });
}

/** Das Formular EINER Zeile — sonst prüft eine Zusicherung die falsche Zeile. */
function formular(html: string, productId: number): string {
  const start = html.indexOf(`action="/api/admin/products/${productId}/catalog-link"`);
  expect(start).toBeGreaterThan(-1);
  const ende = html.indexOf('</form>', start);
  return html.slice(start, ende);
}

describe('Zuordnungsbereich — Aufbau (§6, §22)', () => {
  it('steht als eigener Bereich neben Sortiment & Preise, nicht an dessen Stelle', () => {
    const html = render();
    expect(html).toContain('Bestellprodukte verknüpfen');
    expect(html).toContain('Sortiment &amp; Preise');
  });

  it('behält genau eine h1 und gliedert die beiden Bereiche mit h2', () => {
    const html = render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/<h2\b/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('trägt einen Sprungpunkt, damit die Weiterleitung im Bereich landet', () => {
    expect(render()).toContain('id="zuordnung"');
  });

  it('führt keine zweite Navigation ein', () => {
    const html = render();
    expect(html.match(/<nav\b/g)).toHaveLength(1);
  });
});

describe('Zuordnungsbereich — Zeilen (§7, §19)', () => {
  it('zeigt jedes bestellbare Produkt mit Namen', () => {
    const html = render();
    expect(html).toContain('Käsekuchen');
    expect(html).toContain('Butterkuchen');
  });

  /** §19 — der Zustand steht als WORT da, nicht nur als Farbe. */
  it('sagt „Verknüpft" und nennt das Katalogprodukt im Klartext', () => {
    const html = render();
    expect(html).toContain('Verknüpft');
    expect(html).toContain('Fiktiver Käsekuchen · 26-cm-Ring');
  });

  it('sagt „Nicht verknüpft" als Wort und nicht als leere Zelle', () => {
    expect(render()).toContain('Nicht verknüpft');
  });

  it('benennt ein stillgelegtes Katalogprodukt, statt die Zuordnung zu verschweigen', () => {
    const html = render({
      productLinks: [{
        id: 1,
        name: 'Altprodukt',
        isActive: true,
        catalogProduct: { id: 9, label: 'Fiktiver Altbestand', isActive: false },
      }],
    });
    expect(html).toContain('Fiktiver Altbestand');
    expect(html).toContain('nicht mehr aktiv');
  });

  it('kennzeichnet ein deaktiviertes Produkt, statt es auszublenden', () => {
    const html = render({
      productLinks: [{ id: 3, name: 'Saisonprodukt', isActive: false, catalogProduct: null }],
    });
    expect(html).toContain('Saisonprodukt');
    expect(html).toContain('Inaktiv');
  });
});

describe('Zuordnungsbereich — Formular (§7, §15, §16)', () => {
  it('gibt jeder Zeile ein echtes POST-Formular auf ihren eigenen Pfad', () => {
    const html = render();
    expect(html).toContain('action="/api/admin/products/1/catalog-link"');
    expect(html).toContain('action="/api/admin/products/2/catalog-link"');
    expect(html.match(/method="post"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('schickt genau zwei Felder: CSRF-Token und Katalogkennung', () => {
    const form = formular(render(), 1);
    expect(form).toContain('name="csrf_token"');
    expect(form).toContain('name="catalog_product_id"');
    expect(form.match(/name="/g)).toHaveLength(2);
  });

  it('trägt weder Rolle noch Kunde noch Preis noch Rückkehrziel im Formular', () => {
    const form = formular(render(), 1);
    for (const feld of ['role', 'customer_id', 'price', 'price_list', 'returnUrl', 'next', 'product_name']) {
      expect(form).not.toContain(`name="${feld}"`);
    }
  });

  it('bietet „Nicht verknüpft" als ausdrückliche Auswahl an — §9', () => {
    expect(formular(render(), 1)).toContain('<option value="">Nicht verknüpft</option>');
  });

  it('wählt die bestehende Zuordnung vor', () => {
    expect(formular(render(), 1)).toContain('<option value="7" selected>');
  });

  it('wählt bei einem unverknüpften Produkt „Nicht verknüpft" vor', () => {
    expect(formular(render(), 2)).toContain('<option value="" selected>Nicht verknüpft</option>');
  });

  it('hat je Zeile ein eigenes Label mit Bezug zum Produkt — §22', () => {
    const html = render();
    expect(html).toContain('for="katalogwahl-1"');
    expect(html).toContain('id="katalogwahl-1"');
    expect(html).toContain('Katalogprodukt für Käsekuchen');
  });

  it('trägt eine eindeutig beschriftete Schaltfläche', () => {
    const form = formular(render(), 1);
    expect(form).toContain('type="submit"');
    expect(form).toContain('Speichern');
  });

  it('braucht kein JavaScript — weder Skript noch Ereignisattribut', () => {
    const html = render();
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son(click|change|submit|input)=/);
  });
});

describe('Zuordnungsbereich — Auswahlliste (§5, §8)', () => {
  /**
   * §5 — DIE OBERFLÄCHE BIETET NICHTS AN, WAS DER SERVER ABLEHNEN MÜSSTE.
   *
   * Ein Katalogprodukt, das bereits einem ANDEREN Produkt gehört, steht in
   * dessen Auswahl nicht. Der partielle UNIQUE-Index aus 0014 bleibt trotzdem
   * die letzte Instanz — die Liste erspart dem Admin bloß den Fehlversuch.
   */
  it('verschweigt ein bereits anderweitig vergebenes Katalogprodukt', () => {
    const form = formular(render(), 2);
    expect(form).not.toContain('value="7"');
    expect(form).toContain('value="8"');
  });

  it('zeigt dem haltenden Produkt seine eigene Zuordnung weiterhin an', () => {
    expect(formular(render(), 1)).toContain('value="7"');
  });

  it('bietet die bestehende Zuordnung auf ein stillgelegtes Katalogprodukt zur Fortschreibung an', () => {
    const form = formular(render({
      productLinks: [{
        id: 1,
        name: 'Altprodukt',
        isActive: true,
        catalogProduct: { id: 9, label: 'Fiktiver Altbestand', isActive: false },
      }],
      catalogChoices: [{ id: 8, label: 'Fiktiver Butterkuchen · Blech', linkedProductId: null }],
    }), 1);

    expect(form).toContain('<option value="9" selected>');
    expect(form).toContain('nicht mehr aktiv');
  });

  /** §8 — kein technischer Wert im sichtbaren Text. */
  it('nennt im sichtbaren Label keine Datenbank-ID', () => {
    const html = render({
      productLinks: [{
        id: 1,
        name: 'Käsekuchen',
        isActive: true,
        catalogProduct: { id: 4711, label: 'Fiktiver Käsekuchen · grosser Ring', isActive: true },
      }],
      catalogChoices: [{ id: 4711, label: 'Fiktiver Käsekuchen · grosser Ring', linkedProductId: 1 }],
    });
    expect(html).not.toContain('>4711<');
    expect(html).not.toContain('· 4711');
  });
});

describe('Zuordnungsbereich — Zusammenfassung (§20)', () => {
  it('nennt Gesamtzahl, verknüpfte und nicht verknüpfte Produkte', () => {
    const html = render({
      productLinks: [
        { id: 1, name: 'A', isActive: true, catalogProduct: { id: 7, label: 'K7', isActive: true } },
        { id: 2, name: 'B', isActive: true, catalogProduct: { id: 8, label: 'K8', isActive: true } },
        { id: 3, name: 'C', isActive: true, catalogProduct: null },
      ],
    });
    expect(html).toContain('3 Bestellprodukte');
    expect(html).toContain('2 verknüpft');
    expect(html).toContain('1 nicht verknüpft');
  });

  it('zeigt keine Zusammenfassung, wenn es nichts zusammenzufassen gibt', () => {
    expect(render({ productLinks: [] })).not.toContain('Bestellprodukte</strong>');
  });
});

describe('Zuordnungsbereich — Meldungen (§18)', () => {
  it('meldet den Erfolg dezent und nicht als Warnung', () => {
    const html = render({ noticeCode: 'saved' });
    expect(html).toContain('Die Zuordnung wurde gespeichert.');
    expect(html).toContain('zuordnungsmeldung--erfolg');
    expect(html).not.toMatch(/class="banner[^"]*"[^>]*>[^<]*gespeichert\./);
  });

  it('erklärt den Unique-Konflikt in verständlichem Deutsch', () => {
    const html = render({ noticeCode: 'catalog_product_taken' });
    expect(html).toContain('bereits');
    expect(html).toContain('nicht gespeichert');
  });

  it('hat für jeden Ausgang des Endpunkts einen Text', () => {
    for (const code of [
      'saved', 'unknown_product', 'unknown_catalog_product',
      'inactive_catalog_product', 'catalog_product_taken', 'invalid', 'internal',
    ]) {
      expect(render({ noticeCode: code })).toContain('role="status"');
    }
  });

  it('zeigt einen erfundenen Code gar nicht an, statt ihn zu spiegeln', () => {
    const html = render({ noticeCode: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('&lt;script&gt;');
  });

  it('nennt in keiner Meldung Technik', () => {
    for (const code of ['internal', 'invalid', 'catalog_product_taken', 'unknown_product']) {
      const html = render({ noticeCode: code });
      // Nur der Meldungstext, nicht die ganze Seite: `name="catalog_product_id"`
      // ist ein Formularfeld und keine Auskunft an den Benutzer.
      const treffer = /role="status">([^<]*)</.exec(html);
      expect(treffer).not.toBeNull();
      const text = treffer?.[1] ?? '';
      for (const wort of ['SQL', 'D1_', 'UNIQUE', 'catalog_product_id', 'constraint', '/src/', 'products.']) {
        expect(text).not.toContain(wort);
      }
    }
  });
});

describe('Zuordnungsbereich — Escaping (§22, §26.27)', () => {
  it('escaped Produktnamen, Kataloglabels und den CSRF-Token', () => {
    const html = render({
      csrfToken: '"><script>alert(1)</script>',
      productLinks: [{
        id: 1,
        name: '<img src=x onerror=alert(1)>',
        isActive: true,
        catalogProduct: { id: 7, label: '<b>Kuchen</b> & Co', isActive: true },
      }],
      catalogChoices: [{ id: 7, label: '<b>Kuchen</b> & Co', linkedProductId: 1 }],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Kuchen</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;Kuchen&lt;/b&gt; &amp; Co');
  });
});

describe('Zuordnungsbereich — Leerzustände', () => {
  it('sagt es, wenn es noch keine bestellbaren Produkte gibt', () => {
    expect(render({ productLinks: [] })).toContain('Noch keine Bestellprodukte');
  });

  it('sagt es, wenn der Katalog noch nichts zu verknüpfen hergibt', () => {
    const html = render({ catalogChoices: [], productLinks: [] });
    expect(html).toContain('Noch keine Bestellprodukte');
  });
});
