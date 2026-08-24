-- Bestellbare Produkte.
--
-- Produkte werden NIE gelöscht, sondern über is_active deaktiviert: Auf
-- order_items.product_id liegt ON DELETE RESTRICT, damit historische
-- Bestellungen ihren Bezug behalten.
--
-- unit ist ein freies Anzeigelabel ("Stück", "Blech", "kg") und geht in keine
-- Berechnung ein. Ein CHECK mit fester Werteliste würde jede neue Einheit zu
-- einer Migration machen.
--
-- GELD: price_cents ist ein INTEGER in ganzzahligen Cent. Kein DECIMAL, kein
-- REAL, kein Text. 48,00 EUR sind 4800. SQLite kennt keinen exakten
-- Dezimaltyp — REAL wäre ein Fließkommawert und damit genau der Fehler, den
-- Money.ts ausschließt.
CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    unit        TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,

    CONSTRAINT chk_products_name_not_blank    CHECK (length(trim(name)) > 0),
    CONSTRAINT chk_products_unit_not_blank    CHECK (length(trim(unit)) > 0),
    CONSTRAINT chk_products_price_not_negative CHECK (price_cents >= 0),
    -- typeof() schließt aus, dass ein Fließkommawert als Preis landet:
    -- 4.35 statt 435 wäre sonst ein gültiger INTEGER-Spaltenwert, weil SQLite
    -- den Typ nur empfiehlt.
    CONSTRAINT chk_products_price_is_integer  CHECK (typeof(price_cents) = 'integer'),
    CONSTRAINT chk_products_is_active_boolean CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_products_sort_not_negative CHECK (sort_order >= 0)
);

-- Deckt exakt die eine Abfrage der Bestellseite ab: das vollständige aktive
-- Sortiment in Anzeigereihenfolge, in einem Zugriff.
CREATE INDEX idx_products_orderable ON products (is_active, sort_order, id);
