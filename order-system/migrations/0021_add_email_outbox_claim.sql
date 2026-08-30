-- Ein Provider-Aufruf darf auch bei zwei parallelen Admin-Requests nur
-- einmal beginnen. Der zufällige Claim wird atomar gesetzt und muss beim
-- Abschluss weiterhin derselbe sein. Bestehende Zeilen starten claim-frei.
ALTER TABLE email_outbox ADD COLUMN claim_token TEXT
  CONSTRAINT chk_email_outbox_claim_token CHECK (
    claim_token IS NULL OR length(claim_token) = 36
  );

ALTER TABLE email_outbox ADD COLUMN claimed_at TEXT
  CONSTRAINT chk_email_outbox_claim_state CHECK (
    (claim_token IS NULL AND claimed_at IS NULL)
    OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL AND length(claimed_at) = 24)
  );

CREATE INDEX idx_email_outbox_retry
    ON email_outbox (order_id, status, claim_token);
