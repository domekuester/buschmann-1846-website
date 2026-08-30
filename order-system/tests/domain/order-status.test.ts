import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  OPEN_PRODUCTION_STATUSES,
  canTransitionTo,
  isFinalStatus,
  isOpenProduction,
  isOrderStatus,
  orderStatusLabel,
} from '../../src/domain/order-status';

describe('OrderStatus', () => {
  it('kennt genau fünf Zustände', () => {
    expect(ORDER_STATUSES).toEqual([
      'new',
      'confirmed',
      'in_production',
      'completed',
      'cancelled',
    ]);
  });

  /** Regel 5: Ein unbekannter Status ist ungültig. */
  it('erkennt unbekannte Werte als ungültig', () => {
    for (const bad of ['geliefert', 'offen', '', 'NEW', 7, null, undefined]) {
      expect(isOrderStatus(bad)).toBe(false);
    }
    expect(isOrderStatus('in_production')).toBe(true);
  });

  it('erlaubt den normalen Weg', () => {
    expect(canTransitionTo('new', 'confirmed')).toBe(true);
    expect(canTransitionTo('confirmed', 'in_production')).toBe(true);
    expect(canTransitionTo('in_production', 'completed')).toBe(true);
  });

  it('erlaubt Stornierung bis zum Abschluss', () => {
    for (const from of ['new', 'confirmed', 'in_production'] as const) {
      expect(canTransitionTo(from, 'cancelled')).toBe(true);
    }
  });

  /** Kein Rückwärtsgang: Das wäre Datenkorruption, keine Korrektur. */
  it('lässt abgeschlossene und stornierte Bestellungen nicht wieder aufleben', () => {
    for (const target of ORDER_STATUSES) {
      expect(canTransitionTo('completed', target)).toBe(false);
      expect(canTransitionTo('cancelled', target)).toBe(false);
    }
  });

  it('lässt keine Schritte überspringen oder umkehren', () => {
    expect(canTransitionTo('new', 'completed')).toBe(false);
    expect(canTransitionTo('new', 'in_production')).toBe(false);
    expect(canTransitionTo('in_production', 'confirmed')).toBe(false);
    expect(canTransitionTo('confirmed', 'new')).toBe(false);
  });

  it('kennt keinen Übergang auf sich selbst', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransitionTo(status, status)).toBe(false);
    }
  });

  it('kennt seine Endzustände', () => {
    expect(isFinalStatus('completed')).toBe(true);
    expect(isFinalStatus('cancelled')).toBe(true);
    expect(isFinalStatus('new')).toBe(false);
  });

  it('hat für jeden Zustand eine deutsche Bezeichnung', () => {
    expect(orderStatusLabel('new')).toBe('Neu');
    expect(orderStatusLabel('in_production')).toBe('In Produktion');
  });
});

/**
 * Was zählt als offene Produktion — die Regel, deren Verletzung als einzige
 * in dieser Datei echten Schaden anrichtet: weggeworfener Kuchen, wenn eine
 * stornierte Bestellung gebacken wird, oder ein fehlender Kuchen, wenn eine
 * offene übersehen wird.
 */
describe('offene Produktion', () => {
  it('zählt new noch nicht zur bestätigten Produktion', () => {
    expect(isOpenProduction('new')).toBe(false);
  });

  it('zählt confirmed zur offenen Produktion', () => {
    expect(isOpenProduction('confirmed')).toBe(true);
  });

  /**
   * in_production bleibt drin. Sie herauszunehmen hieße, dass die Tagesliste
   * schrumpft, während gearbeitet wird — die Backstube sähe nicht mehr, was
   * sie gerade tut.
   */
  it('zählt in_production zur offenen Produktion', () => {
    expect(isOpenProduction('in_production')).toBe(true);
  });

  it('zählt completed nicht zur offenen Produktion', () => {
    expect(isOpenProduction('completed')).toBe(false);
  });

  /** Storniert darf niemals Produktion erzeugen. */
  it('zählt cancelled nicht zur offenen Produktion', () => {
    expect(isOpenProduction('cancelled')).toBe(false);
  });

  it('nennt genau die bestätigten Produktionsstatus in Lebenszyklus-Reihenfolge', () => {
    expect(OPEN_PRODUCTION_STATUSES).toEqual(['confirmed', 'in_production']);
  });

  it('enthält keinen Status, den ORDER_STATUSES nicht kennt', () => {
    for (const status of OPEN_PRODUCTION_STATUSES) {
      expect(ORDER_STATUSES).toContain(status);
    }
  });

  /**
   * DER WÄCHTERTEST. Er iteriert über ALLE bekannten Status und verlangt für
   * jeden eine ausgeschriebene Erwartung. Wer einen sechsten Status
   * hinzufügt, bekommt hier einen roten Test — und muss damit ausdrücklich
   * entscheiden, ob der neue Status Produktion erzeugt. Ein stilles
   * „zählt halt nicht" gibt es nicht.
   */
  it('ordnet jeden bekannten Status ausdrücklich ein', () => {
    const erwartung: Readonly<Record<(typeof ORDER_STATUSES)[number], boolean>> = {
      new: false,
      confirmed: true,
      in_production: true,
      completed: false,
      cancelled: false,
    };

    for (const status of ORDER_STATUSES) {
      expect(isOpenProduction(status)).toBe(erwartung[status]);
    }
  });
});
