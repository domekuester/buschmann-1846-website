import { describe, expect, it } from 'vitest';
import { renderOrderPage } from '../../src/ui/order-page-html';
import type { CatalogItemView } from '../../src/application/catalog-view';

const PRODUCTS: CatalogItemView[] = [
  { id: 1, name: 'Beispiel Käsekuchen', description: 'Mit Sahne', unit: 'Stück', price: { kind: 'fixed', priceCents: 435 } },
  { id: 2, name: 'Beispiel Streuselblech', description: null, unit: 'Blech', price: { kind: 'fixed', priceCents: 280 } },
];

function page(overrides: Partial<Parameters<typeof renderOrderPage>[0]> = {}): string {
  return renderOrderPage({
    customerName: 'Testcafé Nord',
    products: PRODUCTS,
    submissionId: 'sub-0123-4567-89ab',
    csrfToken: 'C'.repeat(43),
    earliestDate: '2026-08-24',
    orderDaysNotice: null,
    cutoffNotice: null,
    defaultDate: '2026-08-25',
    hasPriceGroup: true,
    ...overrides,
  });
}

describe('renderOrderPage — das Café erkennt sich wieder', () => {
  it('nennt den Cafénamen', () => {
    expect(page()).toContain('Testcafé Nord');
  });

  it('verlangt weder Name noch Adresse noch Kontaktdaten', () => {
    const html = page();
    for (const field of ['name="email"', 'name="phone"', 'name="address"', 'type="password"']) {
      expect(html).not.toContain(field);
    }
  });

  it('ist auf Deutsch ausgezeichnet', () => {
    expect(page()).toContain('lang="de"');
  });
});

describe('renderOrderPage — das Sortiment', () => {
  it('zeigt jedes Produkt mit Preis und Einheit', () => {
    const html = page();

    expect(html).toContain('Beispiel Käsekuchen');
    expect(html).toContain('4,35 €');
    expect(html).toContain('Stück');
    expect(html).toContain('Beispiel Streuselblech');
    expect(html).toContain('2,80 €');
    expect(html).toContain('Blech');
  });

  it('zeigt eine vorhandene Beschreibung und erfindet keine', () => {
    const html = page();
    expect(html).toContain('Mit Sahne');
    expect(html).not.toContain('null');
  });

  it('gibt jeder Zeile Produkt-ID und Preis in Cent mit', () => {
    const html = page();
    expect(html).toContain('data-product-id="1"');
    expect(html).toContain('data-price-cents="435"');
    expect(html).toContain('data-product-id="2"');
    expect(html).toContain('data-price-cents="280"');
  });

  it('behält die übergebene Reihenfolge bei', () => {
    const html = page();
    expect(html.indexOf('Beispiel Käsekuchen')).toBeLessThan(html.indexOf('Beispiel Streuselblech'));
  });

  it('startet jede Menge bei 0', () => {
    expect(page().match(/value="0"/g)).toHaveLength(2);
  });
});

describe('renderOrderPage — Lieferdatum, Notiz, Absenden', () => {
  it('verbietet die Vergangenheit schon im Feld', () => {
    expect(page()).toContain('min="2026-08-24"');
  });

  it('belegt den Liefertag mit morgen vor — ein Tap weniger', () => {
    expect(page()).toContain('value="2026-08-25"');
  });

  it('führt die Absendekennung im Formular mit', () => {
    expect(page()).toContain('data-submission-id="sub-0123-4567-89ab"');
  });

  it('hat genau ein optionales Notizfeld und kein Rich-Text', () => {
    const html = page();
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain('maxlength="500"');
    expect(html).not.toContain('contenteditable');
  });

  it('hat einen echten Absenden-Button, der zum Formular gehört', () => {
    const html = page();
    expect(html).toMatch(/<button[^>]*type="submit"/);
    // Der Button steht in der Fußleiste, also AUSSERHALB des Formulars. Ohne
    // form-Attribut wäre er dort ein Knopf ohne Wirkung — auch für die
    // Tastatur.
    expect(html).toContain('form="bestellformular"');
    expect(html).toContain('id="bestellformular"');
  });

  it('erklärt ohne JavaScript, was zu tun ist', () => {
    expect(page()).toContain('<noscript>');
  });

  /**
   * Die Fehlermeldung gehört in die Fußleiste, nicht ins Formular.
   *
   * Im Formular stünde sie unter der Notiz — also außerhalb des sichtbaren
   * Bereichs, während der Daumen unten auf „Bestellung senden" liegt. Genau
   * das war sie in der ersten Fassung, und im Browser fiel auf, dass die
   * Meldung erscheint, ohne dass jemand sie sieht. Der Test hält die
   * Platzierung fest, weil sie hier keine Gestaltungsfrage ist, sondern
   * darüber entscheidet, ob die Meldung ihren Zweck erfüllt.
   */
  it('zeigt Fehler dort, wo der Absenden-Button steht', () => {
    const html = page();
    const leiste = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

    expect(leiste).toContain('data-form-error');
    expect(leiste).toContain('role="alert"');

    const formular = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(formular).not.toContain('data-form-error');
  });
});

describe('renderOrderPage — nichts tritt nach außen, was nicht soll', () => {
  it('escapt einen Cafénamen, der Markup enthält', () => {
    const html = page({ customerName: '<script>alert(1)</script>Café' });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapt Produktnamen und Beschreibungen', () => {
    const html = page({
      products: [
        {
          id: 1,
          name: 'Kuchen "A" & B',
          description: '<img src=x onerror=alert(1)>',
          unit: 'Stück',
          price: { kind: 'fixed', priceCents: 100 },
        },
      ],
    });

    expect(html).toContain('Kuchen &quot;A&quot; &amp; B');
    expect(html).not.toContain('<img src=x');
  });

  /**
   * Der Token steht in der URL, aber er hat im Dokument nichts verloren: Ein
   * Screenshot der Seite darf ihn nicht enthalten, und ein versehentliches
   * Kopieren des Quelltextes ebenfalls nicht. Der Client liest ihn aus
   * location.pathname.
   */
  /**
   * Zwei Geheimnisse mit verschiedenen Aufgaben, und nur EINES gehört ins
   * Dokument.
   *
   * Der Sitzungstoken liegt HttpOnly im Cookie: Er darf hier nirgends
   * auftauchen, und dieses Gerüst bekommt ihn gar nicht erst übergeben. Der
   * CSRF-Token MUSS dagegen im Dokument stehen — das Client-Skript liest ihn
   * und sendet ihn beim Absenden zurück. Wer nur ihn hat und nicht das Cookie,
   * kann damit nichts anfangen.
   */
  it('trägt den CSRF-Token und sonst kein Geheimnis', () => {
    const html = page();

    // Der CSRF-Token steht genau zweimal: im Formular und im Abmeldefeld.
    expect(html.split('C'.repeat(43)).length - 1).toBe(2);

    // Vom alten Capability-Link ist nichts übrig.
    expect(html).not.toContain('/o/');
    expect(html).not.toContain('x-order-token');
    expect(html).not.toContain('access');
  });

  it('lädt nichts von einem fremden Host', () => {
    const html = page();
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('cdn.');
  });

  it('bringt weder Inline-Skript noch Inline-Stil mit', () => {
    const html = page();
    // <script src=...> ja, <script>…</script> nein.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/\son\w+="/);
  });

  it('bittet Suchmaschinen ausdrücklich, die Seite zu ignorieren', () => {
    expect(page()).toContain('noindex');
  });
});

/**
 * Dieselbe Falle wie auf der Loginseite, und sie gilt für jedes Seitengerüst:
 * Ein `<meta name="referrer">` gewinnt gegenüber der HTTP-Kopfzeile. Mit
 * `no-referrer` schickt der Browser bei einer Formularabsendung
 * `Origin: null`, und die CSRF-Abwehr lehnt alles ab. Die Policy hat genau
 * eine Quelle: src/http/security.ts.
 */
describe('Referrer-Policy steht nur an einer Stelle', () => {
  it('trägt keine eigene Referrer-Policy im Markup', () => {
    expect(page()).not.toContain('name="referrer"');
  });
});

/**
 * §25 DER TESTMATRIX: DIE VIER PREISFORMEN AUF DER BESTELLSEITE.
 *
 * Der Kern dieser Gruppe ist nicht, dass „ab 55,00 €" dasteht, sondern dass
 * an derselben Zeile KEINE Mengenauswahl steht — und zwar keine deaktivierte,
 * sondern gar keine. Ein deaktiviertes Feld lässt sich in den Entwicklerwerk-
 * zeugen wieder aktivieren; ein fehlendes nicht.
 */
describe('renderOrderPage — Preisformen', () => {
  function mitPreis(price: CatalogItemView['price'], overrides: Partial<CatalogItemView> = {}): string {
    return page({
      products: [
        { id: 1, name: 'Hochzeitstorte', description: null, unit: 'Torte', price, ...overrides },
      ],
    });
  }

  it('zeigt einen Festpreis mit Einheit und Mengenauswahl', () => {
    const html = mitPreis({ kind: 'fixed', priceCents: 3250 });

    expect(html).toContain('32,50 €');
    expect(html).toContain('data-quantity');
    expect(html).toContain('data-price-cents="3250"');
    expect(html).not.toContain('data-unorderable');
  });

  it('zeigt „ab …" und bietet keine Mengenauswahl an', () => {
    const html = mitPreis({ kind: 'from', minPriceCents: 5500 });

    expect(html).toContain('ab 55,00 €');
    expect(html).toContain('data-unorderable');
    expect(html).not.toContain('data-quantity');
    expect(html).not.toContain('data-price-cents');
    expect(html).toContain('keine direkte Online-Preisberechnung');
  });

  it('zeigt eine Preisspanne und bietet keine Mengenauswahl an', () => {
    const html = mitPreis({ kind: 'range', minPriceCents: 5500, maxPriceCents: 7500 });

    expect(html).toContain('55,00–75,00 €');
    expect(html).toContain('data-unorderable');
    expect(html).not.toContain('data-quantity');
  });

  it('zeigt „Auf Anfrage" und bietet keine Mengenauswahl an', () => {
    const html = mitPreis({ kind: 'on_request' });

    expect(html).toContain('Auf Anfrage');
    expect(html).toContain('data-unorderable');
    expect(html).not.toContain('data-quantity');
  });

  /** §38: Ein fehlender Preis erscheint NIEMALS als 0,00 €. */
  it('stellt einen fehlenden Preis nicht als 0,00 € dar', () => {
    const html = mitPreis({ kind: 'unavailable' });

    expect(html).not.toContain('0,00 € / Torte');
    expect(html).toContain('data-unorderable');
    expect(html).not.toContain('data-quantity');
    expect(html).toContain('keinen Preis anzeigen');
  });

  it('mischt bestellbare und nicht bestellbare Zeilen in einer Liste', () => {
    const html = page({
      products: [
        { id: 1, name: 'Käsekuchen', description: null, unit: 'Stück', price: { kind: 'fixed', priceCents: 435 } },
        { id: 2, name: 'Hochzeitstorte', description: null, unit: 'Torte', price: { kind: 'on_request' } },
      ],
    });

    expect(html).toContain('data-price-cents="435"');
    expect(html).toContain('Auf Anfrage');
    // Genau EINE Mengenauswahl, nämlich die des Käsekuchens.
    expect(html.match(/data-quantity/g)).toHaveLength(1);
  });

  /**
   * §16 / §39: Ein Gastronomiekunde sieht keine Privatpreise, und niemand
   * sieht eine interne Kennung. Die Seite bekommt beides gar nicht erst —
   * dieser Test hält fest, dass sie es auch nicht erfindet.
   */
  it('nennt weder Preislisten-ID noch Preislistencode noch Preistyp', () => {
    const html = mitPreis({ kind: 'from', minPriceCents: 5500 });

    for (const intern of ['price_list', 'priceListId', 'gastro', 'private', 'price_type', 'catalog_product']) {
      expect(html).not.toContain(intern);
    }
  });
});

describe('renderOrderPage — Kunde ohne Preisgruppe', () => {
  it('erklärt verständlich, warum keine Preise dastehen', () => {
    const html = page({
      hasPriceGroup: false,
      products: [
        { id: 1, name: 'Käsekuchen', description: null, unit: 'Stück', price: { kind: 'unavailable' } },
      ],
    });

    expect(html).toContain('data-price-group-notice');
    expect(html).toContain('Preisgruppe');
    expect(html).toContain('Buschmann 1846');
    expect(html).not.toContain('data-quantity');
  });

  it('zeigt den Hinweis nicht, wenn eine Preisgruppe hinterlegt ist', () => {
    expect(page()).not.toContain('data-price-group-notice');
  });

  /** Der Hinweis ist eine Auskunft, kein Fehler — und unterbricht keinen Screenreader. */
  it('meldet den Hinweis als status und nicht als alert', () => {
    const html = page({ hasPriceGroup: false });

    expect(html).toContain('role="status" aria-labelledby="titel-preisgruppe"');
  });

  it('nennt keine internen Verwaltungszustände', () => {
    const html = page({ hasPriceGroup: false });

    expect(html).not.toContain('inaktiv');
    expect(html).not.toContain('price_list');
  });
});
