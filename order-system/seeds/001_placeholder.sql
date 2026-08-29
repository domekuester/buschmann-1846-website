-- ============================================================================
--  PLATZHALTERDATEN FÜR DIE ENTWICKLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Es sind KEINE echten Kunden, Adressen, Kontaktdaten oder Preise enthalten,
--  und es dürfen auch keine eingetragen werden. Die Preise sind FREI ERFUNDEN.
--  Verbindliche Angaben zum Sortiment stehen in content/FACTS.md; dort sind
--  keine Preise hinterlegt, und es werden hier auch keine erfunden, die als
--  echt missverstanden werden könnten.
--
--  Echte Kundendaten gehören in die produktive Datenbank, niemals in ein
--  Repository.
--
--  ┌──────────────────────────────────────────────────────────────────────┐
--  │  SEIT PHASE 5C UNVOLLSTÄNDIG — für den Bestellfluss 002 VERWENDEN.    │
--  │                                                                      │
--  │  Diese Datei legt Produkte OHNE Katalogbezug an                      │
--  │  (products.catalog_product_id bleibt NULL) und Kunden OHNE           │
--  │  Preisgruppe. Beides ist seit Phase 5C ein gültiger, aber            │
--  │  unbepreisbarer Zustand: Die Bestellseite zeigt dann bei jedem       │
--  │  Produkt „Preis auf Anfrage" und nimmt keine Bestellung an.          │
--  │                                                                      │
--  │  Das ist KEIN Fehler dieser Datei, sondern genau das Verhalten, das  │
--  │  5C verlangt — geraten wird kein Preis. Wer den Bestellfluss lokal   │
--  │  ausprobieren will, nimmt 002_cafe_ordering_dev.sql: Dort sind       │
--  │  Katalog, Preise, Verknüpfungen und Preisgruppen vollständig.        │
--  └──────────────────────────────────────────────────────────────────────┘
--
--  Anwenden:  npm run db:seed:local
-- ============================================================================

DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM order_number_sequences;
DELETE FROM products;
DELETE FROM customers;

-- Preise in ganzzahligen Cent: 435 = 4,35 EUR.
INSERT INTO products (name, description, price_cents, unit, is_active, sort_order, created_at, updated_at) VALUES
    ('Beispielkuchen A', 'Platzhalter — Beschreibung folgt',  435, 'Stück', 1, 10, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Beispielkuchen B', NULL,                                280, 'Blech', 1, 20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Beispieltorte C',  'Platzhalter — Beschreibung folgt', 2400, 'Torte', 1, 30, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Beispielgebäck D', NULL,                                120, 'Stück', 1, 40, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Saisonartikel E',  'Nur zeitweise im Sortiment',        350, 'Stück', 0, 50, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO customers (name, contact_person, email, phone, delivery_street, delivery_postal_code,
                       delivery_city, is_active, default_fulfillment, internal_note, created_at, updated_at) VALUES
    ('Beispielcafé Nord', NULL, NULL, NULL, 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
     'Platzhalter — betrieblicher Hinweis, niemals Angaben über Personen',
     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Beispielcafé Süd', NULL, NULL, NULL, 'Beispielallee 22', '40215', 'Düsseldorf', 1, 'delivery', NULL,
     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Beispiel-Abholkunde', NULL, NULL, NULL, NULL, NULL, NULL, 1, 'pickup', NULL,
     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('Ehemaliges Beispielcafé', NULL, NULL, NULL, 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', NULL,
     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
