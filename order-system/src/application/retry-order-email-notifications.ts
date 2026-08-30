import { toUtcTimestamp } from '../domain/clock';
import {
  claimEmailNotification,
  listRetryableOrderNotificationIds,
} from '../infrastructure/d1/email-outbox-repository';
import type { EmailSender } from '../infrastructure/email/email-sender';
import { findOrderByNumber } from '../infrastructure/d1/order-repository';
import { deliverClaimedEmailNotification } from './deliver-order-notifications';

export interface RetryOrderEmailResult {
  readonly outcome: 'order_not_found' | 'nothing_to_retry' | 'processed';
  readonly fulfillmentDate: string | null;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly unavailableCount: number;
  readonly unreconciledCount: number;
}

/**
 * Expliziter Admin-Retry. Die Kandidaten und ihre Empfänger kommen nur aus
 * D1; der Browser benennt ausschließlich die Bestellung. Anders als der
 * automatische Erstversand hat der bewusste Retry kein Versuchsmaximum,
 * führt pro Klick und Nachricht aber genau einen Provider-Aufruf aus.
 */
export async function retryOrderEmailNotifications(
  db: D1Database,
  orderNumber: string,
  sender: EmailSender,
  now: Date,
  appOrigin?: string,
): Promise<RetryOrderEmailResult> {
  const order = await findOrderByNumber(db, orderNumber);
  if (order === null) return result('order_not_found', null);

  const candidates = await listRetryableOrderNotificationIds(db, orderNumber);
  if (candidates.length === 0) {
    return result('nothing_to_retry', order.fulfillmentDate.value);
  }

  let sentCount = 0;
  let failedCount = 0;
  let unavailableCount = 0;
  let unreconciledCount = 0;

  for (const notificationId of candidates) {
    const claimed = await claimEmailNotification(
      db, notificationId, toUtcTimestamp(now), null,
    );
    if (claimed === null) continue;

    const outcome = await deliverClaimedEmailNotification(
      db, order, claimed, sender, now, appOrigin,
    );
    if (outcome === 'sent') sentCount += 1;
    else if (outcome === 'failed') failedCount += 1;
    else if (outcome === 'unavailable') unavailableCount += 1;
    else unreconciledCount += 1;
  }

  return {
    outcome: 'processed',
    fulfillmentDate: order.fulfillmentDate.value,
    sentCount,
    failedCount,
    unavailableCount,
    unreconciledCount,
  };
}

function result(
  outcome: RetryOrderEmailResult['outcome'],
  fulfillmentDate: string | null,
): RetryOrderEmailResult {
  return {
    outcome,
    fulfillmentDate,
    sentCount: 0,
    failedCount: 0,
    unavailableCount: 0,
    unreconciledCount: 0,
  };
}
