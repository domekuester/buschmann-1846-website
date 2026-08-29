import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseAdminProductInput } from '../../src/domain/admin-product';

const valid = () => ({
  name: 'Fiktiver Käsekuchen',
  unit: '26 cm Ring',
  isActive: '1',
  gastroPriceType: 'fixed',
  gastroPrice: '24,00',
  gastroMaxPrice: '',
  privatePriceType: 'fixed',
  privatePrice: '42,00',
  privateMaxPrice: '',
  unitCost: '8,50',
});

describe('Admin-Produktangaben', () => {
  it('liest exakte Preise und Herstellkosten als ganzzahlige Cent', () => {
    expect(parseAdminProductInput(valid())).toMatchObject({
      name: 'Fiktiver Käsekuchen',
      unit: '26 cm Ring',
      isActive: true,
      gastroPrice: { type: 'fixed', priceCents: 2400 },
      privatePrice: { type: 'fixed', priceCents: 4200 },
      unitCostCents: 850,
    });
  });

  it('bewahrt Ab-Preis, Preisspanne, Anfrage und fehlenden Preis als verschiedene Zustände', () => {
    expect(parseAdminProductInput({
      ...valid(),
      gastroPriceType: 'from',
      gastroPrice: '20',
      privatePriceType: 'range',
      privatePrice: '35',
      privateMaxPrice: '45,50',
      isActive: '',
    })).toMatchObject({
      isActive: false,
      gastroPrice: { type: 'from', minPriceCents: 2000 },
      privatePrice: { type: 'range', minPriceCents: 3500, maxPriceCents: 4550 },
    });

    expect(parseAdminProductInput({
      ...valid(),
      gastroPriceType: 'on_request',
      gastroPrice: '',
      privatePriceType: 'none',
      privatePrice: '',
      isActive: '',
    })).toMatchObject({ gastroPrice: { type: 'on_request' }, privatePrice: null });
  });

  it.each([
    [{ ...valid(), name: '' }, 'name'],
    [{ ...valid(), unit: '' }, 'unit'],
    [{ ...valid(), gastroPriceType: 'fixed', gastroPrice: '' }, 'gastro_price'],
    [{ ...valid(), gastroPriceType: 'bogus' }, 'gastro_price_type'],
    [{ ...valid(), privatePriceType: 'range', privatePrice: '50', privateMaxPrice: '40' }, 'private_price'],
    [{ ...valid(), unitCost: '-1' }, 'unit_cost'],
  ])('lehnt ungültige Angaben kontrolliert ab, ohne sie zu deuten', (input, field) => {
    try {
      parseAdminProductInput(input);
      throw new Error('ValidationError erwartet');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).hasError(field)).toBe(true);
    }
  });

  it('macht ein Produkt ohne exakten Preis inaktiv statt Bestellbarkeit zu erfinden', () => {
    const parsed = parseAdminProductInput({
      ...valid(),
      gastroPriceType: 'from',
      gastroPrice: '20',
      privatePriceType: 'on_request',
      privatePrice: '',
    });

    expect(parsed.isActive).toBe(false);
  });
});
