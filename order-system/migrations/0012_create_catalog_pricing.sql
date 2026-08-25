-- Paralleles Sortiment für die echten Gastro- und Privatpreislisten.
--
-- Diese Tabellen sind absichtlich NICHT mit products.price_cents verdrahtet:
-- products bleibt in Phase 5A die unveränderte Preisquelle des bestehenden
-- Bestellflows. Ein Katalogprodukt steht hier genau einmal und kann je
-- Preisliste höchstens eine quelltreue Preisangabe besitzen.

CREATE TABLE price_lists (
    id         INTEGER PRIMARY KEY,
    code       TEXT    NOT NULL UNIQUE,
    label      TEXT    NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT chk_price_lists_code_not_blank  CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_price_lists_label_not_blank CHECK (length(trim(label)) > 0),
    CONSTRAINT chk_price_lists_active_boolean  CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_price_lists_sort            CHECK (sort_order >= 0 AND typeof(sort_order) = 'integer')
);

-- Nur die fachlich bestätigten Preislistenidentitäten, keine Produktpreise.
INSERT INTO price_lists (id, code, label, is_active, sort_order) VALUES
    (1, 'gastro',  'Gastronomie',  1, 10),
    (2, 'private', 'Privatkunden', 1, 20);

CREATE TABLE catalog_products (
    id         INTEGER PRIMARY KEY,
    source_key TEXT    NOT NULL UNIQUE,
    name       TEXT    NOT NULL,
    variant    TEXT,
    unit       TEXT    NOT NULL,
    category   TEXT,
    is_active  INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,

    CONSTRAINT chk_catalog_products_source_not_blank CHECK (length(trim(source_key)) > 0),
    CONSTRAINT chk_catalog_products_name_not_blank   CHECK (length(trim(name)) > 0),
    CONSTRAINT chk_catalog_products_variant          CHECK (variant IS NULL OR length(trim(variant)) > 0),
    CONSTRAINT chk_catalog_products_unit_not_blank   CHECK (length(trim(unit)) > 0),
    CONSTRAINT chk_catalog_products_category         CHECK (category IS NULL OR length(trim(category)) > 0),
    CONSTRAINT chk_catalog_products_active_boolean   CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_catalog_products_sort             CHECK (sort_order >= 0 AND typeof(sort_order) = 'integer')
);

CREATE TABLE catalog_product_prices (
    id              INTEGER PRIMARY KEY,
    product_id      INTEGER NOT NULL,
    price_list_id   INTEGER NOT NULL,
    price_type      TEXT    NOT NULL,
    price_cents     INTEGER,
    min_price_cents INTEGER,
    max_price_cents INTEGER,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,

    CONSTRAINT uq_catalog_product_price UNIQUE (product_id, price_list_id),
    CONSTRAINT chk_catalog_price_type CHECK (price_type IN ('fixed', 'from', 'range', 'on_request')),
    CONSTRAINT chk_catalog_price_cents CHECK (
      price_cents IS NULL OR (typeof(price_cents) = 'integer' AND price_cents >= 0)
    ),
    CONSTRAINT chk_catalog_min_price_cents CHECK (
      min_price_cents IS NULL OR (typeof(min_price_cents) = 'integer' AND min_price_cents >= 0)
    ),
    CONSTRAINT chk_catalog_max_price_cents CHECK (
      max_price_cents IS NULL OR (typeof(max_price_cents) = 'integer' AND max_price_cents >= 0)
    ),
    CONSTRAINT chk_catalog_price_shape CHECK (
      (price_type = 'fixed' AND price_cents IS NOT NULL AND min_price_cents IS NULL AND max_price_cents IS NULL)
      OR
      (price_type = 'from' AND price_cents IS NULL AND min_price_cents IS NOT NULL AND max_price_cents IS NULL)
      OR
      (price_type = 'range' AND price_cents IS NULL AND min_price_cents IS NOT NULL
                            AND max_price_cents IS NOT NULL AND min_price_cents <= max_price_cents)
      OR
      (price_type = 'on_request' AND price_cents IS NULL AND min_price_cents IS NULL AND max_price_cents IS NULL)
    ),

    CONSTRAINT fk_catalog_price_product FOREIGN KEY (product_id)
      REFERENCES catalog_products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_catalog_price_list FOREIGN KEY (price_list_id)
      REFERENCES price_lists(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
