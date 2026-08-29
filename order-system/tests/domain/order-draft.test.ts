import { describe, expect, it } from 'vitest';
import { OrderDraft } from '../../src/domain/order-draft';
import { ValidationError } from '../../src/domain/errors';

const now = new Date('2026-08-23T10:32:00Z');

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fulfillment_type: 'delivery',
    fulfillment_date: '2026-08-28',
    note: null,
    items: [{ product_id: 1, quantity: 3 }],
    ...overrides,
  };
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

describe('OrderDraft', () => {
  it('liest eine gültige Bestellung', () => {
    const draft = OrderDraft.fromInput(input({ note: ' Bitte kühl stellen ' }), now);
    expect(draft.fulfillmentType).toBe('delivery');
    expect(draft.fulfillmentDate.value).toBe('2026-08-28');
    expect(draft.note).toBe('Bitte kühl stellen');
    expect(draft.items).toEqual([{ productId: 1, quantity: 3 }]);
  });

  /**
   * Regel 7 und der eigentliche Zweck dieser Klasse: Der Entwurf hat kein
   * Preisfeld. Mitgesendete Beträge werden nicht „geprüft und verworfen",
   * sondern gar nicht erst gelesen.
   */
  it('liest Preisfelder aus der Anfrage überhaupt nicht', () => {
    const draft = OrderDraft.fromInput(
      input({
        total: '0.01',
        total_cents: 1,
        total_amount_cents: 1,
        items: [{ product_id: 1, quantity: 3, unit_price_cents: 1, line_total_cents: 3, price: 1 }],
      }),
      now,
    );

    expect(draft.items).toEqual([{ productId: 1, quantity: 3 }]);
    expect(Object.keys(draft).sort()).toEqual(['fulfillmentDate', 'fulfillmentType', 'items', 'note']);
    expect(JSON.stringify(draft)).not.toContain('price');
    expect(JSON.stringify(draft)).not.toContain('total');
  });

  it('lässt Status, Bestellnummer und Kunde nicht einschleusen', () => {
    const draft = OrderDraft.fromInput(
      input({ status: 'completed', order_number: 'BUS-2026-000001', customer_id: 99 }),
      now,
    );
    expect(Object.keys(draft).sort()).toEqual(['fulfillmentDate', 'fulfillmentType', 'items', 'note']);
  });

  /**
   * Die Bestellseite sendet ALLE Produkte mit, die meisten mit Menge 0.
   * Menge 0 heißt „nicht bestellt" und ist kein Fehler — sie fällt weg.
   */
  it('behandelt Menge 0 als „nicht bestellt"', () => {
    const draft = OrderDraft.fromInput(
      input({
        items: [
          { product_id: 1, quantity: 0 },
          { product_id: 2, quantity: 5 },
          { product_id: 3, quantity: 0 },
        ],
      }),
      now,
    );
    expect(draft.items).toEqual([{ productId: 2, quantity: 5 }]);
  });

  /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
  it('lehnt eine Bestellung ohne Positionen ab', () => {
    for (const items of [[], [{ product_id: 1, quantity: 0 }]]) {
      expect(errorsOf(() => OrderDraft.fromInput(input({ items }), now))).toHaveProperty('items');
    }
    expect(errorsOf(() => OrderDraft.fromInput(input({ items: 'keine Liste' }), now))).toHaveProperty('items');
    expect(errorsOf(() => OrderDraft.fromInput(input({ items: undefined }), now))).toHaveProperty('items');
  });

  /** Regel 2: Eine negative Menge ist ein Fehler, kein „nicht bestellt". */
  it('lehnt negative und nicht ganzzahlige Mengen ab', () => {
    for (const bad of [-1, 'drei', null, 2.5, '', true, {}]) {
      expect(
        errorsOf(() => OrderDraft.fromInput(input({ items: [{ product_id: 1, quantity: bad }] }), now)),
      ).toHaveProperty('items.0.quantity');
    }
  });

  it('akzeptiert Ziffernstrings als Menge, weil Formularwerte so ankommen', () => {
    const draft = OrderDraft.fromInput(input({ items: [{ product_id: '2', quantity: '5' }] }), now);
    expect(draft.items).toEqual([{ productId: 2, quantity: 5 }]);
  });

  it('lehnt ungültige Produkt-IDs ab', () => {
    for (const bad of [0, -5, 'abc', null, 1.5]) {
      expect(
        errorsOf(() => OrderDraft.fromInput(input({ items: [{ product_id: bad, quantity: 1 }] }), now)),
      ).toHaveProperty('items.0.product_id');
    }
  });

  it('lehnt dasselbe Produkt zweimal ab', () => {
    const errors = errorsOf(() =>
      OrderDraft.fromInput(
        input({ items: [{ product_id: 1, quantity: 2 }, { product_id: 1, quantity: 3 }] }),
        now,
      ),
    );
    expect(errors).toHaveProperty('items.1.product_id');
  });

  /** Regel 4: Ein unbekannter Fulfillment-Typ ist ungültig. */
  it('lehnt unbekannte Fulfillment-Typen ab', () => {
    for (const bad of ['versand', '', null, 'DELIVERY', 42, undefined]) {
      expect(
        errorsOf(() => OrderDraft.fromInput(input({ fulfillment_type: bad }), now)),
      ).toHaveProperty('fulfillment_type');
    }
  });

  it('akzeptiert auch Abholung', () => {
    expect(OrderDraft.fromInput(input({ fulfillment_type: 'pickup' }), now).fulfillmentType).toBe('pickup');
  });

  it('lehnt Liefertage in der Vergangenheit ab', () => {
    expect(
      errorsOf(() => OrderDraft.fromInput(input({ fulfillment_date: '2026-08-01' }), now)),
    ).toHaveProperty('fulfillment_date');
  });

  /** Alle Fehler auf einmal — ein Café soll nicht fünfmal absenden müssen. */
  it('sammelt alle Fehler, nicht nur den ersten', () => {
    const errors = errorsOf(() =>
      OrderDraft.fromInput(
        {
          fulfillment_type: 'versand',
          fulfillment_date: '2020-01-01',
          items: [{ product_id: 0, quantity: -3 }],
        },
        now,
      ),
    );
    expect(Object.keys(errors).sort()).toEqual([
      'fulfillment_date',
      'fulfillment_type',
      'items.0.product_id',
      'items.0.quantity',
    ]);
  });

  it('behandelt die Notiz als optional und begrenzt sie', () => {
    expect(OrderDraft.fromInput(input({ note: '   ' }), now).note).toBeNull();
    expect(OrderDraft.fromInput(input({ note: null }), now).note).toBeNull();
    expect(OrderDraft.fromInput(input({ note: undefined }), now).note).toBeNull();
    expect(errorsOf(() => OrderDraft.fromInput(input({ note: 'a'.repeat(501) }), now))).toHaveProperty('note');
    expect(errorsOf(() => OrderDraft.fromInput(input({ note: 42 }), now))).toHaveProperty('note');
  });

  it('lehnt zu viele Positionen ab', () => {
    const items = Array.from({ length: OrderDraft.MAX_ITEMS + 1 }, (_, i) => ({
      product_id: i + 1,
      quantity: 1,
    }));
    expect(errorsOf(() => OrderDraft.fromInput(input({ items }), now))).toHaveProperty('items');
  });

  /** Was nicht einmal ein Objekt ist, ist auch keine Bestellung. */
  it('lehnt Eingaben ab, die gar kein Objekt sind', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      expect(() => OrderDraft.fromInput(bad, now)).toThrow(ValidationError);
    }
  });
});
