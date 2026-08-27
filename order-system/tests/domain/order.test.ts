import { describe, expect, it } from 'vitest';
import { Order } from '../../src/domain/order';
import { OrderItem } from '../../src/domain/order-item';
import { FulfillmentDate } from '../../src/domain/fulfillment-date';
import { OrderDraft } from '../../src/domain/order-draft';
import { OrderNumber } from '../../src/domain/order-number';
import { Customer } from '../../src/domain/customer';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';
import { Address } from '../../src/domain/address';
import { Money } from '../../src/domain/money';
import { CustomerPriceBook } from '../../src/domain/order-pricing';
import { ProductCostBook } from '../../src/domain/product-cost';
import type { CatalogPrice } from '../../src/domain/catalog-pricing';
import { DomainError, ValidationError } from '../../src/domain/errors';
import type { FulfillmentType } from '../../src/domain/fulfillment-type';

const now = new Date('2026-08-23T07:00:00Z');

function catalog(bActive = true): ProductCatalog {
  return ProductCatalog.fromList([
    new Product({ id: 1, name: 'Zitronen-Cheesecake', description: null, unit: 'Stück', isActive: true, sortOrder: 10 }),
    new Product({ id: 2, name: 'Butterkuchen', description: null, unit: 'Blech', isActive: bActive, sortOrder: 20 }),
  ]);
}

/**
 * Die Preise stehen ab Phase 5C NICHT mehr am Produkt, sondern in der
 * Preiswelt des Kunden. Dass diese Testdatei sie getrennt übergeben MUSS, ist
 * kein Umstand, sondern die Aussage: Ein Produkt trägt keinen Preis mehr, den
 * jemand versehentlich verwenden könnte.
 */
function priceBook(priceA: number | CatalogPrice = 435, priceB: number | CatalogPrice = 280): CustomerPriceBook {
  const toPrice = (v: number | CatalogPrice): CatalogPrice =>
    typeof v === 'number' ? { type: 'fixed', priceCents: v } : v;
  return CustomerPriceBook.forPriceList(1, new Map<number, CatalogPrice>([
    [1, toPrice(priceA)],
    [2, toPrice(priceB)],
  ]));
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

function place(
  d = draft(),
  c = customer(),
  cat = catalog(),
  seq = 1,
  prices = priceBook(),
  costs = ProductCostBook.empty(),
): Order {
  return Order.place({
    customer: c,
    catalog: cat,
    priceBook: prices,
    costBook: costs,
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
      new Product({ id: 1, name: 'A', description: null, unit: 'Stück', isActive: true, sortOrder: 1 }),
      new Product({ id: 2, name: 'B', description: null, unit: 'Stück', isActive: true, sortOrder: 2 }),
      new Product({ id: 3, name: 'C', description: null, unit: 'Stück', isActive: true, sortOrder: 3 }),
    ]);
    const oddPrices = CustomerPriceBook.forPriceList(1, new Map<number, CatalogPrice>([
      [1, { type: 'fixed', priceCents: 7 }],
      [2, { type: 'fixed', priceCents: 10 }],
      [3, { type: 'fixed', priceCents: 20 }],
    ]));
    const order = place(
      draft({ items: [{ product_id: 1, quantity: 100 }, { product_id: 2, quantity: 3 }, { product_id: 3, quantity: 3 }] }),
      customer(),
      odd,
      1,
      oddPrices,
    );
    expect(order.total().cents).toBe(790);
    expect(order.total().toDecimalString()).toBe('7.90');
  });

  /** Regel 8: Eine Preisänderung wirkt nicht rückwirkend. */
  it('hält den Preis-Snapshot nach einer Preisänderung fest', () => {
    const order = place();
    expect(order.total().cents).toBe(1305);

    const teurer = priceBook(500);

    expect(order.total().cents).toBe(1305);
    expect(order.items[0]?.unitPrice.cents).toBe(435);

    expect(place(draft(), customer(), catalog(), 2, teurer).total().cents).toBe(1500);
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
      place(draft({ items: [{ product_id: 2, quantity: 1 }] }), customer(), catalog(false)),
    );
    expect(errors).toHaveProperty('items.0.product_id');
  });

  /** Aber: Ein inaktives Produkt bleibt in einer bestehenden Bestellung sichtbar. */
  it('lässt eine bestehende Bestellung mit deaktiviertem Produkt unberührt', () => {
    const order = place(draft({ items: [{ product_id: 2, quantity: 4 }] }));
    const ohne = catalog(false);
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
        catalog(false),
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

  /**
   * PHASE 5C: DER PREIS KOMMT AUS DER PREISWELT DES KUNDEN.
   *
   * Diese Tests sind die Domänenseite von §22 des Auftrags. Sie prüfen nicht,
   * dass ein Preis „richtig übernommen" wird, sondern dass es für jeden
   * Zustand außer `fixed` KEINEN Weg in eine Bestellung gibt.
   */
  describe('Preisauflösung', () => {
    it('bepreist dasselbe Produkt je Preisliste unterschiedlich', () => {
      const gastro = place(draft(), customer(), catalog(), 1, priceBook(1000));
      const privat = place(draft(), customer(), catalog(), 2, priceBook(1500));

      expect(gastro.items[0]?.unitPrice.cents).toBe(1000);
      expect(gastro.total().cents).toBe(3000);
      expect(privat.items[0]?.unitPrice.cents).toBe(1500);
      expect(privat.total().cents).toBe(4500);
    });

    it('lässt einen Kunden ohne Preisgruppe nicht bestellen', () => {
      const errors = errorsOf(() =>
        place(draft(), customer(), catalog(), 1, CustomerPriceBook.unassigned()),
      );

      expect(errors).toHaveProperty('price_list');
      // Kein Positionsfehler: Das Problem liegt am Kunden, nicht am Produkt.
      expect(Object.keys(errors)).toEqual(['price_list']);
    });

    it('lässt einen Kunden mit stillgelegter Preisgruppe nicht bestellen', () => {
      const errors = errorsOf(() =>
        place(draft(), customer(), catalog(), 1, CustomerPriceBook.inactive(1)),
      );

      expect(errors).toHaveProperty('price_list');
    });

    it('fällt bei fehlendem Katalogpreis NICHT auf einen anderen Preis zurück', () => {
      const ohnePreis = CustomerPriceBook.forPriceList(1, new Map());
      const errors = errorsOf(() => place(draft(), customer(), catalog(), 1, ohnePreis));

      expect(errors).toHaveProperty('items.0.product_id');
    });

    it('macht aus „ab 55,00 €" keine Bestellung über 55,00 €', () => {
      const errors = errorsOf(() =>
        place(draft(), customer(), catalog(), 1, priceBook({ type: 'from', minPriceCents: 5500 })),
      );

      expect(errors).toHaveProperty('items.0.product_id');
    });

    it('macht aus einer Preisspanne keine Bestellung', () => {
      const errors = errorsOf(() =>
        place(
          draft(),
          customer(),
          catalog(),
          1,
          priceBook({ type: 'range', minPriceCents: 5500, maxPriceCents: 7500 }),
        ),
      );

      expect(errors).toHaveProperty('items.0.product_id');
    });

    it('macht aus „auf Anfrage" keine Bestellung', () => {
      const errors = errorsOf(() =>
        place(draft(), customer(), catalog(), 1, priceBook({ type: 'on_request' })),
      );

      expect(errors).toHaveProperty('items.0.product_id');
    });

    /**
     * §30: EINE GEMISCHTE BESTELLUNG WIRD NICHT HALB ANGENOMMEN.
     *
     * Vier gültige Positionen und eine ungültige ergeben keine Bestellung mit
     * vier Positionen. Das Aggregat entsteht gar nicht erst — es gibt keinen
     * Zwischenzustand, den jemand speichern könnte.
     */
    it('nimmt eine gemischte Bestellung nicht teilweise an', () => {
      const gemischt = priceBook(1000, { type: 'on_request' });
      const errors = errorsOf(() =>
        place(
          draft({ items: [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 3 }] }),
          customer(),
          catalog(),
          1,
          gemischt,
        ),
      );

      expect(errors).toHaveProperty('items.1.product_id');
      expect(errors).not.toHaveProperty('items.0.product_id');
    });

    it('meldet mehrere nicht bepreisbare Positionen auf einmal', () => {
      const keine = CustomerPriceBook.forPriceList(1, new Map());
      const errors = errorsOf(() =>
        place(
          draft({ items: [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 3 }] }),
          customer(),
          catalog(),
          1,
          keine,
        ),
      );

      expect(Object.keys(errors).sort()).toEqual(['items.0.product_id', 'items.1.product_id']);
    });

    /** §31: Menge mal Preis darf nicht still überlaufen. */
    it('lässt einen Positionsbetrag jenseits der Geldgrenze nicht entstehen', () => {
      expect(() =>
        place(
          draft({ items: [{ product_id: 1, quantity: 9999 }] }),
          customer(),
          catalog(),
          1,
          priceBook(9_999_999),
        ),
      ).toThrow();
    });
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

describe('Order.restore', () => {
  const items = [
    new OrderItem({
      productId: 1,
      productNameSnapshot: 'Zitronen-Cheesecake',
      productUnitSnapshot: 'Stück',
      unitPrice: Money.fromCents(435),
      quantity: 3,
      unitCost: null,
    }),
  ];

  function restored(overrides: Record<string, unknown> = {}) {
    return Order.restore({
      orderNumber: OrderNumber.fromString('BUS-2026-000001'),
      customerId: 7,
      customerNameSnapshot: 'Beispielcafé Nord',
      fulfillmentType: 'delivery',
      fulfillmentDate: FulfillmentDate.restore('2020-01-01'),
      deliveryAddressSnapshot: 'Musterstraße 1, 40213 Düsseldorf',
      note: null,
      status: 'completed',
      items,
      createdAt: '2020-01-01T07:00:00.000Z',
      updatedAt: '2020-01-02T07:00:00.000Z',
      ...overrides,
    } as Parameters<typeof Order.restore>[0]);
  }

  /**
   * Laden ist nicht Bestellen. Eine abgeschlossene Bestellung von 2020 muss
   * sich lesen lassen, ohne dass die Regeln des Bestellvorgangs erneut
   * greifen — sonst wäre keine historische Bestellung mehr aufrufbar.
   */
  it('nimmt einen vergangenen Tag und einen Endstatus an', () => {
    const order = restored();
    expect(order.status).toBe('completed');
    expect(order.fulfillmentDate.value).toBe('2020-01-01');
    expect(order.total().cents).toBe(1305);
    expect(order.updatedAt).toBe('2020-01-02T07:00:00.000Z');
  });

  /** Die Invarianten des Aggregats gelten aber weiterhin. */
  it('lässt sich keine ungültige Bestellung unterschieben', () => {
    expect(() => restored({ items: [] })).toThrow();
    expect(() => restored({ deliveryAddressSnapshot: null })).toThrow();
    expect(() => restored({ customerId: 0 })).toThrow();
  });
});
