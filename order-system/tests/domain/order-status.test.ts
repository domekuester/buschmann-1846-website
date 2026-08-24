import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  canTransitionTo,
  isFinalStatus,
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
