import { describe, expect, it } from 'vitest';
import { Customer } from '../../src/domain/customer';
import { Address } from '../../src/domain/address';
import { InvalidArgumentError } from '../../src/domain/errors';

const address = () => new Address('Musterstraße 1', '40213', 'Düsseldorf');

function customer(overrides: Partial<ConstructorParameters<typeof Customer>[0]> = {}): Customer {
  return new Customer({
    id: 1,
    name: 'Beispielcafé Nord',
    contactPerson: null,
    email: null,
    phone: null,
    deliveryAddress: address(),
    isActive: true,
    defaultFulfillment: 'delivery',
    internalNote: null,
    ...overrides,
  });
}

describe('Customer', () => {
  it('behält seine Daten', () => {
    const c = customer({ contactPerson: 'Beispielperson', phone: '0211 1234567' });
    expect(c.id).toBe(1);
    expect(c.name).toBe('Beispielcafé Nord');
    expect(c.contactPerson).toBe('Beispielperson');
    expect(c.phone).toBe('0211 1234567');
    expect(c.defaultFulfillment).toBe('delivery');
  });

  /** Datenminimierung: Nur der Kundenname ist Pflicht. */
  it('verlangt einzig den Namen', () => {
    const c = customer({ deliveryAddress: null, defaultFulfillment: 'pickup' });
    expect(c.name).toBe('Beispielcafé Nord');
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.deliveryAddress).toBeNull();
  });

  it('verlangt einen Namen', () => {
    expect(() => customer({ name: '   ' })).toThrow(InvalidArgumentError);
    expect(() => customer({ name: 'a'.repeat(121) })).toThrow(InvalidArgumentError);
  });

  /** Invariante: Wer standardmäßig beliefert wird, braucht eine Lieferadresse. */
  it('verlangt bei Standardlieferung eine Adresse', () => {
    expect(() => customer({ defaultFulfillment: 'delivery', deliveryAddress: null })).toThrow(
      InvalidArgumentError,
    );
  });

  /** Umgekehrt ist eine Adresse bei einem Abholkunden kein Widerspruch. */
  it('erlaubt einem Abholkunden trotzdem eine Adresse', () => {
    const c = customer({ defaultFulfillment: 'pickup', deliveryAddress: address() });
    expect(c.deliveryAddress).not.toBeNull();
    expect(c.canBeDeliveredTo()).toBe(true);
  });

  it('weiß, ob eine Lieferung möglich ist', () => {
    expect(customer({ defaultFulfillment: 'pickup', deliveryAddress: null }).canBeDeliveredTo()).toBe(false);
  });

  it('lehnt fehlerhafte E-Mail-Adressen ab', () => {
    for (const bad of ['keine-adresse', 'a@', '@b.de', 'a b@c.de', 'a@b']) {
      expect(() => customer({ email: bad })).toThrow(InvalidArgumentError);
    }
    expect(customer({ email: ' kontakt@example.org ' }).email).toBe('kontakt@example.org');
  });

  it('macht aus leeren optionalen Feldern null', () => {
    const c = customer({ contactPerson: '  ', phone: '', internalNote: '   ' });
    expect(c.contactPerson).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.internalNote).toBeNull();
  });

  it('begrenzt die optionalen Felder in der Länge', () => {
    expect(() => customer({ contactPerson: 'a'.repeat(121) })).toThrow(InvalidArgumentError);
    expect(() => customer({ phone: '1'.repeat(41) })).toThrow(InvalidArgumentError);
    expect(() => customer({ internalNote: 'a'.repeat(1001) })).toThrow(InvalidArgumentError);
    expect(() => customer({ email: `${'a'.repeat(190)}@example.org` })).toThrow(InvalidArgumentError);
  });

  it('verlangt eine positive ID', () => {
    for (const id of [0, -1, 2.5]) {
      expect(() => customer({ id })).toThrow(InvalidArgumentError);
    }
  });
});
