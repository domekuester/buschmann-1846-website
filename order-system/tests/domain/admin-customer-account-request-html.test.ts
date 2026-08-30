import { describe, expect, it } from 'vitest';
import {
  renderAdminCustomerAccountRequestDetailPage,
  renderAdminCustomerAccountRequestsPage,
} from '../../src/ui/admin-customer-account-request-html';

const request = {
  id: 17,
  name: 'Fiktive Konditorei',
  contactPerson: 'Erika Beispiel',
  email: 'anfrage@example.test',
  phone: '0211 123456',
  street: 'Teststraße 1',
  postalCode: '40213',
  city: 'Düsseldorf',
  message: 'Bitte melden Sie sich.',
  status: 'pending' as const,
  createdAt: '2026-08-30T08:00:00.000Z',
  updatedAt: '2026-08-30T08:00:00.000Z',
  processedAt: null,
  linkedCustomerName: null,
  rejectionNote: null,
};

const shell = { loginIdentifier: 'admin@example.test', csrfToken: 'csrf-test' };
const priceGroups = [
  { code: 'gastro', label: 'Gastronomie' },
  { code: 'private', label: 'Privatkunden' },
];

describe('Admin Kundenkonto-Anfragen HTML', () => {
  it('zeigt die scanbare Liste mit Pending-Zähler innerhalb von Kunden', () => {
    const html = renderAdminCustomerAccountRequestsPage({ ...shell, requests: [request], pendingCount: 1, noticeCode: null });
    expect(html).toContain('Kunden');
    expect(html).toContain('Anfragen');
    expect(html).toContain('1 offen');
    for (const value of ['Fiktive Konditorei', 'Erika Beispiel', 'anfrage@example.test', '0211 123456', 'Düsseldorf']) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('Anfrage #17');
  });

  it('zeigt im Detail alle Angaben escaped und den eingereichten Zeitpunkt', () => {
    const html = renderAdminCustomerAccountRequestDetailPage({
      ...shell, request: { ...request, message: '<script>alert(1)</script>' }, priceGroups, noticeCode: null,
    });
    expect(html).toContain('Fiktive Konditorei');
    expect(html).toContain('Teststraße 1');
    expect(html).toContain('40213');
    expect(html).toContain('30.08.2026');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('prefillt kompatible Kundendaten, verlangt aber Preisgruppe, Erfüllung, Kundencode und PIN', () => {
    const html = renderAdminCustomerAccountRequestDetailPage({ ...shell, request, priceGroups, noticeCode: null });
    expect(html).toContain('value="Fiktive Konditorei"');
    expect(html).toContain('value="anfrage@example.test"');
    expect(html).toContain('name="price_group" required');
    expect(html).toContain('name="fulfillment" required');
    expect(html).toContain('<option value="" selected disabled>Bitte auswählen</option>');
    expect(html).toContain('name="customer_code"');
    expect(html).toContain('name="pin"');
    expect(html).not.toMatch(/value="gastro" selected/);
    expect(html).not.toMatch(/value="delivery" selected/);
  });

  it('bietet Ablehnung und Übernahme nur für offene Anfragen an', () => {
    const pending = renderAdminCustomerAccountRequestDetailPage({ ...shell, request, priceGroups, noticeCode: null });
    const rejected = renderAdminCustomerAccountRequestDetailPage({
      ...shell,
      request: { ...request, status: 'rejected', processedAt: request.createdAt },
      priceGroups,
      noticeCode: null,
    });
    expect(pending).toContain('Als Kunde übernehmen');
    expect(pending).toContain('Ablehnen');
    expect(rejected).not.toContain('Als Kunde übernehmen');
    expect(rejected).not.toContain('action="/api/admin/customer-account-requests/17/reject"');
  });
});
