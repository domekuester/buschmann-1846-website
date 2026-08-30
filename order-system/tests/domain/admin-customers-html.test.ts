import { describe, expect, it } from 'vitest';
import type { AdminCustomerView } from '../../src/domain/admin-customer';
import { renderAdminCustomersPage } from '../../src/ui/admin-customers-html';

const CUSTOMER: AdminCustomerView = {
  id: 1,
  name: 'Fiktives Café Nord',
  customerCode: 'cafemorgen',
  contactPerson: 'Erika Beispiel',
  email: 'erika@example.test',
  phone: '0211 123456',
  deliveryAddress: null,
  priceGroupCode: 'gastro',
  defaultFulfillment: 'pickup',
  isActive: true,
  internalNote: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
};

function page(customers: readonly AdminCustomerView[] = [CUSTOMER], noticeCode: string | null = null): string {
  return renderAdminCustomersPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'fiktiver-csrf-token',
    customers,
    priceGroups: [{ code: 'gastro', label: 'Gastronomie' }, { code: 'private', label: 'Privatkunden' }],
    noticeCode,
    pendingRequestCount: 0,
  });
}

describe('Kunden-Arbeitsbereich', () => {
  it('listet Kunden mit Kundencode, Preisgruppe, Erfüllung und Status', () => {
    const html = page();
    for (const text of ['Fiktives Café Nord', 'CAFEMORGEN', 'Gastronomie', 'Abholung', 'Aktiv']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/admin/customers/1"');
  });

  it('bietet den verständlichen Anlegeablauf mit PIN und CSRF an', () => {
    const html = page([]);
    expect(html).toContain('Neuer Kunde');
    expect(html).toContain('action="/api/admin/customers"');
    for (const field of [
      'csrf_token', 'name', 'customer_code', 'contact_person', 'email', 'phone',
      'delivery_street', 'delivery_postal_code', 'delivery_city', 'price_group',
      'fulfillment', 'pin', 'is_active', 'internal_note',
    ]) expect(html).toContain(`name="${field}"`);
  });

  it('zeigt Altbestände ohne Zugang oder Preisgruppe, statt sie zu verschweigen', () => {
    const html = page([{ ...CUSTOMER, customerCode: '', priceGroupCode: null }]);
    expect(html).toContain('Kein Kundencode');
    expect(html).toContain('Nicht zugeordnet');
  });

  it('zeigt keine Authentifizierungsinternas und kein bestehendes Geheimnis', () => {
    const html = page();
    for (const forbidden of ['credential_', 'token_hash', 'salt', 'verifier', 'pepper', 'account_id']) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('escapet dynamische Kundendaten', () => {
    const html = page([{ ...CUSTOMER, name: '<script>alert(1)</script>', customerCode: 'safe' }]);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it.each([
    ['customer_created', 'wurde angelegt'],
    ['customer_duplicate_code', 'bereits vergeben'],
    ['customer_invalid', 'nicht gespeichert'],
  ])('übersetzt Rückmeldung %s in Geschäftssprache', (code, message) => {
    expect(page([], code)).toContain(message);
  });

  it('spiegelt unbekannte Rückmeldungscodes nicht', () => {
    expect(page([], '"><script>alert(1)</script>')).not.toContain('alert(1)');
  });
});
