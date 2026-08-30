import { describe, expect, it } from 'vitest';
import { renderCustomerAccountRequestPage } from '../../src/ui/customer-account-request-html';

describe('Kundenkonto-Anfrage HTML', () => {
  it('rendert ein schlichtes, beschriftetes Formular mit den freigegebenen Feldern', () => {
    const html = renderCustomerAccountRequestPage({ values: {}, errors: {}, success: false });
    expect(html).toContain('<form method="post" action="/konto-anfragen"');
    for (const name of [
      'name', 'contact_person', 'email', 'phone', 'street', 'postal_code', 'city', 'message', 'website',
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('href="/datenschutz/"');
    expect(html).not.toContain('name="price');
    expect(html).not.toContain('name="fulfillment"');
    expect(html).not.toContain('Gastronomie');
  });

  it('kennzeichnet Pflichtfelder, Feldfehler und Längengrenzen', () => {
    const html = renderCustomerAccountRequestPage({
      values: { name: 'Fiktiv' }, errors: { email: 'Bitte E-Mail prüfen.' }, success: false,
    });
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Bitte E-Mail prüfen.');
    expect(html).toContain('maxlength="1000"');
    expect(html).toContain('required');
  });

  it('escaped zurückgespiegelte Werte und Fehler', () => {
    const html = renderCustomerAccountRequestPage({
      values: { name: '<script>alert(1)</script>' },
      errors: { name: '<img src=x onerror=alert(1)>' },
      success: false,
    });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('zeigt nach Erfolg nur die ruhige Bestätigung und kein Formular', () => {
    const html = renderCustomerAccountRequestPage({ values: {}, errors: {}, success: true });
    expect(html).toContain('<h1>Vielen Dank.</h1>');
    expect(html).toContain('Ihre Kundenanfrage ist bei Buschmann eingegangen.');
    expect(html).toContain('Wir prüfen Ihre Angaben und melden uns bei Ihnen.');
    expect(html).not.toContain('<form');
    expect(html).not.toMatch(/Stunden|Werktag|Antwortzeit/);
  });
});
