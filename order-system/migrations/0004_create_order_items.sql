-- Bestellpositionen.
--
-- unit_price_cents ist der Preis-SNAPSHOT zum Bestellzeitpunkt, nicht der
-- aktuelle Produktpreis. Eine spätere Preisänderung darf historische
-- Bestellungen nicht verändern. product_name_snapshot und
-- product_unit_snapshot halten die Position außerdem lesbar, wenn ein Produkt
-- längst umbenannt oder deaktiviert wurde.
--
-- line_total_cents wird von der Anwendung als unit_price_cents * quantity
-- berechnet und einmal geschrieben. Der Konstruktor von OrderItem nimmt den
-- Betrag gar nicht erst entgegen — es gibt im Code keinen Weg, einen
-- abweichenden Wert zu setzen. Das CHECK darunter prüft dieselbe Rechnung
-- noch einmal in der Datenbank.
CREATE TABLE order_items (
    id                    INTEGER PRIMARY KEY,
    order_id              INTEGER NOT NULL,
    product_id            INTEGER NOT NULL,
    product_name_snapshot TEXT    NOT NULL,
    product_unit_snapshot TEXT    NOT NULL,
    unit_price_cents      INTEGER NOT NULL,
    quantity              INTEGER NOT NULL,
    line_total_cents      INTEGER NOT NULL,

    -- Dasselbe Produkt zweimal in einer Bestellung wäre eine Position zu viel,
    -- keine zweite Zeile. Die Domäne lehnt es ab, das Schema ebenso.
    CONSTRAINT uq_order_items_product UNIQUE (order_id, product_id),

    CONSTRAINT chk_order_items_quantity_positive  CHECK (quantity > 0),
    CONSTRAINT chk_order_items_quantity_integer   CHECK (typeof(quantity) = 'integer'),
    CONSTRAINT chk_order_items_price_not_negative CHECK (unit_price_cents >= 0),
    CONSTRAINT chk_order_items_price_integer      CHECK (typeof(unit_price_cents) = 'integer'),
    CONSTRAINT chk_order_items_total_not_negative CHECK (line_total_cents >= 0),
    CONSTRAINT chk_order_items_name_not_blank     CHECK (length(trim(product_name_snapshot)) > 0),
    CONSTRAINT chk_order_items_unit_not_blank     CHECK (length(trim(product_unit_snapshot)) > 0),

    -- Die Rechnung selbst als Constraint. Ein manipulierter oder falsch
    -- berechneter Positionsbetrag kommt hier nicht durch.
    CONSTRAINT chk_order_items_total_is_product CHECK (line_total_cents = unit_price_cents * quantity),

    -- CASCADE: Positionen ohne Bestellung sind sinnlos.
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,

    -- RESTRICT: Ein je bestelltes Produkt darf nicht verschwinden.
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_order_items_order   ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);
