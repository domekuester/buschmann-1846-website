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
--    Testkunde Privat (PREISGRUPPE: Privatkunden)
--      Kundencode  TESTPRIV
--      PIN         00000042
--      → sieht DIESELBEN Produkte wie TESTCAFE, aber zu Privatpreisen.
--        Der Vergleich beider Anmeldungen ist die Probe auf Phase 5C.
--
--    Testkunde ohne Preisgruppe
--      Kundencode  TESTOHNE
--      PIN         01234567
--      → sieht KEINE Preise und kann nichts bestellen; die Seite erklärt,
--        warum. Kein Rückfall auf Gastro- oder Privatpreise.
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

-- Reihenfolge wegen der Fremdschlüssel. products hängt seit Migration 0014 an
-- catalog_products und muss deshalb VOR dem Katalog geleert werden.
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM auth_sessions;
DELETE FROM auth_accounts;
DELETE FROM order_number_sequences;
DELETE FROM products;
DELETE FROM catalog_product_prices;
DELETE FROM catalog_products;
DELETE FROM customers;

-- ----------------------------------------------------------------------------
--  KATALOG UND PREISE — SEIT PHASE 5C DIE PREISQUELLE
--
--  Bis Phase 5B war products.price_cents der Preis. Seit 5C kommt er aus
--  catalog_product_prices, ausgewählt über die Preisgruppe des angemeldeten
--  Kunden. products.price_cents wird vom Bestellfluss NICHT MEHR GELESEN;
--  die Spalte ist unten deshalb mit 0 belegt, damit niemand die alten Werte
--  für gültig hält.
--
--  ALLE PREISE HIER SIND FREI ERFUNDEN. Die echten Gastro- und Privatpreise
--  stehen in order-system/source-data/ und gehören in kein Repository.
--
--  Absichtlich enthalten sind alle vier Preisformen UND zwei Sonderfälle —
--  ein Sortiment, in dem alles ein Festpreis ist, prüft Phase 5C nicht:
--
--    Käsekuchen      fixed / fixed        → bestellbar, beide Gruppen
--    Streuselblech   fixed / fixed        → Gastro billiger als Privat
--    Butterkuchen    fixed / —            → für Privatkunden NICHT bepreist
--    Obsttorte       from  / from         → „ab …", nicht direkt bestellbar
--    Franzbrötchen   range / on_request   → Spanne bzw. „Auf Anfrage"
--    Hochzeitstorte  on_request/on_request→ „Auf Anfrage"
--    Baumkuchen      (unverknüpft)        → kein Katalogbezug, nicht bepreisbar
-- ----------------------------------------------------------------------------
INSERT INTO catalog_products (id, source_key, name, variant, unit, category, is_active, sort_order, created_at, updated_at) VALUES
    (101, 'dev-kaesekuchen',    'Beispiel Käsekuchen',    NULL, 'Stück', 'Kuchen', 1, 10, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (102, 'dev-streuselblech',  'Beispiel Streuselblech', NULL, 'Blech', 'Kuchen', 1, 20, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (103, 'dev-butterkuchen',   'Beispiel Butterkuchen',  NULL, 'Blech', 'Kuchen', 1, 30, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (104, 'dev-obsttorte',      'Beispiel Obsttorte',     NULL, 'Torte', 'Torten', 1, 40, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (105, 'dev-franzbroetchen', 'Beispiel Franzbrötchen', NULL, 'Stück', 'Gebäck', 1, 50, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (106, 'dev-hochzeitstorte', 'Beispiel Hochzeitstorte',NULL, 'Torte', 'Torten', 1, 60, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (109, 'dev-saisontorte',    'Beispiel Saisontorte',   NULL, 'Torte', 'Torten', 1, 70, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

INSERT INTO catalog_product_prices (product_id, price_list_id, price_type, price_cents, min_price_cents, max_price_cents, created_at, updated_at) VALUES
    -- Gastronomie (price_list_id = 1)
    (101, 1, 'fixed',       435,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (102, 1, 'fixed',      2800,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (103, 1, 'fixed',      3200,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (104, 1, 'from',       NULL,  2400, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (105, 1, 'range',      NULL,   120,  180, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (106, 1, 'on_request', NULL,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (109, 1, 'fixed',      3500,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- Privatkunden (price_list_id = 2) — durchweg höher als Gastro.
    -- Butterkuchen (103) fehlt hier ABSICHTLICH: Er muss für einen
    -- Privatkunden als „nicht bepreist" erscheinen und NICHT als 0,00 €.
    (101, 2, 'fixed',       520,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (102, 2, 'fixed',      3400,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (104, 2, 'from',       NULL,  2900, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (105, 2, 'on_request', NULL,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (106, 2, 'on_request', NULL,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (109, 2, 'fixed',      4200,  NULL, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

-- price_cents ist 0 und BEDEUTET NICHTS. Der Bestellfluss liest die Spalte
-- seit 5C nicht mehr (siehe product-repository.ts); ein alter Wert stünde nur
-- da, um irgendwann für einen Preis gehalten zu werden.
INSERT INTO products (id, name, description, price_cents, unit, is_active, sort_order, catalog_product_id, created_at, updated_at) VALUES
    (1, 'Beispiel Käsekuchen',     'Platzhalter — Beschreibung folgt', 0, 'Stück', 1, 10,  101, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (2, 'Beispiel Streuselblech',  NULL,                               0, 'Blech', 1, 20,  102, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (3, 'Beispiel Butterkuchen',   'Platzhalter — Beschreibung folgt', 0, 'Blech', 1, 30,  103, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (4, 'Beispiel Obsttorte',      NULL,                               0, 'Torte', 1, 40,  104, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (5, 'Beispiel Franzbrötchen',  'Platzhalter — Beschreibung folgt', 0, 'Stück', 1, 50,  105, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    (6, 'Beispiel Hochzeitstorte', 'Nur nach Absprache',               0, 'Torte', 1, 60,  106, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- OHNE Katalogbezug. Muss auf der Bestellseite als „nicht bepreisbar"
    -- erscheinen — nicht als 0,00 € und nicht mit Mengenauswahl.
    (7, 'Beispiel Baumkuchen',     'Noch nicht mit dem Katalog verknüpft', 0, 'Stück', 1, 70, NULL, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- Muss auf der Bestellseite FEHLEN. Ein Sortiment ohne inaktives Produkt
    -- prüft die Filterung nicht.
    (9, 'Beispiel Saisontorte',    'Nur zeitweise im Sortiment',       0, 'Torte', 0, 80,  109, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

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
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- Privatkunde: gleiche Produkte, andere Preiswelt.
    (4, 'Testkunde Privat', NULL, NULL, NULL, NULL, NULL, NULL, 1, 'pickup', NULL,
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- OHNE Preisgruppe. Muss sich anmelden können und trotzdem nichts
    -- bestellen können — Phase 5C sperrt das Preisen, nicht den Zugang.
    (5, 'Testkunde ohne Preisgruppe', NULL, NULL, NULL, NULL, NULL, NULL, 1, 'pickup', NULL,
     '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');

-- ----------------------------------------------------------------------------
--  PREISGRUPPEN — EINZELN UND BEWUSST, NIEMALS PER DEFAULT
--
--  Kunde 5 bekommt KEINE. Das ist kein vergessener Eintrag, sondern der
--  Zustand, den Phase 5C beherrschen muss: „noch nicht zugeordnet" heißt
--  nicht „Gastro" und nicht „Privat", sondern „kein Preis".
-- ----------------------------------------------------------------------------
UPDATE customers SET price_list_id = 1 WHERE id IN (1, 2, 3);  -- Gastronomie
UPDATE customers SET price_list_id = 2 WHERE id = 4;           -- Privatkunden

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
     '9a474740fa36ebc1cf463bb1bbfe7400', '8d93be0f95600543e3645292455c7d38e29abe201497e179bb4cadabd2e3ab47', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- TESTPRIV / PIN 00000042 — der Privatkunde für den Preisvergleich.
    (5, 'testpriv', 'customer', 4, 'pbkdf2-sha256', 600000,
     '26e71fbf0c6da85dfbb78f23943a2d97', '0e41a6b3da84262796535e21c28885a372faa42ee352a87b51283d04c25a6d6a', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z'),
    -- TESTOHNE / PIN 01234567 — Konto gültig, Preisgruppe fehlt.
    (6, 'testohne', 'customer', 5, 'pbkdf2-sha256', 600000,
     '4ce006227b802778fe064f92e52ce0da', 'f374e301987a4fafd4ee25f09319ee810693460b2e9d31b5ea9e7e6ca64b7055', 1, 0, '2026-08-24T06:00:00.000Z', '2026-08-24T06:00:00.000Z');
