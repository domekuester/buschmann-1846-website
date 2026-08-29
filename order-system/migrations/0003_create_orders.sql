-- Bestellungen.
--
-- Eine Bestellung ist ein DOKUMENT, keine Sicht auf den aktuellen
-- Stammdatenbestand. Deshalb tragen customer_name_snapshot und
-- delivery_address_snapshot den Stand zum Bestellzeitpunkt: Benennt ein Café
-- sich um oder zieht es um, ändert sich eine Bestellung von letzter Woche
-- nicht rückwirkend.
--
-- ZEIT: created_at und updated_at sind ZEITPUNKTE in ISO-8601-UTC
-- ('2026-08-23T07:00:00.000Z'). Feste Länge, deshalb ist die lexikografische
-- Ordnung die chronologische — ORDER BY created_at ist korrekt ohne
-- Datumsfunktion.
--
-- fulfillment_date ist dagegen ein TAG in Europe/Berlin ('JJJJ-MM-TT'), ohne
-- Uhrzeit und ohne Zeitzone, weil er fachlich keine hat. Ein Café bestellt
-- "für Freitag", nicht "für Freitag 14:32".
--
-- total_amount_cents wird beim Anlegen einmal geschrieben und danach nicht
-- mehr angefasst — dieselbe Begründung wie bei den Snapshots, und die
-- Tagesübersichten müssen dafür nicht über order_items aggregieren.
CREATE TABLE orders (
    id                        INTEGER PRIMARY KEY,
    order_number              TEXT    NOT NULL,
    customer_id               INTEGER NOT NULL,
    customer_name_snapshot    TEXT    NOT NULL,
    fulfillment_type          TEXT    NOT NULL,
    fulfillment_date          TEXT    NOT NULL,
    delivery_address_snapshot TEXT,
    note                      TEXT,
    status                    TEXT    NOT NULL DEFAULT 'new',
    total_amount_cents        INTEGER NOT NULL,
    created_at                TEXT    NOT NULL,
    updated_at                TEXT    NOT NULL,

    -- Die Eindeutigkeit hängt an der Datenbank, nicht am Anwendungscode. Sie
    -- ist zugleich die letzte Absicherung der Bestellnummernvergabe: Selbst
    -- wenn zwei gleichzeitige Anfragen dieselbe Nummer erhielten, käme die
    -- zweite Bestellung hier nicht durch.
    CONSTRAINT uq_orders_order_number UNIQUE (order_number),

    -- Form der Bestellnummer: BUS-JJJJ-NNNNNN, feste Länge 15.
    -- Kein GLOB mit zehn Zeichenklassen — SQLite lehnt ein solches Muster zur
    -- Laufzeit als "LIKE or GLOB pattern too complex" ab. NOT GLOB '*[^0-9]*'
    -- ist das übliche SQLite-Idiom für "besteht nur aus Ziffern" und braucht
    -- genau eine Klasse.
    CONSTRAINT chk_orders_number_format CHECK (
        length(order_number) = 15
        AND substr(order_number, 1, 4) = 'BUS-'
        AND substr(order_number, 9, 1) = '-'
        AND substr(order_number, 5, 4) NOT GLOB '*[^0-9]*'
        AND substr(order_number, 10, 6) NOT GLOB '*[^0-9]*'
    ),
    CONSTRAINT chk_orders_fulfillment   CHECK (fulfillment_type IN ('delivery', 'pickup')),
    CONSTRAINT chk_orders_status        CHECK (status IN ('new', 'confirmed', 'in_production', 'completed', 'cancelled')),
    -- Gültiger Kalendertag im Format JJJJ-MM-TT. date() normalisiert und
    -- liefert NULL für Unsinn; der IS-Vergleich behandelt dieses NULL als
    -- Verstoß (ein CHECK mit Ergebnis NULL würde sonst durchgehen). Damit
    -- scheitern auch '2026-02-30', '2026-13-01' und '2026-8-28'.
    CONSTRAINT chk_orders_date_valid CHECK (date(fulfillment_date) IS fulfillment_date),
    CONSTRAINT chk_orders_total_not_negative CHECK (total_amount_cents >= 0),
    CONSTRAINT chk_orders_total_is_integer   CHECK (typeof(total_amount_cents) = 'integer'),

    -- Eine Lieferung ohne Lieferadresse ist kein gültiges Dokument.
    CONSTRAINT chk_orders_delivery_needs_address CHECK (
        fulfillment_type <> 'delivery'
        OR (delivery_address_snapshot IS NOT NULL AND length(trim(delivery_address_snapshot)) > 0)
    ),

    -- RESTRICT: Ein Kunde mit Bestellungen wird deaktiviert, nicht gelöscht.
    -- Ein Löschverlangen wird als Anonymisierung umgesetzt; der Namens-
    -- Snapshot hält die Bestellung dann weiterhin lesbar.
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "Was ist für Freitag zu produzieren?" — die wichtigste Abfrage des Betriebs.
CREATE INDEX idx_orders_day ON orders (fulfillment_date, status);

-- "Die letzte Bestellung dieses Cafés" — Grundlage für "Bestellung wiederholen".
CREATE INDEX idx_orders_customer_day ON orders (customer_id, fulfillment_date);
