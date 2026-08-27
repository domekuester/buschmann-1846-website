import { describe, expect, it } from 'vitest';
import type { AdminCatalogProduct } from '../../src/domain/catalog-pricing';
import { renderAdminCatalogPage, type AdminCatalogPageView } from '../../src/ui/admin-catalog-html';

/**
 * Die Herstellkostenspalte auf /admin/catalog — §18 des Auftrags.
 *
 * Geprüft wird das AUSGELIEFERTE HTML: dass die Angabe als intern
 * gekennzeichnet ist, dass „nicht hinterlegt" ein leeres Feld und nie „0,00"
 * ist, und dass das Formular genau zwei Felder trägt.
 *
 * ALLE NAMEN UND BETRÄGE SIND FREI ERFUNDEN.
 */

function produkt(overrides: Partial<AdminCatalogProduct> = {}): AdminCatalogProduct {
  return {
    id: 7,
    name: 'Fiktiver Käsekuchen',
    variant: null,
    unit: 'Stück',
    gastroPrice: { type: 'fixed', priceCents: 420 },
    privatePrice: { type: 'fixed', priceCents: 520 },
    unitCostCents: null,
    ...overrides,
  };
}

function view(overrides: Partial<AdminCatalogPageView> = {}): AdminCatalogPageView {
  return {
    loginIdentifier: 'admin@example.test',
    csrfToken: 'csrf-testwert',
    productLinks: [],
    catalogChoices: [],
    noticeCode: null,
    products: [produkt()],
    ...overrides,
  };
}

describe('Herstellkosten in der Katalogtabelle — §18.21', () => {
  it('zeigt eine eigene Spalte „Herstellkosten"', () => {
    const html = renderAdminCatalogPage(view());
    expect(html).toContain('Herstellkosten');
  });

  it('zeigt einen gepflegten Wert im Eingabefeld, so wie er wieder lesbar ist', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ unitCostCents: 210 })] }));
    expect(html).toContain('value="2,10"');
  });

  it('zeigt gepflegte 0 € als 0,00 und nicht als leeres Feld', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ unitCostCents: 0 })] }));
    expect(html).toContain('value="0,00"');
  });

  /**
   * §18.22 — DER WICHTIGSTE TEST DIESER DATEI.
   *
   * „Noch nicht gepflegt" ist ein LEERES Feld mit dem Platzhalter „Nicht
   * hinterlegt". Ein vorbelegtes „0,00" wäre eine Zahl, die niemand
   * eingegeben hat, und würde beim nächsten Speichern zur Aussage „kostet uns
   * nichts".
   */
  it('zeigt ein nicht gepflegtes Produkt als leeres Feld und nie als 0,00', () => {
    const html = renderAdminCatalogPage(view());

    expect(html).toContain('value=""');
    expect(html).toContain('placeholder="Nicht hinterlegt"');
    expect(html).not.toContain('value="0,00"');
  });

  it('trägt den Eurobetrag außerhalb des Feldes', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ unitCostCents: 210 })] }));

    expect(html).not.toContain('value="2,10 €"');
    expect(html).toContain('kosten__waehrung');
  });

  /**
   * §6 — DIE INTERNE KENNZEICHNUNG STEHT ALS SATZ DA und nicht nur als Farbe
   * oder Symbol.
   */
  it('kennzeichnet die Angabe ausdrücklich als nur intern sichtbar', () => {
    const html = renderAdminCatalogPage(view());

    expect(html).toContain('Herstellkosten sind nur intern sichtbar.');
    expect(html).toContain('nur intern');
  });

  /** §6 — keine Marge, kein Rohertrag, keine Differenz in dieser Phase. */
  it('zeigt weder Marge noch Rohertrag noch eine Differenz', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ unitCostCents: 210 })] }));

    expect(html).not.toMatch(/Marge|Rohertrag|Deckungsbeitrag|Gewinn|Aufschlag/i);
  });
});

describe('Das Kostenformular — §18.23 bis §18.25', () => {
  it('schickt an den Endpunkt des adressierten Katalogprodukts', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ id: 42 })] }));
    expect(html).toContain('action="/api/admin/catalog-products/42/cost"');
  });

  it('ist ein echtes POST-Formular ohne Skript', () => {
    const html = renderAdminCatalogPage(view());

    expect(html).toContain('<form method="post"');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son(click|submit|change|input)=/);
  });

  /** §18.25 — der Sitzungstoken liegt im Formular. */
  it('trägt den CSRF-Token der Sitzung', () => {
    const html = renderAdminCatalogPage(view());
    expect(html).toContain('name="csrf_token" value="csrf-testwert"');
  });

  /**
   * GENAU ZWEI FELDER. Kein Produktname, kein Preis, keine Preisliste, kein
   * Rückkehrziel — was nicht im Formular steht, kann auch nicht geschmuggelt
   * werden.
   */
  it('trägt genau zwei Felder', () => {
    const html = renderAdminCatalogPage(view());
    const formular = html.slice(
      html.indexOf('<form method="post" action="/api/admin/catalog-products/'),
    ).split('</form>')[0] ?? '';
    const namen = [...formular.matchAll(/<input\b[^>]*\bname="([^"]+)"/g)].map((t) => t[1]);

    expect(namen).toEqual(['csrf_token', 'unit_cost']);
  });

  /** Ein eigenes Label je Zeile — sonst hieße jedes Feld gleich. */
  it('beschriftet jedes Feld mit seinem Produkt', () => {
    const html = renderAdminCatalogPage(view());
    expect(html).toContain('Herstellkosten für Fiktiver Käsekuchen in Euro');
  });

  it('escaped den Produktnamen auch im Label', () => {
    const html = renderAdminCatalogPage(view({
      products: [produkt({ name: '<img src=x onerror=alert(1)>' })],
    }));

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('Rückmeldungen — §18.27', () => {
  it('meldet den Erfolg ohne Warndreieck', () => {
    const html = renderAdminCatalogPage(view({ noticeCode: 'cost_saved' }));

    expect(html).toContain('Die Herstellkosten wurden gespeichert.');
    expect(html).toContain('zuordnungsmeldung--erfolg');
  });

  it('meldet das Entfernen eines Werts eigens', () => {
    const html = renderAdminCatalogPage(view({ noticeCode: 'cost_cleared' }));
    expect(html).toContain('Die Herstellkosten wurden entfernt.');
  });

  it('erklärt eine ungültige Eingabe in Alltagssprache und ohne Feldnamen', () => {
    const html = renderAdminCatalogPage(view({ noticeCode: 'cost_invalid' }));

    const meldung = html.slice(html.indexOf('Bitte einen Betrag wie 2,10 eingeben'));
    const satz = meldung.slice(0, meldung.indexOf('</p>'));

    expect(satz).toContain('Die Herstellkosten wurden nicht gespeichert.');
    // Der Satz nennt keinen Feldnamen und keine Technik.
    expect(satz).not.toMatch(/unit_cost|cost_cents|SQL|D1|catalog_products/);
    expect(html).toContain('banner');
  });

  /**
   * DER CODE KOMMT AUS DER ADRESSZEILE UND WIRD NIE ANGEZEIGT, sondern in
   * einer festen Tabelle nachgeschlagen. Ein unbekannter Code führt zu gar
   * keiner Meldung — damit kann hier nichts stehen, was nicht im Quelltext
   * steht.
   */
  it('zeigt für einen erfundenen Code gar nichts an', () => {
    const html = renderAdminCatalogPage(view({
      noticeCode: 'cost_<script>alert(1)</script>',
    }));

    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('cost_&lt;script&gt;');
  });

  /** Die Meldung des Kostenformulars steht IM Preisbereich, nicht unten. */
  it('zeigt die Kostenmeldung über der Preistabelle', () => {
    const html = renderAdminCatalogPage(view({ noticeCode: 'cost_saved' }));

    expect(html.indexOf('Die Herstellkosten wurden gespeichert.'))
      .toBeLessThan(html.indexOf('Bestellprodukte verknüpfen'));
  });

  /** Und umgekehrt: Die Zuordnungsmeldung landet nicht im Preisbereich. */
  it('verwechselt die beiden Meldungsbereiche nicht', () => {
    const html = renderAdminCatalogPage(view({ noticeCode: 'saved' }));

    expect(html).toContain('Die Zuordnung wurde gespeichert.');
    expect(html).not.toContain('Die Herstellkosten wurden gespeichert.');
  });
});

describe('Der Preisbereich bleibt, was er war', () => {
  /** §13 — die Verkaufspreise sind weiterhin nur lesbar. */
  it('bietet kein Eingabefeld für einen Verkaufspreis', () => {
    const html = renderAdminCatalogPage(view({ products: [produkt({ unitCostCents: 210 })] }));

    expect(html).toContain('4,20 €');
    expect(html).toContain('5,20 €');
    expect(html).not.toMatch(/name="(price|price_cents|gastro|private)[^"]*"/);
  });

  it('zeigt den Ankerpunkt, auf den die Weiterleitung zeigt', () => {
    const html = renderAdminCatalogPage(view());
    expect(html).toContain('id="herstellkosten"');
  });
});
