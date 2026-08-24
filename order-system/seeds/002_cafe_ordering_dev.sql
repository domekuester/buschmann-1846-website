-- ============================================================================
--  ENTWICKLUNGSDATEN FÜR DIE CAFÉ-BESTELLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Alles hier ist FREI ERFUNDEN: die Cafés, die Adressen, das Sortiment und
--  die Preise. Es sind keine echten Buschmann-Kunden, keine echten
--  Kontaktdaten und keine echten Preise enthalten — und es dürfen auch keine
--  eingetragen werden. Echte Kundendaten gehören in die produktive Datenbank,
--  niemals in ein Repository.
--
--  ╔══════════════════════════════════════════════════════════════════════╗
--  ║  DIE HIER HINTERLEGTEN ZUGANGSTOKEN SIND ÖFFENTLICH BEKANNT.         ║
--  ║  Sie stehen im Klartext in dieser Datei, in Git und in jedem Klon.   ║
--  ║  Sie dürfen ausschließlich gegen eine LOKALE D1 verwendet werden.    ║
--  ║  Für echte Cafés: npm run token:issue -- --customer <id>             ║
--  ╚══════════════════════════════════════════════════════════════════════╝
--
--  Bestell-Links nach dem Einspielen (bei `npm run dev`):
--
--    Testcafé Nord (Lieferung):
--    http://127.0.0.1:8787/o/DEV-nur-lokal-Testcafe-Nord-kein-Echtbetrieb
--
--    Testcafé Süd (Abholung — fragt trotzdem nicht nach Lieferung/Abholung):
--    http://127.0.0.1:8787/o/DEV-nur-lokal-Testcafe-Sued-kein-Echtbetrieb
--
--    Widerrufener Zugang (muss die Ablehnungsseite zeigen):
--    http://127.0.0.1:8787/o/DEV-nur-lokal-widerrufen-kein-Echtbetrieb00
--
--  Anwenden:  npm run db:seed:cafe:local
-- ============================================================================

DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM customer_access_tokens;
DELETE FROM order_number_sequences;
DELETE FROM products;
DELETE FROM customers;

-- Preise in ganzzahligen Cent: 435 = 4,35 EUR. Erfunden.
INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, created_at, updated_at) VALUES
    (1, 'Beispiel Käsekuchen',    'Platzhalter — Beschreibung folgt', 435, 'Stück', 1, 10, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (2, 'Beispiel Streuselblech', NULL,                               280, 'Blech', 1, 20, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (3, 'Beispiel Butterkuchen',  'Platzhalter — Beschreibung folgt', 320, 'Blech', 1, 30, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (4, 'Beispiel Obsttorte',     NULL,                              2400, 'Torte', 1, 40, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (5, 'Beispiel Franzbrötchen', 'Platzhalter — Beschreibung folgt', 120, 'Stück', 1, 50, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- Muss auf der Bestellseite FEHLEN. Ein Sortiment ohne inaktives Produkt
    -- prüft die Filterung nicht.
    (9, 'Beispiel Saisontorte',   'Nur zeitweise im Sortiment',       350, 'Torte', 0, 60, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

INSERT INTO customers (id, name, contact_person, email, phone, delivery_street, delivery_postal_code,
                       delivery_city, is_active, default_fulfillment, internal_note, created_at, updated_at) VALUES
    -- internal_note ist absichtlich gefüllt: Es darf auf keiner Seite auftauchen.
    (1, 'Testcafé Nord', NULL, NULL, NULL, 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
     'Platzhalter — betrieblicher Hinweis, darf niemals in der Oberfläche erscheinen',
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (2, 'Testcafé Süd', NULL, NULL, NULL, NULL, NULL, NULL, 1, 'pickup', NULL,
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- Deaktiviertes Café: Sein Token ist gültig, die Seite muss trotzdem
    -- ablehnen — und zwar nicht unterscheidbar von einem unbekannten Token.
    (3, 'Ehemaliges Testcafé', NULL, NULL, NULL, 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', NULL,
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

-- NUR HASHES. Der Klartext steht oben im Kommentar, weil dies
-- Entwicklungsdaten sind — in einer echten Datenbank existiert er nirgends.
INSERT INTO customer_access_tokens (customer_id, token_hash, is_active, created_at, revoked_at) VALUES
    -- sha256('DEV-nur-lokal-Testcafe-Nord-kein-Echtbetrieb')
    (1, '33f8b19f7b9fce5a90b3a1444e535e353f825fb8ea64099db40b979c161593bd', 1, '2026-08-24T06:00:00.000Z', NULL),
    -- sha256('DEV-nur-lokal-Testcafe-Sued-kein-Echtbetrieb')
    (2, '1b6a2f8020c88c38ed27b2c80714235cdaa500a57a62c843946519aa98a8e4f1', 1, '2026-08-24T06:00:00.000Z', NULL),
    -- sha256('DEV-nur-lokal-widerrufen-kein-Echtbetrieb00') — widerrufen
    (1, '6d2aef5d4a53ed2c4d45e49e339f9fa033820f54e6bedef6459dfadc6d949912', 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:30:00.000Z');
