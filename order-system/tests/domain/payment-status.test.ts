import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATUSES,
  isPaid,
  isPaymentStatus,
  paymentRecordedAtFor,
  paymentStatusLabel,
} from '../../src/domain/payment-status';

describe('PaymentStatus', () => {
  it('kennt genau fünf Zustände', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'unpaid',
      'paid_cash',
      'paid_card',
      'paid_bank',
      'paid_other',
    ]);
  });

  it('erkennt jeden bekannten Zustand', () => {
    for (const status of PAYMENT_STATUSES) {
      expect(isPaymentStatus(status)).toBe(true);
    }
  });

  it('weist alles zurück, was nicht in der Liste steht', () => {
    for (const fremd of [
      'paid',
      'paid_bitcoin',
      'UNPAID',
      ' unpaid',
      'unpaid ',
      '',
      'new',
      'completed',
      null,
      undefined,
      0,
      1,
      true,
      {},
      ['unpaid'],
    ]) {
      expect(isPaymentStatus(fremd)).toBe(false);
    }
  });

  it('nennt „unpaid" als einzigen nicht bezahlten Zustand', () => {
    expect(isPaid('unpaid')).toBe(false);
    expect(isPaid('paid_cash')).toBe(true);
    expect(isPaid('paid_card')).toBe(true);
    expect(isPaid('paid_bank')).toBe(true);
    expect(isPaid('paid_other')).toBe(true);
  });

  it('beschriftet jeden Zustand deutsch und unterscheidbar', () => {
    const labels = PAYMENT_STATUSES.map(paymentStatusLabel);
    expect(labels).toEqual([
      'Offen',
      'Bar bezahlt',
      'Karte bezahlt',
      'Überweisung bezahlt',
      'Sonstiges bezahlt',
    ]);
    expect(new Set(labels).size).toBe(PAYMENT_STATUSES.length);
  });
});

describe('paymentRecordedAtFor', () => {
  const now = new Date('2026-08-25T09:30:00.000Z');

  it('setzt für „offen" keinen Zeitpunkt', () => {
    expect(paymentRecordedAtFor('unpaid', now)).toBeNull();
  });

  it('setzt für jeden bezahlten Zustand den übergebenen Zeitpunkt', () => {
    for (const status of ['paid_cash', 'paid_card', 'paid_bank', 'paid_other'] as const) {
      expect(paymentRecordedAtFor(status, now)).toBe('2026-08-25T09:30:00.000Z');
    }
  });
});
