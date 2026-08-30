-- Kleiner, anwendungsseitiger Geschwindigkeitsbegrenzer für die beiden
-- öffentlichen Schreibpfade. bucket_key ist ausschließlich eine
-- HMAC-SHA-256-Kennung; eine rohe Client-IP wird nie persistiert.
CREATE TABLE public_request_rate_limits (
    bucket_key         TEXT    PRIMARY KEY,
    scope              TEXT    NOT NULL,
    window_started_at  INTEGER NOT NULL,
    request_count      INTEGER NOT NULL,
    updated_at         TEXT    NOT NULL,

    CONSTRAINT chk_public_request_limit_key CHECK (
      length(bucket_key) = 64 AND bucket_key = lower(bucket_key)
    ),
    CONSTRAINT chk_public_request_limit_scope CHECK (
      scope IN ('login', 'account_request')
    ),
    CONSTRAINT chk_public_request_limit_window CHECK (window_started_at >= 0),
    CONSTRAINT chk_public_request_limit_count CHECK (request_count >= 1),
    CONSTRAINT chk_public_request_limit_updated CHECK (length(updated_at) = 24)
);

CREATE INDEX idx_public_request_limits_updated
    ON public_request_rate_limits (updated_at);
