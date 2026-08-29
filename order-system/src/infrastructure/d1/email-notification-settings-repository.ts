import { toUtcTimestamp } from '../../domain/clock';
import {
  normalizeOperatorRecipients,
  type EmailNotificationSettings,
  type EmailNotificationSettingsInput,
} from '../../domain/email-notification-settings';
import { fromBoolean, toBoolean } from './rows';

interface SettingsRow {
  operator_notifications_enabled: number;
  customer_confirmations_enabled: number;
  updated_at: string | null;
}

interface RecipientRow {
  email: string;
}

export async function loadEmailNotificationSettings(
  db: D1Database,
): Promise<EmailNotificationSettings> {
  const [settings, recipients] = await Promise.all([
    db.prepare(
      `SELECT operator_notifications_enabled, customer_confirmations_enabled, updated_at
         FROM email_notification_settings
        WHERE id = 1`,
    ).first<SettingsRow>(),
    db.prepare(
      `SELECT email
         FROM email_operator_recipients
        ORDER BY id`,
    ).all<RecipientRow>(),
  ]);

  return {
    operatorNotificationsEnabled: settings === null
      ? false
      : toBoolean(settings.operator_notifications_enabled),
    customerConfirmationsEnabled: settings === null
      ? false
      : toBoolean(settings.customer_confirmations_enabled),
    operatorRecipients: recipients.results.map((row) => row.email),
    updatedAt: settings?.updated_at ?? null,
  };
}

export async function saveEmailNotificationSettings(
  db: D1Database,
  input: EmailNotificationSettingsInput,
  now: Date,
): Promise<void> {
  const recipients = normalizeOperatorRecipients(input.operatorRecipients);
  const timestamp = toUtcTimestamp(now);

  const settings = db.prepare(
    `INSERT INTO email_notification_settings
       (id, operator_notifications_enabled, customer_confirmations_enabled, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       operator_notifications_enabled = excluded.operator_notifications_enabled,
       customer_confirmations_enabled = excluded.customer_confirmations_enabled,
       updated_at = excluded.updated_at`,
  ).bind(
    fromBoolean(input.operatorNotificationsEnabled),
    fromBoolean(input.customerConfirmationsEnabled),
    timestamp,
  );

  const removeRecipients = db.prepare('DELETE FROM email_operator_recipients');
  const insertRecipients = recipients.map((recipient) => db.prepare(
    `INSERT INTO email_operator_recipients (email, created_at) VALUES (?, ?)`,
  ).bind(recipient, timestamp));

  await db.batch([settings, removeRecipients, ...insertRecipients]);
}
