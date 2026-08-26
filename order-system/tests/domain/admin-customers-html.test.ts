import { describe, expect, it } from 'vitest';
import { renderAdminCustomersPage } from '../../src/ui/admin-customers-html';
import type { AdminCustomerRow, PriceGroupOption } from '../../src/domain/customer-price-group';

const GRUPPEN: readonly PriceGroupOption[] = [
  { code: 'gastro', label: 'Gastronomie' },
  { code: 'private', label: 'Privatkunden' },
];

function seite(
  customers: readonly AdminCustomerRow[],
  overrides: { priceGroups?: readonly PriceGroupOption[]; noticeCode?: string | null } = {},
): string {
  return renderAdminCustomersPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'fiktiver-csrf-token',
    customers,
    priceGroups: overrides.priceGroups ?? GRUPPEN,
    noticeCode: overrides.noticeCode ?? null,
  });
}

const ZUGEORDNET: AdminCustomerRow = {
  id: 1,
  name: 'Fiktives Café Nord',
  isActive: true,
  priceGroup: { code: 'gastro', label: 'Gastronomie', isActive: true },
};

const OFFEN: AdminCustomerRow = {
  id: 2,
  name: 'Fiktiver Privatkunde',
  isActive: true,
  priceGroup: null,
};

describe('renderAdminCustomersPage', () => {
  it('nennt jeden Kunden mit Namen', () => {
    const html = seite([ZUGEORDNET, OFFEN]);
    expect(html).toContain('Fiktives Café Nord');
    expect(html).toContain('Fiktiver Privatkunde');
  });

  it('zeigt die zugewiesene Preisgruppe im Klartext', () => {
    expect(seite([ZUGEORDNET])).toContain('Gastronomie');
  });

  it('nennt eine fehlende Zuordnung „Nicht zugeordnet"', () => {
    expect(seite([OFFEN])).toContain('Nicht zugeordnet');
  });

  it('bietet jede aktive Preisgruppe zur Auswahl an', () => {
    const html = seite([OFFEN]);
    expect(html).toContain('value="gastro"');
    expect(html).toContain('value="private"');
  });

  it('bietet eine deaktivierte Preisgruppe nicht als neue Auswahl an', () => {
    const html = seite([OFFEN], { priceGroups: [{ code: 'gastro', label: 'Gastronomie' }] });
    expect(html).not.toContain('value="private"');
  });

  it('wählt die bestehende Zuordnung im Auswahlfeld vor', () => {
    expect(seite([ZUGEORDNET])).toMatch(/<option value="gastro" selected>/);
  });

  it('macht eine inaktiv gewordene Zuordnung sichtbar, ohne sie zu ersetzen', () => {
    const html = seite([{
      id: 3,
      name: 'Fiktiver Altkunde',
      isActive: true,
      priceGroup: { code: 'fixture_alt', label: 'Fiktive Altpreisliste', isActive: false },
    }]);

    expect(html).toContain('Fiktive Altpreisliste');
    expect(html).toContain('nicht mehr aktiv');
    // Die Zuordnung bleibt stehen — nichts wird still auf eine andere gesetzt.
    expect(html).not.toMatch(/<option value="gastro" selected>/);
  });

  it('adressiert im Formular genau den Kunden der Zeile', () => {
    const html = seite([ZUGEORDNET, OFFEN]);
    expect(html).toContain('action="/api/admin/customers/1/price-list"');
    expect(html).toContain('action="/api/admin/customers/2/price-list"');
  });

  it('schickt das Formular als echtes POST mit CSRF-Token', () => {
    const html = seite([OFFEN]);
    expect(html).toContain('method="post"');
    expect(html).toContain('name="csrf_token" value="fiktiver-csrf-token"');
  });

  it('überträgt ausschließlich das Preisgruppenfeld und den Token', () => {
    const html = seite([ZUGEORDNET]);
    const felder = [...html.matchAll(/<(?:input|select|textarea)[^>]*name="([^"]+)"/g)]
      .map((m) => m[1]);
    expect(new Set(felder)).toEqual(new Set(['csrf_token', 'price_list_code']));
  });

  it('trägt kein Skript und keine Preisangabe', () => {
    const html = seite([ZUGEORDNET, OFFEN]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('€');
  });

  it('zeigt keinerlei Zugangs- oder Sitzungsdaten', () => {
    const html = seite([ZUGEORDNET, OFFEN]);
    for (const verboten of [
      'credential_', 'token_hash', 'salt', 'verifier', 'pepper',
      'session_id', 'failed_attempts', 'locked_until',
    ]) {
      expect(html.toLowerCase()).not.toContain(verboten);
    }
  });

  it('escapet dynamische Werte', () => {
    const html = seite([{
      id: 4,
      name: '<script>alert("x")</script>',
      isActive: true,
      priceGroup: { code: '"><b>', label: '<b>Fiktiv</b>', isActive: true },
    }], { priceGroups: [{ code: '"><b>', label: '<b>Fiktiv</b>' }] });

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>Fiktiv</b>');
  });

  it('weist auf noch nicht zugeordnete Kunden hin', () => {
    expect(seite([ZUGEORDNET, OFFEN])).toMatch(/1 von 2 Kunden/);
  });

  it('schweigt, wenn alle Kunden zugeordnet sind', () => {
    expect(seite([ZUGEORDNET])).not.toMatch(/von 1 Kunden/);
  });

  it('markiert einen deaktivierten Kunden in Worten, nicht nur farblich', () => {
    const html = seite([{ ...OFFEN, isActive: false }]);
    expect(html).toContain('Inaktiv');
  });

  /**
   * Die Seite muss die Klassen benutzen, die das Stylesheet TATSÄCHLICH
   * kennt. Ein Tippfehler im Klassennamen fällt in keiner Zusicherung über
   * Textinhalte auf — die Seite ist dann im Browser eine nackte
   * Standardtabelle, und genau das ist einmal passiert.
   */
  it('benutzt das gemeinsame Listenmuster der Adminseiten', () => {
    const html = seite([OFFEN]);
    expect(html).toContain('class="bereichskopf"');
    expect(html).toContain('class="datentabelle"');
    expect(html).toContain('class="datentabelle-wrap"');
  });

  it('hat einen leeren Zustand ohne Tabelle', () => {
    const html = seite([]);
    expect(html).toContain('Noch keine Kunden');
    expect(html).not.toContain('<table');
  });

  it('führt die vier echten Adminbereiche', () => {
    const html = seite([OFFEN]);
    expect(html).toContain('href="/admin/dashboard"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/catalog"');
    expect(html).toContain('href="/admin/customers"');
    expect(html).toContain('aria-current="page"');
  });

  it('zeigt noch keine Attrappen für Bereiche ohne Seite', () => {
    // „Dashboard" stand bis Phase 5D in dieser Liste und ist seit Phase 6A
    // eine echte Seite mit echter Route — der Eintrag ist damit keine
    // Attrappe mehr, sondern ihr Gegenteil. Was hier steht, hat weiterhin
    // keine Seite.
    const html = seite([OFFEN]);
    for (const attrappe of ['Finanzen', 'Analytics', 'Kosten', 'Einstellungen']) {
      expect(html).not.toContain(attrappe);
    }
  });

  it.each([
    ['saved', 'gespeichert'],
    ['unknown_customer', 'Kunde'],
    ['inactive_price_group', 'nicht mehr vergeben'],
    ['invalid', 'nicht gespeichert'],
  ])('macht die Rückmeldung %s in Worten sichtbar', (code, text) => {
    const html = seite([OFFEN], { noticeCode: code });
    expect(html).toContain(text);
    expect(html).toContain('role="status"');
  });

  it('stellt die Erfolgsmeldung nicht als Fehler dar', () => {
    const html = seite([OFFEN], { noticeCode: 'saved' });
    expect(html).toContain('kundenmeldung--erfolg');
    // .banner ist im ganzen System die Fehlerdarstellung samt ⚠.
    expect(html).not.toContain('class="banner kundenmeldung kundenmeldung--erfolg"');
    expect(html).toMatch(/class="kundenmeldung kundenmeldung--erfolg"/);
  });

  it('stellt einen Fehlschlag weiterhin als Fehlerbanner dar', () => {
    expect(seite([OFFEN], { noticeCode: 'inactive_price_group' }))
      .toContain('class="banner kundenmeldung"');
  });

  it('zeigt zu einem unbekannten Rückmeldungscode gar nichts an', () => {
    expect(seite([OFFEN], { noticeCode: 'frei-erfunden' })).not.toContain('role="status"');
  });

  it('spiegelt einen fremden Rückmeldungscode nicht in die Seite', () => {
    const html = seite([OFFEN], { noticeCode: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('alert(1)');
  });
});

describe('renderAdminCustomersPage — Spaltenbreite', () => {
  it('bleibt bei der schmalen Adminspalte', () => {
    // Die breite Spalte gehört ausschließlich dem Dashboard mit seinen sechs
    // Tabellenspalten. Drei Spalten lesen sich in 44rem besser.
    expect(seite([OFFEN])).toContain('<body class="adminseite">');
    expect(seite([OFFEN])).not.toContain('adminseite--breit');
  });
});
