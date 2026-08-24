-- Sitzungen.
--
-- Nach erfolgreicher Anmeldung erzeugt der Server 32 Byte Zufall, gibt sie dem
-- Browser als Cookie und legt hier ihren SHA-256-Hash ab.
--
-- IN DIESER TABELLE STEHT NIEMALS DER ROHTOKEN.
--
-- Kein Passwort-KDF und kein Salt für den Hash — und das ist kein
-- Widerspruch zu auth_accounts, sondern derselbe Gedanke andersherum: Ein
-- langsamer KDF schützt SCHWACHE Geheimnisse gegen Raten. Ein Sitzungstoken
-- ist 256 Bit gleichverteilter Zufall; dagegen gibt es kein Rateverfahren,
-- egal wie schnell der Hash ist. Ein KDF kostete stattdessen bei JEDEM
-- geschützten Request 45 ms.
--
-- Der csrf_token liegt daneben in derselben Zeile. Er ist ein zweiter,
-- unabhängiger Zufallswert: Der Sitzungstoken liegt HttpOnly im Cookie und
-- darf nie in ein Dokument geraten, der CSRF-Token steht lesbar im HTML, weil
-- der Client ihn zurücksenden muss. Wären es dieselben Werte, stünde der
-- Sitzungstoken im Quelltext der Seite.
--
-- Bewusst NICHT enthalten:
--   ip_address    Ein personenbezogenes Datum ohne bestätigten Bedarf.
--                 Datenminimierung ist Voreinstellung.
--   user_agent    Dasselbe, und für nichts benutzt.
--   last_seen_at  Ein Schreibvorgang bei JEDEM Request für eine Information,
--                 die niemand auswertet.
CREATE TABLE auth_sessions (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL,

    -- sha256(token) als 64 Hex-Zeichen.
    token_hash  TEXT    NOT NULL,

    -- 32 Byte base64url, 43 Zeichen.
    csrf_token  TEXT    NOT NULL,

    created_at  TEXT    NOT NULL,

    -- ISO-8601-UTC mit fester Länge: Die lexikografische Ordnung ist die
    -- chronologische, deshalb ist `WHERE expires_at > ?` ohne Datumsfunktion
    -- korrekt. Kundensitzung 30 Tage, Adminsitzung 12 Stunden.
    expires_at  TEXT    NOT NULL,

    -- Gesetzt beim Abmelden und beim Anmelden (Session Fixation: die alte
    -- Sitzung wird widerrufen, nie übernommen).
    revoked_at  TEXT,

    -- Die Eindeutigkeit hängt an der Datenbank und ist zugleich der Index,
    -- über den bei jedem geschützten Request gesucht wird: ein Zugriff, kein
    -- Scan.
    CONSTRAINT uq_auth_sessions_token_hash UNIQUE (token_hash),

    CONSTRAINT chk_auth_sessions_token_form CHECK (
        length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),

    CONSTRAINT chk_auth_sessions_csrf_form CHECK (
        length(csrf_token) = 43 AND csrf_token NOT GLOB '*[^A-Za-z0-9_-]*'
    ),

    -- Eine Sitzung, die schon bei ihrer Entstehung abgelaufen ist, wäre keine.
    CONSTRAINT chk_auth_sessions_expiry_after_creation CHECK (expires_at > created_at),

    -- Ein Konto verschwindet mit seinem Kunden, und seine Sitzungen mit ihm.
    -- Eine Sitzung ohne Konto wäre ein Zugang ohne Inhaber.
    CONSTRAINT fk_auth_sessions_account FOREIGN KEY (account_id)
        REFERENCES auth_accounts (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- "Alle Sitzungen dieses Kontos widerrufen" — beim Anmelden und beim Sperren.
CREATE INDEX idx_auth_sessions_account ON auth_sessions (account_id);

-- Für ein späteres Aufräumen abgelaufener Sitzungen. Bewusst schon hier: Der
-- Index kostet nichts und die Alternative wäre ein Tabellenscan zu einem
-- Zeitpunkt, an dem die Tabelle groß ist.
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions (expires_at);
