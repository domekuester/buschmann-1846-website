-- Bestellpositionen.
--
-- unit_price ist der Preis-SNAPSHOT zum Bestellzeitpunkt, nicht der aktuelle
-- Produktpreis. Eine spätere Preisänderung darf historische Bestellungen
-- nicht verändern.
--
-- line_total wird von der Anwendung als unit_price * quantity berechnet und
-- einmal geschrieben. Der Konstruktor von OrderItem nimmt den Betrag gar
-- nicht erst entgegen — es gibt im Code keinen Weg, einen abweichenden Wert
-- zu setzen.
--
-- Die CHECK-Bedingungen setzt MariaDB ab 10.2 durch; ältere MySQL-Versionen
-- ignorieren sie stillschweigend. Die Domäne erzwingt dieselben Regeln
-- unabhängig davon — das Schema ist die zweite Verteidigungslinie.
CREATE TABLE order_items (
    id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_id              INT UNSIGNED  NOT NULL,
    product_id            INT UNSIGNED  NOT NULL,
    product_name_snapshot VARCHAR(120)  NOT NULL,
    product_unit_snapshot VARCHAR(20)   NOT NULL,
    unit_price            DECIMAL(10,2) NOT NULL,
    quantity              INT UNSIGNED  NOT NULL,
    line_total            DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    -- CASCADE: Positionen ohne Bestellung sind sinnlos.
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- RESTRICT: Ein je bestelltes Produkt darf nicht verschwinden.
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_order_items_quantity_positive  CHECK (quantity > 0),
    CONSTRAINT chk_order_items_price_not_negative CHECK (unit_price >= 0),
    CONSTRAINT chk_order_items_total_not_negative CHECK (line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
