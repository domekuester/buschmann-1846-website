import { describe, expect, it } from 'vitest';
import { Order } from '../../src/domain/order';
import { OrderDraft } from '../../src/domain/order-draft';
import { OrderNumber } from '../../src/domain/order-number';
import { Customer } from '../../src/domain/customer';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';
import { Address } from '../../src/domain/address';
import { Money } from '../../src/domain/money';
import { DomainError, ValidationError } from '../../src/domain/errors';
import type { FulfillmentType } from '../../src/domain/fulfillment-type';

const now = new Date('2026-08-23T07:00:00Z');

function catalog(priceA = 435, priceB = 280, bActive = true): ProductCatalog {
  return ProductCatalog.fromList([
    new Product({ id: 1, name: 'Zitronen-Cheesecake', description: null, unitPrice: Money.fromCents(priceA), unit: 'Stück', isActive: true, sortOrder: 10 }),
    new Product({ id: 2, name: 'Butterkuchen', description: null, unitPrice: Money.fromCents(priceB), unit: 'Blech', isActive: bActive, sortOrder: 20 }),
  ]);
}

function customer(
  defaultFulfillment: FulfillmentType = 'delivery',
  withAddress = true,
  isActive = true,
): Customer {
  return new Customer({
    id: 7,
    name: 'Beispielcafé Nord',
    contactPerson: null,
    email: null,
    phone: null,
    deliveryAddress: withAddress ? new Address('Musterstraße 1', '40213', 'Düsseldorf') : null,
    isActive,
    defaultFulfillment,
    internalNote: null,
  });
}

function draft(overrides: Record<string, unknown> = {}): OrderDraft {
  return OrderDraft.fromInput(
    {
      fulfillment_type: 'delivery',
      fulfillment_date: '2026-08-28',
      items: [{ product_id: 1, quantity: 3 }],
      ...overrides,
    },
    now,
  );
}

function place(d = draft(), c = customer(), cat = catalog(), seq = 1): Order {
  return Order.place({
    customer: c,
    catalog: cat,
    draft: d,
    orderNumber: OrderNumber.fromYearAndSequence(2026, seq),
    now,
  });
}

function errorsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return { ...e.errors };
    throw e;
  }
  throw new Error('Es wurde keine ValidationError geworfen.');
}

describe('Order.place', () => {
  it('legt eine Bestellung mit Snapshots im Status new an', () => {
    const order = place();
    expect(order.orderNumber.value).toBe('BUS-2026-000001');
    expect(order.customerId).toBe(7);
    expect(order.customerNameSnapshot).toBe('Beispielcafé Nord');
    expect(order.status).toBe('new');
    expect(order.fulfillmentDate.value).toBe('2026-08-28');
    expect(order.deliveryAddressSnapshot).toBe('Musterstraße 1, 40213 Düsseldorf');
    expect(order.createdAt).toBe('2026-08-23T07:00:00.000Z');
    expect(order.updatedAt).toBe('2026-08-23T07:00:00.000Z');
  });

  /** Regel 6: Der Preis stammt aus dem Katalog, nicht aus der Eingabe. */
  it('nimmt den Preis aus dem Katalog', () => {
    const order = place();
    expect(order.items[0]?.unitPrice.cents).toBe(435);
    expect(order.total().cents).toBe(1305);
  });

  /** Regel 7 und 11: Ein mitgesendeter oder manipulierter Preis ändert nichts. */
  it('ignoriert Preise aus der Anfrage vollständig', () => {
    const manipulated = draft({
      items: [{ product_id: 1, quantity: 3, unit_price_cents: 1, line_total_cents: 3 }],
      total_amount_cents: 3,
    });
    const order = place(manipulated);
    expect(order.total().cents).toBe(1305);
    expect(order.items[0]?.unitPrice.cents).toBe(435);
  });

  /** Regel 9: Mehrere Positionen werden exakt summiert. */
  it('summiert mehrere Positionen korrekt', () => {
    const order = place(draft({ items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 7 }] }));
    expect(order.items).toHaveLength(2);
    expect(order.items[0]?.lineTotal.cents).toBe(1305);
    expect(order.items[1]?.lineTotal.cents).toBe(1960);
    expect(order.total().cents).toBe(3265);
  });

  /** Regel 10 im Zusammenspiel: viele krumme Beträge, kein Rundungsfehler. */
  it('summiert viele krumme Beträge ohne Abweichung', () => {
    const odd = ProductCatalog.fromList([
      new Product({ id: 1, name: 'A', description: null, unitPrice: Money.fromCents(7), unit: 'Stück', isActive: true, sortOrder: 1 }),
      new Product({ id: 2, name: 'B', description: null, unitPrice: Money.fromCents(10), unit: 'Stück', isActive: true, sortOrder: 2 }),
      new Product({ id: 3, name: 'C', description: null, unitPrice: Money.fromCents(20), unit: 'Stück', isActive: true, sortOrder: 3 }),
    ]);
    const order = place(
      draft({ items: [{ product_id: 1, quantity: 100 }, { product_id: 2, quantity: 3 }, { product_id: 3, quantity: 3 }] }),
      customer(),
      odd,
    );
    expect(order.total().cents).toBe(790);
    expect(order.total().toDecimalString()).toBe('7.90');
  });

  /** Regel 8: Eine Preisänderung wirkt nicht rückwirkend. */
  it('hält den Preis-Snapshot nach einer Preisänderung fest', () => {
    const order = place();
    expect(order.total().cents).toBe(1305);

    const teurer = catalog(500);
    expect(teurer.get(1).unitPrice.cents).toBe(500);

    expect(order.total().cents).toBe(1305);
    expect(order.items[0]?.unitPrice.cents).toBe(435);

    expect(place(draft(), customer(), teurer, 2).total().cents).toBe(1500);
  });

  it('hält den Namens-Snapshot nach einer Umbenennung fest', () => {
    const order = place();
    const umbenannt = new Customer({
      id: 7, name: 'Beispielcafé Neuer Name', contactPerson: null, email: null, phone: null,
      deliveryAddress: new Address('Musterstraße 1', '40213', 'Düsseldorf'),
      isActive: true, defaultFulfillment: 'delivery', internalNote: null,
    });
    expect(order.customerNameSnapshot).toBe('Beispielcafé Nord');
    expect(umbenannt.name).toBe('Beispielcafé Neuer Name');
  });

  /** Regel 3: Inaktive Produkte dürfen nicht neu bestellt werden. */
  it('lehnt inaktive Produkte ab', () => {
    const errors = errorsOf(() =>
      place(draft({ items: [{ product_id: 2, quantity: 1 }] }), customer(), catalog(435, 280, false)),
    );
    expect(errors).toHaveProperty('items.0.product_id');
  });

  /** Aber: Ein inaktives Produkt bleibt in einer bestehenden Bestellung sichtbar. */
  it('lässt eine bestehende Bestellung mit deaktiviertem Produkt unberührt', () => {
    const order = place(draft({ items: [{ product_id: 2, quantity: 4 }] }));
    const ohne = catalog(435, 280, false);
    expect(ohne.get(2).isActive).toBe(false);
    expect(ohne.orderable()).toHaveLength(1);

    expect(order.items[0]?.productNameSnapshot).toBe('Butterkuchen');
    expect(order.items[0]?.productUnitSnapshot).toBe('Blech');
    expect(order.total().cents).toBe(1120);
  });

  it('lehnt unbekannte Produkte ab', () => {
    const errors = errorsOf(() => place(draft({ items: [{ product_id: 999, quantity: 1 }] })));
    expect(errors).toHaveProperty('items.0.product_id');
  });

  it('meldet alle Produktprobleme auf einmal', () => {
    const errors = errorsOf(() =>
      place(
        draft({ items: [{ product_id: 999, quantity: 1 }, { product_id: 2, quantity: 1 }] }),
        customer(),
        catalog(435, 280, false),
      ),
    );
    expect(Object.keys(errors)).toHaveLength(2);
  });

  it('lässt inaktive Kunden nicht bestellen', () => {
    expect(errorsOf(() => place(draft(), customer('delivery', true, false)))).toHaveProperty('customer');
  });

  it('lehnt eine Lieferung ohne hinterlegte Adresse ab', () => {
    expect(errorsOf(() => place(draft(), customer('pickup', false)))).toHaveProperty('fulfillment_type');
  });

  it('führt bei Abholung keine Adresse mit', () => {
    const order = place(draft({ fulfillment_type: 'pickup' }), customer('pickup', false), catalog(), 2);
    expect(order.fulfillmentType).toBe('pickup');
    expect(order.deliveryAddressSnapshot).toBeNull();
  });

  /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
  it('lässt eine Bestellung ohne Positionen nicht entstehen', () => {
    expect(() => draft({ items: [] })).toThrow(ValidationError);
  });
});

describe('Order-Status', () => {
  it('folgt dem erlaubten Weg', () => {
    const later = new Date('2026-08-23T08:00:00Z');
    const order = place().withStatus('confirmed', later);
    expect(order.status).toBe('confirmed');
    expect(order.updatedAt).toBe('2026-08-23T08:00:00.000Z');
    expect(order.createdAt).toBe('2026-08-23T07:00:00.000Z');
    expect(order.total().cents).toBe(1305);
  });

  it('lehnt unerlaubte Statuswechsel ab', () => {
    const order = place();
    expect(() => order.withStatus('completed', now)).toThrow(DomainError);
    const storniert = order.withStatus('cancelled', now);
    expect(() => storniert.withStatus('in_production', now)).toThrow(DomainError);
  });

  it('lässt das Original beim Statuswechsel unberührt', () => {
    const order = place();
    const bestaetigt = order.withStatus('confirmed', now);
    expect(order.status).toBe('new');
    expect(bestaetigt.status).toBe('confirmed');
  });
});
