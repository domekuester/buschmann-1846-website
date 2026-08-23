-- Bestellungen.
--
-- Eine Bestellung ist ein DOKUMENT, keine Sicht auf den aktuellen
-- Stammdatenbestand. Deshalb tragen customer_name_snapshot und
-- delivery_address_snapshot den Stand zum Bestellzeitpunkt: Benennt ein Café
-- sich um oder zieht es um, ändert sich eine Bestellung von letzter Woche
-- nicht rückwirkend.
--
-- total_amount wird beim Anlegen einmal geschrieben und danach nicht mehr
-- angefasst — dieselbe Begründung, und die Tagesübersichten der Phase 2
-- müssen dafür nicht über order_items aggregieren.
--
-- fulfillment_date ist DATE: Ein Café bestellt "für Freitag", nicht "für
-- Freitag 14:32".
--
-- Zeitstempel in UTC, geschrieben von der Anwendung. Kein TIMESTAMP, dessen
-- Zeitzonenverhalten von der Serverkonfiguration abhängt.
CREATE TABLE orders (
    id                        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_number              VARCHAR(20)   NOT NULL,
    customer_id               INT UNSIGNED  NOT NULL,
    customer_name_snapshot    VARCHAR(120)  NOT NULL,
    fulfillment_type          ENUM('delivery','pickup') NOT NULL,
    fulfillment_date          DATE          NOT NULL,
    delivery_address_snapshot VARCHAR(400)      NULL,
    note                      VARCHAR(500)      NULL,
    status                    ENUM('new','confirmed','in_production','completed','cancelled')
                                            NOT NULL DEFAULT 'new',
    total_amount              DECIMAL(10,2) NOT NULL,
    created_at                DATETIME      NOT NULL,
    updated_at                DATETIME      NOT NULL,
    PRIMARY KEY (id),
    -- Die Eindeutigkeit hängt an der Datenbank, nicht am Anwendungscode.
    UNIQUE KEY uq_orders_order_number (order_number),
    -- "Was ist für Freitag zu produzieren?" — die wichtigste Abfrage des Betriebs.
    KEY idx_orders_day (fulfillment_date, status),
    -- "Die letzte Bestellung dieses Cafés" — Grundlage für "Bestellung wiederholen".
    KEY idx_orders_customer_day (customer_id, fulfillment_date),
    -- RESTRICT: Ein Kunde mit Bestellungen wird deaktiviert, nicht gelöscht.
    -- Ein Löschverlangen wird als Anonymisierung umgesetzt; der Namens-
    -- Snapshot hält die Bestellung dann weiterhin lesbar.
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_orders_total_not_negative CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
