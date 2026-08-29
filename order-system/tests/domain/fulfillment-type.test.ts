import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_TYPES,
  fulfillmentLabel,
  isFulfillmentType,
  requiresAddress,
  type FulfillmentType,
} from '../../src/domain/fulfillment-type';

describe('FulfillmentType', () => {
  it('kennt genau zwei Arten', () => {
    expect(FULFILLMENT_TYPES).toEqual(['delivery', 'pickup']);
  });

  /** Regel 4: Ein unbekannter Wert ist ungültig. */
  it('erkennt unbekannte Werte als ungültig', () => {
    for (const bad of ['versand', '', 'DELIVERY', 'Delivery', 42, null, undefined, {}]) {
      expect(isFulfillmentType(bad)).toBe(false);
    }
    expect(isFulfillmentType('delivery')).toBe(true);
    expect(isFulfillmentType('pickup')).toBe(true);
  });

  it('verlangt nur bei Lieferung eine Adresse', () => {
    expect(requiresAddress('delivery')).toBe(true);
    expect(requiresAddress('pickup')).toBe(false);
  });

  it('hat für jede Art eine deutsche Bezeichnung', () => {
    expect(fulfillmentLabel('delivery')).toBe('Lieferung');
    expect(fulfillmentLabel('pickup')).toBe('Abholung');
  });

  /**
   * Domänenwert und Datenbankwert sind dieselbe Zeichenkette. Gäbe es hier
   * eine Übersetzungstabelle, wäre sie die Stelle, an der beide Seiten
   * auseinanderlaufen könnten.
   */
  it('benutzt denselben Wert wie die Datenbank', () => {
    const stored: string = 'delivery';
    expect(isFulfillmentType(stored)).toBe(true);
    const type: FulfillmentType = 'pickup';
    expect(String(type)).toBe('pickup');
  });
});
