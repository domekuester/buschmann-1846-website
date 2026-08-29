-- E-Mail-Grundeinstellungen und durable Benachrichtigungsabsichten.
--
-- Der Versand selbst ist absichtlich nicht Teil dieser Migration: Zugangsdaten
-- und Absenderkonfiguration gehören in die Laufzeitumgebung. D1 hält nur fest,
-- WAS nach einer erfolgreichen Bestellung zu versenden ist und welchen Stand
-- dieser Versuch hat.

CREATE TABLE email_notification_settings (
    id INTEGER PRIMARY KEY,
    operator_notifications_enabled INTEGER NOT NULL DEFAULT 0,
    customer_confirmations_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,

    CONSTRAINT chk_email_settings_singleton CHECK (id = 1),
    CONSTRAINT chk_email_settings_operator_enabled
      CHECK (operator_notifications_enabled IN (0, 1)),
    CONSTRAINT chk_email_settings_customer_enabled
      CHECK (customer_confirmations_enabled IN (0, 1)),
    CONSTRAINT chk_email_settings_updated_at
      CHECK (updated_at IS NULL OR length(updated_at) = 24)
);

INSERT INTO email_notification_settings (id) VALUES (1);

CREATE TABLE email_operator_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL,

    CONSTRAINT uq_email_operator_recipients_email UNIQUE (email),
    CONSTRAINT chk_email_operator_recipient_normalized CHECK (
      email = lower(trim(email))
      AND length(email) BETWEEN 3 AND 190
      AND instr(email, '@') > 1
    ),
    CONSTRAINT chk_email_operator_recipient_created_at CHECK (length(created_at) = 24)
);

CREATE TABLE email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id TEXT NOT NULL,
    order_id INTEGER NOT NULL,
    notification_kind TEXT NOT NULL,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    last_error TEXT,

    CONSTRAINT uq_email_outbox_notification_id UNIQUE (notification_id),
    CONSTRAINT uq_email_outbox_intent UNIQUE (order_id, notification_kind, recipient),
    CONSTRAINT fk_email_outbox_order
      FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT chk_email_outbox_notification_id
      CHECK (length(notification_id) BETWEEN 3 AND 64),
    CONSTRAINT chk_email_outbox_kind CHECK (
      notification_kind IN ('operator_new_order', 'customer_order_confirmation')
    ),
    CONSTRAINT chk_email_outbox_recipient CHECK (
      recipient = lower(trim(recipient))
      AND length(recipient) BETWEEN 3 AND 190
      AND instr(recipient, '@') > 1
    ),
    CONSTRAINT chk_email_outbox_status CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT chk_email_outbox_attempts CHECK (
      typeof(attempts) = 'integer'
      AND attempts >= 0
      AND (status = 'pending' OR attempts >= 1)
    ),
    CONSTRAINT chk_email_outbox_created_at CHECK (length(created_at) = 24),
    CONSTRAINT chk_email_outbox_sent_state CHECK (
      (status = 'sent' AND sent_at IS NOT NULL)
      OR (status <> 'sent' AND sent_at IS NULL)
    ),
    CONSTRAINT chk_email_outbox_sent_at
      CHECK (sent_at IS NULL OR length(sent_at) = 24),
    CONSTRAINT chk_email_outbox_last_error
      CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 240)
);

CREATE INDEX idx_email_outbox_status_created
    ON email_outbox (status, created_at, id);

CREATE INDEX idx_email_outbox_order
    ON email_outbox (order_id, status);
