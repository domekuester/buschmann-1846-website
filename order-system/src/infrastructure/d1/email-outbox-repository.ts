import type {
  EmailNotificationIntent,
  EmailNotificationKind,
  EmailNotificationStatus,
  EmailOutboxNotification,
} from '../../domain/email-notification';

interface OutboxRow {
  notification_id: string;
  order_number: string;
  notification_kind: EmailNotificationKind;
  recipient: string;
  status: EmailNotificationStatus;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  last_error: string | null;
}

export function prepareEmailIntentInsert(
  db: D1Database,
  orderNumber: string,
  intent: EmailNotificationIntent,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO email_outbox
       (notification_id, order_id, notification_kind, recipient, status, attempts, created_at)
     VALUES (?, (SELECT id FROM orders WHERE order_number = ?), ?, ?, 'pending', 0, ?)
     ON CONFLICT(order_id, notification_kind, recipient) DO NOTHING`,
  ).bind(
    intent.notificationId,
    orderNumber,
    intent.kind,
    intent.recipient,
    intent.createdAt,
  );
}

export async function listOrderNotifications(
  db: D1Database,
  orderNumber: string,
): Promise<readonly EmailOutboxNotification[]> {
  const { results } = await db.prepare(
    `SELECT e.notification_id, o.order_number, e.notification_kind, e.recipient,
            e.status, e.attempts, e.created_at, e.sent_at, e.last_error
       FROM email_outbox e
       JOIN orders o ON o.id = e.order_id
      WHERE o.order_number = ?
      ORDER BY CASE e.notification_kind
                 WHEN 'operator_new_order' THEN 0 ELSE 1
               END,
               e.recipient`,
  ).bind(orderNumber).all<OutboxRow>();

  return results.map(toNotification);
}

export async function listDeliverableOrderNotifications(
  db: D1Database,
  orderNumber: string,
  maxAttempts: number,
): Promise<readonly EmailOutboxNotification[]> {
  const notifications = await listOrderNotifications(db, orderNumber);
  return notifications.filter((notification) =>
    (notification.status === 'pending' || notification.status === 'failed')
    && notification.attempts < maxAttempts,
  );
}

export async function markEmailNotificationSent(
  db: D1Database,
  notificationId: string,
  sentAt: string,
): Promise<void> {
  await db.prepare(
    `UPDATE email_outbox
        SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND attempts < 2`,
  ).bind(sentAt, notificationId).run();
}

export async function markEmailNotificationFailed(
  db: D1Database,
  notificationId: string,
  sanitizedError: string,
): Promise<void> {
  const safe = sanitizedError.slice(0, 240);
  await db.prepare(
    `UPDATE email_outbox
        SET status = 'failed', attempts = attempts + 1, sent_at = NULL, last_error = ?
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND attempts < 2`,
  ).bind(safe, notificationId).run();
}

function toNotification(row: OutboxRow): EmailOutboxNotification {
  return {
    notificationId: row.notification_id,
    orderNumber: row.order_number,
    kind: row.notification_kind,
    recipient: row.recipient,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    lastError: row.last_error,
  };
}
