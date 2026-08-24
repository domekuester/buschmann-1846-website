-- ============================================================================
--  ENTWICKLUNGSDATEN FÜR DEN CAFÉ-BESTELLFLUSS — NICHT PRODUKTIV EINSPIELEN
--
--  Alles hier ist FREI ERFUNDEN: die Cafés, die Adressen, das Sortiment, die
--  Preise und die Zugangsdaten. Es sind keine echten Buschmann-Kunden, keine
--  echten Kontaktdaten und keine echten Preise enthalten — und es dürfen auch
--  keine eingetragen werden. Echte Kundendaten gehören in die produktive
--  Datenbank, niemals in ein Repository.
--
--  ╔══════════════════════════════════════════════════════════════════════╗
--  ║  DIE HIER HINTERLEGTEN ZUGANGSDATEN SIND ÖFFENTLICH BEKANNT.         ║
--  ║  Kundencodes, PINs und das Admin-Passwort stehen im Klartext in      ║
--  ║  diesem Kommentar, in Git und in jedem Klon. Sie dürfen              ║
--  ║  ausschließlich gegen eine LOKALE D1 verwendet werden.               ║
--  ╚══════════════════════════════════════════════════════════════════════╝
--
--  Anmeldung unter http://127.0.0.1:8787/login (bei `npm run dev`):
--
--    Testcafé Nord (Lieferung)
--      Kundencode  TESTCAFE
--      PIN         01234567        ← führende Null ausdrücklich
--
--    Testcafé Süd (Abholung — fragt trotzdem nicht nach Lieferung/Abholung)
--      Kundencode  TESTSUED
--      PIN         00000042        ← zwei führende Nullen, ebenfalls Absicht
--
--    Ehemaliges Testcafé (Konto aktiv, Café deaktiviert)
--      Kundencode  EHEMALIG
--      PIN         01234567
--      → muss dieselbe generische Ablehnung zeigen wie ein falscher Zugang
--
--    Administration
--      E-Mail      admin@example.test
--      Passwort    demo-admin-passwort-nur-lokal
--
--  ┌──────────────────────────────────────────────────────────────────────┐
--  │  DIESE VERIFIER GELTEN NUR MIT DEM ENTWICKLUNGS-PEPPER AUS           │
--  │  .dev.vars.example:                                                  │
--  │                                                                      │
--  │    DEV-PEPPER-oeffentlich-bekannt-nur-lokal-kein-Echtbetrieb         │
--  │                                                                      │
--  │  Ein Verifier hängt am Pepper. Wer lokal einen anderen benutzt,      │
--  │  kommt mit diesen Konten nicht herein — und legt sich stattdessen    │
--  │  eigene an:                                                          │
--  │                                                                      │
--  │    npm run auth:account -- --role customer \                          │
--  │        --identifier TESTCAFE --customer 1 --secret 01234567          │
--  └──────────────────────────────────────────────────────────────────────┘
--
--  Anwenden:  npm run db:seed:cafe:local
-- ============================================================================

DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM auth_sessions;
DELETE FROM auth_accounts;
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
    -- Deaktiviertes Café: Sein Konto ist gültig, die Anmeldung muss trotzdem
    -- scheitern — und zwar ununterscheidbar von einer falschen PIN.
    (3, 'Ehemaliges Testcafé', NULL, NULL, NULL, 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', NULL,
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

-- NUR VERIFIER. Die PINs und das Passwort stehen oben im Kommentar, weil dies
-- Entwicklungsdaten sind — in einer echten Datenbank existieren sie nirgends.
--
-- Jede Zeile trägt ihren eigenen Salt und ihre eigene Iterationszahl. Dass die
-- beiden Cafés mit derselben PIN verschiedene Verifier haben, ist genau der
-- Zweck des Salts: Ein Blick in die Tabelle verrät nicht, wer dieselbe PIN
-- benutzt.
INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                           credential_algorithm, credential_iterations,
                           credential_salt, credential_verifier,
                           is_active, failed_attempts, created_at, updated_at) VALUES
    (1, 'testcafe', 'customer', 1, 'pbkdf2-sha256', 600000,
     'c18cfdddeb35a4181f6c7212bd421dd4', '7b9324c25dad5c800e40c3df9b867f13eff59f0e7b1a4e3ee3b93643fcbe3d7b', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (2, 'testsued', 'customer', 2, 'pbkdf2-sha256', 600000,
     'f02663e71c7286014fdbc56022c9e4a7', 'b15962db31d8842de10c0f1f9ba404dedbf7c8724edac5cd5aee15604158304b', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (3, 'ehemalig', 'customer', 3, 'pbkdf2-sha256', 600000,
     'f480c8b51cc3eae195806f542fab1050', '8c4e50433823d5f897e961f396dde0835df87d52cdcaaa76279f235a7946dd99', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- customer_id ist NULL und muss es sein: Ein Admin ist kein Café mit mehr
    -- Rechten. Das Schema lehnt jede andere Zeile ab.
    (4, 'admin@example.test', 'admin', NULL, 'pbkdf2-sha256', 600000,
     '9a474740fa36ebc1cf463bb1bbfe7400', '8d93be0f95600543e3645292455c7d38e29abe201497e179bb4cadabd2e3ab47', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');
