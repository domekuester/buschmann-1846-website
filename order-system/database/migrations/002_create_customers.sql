-- Geschäftskunden (Cafés) und Privat-/Sonderkunden.
--
-- Datenminimierung ist Voreinstellung: Pflicht ist ausschließlich der Name.
-- Ansprechpartner, E-Mail und Telefon sind optional, weil ein Café zur
-- Bestellung keinen personenbezogenen Kontakt braucht.
--
-- internal_note ist für BETRIEBLICHE Hinweise ("Lieferung an der Rückseite").
-- Niemals für Angaben über Personen, niemals für besondere Datenkategorien.
--
-- Die Regel "Standardlieferung => Lieferadresse" verbindet mehrere Spalten und
-- steht deshalb in Customer.php, wo sie eine verständliche Meldung erzeugt.
CREATE TABLE customers (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                 VARCHAR(120) NOT NULL,
    contact_person       VARCHAR(120)     NULL,
    email                VARCHAR(190)     NULL,
    phone                VARCHAR(40)      NULL,
    delivery_street      VARCHAR(160)     NULL,
    delivery_postal_code VARCHAR(10)      NULL,
    delivery_city        VARCHAR(100)     NULL,
    is_active            TINYINT(1)   NOT NULL DEFAULT 1,
    default_fulfillment  ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery',
    internal_note        TEXT             NULL,
    created_at           DATETIME     NOT NULL,
    updated_at           DATETIME     NOT NULL,
    PRIMARY KEY (id),
    KEY idx_customers_active_name (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
