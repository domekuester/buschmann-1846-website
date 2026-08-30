-- Öffentliche Interessenten dürfen ein Kundenkonto ANFRAGEN, aber keines
-- anlegen. Preisgruppe, Erfüllung, Kundencode und Zugangsdaten stehen deshalb
-- bewusst nicht in dieser Tabelle. Sie entstehen erst bei der geprüften
-- Übernahme durch die bestehende Admin-Kundenanlage.
CREATE TABLE customer_account_requests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    contact_person       TEXT,
    email                TEXT    NOT NULL,
    email_normalized     TEXT    NOT NULL,
    phone                TEXT    NOT NULL,
    street               TEXT,
    postal_code          TEXT,
    city                 TEXT,
    message              TEXT,
    status               TEXT    NOT NULL DEFAULT 'pending',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL,
    processed_at         TEXT,
    customer_id          INTEGER,
    rejection_note       TEXT,

    CONSTRAINT chk_account_requests_name CHECK (
      length(trim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT chk_account_requests_contact CHECK (
      contact_person IS NULL OR length(trim(contact_person)) BETWEEN 1 AND 120
    ),
    CONSTRAINT chk_account_requests_email CHECK (
      length(trim(email)) BETWEEN 3 AND 190
    ),
    CONSTRAINT chk_account_requests_email_normalized CHECK (
      email_normalized = lower(trim(email_normalized))
      AND length(email_normalized) BETWEEN 3 AND 190
      AND instr(email_normalized, '@') > 1
    ),
    CONSTRAINT chk_account_requests_phone CHECK (
      length(trim(phone)) BETWEEN 1 AND 40
    ),
    CONSTRAINT chk_account_requests_street CHECK (
      street IS NULL OR length(trim(street)) BETWEEN 1 AND 160
    ),
    CONSTRAINT chk_account_requests_postal CHECK (
      postal_code IS NULL OR length(trim(postal_code)) BETWEEN 1 AND 10
    ),
    CONSTRAINT chk_account_requests_city CHECK (
      city IS NULL OR length(trim(city)) BETWEEN 1 AND 100
    ),
    CONSTRAINT chk_account_requests_message CHECK (
      message IS NULL OR length(trim(message)) BETWEEN 1 AND 1000
    ),
    CONSTRAINT chk_account_requests_status CHECK (
      status IN ('pending', 'converted', 'rejected')
    ),
    CONSTRAINT chk_account_requests_created_at CHECK (length(created_at) = 24),
    CONSTRAINT chk_account_requests_updated_at CHECK (length(updated_at) = 24),
    CONSTRAINT chk_account_requests_processed_at CHECK (
      processed_at IS NULL OR length(processed_at) = 24
    ),
    CONSTRAINT chk_account_requests_rejection_note CHECK (
      rejection_note IS NULL OR length(trim(rejection_note)) BETWEEN 1 AND 500
    ),
    CONSTRAINT chk_account_requests_state CHECK (
      (status = 'pending' AND processed_at IS NULL AND customer_id IS NULL AND rejection_note IS NULL)
      OR (status = 'converted' AND processed_at IS NOT NULL AND customer_id IS NOT NULL AND rejection_note IS NULL)
      OR (status = 'rejected' AND processed_at IS NOT NULL AND customer_id IS NULL)
    ),
    CONSTRAINT fk_account_requests_customer FOREIGN KEY (customer_id)
      REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Nur eine OFFENE Anfrage je normalisierter Adresse. Bearbeitete Historie
-- bleibt erhalten und verhindert keine spätere, neue Kontaktaufnahme.
CREATE UNIQUE INDEX uq_account_requests_pending_email
    ON customer_account_requests (email_normalized)
    WHERE status = 'pending';

CREATE INDEX idx_account_requests_status_created
    ON customer_account_requests (status, created_at DESC, id DESC);

CREATE INDEX idx_account_requests_customer
    ON customer_account_requests (customer_id)
    WHERE customer_id IS NOT NULL;
