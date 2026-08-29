-- Zugänge der Cafés — der Ersatz für Registrierung, Passwort und Sitzung.
--
-- Jedes Café bekommt einen persönlichen Link der Form /o/<token>. Wer den
-- vollständigen Link besitzt, darf für dieses Café bestellen: ein Capability
-- Link. Das ist eine bewusste Produktentscheidung. Ein Stammcafé soll in
-- zwanzig Sekunden bestellen, nicht sich anmelden.
--
-- IN DIESER TABELLE STEHT NIEMALS DER TOKEN.
--
-- Gespeichert wird ausschließlich sha256(token) als 64 Zeichen Hex. Der
-- Klartext existiert nur im Link des Cafés und ist nach dem Ausstellen nicht
-- rekonstruierbar. Geht er verloren, wird ein neuer ausgestellt.
--
-- Kein PBKDF2/Argon2/bcrypt und kein Salt: Beides schützt SCHWACHE
-- Geheimnisse gegen Offline-Raten. Der Token ist 256 Bit gleichverteilter
-- Zufall aus crypto.getRandomValues — dagegen gibt es weder ein
-- Rateverfahren noch eine Rainbow-Table. Ein Salt je Zeile würde außerdem die
-- Suche über uq_cat_token_hash unmöglich machen und jede Anfrage zu einem
-- Tabellenscan mit einer Hashberechnung pro Zeile machen.
--
-- Bewusst NICHT enthalten:
--   token          Klartext — siehe oben
--   expires_at     Ein Stammcafé bestellt seit Jahren. Ein Ablaufdatum wäre
--                  eine Störung ohne Gegenwert; Widerruf ist der Weg.
--   last_used_at   Ein Schreibvorgang bei jedem Seitenaufruf für eine
--                  Information, die niemand auswertet.
--   label          Niemand hat danach gefragt.
CREATE TABLE customer_access_tokens (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    token_hash  TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    revoked_at  TEXT,

    -- Die Eindeutigkeit hängt an der Datenbank. Sie ist zugleich der Index,
    -- über den bei jedem Seitenaufruf gesucht wird: ein Zugriff, kein Scan.
    CONSTRAINT uq_cat_token_hash UNIQUE (token_hash),

    -- Genau 64 Zeichen aus [0-9a-f]. Eine reine Längenprüfung ließe einen
    -- versehentlich eingetragenen Klartext-Token derselben Länge durch.
    -- NOT GLOB '*[^0-9a-f]*' ist das SQLite-Idiom für "besteht nur aus diesen
    -- Zeichen" und braucht genau eine Zeichenklasse.
    CONSTRAINT chk_cat_hash_form CHECK (
        length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),

    CONSTRAINT chk_cat_is_active_boolean CHECK (is_active IN (0, 1)),

    -- Ein Widerruf ohne Zeitpunkt wäre eine Behauptung ohne Beleg.
    CONSTRAINT chk_cat_revoked_consistent CHECK (is_active = 1 OR revoked_at IS NOT NULL),

    -- CASCADE, im Unterschied zu RESTRICT bei orders: Eine Bestellung ist ein
    -- historisches Dokument und muss einen gelöschten Kunden überleben. Ein
    -- Zugang ohne Kunden ist dagegen kein Dokument, sondern ein
    -- Sicherheitsproblem.
    CONSTRAINT fk_cat_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Deckt die Verwaltungssicht ab: "welche Zugänge hat dieses Café?".
-- Die Anfrage der Bestellseite läuft dagegen über uq_cat_token_hash.
CREATE INDEX idx_cat_customer ON customer_access_tokens (customer_id, is_active);
