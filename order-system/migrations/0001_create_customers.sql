-- Geschäftskunden (Cafés) und Privat-/Sonderkunden.
--
-- Datenminimierung ist Voreinstellung: Pflicht ist ausschließlich der Name.
-- Ansprechpartner, E-Mail und Telefon sind optional, weil ein Café zur
-- Bestellung keinen personenbezogenen Kontakt braucht.
--
-- internal_note ist für BETRIEBLICHE Hinweise ("Lieferung an der Rückseite").
-- Niemals für Angaben über Personen, niemals für besondere Datenkategorien.
--
-- SQLite kennt kein ENUM und kein BOOLEAN. Beides wird über CHECK abgebildet:
-- Die Anwendung bleibt die erste Verteidigungslinie, das Schema die zweite.
CREATE TABLE customers (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT    NOT NULL,
    contact_person       TEXT,
    email                TEXT,
    phone                TEXT,
    delivery_street      TEXT,
    delivery_postal_code TEXT,
    delivery_city        TEXT,
    is_active            INTEGER NOT NULL DEFAULT 1,
    default_fulfillment  TEXT    NOT NULL DEFAULT 'delivery',
    internal_note        TEXT,
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL,

    CONSTRAINT chk_customers_name_not_blank    CHECK (length(trim(name)) > 0),
    CONSTRAINT chk_customers_is_active_boolean CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_customers_fulfillment       CHECK (default_fulfillment IN ('delivery', 'pickup')),

    -- Dieselbe Invariante wie in Customer: Wer standardmäßig beliefert wird,
    -- braucht eine vollständige Lieferadresse. Die verständliche Fehlermeldung
    -- entsteht in der Domäne; hier steht nur die Absicherung dagegen, dass ein
    -- Datensatz auf anderem Weg in diesen Zustand gerät.
    CONSTRAINT chk_customers_delivery_needs_address CHECK (
        default_fulfillment <> 'delivery'
        OR (delivery_street IS NOT NULL
            AND delivery_postal_code IS NOT NULL
            AND delivery_city IS NOT NULL)
    )
);

-- Deckt die Kundenliste des Backoffice ab: aktive Kunden alphabetisch.
CREATE INDEX idx_customers_active_name ON customers (is_active, name);
