import { toUtcTimestamp } from '../domain/clock';
import type { Order } from '../domain/order';
import {
  claimEmailNotification,
  listDeliverableOrderNotifications,
  markEmailNotificationFailed,
  markEmailNotificationSent,
  releaseEmailNotificationClaim,
  type ClaimedEmailNotification,
} from '../infrastructure/d1/email-outbox-repository';
import type { EmailSender } from '../infrastructure/email/email-sender';
import {
  renderCustomerOrderConfirmationEmail,
  renderOperatorNewOrderEmail,
} from './email-templates';

const SANITIZED_DELIVERY_ERROR = 'Der E-Mail-Versand ist fehlgeschlagen.';
const MAX_DELIVERY_ATTEMPTS = 2;

/**
 * Best-effort nach dem atomaren Bestellspeichern. Diese Funktion wirft
 * absichtlich nie: Transport und Statuspflege dürfen die Bestellung nicht
 * nachträglich in einen Fehler verwandeln.
 */
export async function deliverOrderNotifications(
  db: D1Database,
  order: Order,
  sender: EmailSender,
  now: Date,
  appOrigin?: string,
): Promise<void> {
  let deliverable;
  try {
    deliverable = await listDeliverableOrderNotifications(
      db,
      order.orderNumber.value,
      MAX_DELIVERY_ATTEMPTS,
    );
  } catch {
    return;
  }

  for (const notification of deliverable) {
    while (true) {
      let claimed: ClaimedEmailNotification | null;
      try {
        claimed = await claimEmailNotification(
          db, notification.notificationId, toUtcTimestamp(now), MAX_DELIVERY_ATTEMPTS,
        );
      } catch {
        break;
      }
      if (claimed === null) break;

      const outcome = await deliverClaimedEmailNotification(
        db, order, claimed, sender, now, appOrigin,
      );
      if (outcome !== 'failed') break;
    }
  }
}

export type ClaimedDeliveryOutcome =
  | 'sent'
  | 'failed'
  | 'unavailable'
  | 'accepted_unreconciled'
  | 'state_error';

/** Ein Provider-Aufruf für eine bereits atomar geclaimte Outboxzeile. */
export async function deliverClaimedEmailNotification(
  db: D1Database,
  order: Order,
  notification: ClaimedEmailNotification,
  sender: EmailSender,
  now: Date,
  appOrigin?: string,
): Promise<ClaimedDeliveryOutcome> {
  let message;
  try {
    message = notification.kind === 'operator_new_order'
      ? renderOperatorNewOrderEmail(order, notification.recipient, appOrigin)
      : renderCustomerOrderConfirmationEmail(order, notification.recipient);
  } catch {
    return recordFailure(db, notification);
  }

  let result;
  try {
    result = await sender.send(message);
  } catch {
    return recordFailure(db, notification);
  }

  if (result.kind === 'unavailable') {
    try {
      return await releaseEmailNotificationClaim(
        db, notification.notificationId, notification.claimToken,
      ) ? 'unavailable' : 'state_error';
    } catch {
      return 'state_error';
    }
  }

  // Nach Provider-Akzeptanz niemals erneut senden. Scheitert die D1-Pflege,
  // bleibt der Claim absichtlich stehen und sperrt jede automatische oder
  // manuelle Wiederholung bis zu einer bewussten Betreiber-Reconciliation.
  try {
    return await markEmailNotificationSent(
      db, notification.notificationId, notification.claimToken, toUtcTimestamp(now),
    ) ? 'sent' : 'accepted_unreconciled';
  } catch {
    return 'accepted_unreconciled';
  }
}

async function recordFailure(
  db: D1Database,
  notification: ClaimedEmailNotification,
): Promise<ClaimedDeliveryOutcome> {
  try {
    return await markEmailNotificationFailed(
      db, notification.notificationId, notification.claimToken, SANITIZED_DELIVERY_ERROR,
    ) ? 'failed' : 'state_error';
  } catch {
    // Ohne durable Versuchszählung und Claim-Abschluss kein weiterer Aufruf.
    return 'state_error';
  }
}
