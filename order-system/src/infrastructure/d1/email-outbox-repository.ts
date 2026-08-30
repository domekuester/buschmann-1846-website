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

export interface ClaimedEmailNotification {
  readonly notificationId: string;
  readonly kind: EmailNotificationKind;
  readonly recipient: string;
  readonly attempts: number;
  readonly claimToken: string;
}

interface ClaimedRow {
  notification_id: string;
  notification_kind: EmailNotificationKind;
  recipient: string;
  attempts: number;
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
  const eligible = new Set(await listRetryableOrderNotificationIds(db, orderNumber, maxAttempts));
  return (await listOrderNotifications(db, orderNumber)).filter((notification) =>
    eligible.has(notification.notificationId));
}

export async function listRetryableOrderNotificationIds(
  db: D1Database,
  orderNumber: string,
  maxAttempts: number | null = null,
): Promise<readonly string[]> {
  const maxClause = maxAttempts === null ? '' : 'AND e.attempts < ?';
  const statement = db.prepare(
    `SELECT e.notification_id
       FROM email_outbox e
       JOIN orders o ON o.id = e.order_id
      WHERE o.order_number = ?
        AND e.status IN ('pending', 'failed')
        AND e.claim_token IS NULL
        ${maxClause}
      ORDER BY e.id`,
  );
  const bound = maxAttempts === null
    ? statement.bind(orderNumber)
    : statement.bind(orderNumber, maxAttempts);
  const { results } = await bound.all<{ notification_id: string }>();
  return results.map((row) => row.notification_id);
}

/** Atomarer Claim: nur ein paralleler Aufrufer erhält die Zeile zurück. */
export async function claimEmailNotification(
  db: D1Database,
  notificationId: string,
  claimedAt: string,
  maxAttempts: number | null = null,
): Promise<ClaimedEmailNotification | null> {
  const claimToken = crypto.randomUUID();
  const maxClause = maxAttempts === null ? '' : 'AND attempts < ?';
  const statement = db.prepare(
    `UPDATE email_outbox
        SET claim_token = ?, claimed_at = ?
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND claim_token IS NULL
        ${maxClause}
      RETURNING notification_id, notification_kind, recipient, attempts`,
  );
  const bound = maxAttempts === null
    ? statement.bind(claimToken, claimedAt, notificationId)
    : statement.bind(claimToken, claimedAt, notificationId, maxAttempts);
  const row = await bound.first<ClaimedRow>();
  return row === null ? null : {
    notificationId: row.notification_id,
    kind: row.notification_kind,
    recipient: row.recipient,
    attempts: row.attempts,
    claimToken,
  };
}

export async function markEmailNotificationSent(
  db: D1Database,
  notificationId: string,
  claimToken: string,
  sentAt: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE email_outbox
        SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL,
            claim_token = NULL, claimed_at = NULL
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND claim_token = ?`,
  ).bind(sentAt, notificationId, claimToken).run();
  return result.meta.changes === 1;
}

export async function markEmailNotificationFailed(
  db: D1Database,
  notificationId: string,
  claimToken: string,
  sanitizedError: string,
): Promise<boolean> {
  const safe = sanitizedError.slice(0, 240);
  const result = await db.prepare(
    `UPDATE email_outbox
        SET status = 'failed', attempts = attempts + 1, sent_at = NULL, last_error = ?,
            claim_token = NULL, claimed_at = NULL
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND claim_token = ?`,
  ).bind(safe, notificationId, claimToken).run();
  return result.meta.changes === 1;
}

export async function releaseEmailNotificationClaim(
  db: D1Database,
  notificationId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE email_outbox
        SET claim_token = NULL, claimed_at = NULL
      WHERE notification_id = ?
        AND status IN ('pending', 'failed')
        AND claim_token = ?`,
  ).bind(notificationId, claimToken).run();
  return result.meta.changes === 1;
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
