import { describe, expect, it } from 'vitest';
import { Address } from '../../src/domain/address';
import type { CatalogPrice } from '../../src/domain/catalog-pricing';
import { Customer } from '../../src/domain/customer';
import { Money } from '../../src/domain/money';
import { Order } from '../../src/domain/order';
import { OrderDraft } from '../../src/domain/order-draft';
import { OrderItem } from '../../src/domain/order-item';
import { OrderNumber } from '../../src/domain/order-number';
import { CustomerPriceBook } from '../../src/domain/order-pricing';
import { Product } from '../../src/domain/product';
import { ProductCatalog } from '../../src/domain/product-catalog';
import { ProductCostBook } from '../../src/domain/product-cost';

/**
 * Der Kostenschnappschuss in der DOMÄNE — §16 des Auftrags.
 *
 * Hier steht keine Datenbank und keine HTTP-Schicht. Geprüft wird die Regel
 * selbst: Eine Position übernimmt die Herstellkosten beim ENTSTEHEN, sie
 * schlägt sie nie nach, und ein fehlender Wert bleibt ein fehlender Wert.
 *
 * ALLE NAMEN UND BETRÄGE SIND FREI ERFUNDEN.
 */

const now = new Date('2026-08-26T07:00:00Z');

function catalog(): ProductCatalog {
  return ProductCatalog.fromList([
    new Product({ id: 1, name: 'Fiktiver Käsekuchen', description: null, unit: 'Stück', isActive: true, sortOrder: 10 }),
    new Product({ id: 2, name: 'Fiktiver Butterkuchen', description: null, unit: 'Blech', isActive: true, sortOrder: 20 }),
  ]);
}

function priceBook(): CustomerPriceBook {
  return CustomerPriceBook.forPriceList(1, new Map<number, CatalogPrice>([
    [1, { type: 'fixed', priceCents: 520 }],
    [2, { type: 'fixed', priceCents: 2400 }],
  ]));
}

function costBook(entries: ReadonlyArray<readonly [number, number]>): ProductCostBook {
  return ProductCostBook.fromCosts(new Map(entries.map(([id, c]) => [id, Money.fromCents(c)])));
}

function customer(): Customer {
  return new Customer({
    id: 7,
    name: 'Fiktives Café Nord',
    contactPerson: null,
    email: null,
    phone: null,
    deliveryAddress: new Address('Fiktivstraße 1', '40213', 'Düsseldorf'),
    isActive: true,
    defaultFulfillment: 'pickup',
    internalNote: null,
  });
}

function draft(items: ReadonlyArray<{ product_id: number; quantity: number }>): OrderDraft {
  return OrderDraft.fromInput(
    { fulfillment_type: 'pickup', fulfillment_date: '2026-08-28', items },
    now,
  );
}

function place(
  costs: ProductCostBook,
  items: ReadonlyArray<{ product_id: number; quantity: number }> = [{ product_id: 1, quantity: 3 }],
): Order {
  return Order.place({
    customer: customer(),
    catalog: catalog(),
    priceBook: priceBook(),
    costBook: costs,
    draft: draft(items),
    orderNumber: OrderNumber.fromYearAndSequence(2026, 1),
    now,
  });
}

describe('OrderItem — der Kostenschnappschuss', () => {
  /** §16.9 */
  it('übernimmt die Herstellkosten der Preisauflösung', () => {
    const item = OrderItem.forProduct(
      catalog().get(1), Money.fromCents(520), 3, Money.fromCents(210),
    );
    expect(item.unitCostSnapshot?.cents).toBe(210);
  });

  /** §16.10 — kein gepflegter Wert bleibt kein Wert. */
  it('bleibt ohne Herstellkosten null und wird nicht 0', () => {
    const item = OrderItem.forProduct(catalog().get(1), Money.fromCents(520), 3, null);
    expect(item.unitCostSnapshot).toBeNull();
  });

  it('übernimmt gepflegte 0 € als Betrag und nicht als „nichts gepflegt"', () => {
    const item = OrderItem.forProduct(
      catalog().get(1), Money.fromCents(520), 3, Money.fromCents(0),
    );
    expect(item.unitCostSnapshot?.cents).toBe(0);
  });

  /**
   * §16.14 — DER VERKAUFSPREIS BLEIBT, WAS ER WAR. Die Herstellkosten stehen
   * neben ihm und rechnen ihn nicht um; der Positionsbetrag hängt an keiner
   * Kostenangabe.
   */
  it('lässt Verkaufspreis und Positionsbetrag unberührt', () => {
    const ohne = OrderItem.forProduct(catalog().get(1), Money.fromCents(520), 3, null);
    const mit = OrderItem.forProduct(
      catalog().get(1), Money.fromCents(520), 3, Money.fromCents(210),
    );

    expect(ohne.unitPrice.cents).toBe(520);
    expect(mit.unitPrice.cents).toBe(520);
    expect(ohne.lineTotal.cents).toBe(1560);
    expect(mit.lineTotal.cents).toBe(1560);
  });

  /**
   * DIE POSITION KANN DIE KOSTEN NICHT NACHSCHLAGEN — sie kennt weder
   * Kostenbuch noch Datenbank. Der Snapshot ist damit endgültig, sobald die
   * Position existiert.
   */
  it('trägt den Wert unveränderlich', () => {
    const item = OrderItem.forProduct(
      catalog().get(1), Money.fromCents(520), 3, Money.fromCents(210),
    );
    const zweiter = OrderItem.forProduct(
      catalog().get(1), Money.fromCents(520), 3, Money.fromCents(999),
    );

    expect(item.unitCostSnapshot?.cents).toBe(210);
    expect(zweiter.unitCostSnapshot?.cents).toBe(999);
  });
});

describe('Order.place — die Kostenquelle', () => {
  /** §16.9 */
  it('schreibt den Kostenwert aus dem Kostenbuch in die Position', () => {
    const order = place(costBook([[1, 210]]));
    expect(order.items[0]?.unitCostSnapshot?.cents).toBe(210);
  });

  /** §16.10 und §9 — fehlende Kosten lassen die Bestellung NICHT scheitern. */
  it('bestellt auch ohne gepflegte Herstellkosten', () => {
    const order = place(ProductCostBook.empty());

    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.unitCostSnapshot).toBeNull();
    expect(order.total().cents).toBe(1560);
  });

  /**
   * §13 — DIE KOSTEN ÄNDERN AM BETRAG NICHTS. Zwei Bestellungen mit
   * identischen Positionen und verschiedenen Kostenwerten haben denselben
   * Verkaufsbetrag.
   */
  it('lässt die Bestellsumme von den Herstellkosten unberührt', () => {
    expect(place(ProductCostBook.empty()).total().cents).toBe(1560);
    expect(place(costBook([[1, 210]])).total().cents).toBe(1560);
    expect(place(costBook([[1, 5000]])).total().cents).toBe(1560);
  });

  /**
   * DAS KOSTENBUCH IST NACH PRODUKT AUFGESCHLÜSSELT und wird nicht auf alle
   * Positionen angewendet. Ein Kostenwert am falschen Produkt wäre eine
   * Verwechslung, die niemand mehr auflösen könnte.
   */
  it('ordnet jeden Kostenwert genau seinem Produkt zu', () => {
    const order = place(
      costBook([[1, 210], [2, 1450]]),
      [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }],
    );

    const nachProdukt = new Map(order.items.map((i) => [i.productId, i.unitCostSnapshot?.cents ?? null]));
    expect(nachProdukt.get(1)).toBe(210);
    expect(nachProdukt.get(2)).toBe(1450);
  });
});

describe('Order.costSummary — §14', () => {
  it('meldet eine Bestellung mit lückenlosen Kosten als vollständig', () => {
    const order = place(
      costBook([[1, 210], [2, 1450]]),
      [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }],
    );

    expect(order.costSummary()).toEqual({
      itemCount: 2,
      itemsWithCost: 2,
      complete: true,
      // 2 × 2,10 € + 1 × 14,50 €
      knownCost: Money.fromCents(1870),
    });
  });

  /**
   * DER FALL, UM DEN ES IN §14 GEHT: Zwei von drei Positionen tragen einen
   * Kostenwert. Die Summe der beiden ist NICHT „die Kosten der Bestellung" —
   * wer sie so nennt, veröffentlicht eine zu hohe Marge. `complete` sagt es.
   */
  it('meldet eine teilweise gepflegte Bestellung als unvollständig', () => {
    const order = place(
      costBook([[1, 210]]),
      [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }],
    );

    const summary = order.costSummary();
    expect(summary.itemCount).toBe(2);
    expect(summary.itemsWithCost).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.knownCost.cents).toBe(420);
  });

  it('meldet eine Bestellung ganz ohne Kostenwerte als unvollständig mit 0 bekannten Kosten', () => {
    const summary = place(ProductCostBook.empty()).costSummary();

    expect(summary.itemsWithCost).toBe(0);
    expect(summary.complete).toBe(false);
    expect(summary.knownCost.isZero()).toBe(true);
  });

  /**
   * EIN GEPFLEGTES 0 € ZÄHLT ALS BEKANNT. Es ist eine Aussage, keine Lücke —
   * genau der Unterschied, den NULL und 0 in 0017 abbilden.
   */
  it('zählt gepflegte 0 € als bekannten Wert', () => {
    const summary = place(costBook([[1, 0]])).costSummary();

    expect(summary.itemsWithCost).toBe(1);
    expect(summary.complete).toBe(true);
    expect(summary.knownCost.isZero()).toBe(true);
  });

  /** Der Positionskostenbetrag entsteht aus Stückkosten × Menge. */
  it('rechnet die Menge in die bekannten Kosten ein', () => {
    const order = place(costBook([[1, 210]]), [{ product_id: 1, quantity: 7 }]);
    expect(order.costSummary().knownCost.cents).toBe(1470);
  });

  /** Ein Statuswechsel ist keine Kostenänderung. */
  it('überlebt einen Statuswechsel unverändert', () => {
    const order = place(costBook([[1, 210]]));
    const bestaetigt = order.withStatus('confirmed', now);

    expect(bestaetigt.costSummary()).toEqual(order.costSummary());
    expect(bestaetigt.items[0]?.unitCostSnapshot?.cents).toBe(210);
  });
});
