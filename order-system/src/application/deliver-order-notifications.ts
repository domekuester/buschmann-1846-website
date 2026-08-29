import { toUtcTimestamp } from '../domain/clock';
import type { Order } from '../domain/order';
import {
  listPendingOrderNotifications,
  markEmailNotificationFailed,
  markEmailNotificationSent,
} from '../infrastructure/d1/email-outbox-repository';
import type { EmailSender } from '../infrastructure/email/email-sender';
import {
  renderCustomerOrderConfirmationEmail,
  renderOperatorNewOrderEmail,
} from './email-templates';

const SANITIZED_DELIVERY_ERROR = 'Der E-Mail-Versand ist fehlgeschlagen.';

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
  let pending;
  try {
    pending = await listPendingOrderNotifications(db, order.orderNumber.value);
  } catch {
    return;
  }

  for (const notification of pending) {
    try {
      const message = notification.kind === 'operator_new_order'
        ? renderOperatorNewOrderEmail(order, notification.recipient, appOrigin)
        : renderCustomerOrderConfirmationEmail(order, notification.recipient);
      const result = await sender.send(message);
      if (result.kind === 'unavailable') continue;
      try {
        await markEmailNotificationSent(
          db,
          notification.notificationId,
          toUtcTimestamp(now),
        );
      } catch {
        // Die Absicht bleibt durable; ein Statusfehler darf den Auftrag nicht berühren.
      }
    } catch {
      try {
        await markEmailNotificationFailed(
          db,
          notification.notificationId,
          SANITIZED_DELIVERY_ERROR,
        );
      } catch {
        // Auch ein zweiter Infrastrukturfehler bleibt vom Auftrag getrennt.
      }
    }
  }
}
