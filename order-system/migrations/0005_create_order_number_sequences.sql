-- Laufende Nummer je Kalenderjahr für das Format BUS-JJJJ-NNNNNN.
--
-- Das MariaDB-Idiom der Vorgängerfassung (LAST_INSERT_ID(expr) im
-- ON-DUPLICATE-KEY-Zweig) gibt es in SQLite nicht. Es wird deshalb NICHT
-- nachgebaut, sondern durch das SQLite-eigene Gegenstück ersetzt:
--
--   INSERT INTO order_number_sequences (year, next_value)
--   VALUES (?, 1)
--   ON CONFLICT (year) DO UPDATE SET next_value = next_value + 1
--   RETURNING next_value;
--
-- Eine einzige Anweisung, atomar. SQLite serialisiert Schreibvorgänge, und
-- UPSERT ... RETURNING liefert den vergebenen Wert in beiden Zweigen zurück.
-- Kein SELECT ... FOR UPDATE, keine Leserunde vorab, keine Race Condition.
--
-- Bewusst NICHT aus MAX(id)+1 und nicht aus der Zeilen-ID der Bestellung:
-- Beides ist eine Leseoperation vor einer Schreiboperation und damit genau
-- die Lücke, in der zwei gleichzeitige Bestellungen dieselbe Nummer bekämen.
--
-- Lücken sind zulässig und erwartet: Scheitert das anschließende Schreiben der
-- Bestellung, ist die Nummer verbraucht. Lückenlosigkeit ist eine Anforderung
-- an Rechnungsnummern, nicht an Bestellnummern. Die letzte Absicherung bleibt
-- ohnehin UNIQUE(order_number) auf orders.
CREATE TABLE order_number_sequences (
    year       INTEGER PRIMARY KEY,
    next_value INTEGER NOT NULL,

    CONSTRAINT chk_sequences_year       CHECK (year BETWEEN 2000 AND 9999),
    CONSTRAINT chk_sequences_next_value CHECK (next_value BETWEEN 1 AND 999999)
);
