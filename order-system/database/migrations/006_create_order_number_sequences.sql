-- Laufende Nummer je Kalenderjahr für das Format BUS-JJJJ-NNNNNN.
--
-- Bewusst NICHT aus MAX(id)+1 und nicht aus der AUTO_INCREMENT-ID der
-- Bestellung. Die Vergabe erfolgt atomar in EINER Anweisung:
--
--   INSERT INTO order_number_sequences (year, next_value)
--   VALUES (:year, LAST_INSERT_ID(1))
--   ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1);
--   SELECT LAST_INSERT_ID();
--
-- LAST_INSERT_ID(expr) setzt den Wert auch im INSERT-Zweig, deshalb liefert
-- das SELECT in beiden Fällen die richtige Zahl. Keine Race Condition, kein
-- SELECT ... FOR UPDATE, lauffähig auf jedem Shared Hosting.
--
-- Lücken sind zulässig und erwartet: Rollt eine Transaktion zurück, ist die
-- Nummer verbraucht. Lückenlosigkeit ist eine Anforderung an
-- Rechnungsnummern, nicht an Bestellnummern.
CREATE TABLE order_number_sequences (
    year       SMALLINT UNSIGNED NOT NULL,
    next_value INT UNSIGNED      NOT NULL,
    PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
