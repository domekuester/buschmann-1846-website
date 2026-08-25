ALTER TABLE orders
  ADD COLUMN status_changed_by_account_id INTEGER
    REFERENCES auth_accounts(id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD COLUMN status_changed_at TEXT;
