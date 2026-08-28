import { describe, expect, it } from 'vitest';
import { Address } from '../../src/domain/address';
import type { AdminCustomerView } from '../../src/domain/admin-customer';
import { renderAdminCustomerDetailPage } from '../../src/ui/admin-customer-detail-html';

const CUSTOMER: AdminCustomerView = {
  id: 7,
  name: 'Fiktives Café',
  customerCode: 'cafemorgen',
  contactPerson: 'Erika Beispiel',
  email: 'erika@example.test',
  phone: '0211 123456',
  deliveryAddress: new Address('Teststraße 1', '40213', 'Düsseldorf'),
  priceGroupCode: 'gastro',
  defaultFulfillment: 'delivery',
  isActive: true,
  internalNote: 'Hintereingang',
  updatedAt: '2026-08-28T10:00:00.000Z',
};

function page(noticeCode: string | null = null): string {
  return renderAdminCustomerDetailPage({
    loginIdentifier: 'admin@example.test', csrfToken: 'csrf-test', customer: CUSTOMER,
    orders: [], orderLimit: 10, noticeCode,
    priceGroups: [{ code: 'gastro', label: 'Gastronomie' }, { code: 'private', label: 'Privatkunden' }],
  });
}

describe('Kundendetail-Self-Service', () => {
  it('bietet alle freigegebenen Stammdaten atomar zum Bearbeiten an', () => {
    const html = page();
    expect(html).toContain('action="/api/admin/customers/7"');
    expect(html).toContain('name="expected_updated_at" value="2026-08-28T10:00:00.000Z"');
    for (const field of ['name', 'customer_code', 'contact_person', 'email', 'phone', 'delivery_street', 'delivery_postal_code', 'delivery_city', 'price_group', 'fulfillment', 'is_active', 'internal_note']) {
      expect(html).toContain(`name="${field}"`);
    }
  });

  it('vergibt eine PIN nur neu und verlangt eine bewusste Bestätigung', () => {
    const html = page();
    expect(html).toContain('Neue PIN vergeben');
    expect(html).toContain('action="/api/admin/customers/7/pin"');
    expect(html).toContain('name="confirm_pin" value="1"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).not.toContain('00123456');
  });

  it('zeigt Kontakt, Adresse und betriebliche Notiz, aber keine Auth-Internas', () => {
    const html = page();
    for (const expected of ['Erika Beispiel', 'erika@example.test', 'Teststraße 1', 'Hintereingang']) expect(html).toContain(expected);
    for (const forbidden of ['credential_', 'salt', 'verifier', 'failed_attempts', 'account_id']) expect(html.toLowerCase()).not.toContain(forbidden);
  });

  it.each([
    ['customer_saved', 'wurde gespeichert'],
    ['customer_conflict', 'zwischenzeitlich geändert'],
    ['pin_saved', 'PIN wurde neu vergeben'],
  ])('übersetzt %s kontrolliert', (code, text) => expect(page(code)).toContain(text));
});
