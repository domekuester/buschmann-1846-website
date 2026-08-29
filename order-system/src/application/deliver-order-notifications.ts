import { toUtcTimestamp } from '../domain/clock';
import type { Order } from '../domain/order';
import {
  listDeliverableOrderNotifications,
  markEmailNotificationFailed,
  markEmailNotificationSent,
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
    let attempts = notification.attempts;
    while (attempts < MAX_DELIVERY_ATTEMPTS) {
      let message;
      try {
        message = notification.kind === 'operator_new_order'
          ? renderOperatorNewOrderEmail(order, notification.recipient, appOrigin)
          : renderCustomerOrderConfirmationEmail(order, notification.recipient);
      } catch {
        if (!await recordFailure(db, notification.notificationId)) break;
        attempts += 1;
        continue;
      }

      let result;
      try {
        result = await sender.send(message);
      } catch {
        if (!await recordFailure(db, notification.notificationId)) break;
        attempts += 1;
        continue;
      }

      if (result.kind === 'unavailable') break;

      // Nach Provider-Akzeptanz niemals erneut senden, auch wenn D1 gerade
      // nicht erreichbar sein sollte. Dieser Statusfehler bleibt vom Auftrag
      // getrennt und darf keinen möglichen Doppelversand erzeugen.
      try {
        await markEmailNotificationSent(
          db,
          notification.notificationId,
          toUtcTimestamp(now),
        );
      } catch {
        // Die Absicht bleibt durable; ein Statusfehler darf den Auftrag nicht berühren.
      }
      break;
    }
  }
}

async function recordFailure(db: D1Database, notificationId: string): Promise<boolean> {
  try {
    await markEmailNotificationFailed(db, notificationId, SANITIZED_DELIVERY_ERROR);
    return true;
  } catch {
    // Ohne durable Versuchszählung kein weiterer Provider-Aufruf.
    return false;
  }
}
