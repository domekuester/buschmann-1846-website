-- Die Bestellrichtlinie: an welchen Wochentagen produziert wird und wann der
-- Bestellschluss ist.
--
-- EINE ZEILE, KEINE TABELLE VON REGELN. Das ist die eigentliche Entscheidung
-- dieser Migration. Eine Zeile je Wochentag, je Kunde, je Produkt oder je
-- Zeitraum wäre der Griff, der sich später nicht mehr auflösen lässt: Sobald
-- es zwei Regeln gibt, gibt es die Frage, welche gewinnt — und die Antwort
-- darauf steht dann in Anwendungscode, den niemand mehr liest. Buschmann hat
-- EINE Backstube und EINEN Bestellschluss. Solange das so ist, ist eine Zeile
-- die ehrliche Abbildung.
--
-- WAS HIER NICHT STEHT, und in dieser Phase auch nicht stehen soll:
-- Feiertage, einzelne Sperrtage, Betriebsferien, kundenspezifische Fristen,
-- produktabhängige Fristen, Lieferfenster, Kapazitätsgrenzen. Jedes davon
-- verlangt eine zweite Tabelle mit einer Vorrangregel, und ein Betreiber, der
-- „an welchen Tagen nehmen wir Bestellungen an?" beantworten will, soll dafür
-- keinen Kalender pflegen müssen.
--
-- ZWEI SCHALTER UND NICHT EINER — der Unterschied ist fachlich:
--
--   Die WOCHENTAGE gelten immer. Sie stehen nach dieser Migration alle auf
--   „erlaubt" und ändern damit nichts am bisherigen Verhalten; wer einen Tag
--   ausschaltet, hat das ausdrücklich getan.
--
--   Der BESTELLSCHLUSS hat einen eigenen Schalter und steht nach dieser
--   Migration AUS. Er ist die Regel, die eine bereits mögliche Bestellung
--   plötzlich unmöglich macht — und zwar abhängig von der Uhrzeit. Sie
--   stillschweigend zu aktivieren hieße, einer bestehenden Installation über
--   Nacht Bestellungen wegzunehmen, ohne dass jemand es entschieden hat.
--
-- Ein einzelner Hauptschalter über beidem wäre die dritte Möglichkeit und
-- wurde verworfen: Er brächte einen Zustand „Regel aktiv, aber alle Tage
-- erlaubt und kein Bestellschluss", der genau dasselbe tut wie „Regel aus" —
-- zwei Wege für dieselbe Wirkung sind einer zu viel.
--
-- KEINE HISTORIE. Diese Tabelle sagt, was HEUTE gilt, und nicht, was einmal
-- galt. Bestehende Bestellungen sind davon unberührt: Sie tragen ihren
-- fulfillment_date seit 0003 selbst und werden von einer späteren
-- Regeländerung weder verschoben noch storniert noch ausgeblendet. Die
-- Richtlinie wirkt ausschließlich auf NEUE Bestellungen.
CREATE TABLE order_policy (
    -- Der Singleton-Schlüssel. Das CHECK ist der Grund, warum es diese Spalte
    -- gibt: Ohne sie könnte eine zweite Zeile entstehen, und dann entschiede
    -- ein ORDER BY darüber, welche Regel gilt.
    id INTEGER PRIMARY KEY,

    -- Die sieben Produktionstage, Montag zuerst — die deutsche und die
    -- ISO-8601-Zählung, dieselbe wie in domain/clock.ts weekStart().
    --
    -- SIEBEN SPALTEN UND KEINE BITMASKE: '0111110' wäre kürzer und in jeder
    -- Konsole unlesbar. Eine Spalte je Tag lässt sich einzeln lesen, einzeln
    -- prüfen und einzeln in einem SELECT benennen.
    monday_enabled    INTEGER NOT NULL DEFAULT 1,
    tuesday_enabled   INTEGER NOT NULL DEFAULT 1,
    wednesday_enabled INTEGER NOT NULL DEFAULT 1,
    thursday_enabled  INTEGER NOT NULL DEFAULT 1,
    friday_enabled    INTEGER NOT NULL DEFAULT 1,
    saturday_enabled  INTEGER NOT NULL DEFAULT 1,
    sunday_enabled    INTEGER NOT NULL DEFAULT 1,

    -- Ob der Bestellschluss überhaupt geprüft wird. AUS nach der Migration.
    cutoff_enabled INTEGER NOT NULL DEFAULT 0,

    -- Wie viele KALENDERTAGE vor dem Produktionstag Schluss ist.
    --
    -- Kalendertage und nicht Werktage. Das ist bewusst die dumme Rechnung:
    -- „ein Tag vorher" heißt der Vortag, auch wenn das ein Sonntag ist. Eine
    -- Werktagsrechnung müsste wissen, was ein Werktag ist — und damit wären
    -- wir bei dem Feiertagskalender, den es hier gerade nicht geben soll.
    -- Die Regel bleibt so nachvollziehbar: Freitag minus 1 ist Donnerstag,
    -- immer.
    --
    -- 0 ist ausdrücklich erlaubt und heißt „am Produktionstag selbst, bis zur
    -- Uhrzeit". Die Obergrenze 30 ist eine Plausibilitätsgrenze gegen einen
    -- Tippfehler, keine fachliche Aussage: Ein Vorlauf von 300 Tagen wäre
    -- kein Bestellschluss mehr, sondern eine Betriebsschließung.
    lead_days INTEGER NOT NULL DEFAULT 1,

    -- Die Uhrzeit des Bestellschlusses als 'HH:MM' in Europe/Berlin.
    --
    -- ORTSZEIT UND KEIN ZEITSTEMPEL. „Bis zwölf" heißt in Düsseldorf zwölf,
    -- im Sommer wie im Winter; ein in UTC gespeicherter Bestellschluss läge
    -- die halbe Jahreshälfte über eine Stunde daneben. Dieselbe Trennung wie
    -- bei fulfillment_date, die domain/clock.ts in ihren ersten Zeilen
    -- begründet: Ein ZEITPUNKT ist UTC, eine GESCHÄFTSZEIT ist Ortszeit.
    cutoff_time TEXT NOT NULL DEFAULT '12:00',

    -- Wann zuletzt jemand gespeichert hat — ISO-8601-UTC wie überall sonst,
    -- oder NULL.
    --
    -- NULL HEISST „NOCH NIE GEÄNDERT" und wird nicht mit dem
    -- Migrationszeitpunkt gefüllt. Ein Zeitstempel dort behauptete, jemand
    -- habe diese Regel eingerichtet — dieselbe Überlegung wie bei
    -- customers.price_list_id in 0013: nichts raten, was niemand entschieden
    -- hat.
    updated_at TEXT,

    CONSTRAINT chk_order_policy_singleton CHECK (id = 1),

    CONSTRAINT chk_order_policy_weekdays CHECK (
        monday_enabled    IN (0, 1) AND
        tuesday_enabled   IN (0, 1) AND
        wednesday_enabled IN (0, 1) AND
        thursday_enabled  IN (0, 1) AND
        friday_enabled    IN (0, 1) AND
        saturday_enabled  IN (0, 1) AND
        sunday_enabled    IN (0, 1)
    ),

    CONSTRAINT chk_order_policy_cutoff_enabled CHECK (cutoff_enabled IN (0, 1)),

    CONSTRAINT chk_order_policy_lead_days CHECK (
        typeof(lead_days) = 'integer' AND lead_days BETWEEN 0 AND 30
    ),

    -- 'HH:MM', und zwar eine, die es gibt.
    --
    -- Das GLOB-Muster allein ließe '29:71' durch — es prüft Ziffern, nicht
    -- Bereiche. Deshalb steht die Bereichsprüfung ausdrücklich daneben.
    -- Dieselbe Doppelprüfung wie bei isCalendarDay() in domain/clock.ts, und
    -- aus demselben Grund: Ein Muster beschreibt die Form, nicht die
    -- Existenz.
    --
    -- Die Regel steht im Schema und nicht nur im Anwendungscode: Eine Regel,
    -- die nur im Anwendungscode steht, gilt für den Anwendungscode — nicht
    -- für die Konsole, das Wartungsskript und den Import.
    CONSTRAINT chk_order_policy_cutoff_time CHECK (
        cutoff_time GLOB '[0-9][0-9]:[0-9][0-9]'
        AND CAST(substr(cutoff_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
        AND CAST(substr(cutoff_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
    ),

    CONSTRAINT chk_order_policy_updated_at CHECK (
        updated_at IS NULL OR length(updated_at) = 24
    )
);

-- Die eine Zeile, mit genau den Voreinstellungen von oben: alle sieben Tage
-- erlaubt, Bestellschluss aus, nie geändert.
--
-- Sie wird HIER angelegt und nicht beim ersten Lesen im Anwendungscode: Ein
-- „lege sie an, falls sie fehlt" wäre ein Schreibvorgang im Lesepfad und
-- damit ein Schreibvorgang, den ein unangemeldeter Aufruf auslösen könnte.
INSERT INTO order_policy (id) VALUES (1);
