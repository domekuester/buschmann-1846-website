import { describe, expect, it } from 'vitest';
import { parseAdminCustomerInput, parseCustomerPin } from '../../src/domain/admin-customer';
import { ValidationError } from '../../src/domain/errors';

const valid = () => ({
  name: 'Fiktives Café',
  customerCode: 'CAFE-MORGEN',
  contactPerson: 'Erika Beispiel',
  email: 'erika@example.test',
  phone: '0211 123456',
  deliveryStreet: 'Teststraße 1',
  deliveryPostalCode: '40213',
  deliveryCity: 'Düsseldorf',
  priceGroup: 'gastro',
  fulfillment: 'delivery',
  isActive: '1',
  internalNote: 'Lieferung an der Rückseite',
});

describe('Admin-Kundenangaben', () => {
  it('liest und normalisiert sichere Geschäftsfelder', () => {
    expect(parseAdminCustomerInput(valid())).toMatchObject({
      name: 'Fiktives Café', customerCode: 'cafe-morgen',
      contactPerson: 'Erika Beispiel', email: 'erika@example.test',
      phone: '0211 123456', priceGroupCode: 'gastro',
      defaultFulfillment: 'delivery', isActive: true,
      deliveryAddress: { street: 'Teststraße 1', postalCode: '40213', city: 'Düsseldorf' },
    });
  });

  it('erlaubt Abholung ohne Lieferadresse', () => {
    expect(parseAdminCustomerInput({
      ...valid(), fulfillment: 'pickup',
      deliveryStreet: '', deliveryPostalCode: '', deliveryCity: '',
    }).deliveryAddress).toBeNull();
  });

  it.each([
    [{ ...valid(), name: '' }, 'name'],
    [{ ...valid(), customerCode: 'Café mit Leerzeichen' }, 'customer_code'],
    [{ ...valid(), email: 'keine-adresse' }, 'email'],
    [{ ...valid(), priceGroup: 'vip' }, 'price_group'],
    [{ ...valid(), fulfillment: 'delivery', deliveryStreet: '' }, 'delivery_address'],
    [{ ...valid(), fulfillment: 'versand' }, 'fulfillment'],
  ])('lehnt ungültige Kundendaten kontrolliert ab', (input, field) => {
    try {
      parseAdminCustomerInput(input);
      throw new Error('ValidationError erwartet');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).hasError(field)).toBe(true);
    }
  });

  it('akzeptiert nur eine neue PIN mit genau acht Ziffern', () => {
    expect(parseCustomerPin('00123456')).toBe('00123456');
    for (const invalid of ['1234567', '123456789', 'abcdefgh', '1234 5678']) {
      expect(() => parseCustomerPin(invalid)).toThrow(ValidationError);
    }
  });
});
