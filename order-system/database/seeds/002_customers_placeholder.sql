-- ============================================================================
--  PLATZHALTERDATEN FÜR DIE ENTWICKLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Es sind KEINE echten Kunden, Adressen oder Kontaktdaten enthalten und es
--  dürfen auch keine eingetragen werden. Echte Kundendaten gehören in die
--  produktive Datenbank, niemals in ein Repository.
-- ============================================================================

INSERT INTO customers
    (name, contact_person, email, phone, delivery_street, delivery_postal_code,
     delivery_city, is_active, default_fulfillment, internal_note, created_at, updated_at)
VALUES
    ('Beispielcafé Nord', NULL, NULL, NULL,
     'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
     'Platzhalter — betrieblicher Hinweis, niemals Angaben über Personen',
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Beispielcafé Süd', NULL, NULL, NULL,
     'Beispielallee 22', '40215', 'Düsseldorf', 1, 'delivery', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Beispiel-Abholkunde', NULL, NULL, NULL,
     NULL, NULL, NULL, 1, 'pickup', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Ehemaliges Beispielcafé', NULL, NULL, NULL,
     'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP());
