-- Bestellbare Produkte.
--
-- Produkte werden NIE gelöscht, sondern über is_active deaktiviert: Auf
-- order_items.product_id liegt ON DELETE RESTRICT, damit historische
-- Bestellungen ihren Bezug behalten.
--
-- unit ist ein freies Anzeigelabel ("Stück", "Blech", "kg") und geht in keine
-- Berechnung ein. Eine ENUM hier würde jede neue Einheit zu einem Deployment
-- machen.
--
-- Geld als DECIMAL(10,2): exakt, in Backups und Auswertungen lesbar, und
-- summierbar per SQL. Die Anwendung rechnet in ganzzahligen Cent (Money.php);
-- die Umwandlung liegt an genau einer getesteten Stelle.
CREATE TABLE products (
    id          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    name        VARCHAR(120)   NOT NULL,
    description VARCHAR(500)       NULL,
    unit_price  DECIMAL(10,2)  NOT NULL,
    unit        VARCHAR(20)    NOT NULL,
    is_active   TINYINT(1)     NOT NULL DEFAULT 1,
    sort_order  INT            NOT NULL DEFAULT 0,
    created_at  DATETIME       NOT NULL,
    updated_at  DATETIME       NOT NULL,
    PRIMARY KEY (id),
    -- Deckt exakt die eine Abfrage der Bestellseite ab: das vollständige
    -- aktive Sortiment in Anzeigereihenfolge, in einem Zugriff.
    KEY idx_products_orderable (is_active, sort_order, id),
    CONSTRAINT chk_products_price_not_negative CHECK (unit_price >= 0),
    CONSTRAINT chk_products_sort_not_negative  CHECK (sort_order >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
