-- ============================================================================
--  PLATZHALTERDATEN FÜR DIE ENTWICKLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Die Preise sind FREI ERFUNDEN und stellen keine echten Preise dar.
--  Verbindliche Fakten zum Sortiment stehen in content/FACTS.md; dort sind
--  keine Preise hinterlegt, und es werden hier auch keine erfunden, die als
--  echt missverstanden werden könnten.
-- ============================================================================

INSERT INTO products
    (name, description, unit_price, unit, is_active, sort_order, created_at, updated_at)
VALUES
    ('Beispielkuchen A', 'Platzhalter — Beschreibung folgt',  4.35, 'Stück', 1, 10, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispielkuchen B', NULL,                                2.80, 'Blech', 1, 20, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispieltorte C',  'Platzhalter — Beschreibung folgt', 24.00, 'Torte', 1, 30, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispielgebäck D', NULL,                                1.20, 'Stück', 1, 40, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Saisonartikel E',  'Nur zeitweise im Sortiment',        3.50, 'Stück', 0, 50, UTC_TIMESTAMP(), UTC_TIMESTAMP());
