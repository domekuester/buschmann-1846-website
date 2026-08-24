import { describe, expect, it } from 'vitest';
import { renderInvalidLinkPage, renderOrderPage } from '../../src/ui/order-page-html';
import type { CatalogItemView } from '../../src/application/catalog-view';

const PRODUCTS: CatalogItemView[] = [
  { id: 1, name: 'Beispiel Käsekuchen', description: 'Mit Sahne', priceCents: 435, unit: 'Stück' },
  { id: 2, name: 'Beispiel Streuselblech', description: null, priceCents: 280, unit: 'Blech' },
];

function page(overrides: Partial<Parameters<typeof renderOrderPage>[0]> = {}): string {
  return renderOrderPage({
    customerName: 'Testcafé Nord',
    products: PRODUCTS,
    submissionId: 'sub-0123-4567-89ab',
    csrfToken: 'C'.repeat(43),
    today: '2026-08-24',
    defaultDate: '2026-08-25',
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
          priceCents: 100,
          unit: 'Stück',
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

describe('renderInvalidLinkPage', () => {
  it('sagt freundlich, dass der Link nicht mehr gilt', () => {
    const html = renderInvalidLinkPage();
    expect(html).toContain('nicht mehr gültig');
    expect(html).toContain('Buschmann');
  });

  it('nennt keinen Grund und kein Café', () => {
    const html = renderInvalidLinkPage().toLowerCase();
    for (const leak of ['widerrufen', 'unbekannt', 'deaktiviert', 'abgelaufen', 'existiert', 'token']) {
      expect(html).not.toContain(leak);
    }
  });

  it('zeigt kein Formular und kein Sortiment', () => {
    const html = renderInvalidLinkPage();
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });
});
