-- Anmeldekonten — der Ersatz für den Capability-Link aus Phase 2.
--
-- Ein Café meldet sich mit Kundencode und 8-stelliger PIN an, ein
-- Buschmann-Mitarbeiter mit E-Mail und Passwort. Beide benutzen dasselbe
-- Formular und dieselbe Tabelle; unterschieden werden sie ausschließlich über
-- role.
--
-- IN DIESER TABELLE STEHT NIEMALS EIN KLARTEXTGEHEIMNIS.
--
-- Gespeichert wird ein Verifier:
--
--     PBKDF2-HMAC-SHA256(
--         password = HMAC-SHA256(key = AUTH_PEPPER, message = geheimnis),
--         salt     = 16 zufällige Byte je Konto,
--         c        = 600 000,
--         dkLen    = 32 Byte)
--
-- Der Pepper steht NICHT in dieser Datenbank. Wer einen Dump erbeutet, hat
-- damit 16 Byte Salt, 32 Byte Ergebnis und einen fehlenden 256-Bit-Schlüssel
-- — und kann nicht einmal anfangen zu raten. Das ist die eigentliche
-- Verteidigung; die Iterationszahl kauft darüber hinaus Zeit, keine
-- Sicherheit (eine 8-stellige PIN hat nur 10^8 Möglichkeiten).
--
-- WARUM ALGORITHMUS UND ITERATIONSZAHL JE ZEILE STEHEN
--
-- Ohne diese beiden Spalten wäre eine Erhöhung des Work Factors ein Flag Day:
-- Alle bestehenden Verifier würden ungültig, und niemand könnte sich mehr
-- anmelden. Mit ihnen ist sie ein Neuberechnen beim nächsten erfolgreichen
-- Login. Zwei Spalten sind der Preis dafür, dass diese Entscheidung je
-- revidierbar ist.
CREATE TABLE auth_accounts (
    id                          INTEGER PRIMARY KEY,

    -- Kundencode oder E-Mail, normalisiert nach src/domain/login-identifier.ts:
    -- NFKC, Formatzeichen entfernt, getrimmt, kleingeschrieben und auf den
    -- Zeichenvorrat [a-z0-9._@+-] beschränkt. Die Normalisierung ist idempotent
    -- — sonst wäre der bei der Provisionierung geschriebene Wert nicht
    -- zwingend gleich dem beim Login berechneten.
    login_identifier_normalized TEXT    NOT NULL,

    role                        TEXT    NOT NULL,

    -- Pflicht bei 'customer', verboten bei 'admin'. Siehe die beiden CHECKs
    -- weiter unten: Ein Admin ist kein Café mit mehr Rechten.
    customer_id                 INTEGER,

    credential_algorithm        TEXT    NOT NULL,
    credential_iterations       INTEGER NOT NULL,
    credential_salt             TEXT    NOT NULL,
    credential_verifier         TEXT    NOT NULL,

    is_active                   INTEGER NOT NULL DEFAULT 1,

    -- Bruteforce-Schutz. Gezählt wird in EINER UPDATE-Anweisung, damit zwei
    -- gleichzeitige Fehlversuche nicht denselben Stand lesen und
    -- zurückschreiben.
    failed_attempts             INTEGER NOT NULL DEFAULT 0,

    -- Zeitlich begrenzte Sperre, ISO-8601-UTC oder NULL. Sie läuft von selbst
    -- ab; es gibt bewusst keine manuelle Entsperrung. Der Lockout-DoS ist
    -- dokumentiert und in Kauf genommen: Eine Verzögerung, die von selbst
    -- endet, ist besser als ein dauerhafter Fremdzugriff.
    locked_until                TEXT,

    created_at                  TEXT    NOT NULL,
    updated_at                  TEXT    NOT NULL,

    -- Eine Kennung, ein Konto. Die Eindeutigkeit hängt an der Datenbank und
    -- ist zugleich der Index, über den bei jeder Anmeldung gesucht wird.
    CONSTRAINT uq_auth_accounts_identifier UNIQUE (login_identifier_normalized),

    CONSTRAINT chk_auth_accounts_identifier_not_blank CHECK (
        length(trim(login_identifier_normalized)) > 0
        AND length(login_identifier_normalized) <= 190
    ),

    -- Genau zwei Rollen. Kein manager, superadmin, accounting, production,
    -- editor, owner, moderator — es gibt heute niemanden, der eine davon hätte.
    CONSTRAINT chk_auth_accounts_role CHECK (role IN ('customer', 'admin')),

    -- Die beiden Invarianten aus der Spezifikation, als Schema.
    --
    -- Ein Café ohne Kundenbezug könnte nicht bestellen; ein Admin MIT
    -- Kundenbezug könnte im Namen eines Cafés bestellen, ohne dass es im
    -- Bestellablauf sichtbar wäre. Beides ist hier unmöglich.
    CONSTRAINT chk_auth_accounts_customer_required CHECK (
        role <> 'customer' OR customer_id IS NOT NULL
    ),
    CONSTRAINT chk_auth_accounts_admin_has_no_customer CHECK (
        role <> 'admin' OR customer_id IS NULL
    ),

    CONSTRAINT chk_auth_accounts_algorithm CHECK (credential_algorithm = 'pbkdf2-sha256'),

    -- Die Untergrenze im Schema, nicht im Code: src/infrastructure/auth/
    -- credential.ts ist ein Primitiv und rechnet mit dem, was es bekommt.
    -- Durchgesetzt wird die Grenze dort, wo geschrieben wird.
    CONSTRAINT chk_auth_accounts_iterations CHECK (
        typeof(credential_iterations) = 'integer' AND credential_iterations >= 100000
    ),

    -- 16 Byte als 32 Hex-Zeichen, 32 Byte als 64 Hex-Zeichen. Eine reine
    -- Längenprüfung ließe einen versehentlich eingetragenen Klartext gleicher
    -- Länge durch; NOT GLOB '*[^0-9a-f]*' ist das SQLite-Idiom für "besteht
    -- nur aus diesen Zeichen".
    CONSTRAINT chk_auth_accounts_salt_form CHECK (
        length(credential_salt) = 32 AND credential_salt NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT chk_auth_accounts_verifier_form CHECK (
        length(credential_verifier) = 64 AND credential_verifier NOT GLOB '*[^0-9a-f]*'
    ),

    CONSTRAINT chk_auth_accounts_is_active_boolean CHECK (is_active IN (0, 1)),

    CONSTRAINT chk_auth_accounts_failed_attempts CHECK (
        typeof(failed_attempts) = 'integer' AND failed_attempts >= 0
    ),

    -- CASCADE, wie bei customer_access_tokens und anders als bei orders:
    -- Eine Bestellung ist ein historisches Dokument und muss einen gelöschten
    -- Kunden überleben. Ein Anmeldekonto ohne Kunden ist kein Dokument,
    -- sondern ein Sicherheitsproblem.
    CONSTRAINT fk_auth_accounts_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Deckt die spätere Verwaltungssicht ab: "welches Konto hat dieses Café?".
-- Die Anmeldung selbst läuft über uq_auth_accounts_identifier.
CREATE INDEX idx_auth_accounts_customer ON auth_accounts (customer_id);
