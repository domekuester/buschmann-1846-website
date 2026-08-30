import { describe, expect, it } from 'vitest';
import {
  hasFilledAccountRequestHoneypot,
  parseCustomerAccountRequest,
} from '../../src/domain/customer-account-request';
import { ValidationError } from '../../src/domain/errors';

const valid = () => ({
  name: '  Fiktive Konditorei  ',
  contactPerson: '  Erika Beispiel ',
  email: '  ANFRAGE@EXAMPLE.TEST ',
  phone: '  0211 123456 ',
  street: '  Teststraße 1 ',
  postalCode: ' 40213 ',
  city: ' Düsseldorf ',
  message: '  Bitte melden Sie sich. ',
});

describe('Kundenkonto-Anfrage', () => {
  it('trimmt Angaben und normalisiert die E-Mail kleingeschrieben', () => {
    expect(parseCustomerAccountRequest(valid())).toEqual({
      name: 'Fiktive Konditorei',
      contactPerson: 'Erika Beispiel',
      email: 'anfrage@example.test',
      phone: '0211 123456',
      street: 'Teststraße 1',
      postalCode: '40213',
      city: 'Düsseldorf',
      message: 'Bitte melden Sie sich.',
    });
  });

  it('verlangt Name, E-Mail und Telefon und prüft das E-Mail-Format', () => {
    for (const [input, field] of [
      [{ ...valid(), name: '' }, 'name'],
      [{ ...valid(), email: '' }, 'email'],
      [{ ...valid(), email: 'keine-adresse' }, 'email'],
      [{ ...valid(), phone: '' }, 'phone'],
    ] as const) {
      expect(() => parseCustomerAccountRequest(input)).toThrow(ValidationError);
      try {
        parseCustomerAccountRequest(input);
      } catch (error) {
        expect((error as ValidationError).hasError(field)).toBe(true);
      }
    }
  });

  it('setzt leere optionale Angaben auf null', () => {
    expect(parseCustomerAccountRequest({
      ...valid(), contactPerson: '', street: '', postalCode: '', city: '', message: '',
    })).toMatchObject({
      contactPerson: null, street: null, postalCode: null, city: null, message: null,
    });
  });

  it.each([
    ['name', 121],
    ['contactPerson', 121],
    ['email', 191],
    ['phone', 41],
    ['street', 161],
    ['postalCode', 11],
    ['city', 101],
    ['message', 1001],
  ] as const)('lehnt %s oberhalb der Feldgrenze ab', (field, length) => {
    expect(() => parseCustomerAccountRequest({ ...valid(), [field]: 'x'.repeat(length) }))
      .toThrow(ValidationError);
  });

  it('nimmt keine Preis- oder Erfüllungsautorität aus öffentlichen Angaben an', () => {
    const publicInput = {
      ...valid(), priceGroup: 'gastro', fulfillment: 'delivery', priceCents: '1',
    };
    const parsed = parseCustomerAccountRequest(publicInput);
    expect(parsed).not.toHaveProperty('priceGroup');
    expect(parsed).not.toHaveProperty('fulfillment');
    expect(parsed).not.toHaveProperty('priceCents');
  });

  it('erkennt nur ein tatsächlich befülltes Honeypot-Feld', () => {
    expect(hasFilledAccountRequestHoneypot('')).toBe(false);
    expect(hasFilledAccountRequestHoneypot('   ')).toBe(false);
    expect(hasFilledAccountRequestHoneypot('https://spam.test')).toBe(true);
    expect(hasFilledAccountRequestHoneypot(null)).toBe(true);
  });
});
