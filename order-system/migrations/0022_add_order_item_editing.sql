-- Einzelne Bestellpositionen bearbeiten — Menge ändern, Position stornieren.
--
-- DER ANLASS IST EIN TELEFONAT. Ein Café ruft an: „Wir haben fünf
-- Käsekuchen bestellt, wir brauchen nur drei." Bis hierher konnte der Betrieb
-- darauf nur mit einer vollständigen Stornierung antworten und die Bestellung
-- neu aufnehmen — mit neuer Nummer, neuem Zeitpunkt und ohne Zusammenhang zur
-- ursprünglichen Absprache.
--
-- WAS DIESE MIGRATION NICHT TUT: Sie löscht nichts. Sie ändert keinen
-- Preis-, Kosten-, Namens- oder Einheiten-Schnappschuss. Sie kennt keinen
-- Produkttausch und keine neue Position. Was sie hinzufügt, ist die
-- Unterscheidung zwischen einer Position, die noch gilt, und einer, die
-- einmal galt — und die Spur dazwischen.


-- ============================================================================
-- 1. cancelled_at — die Position, die einmal galt.
-- ============================================================================
--
-- EIN ZEITPUNKT UND KEIN BOOLEAN. `is_cancelled INTEGER` hätte dieselbe
-- Verzweigung ermöglicht und weniger gesagt: „storniert" ohne „wann" ist eine
-- Auskunft, die man später ergänzen will und dann nicht mehr rekonstruieren
-- kann. Der Zeitpunkt beantwortet beide Fragen mit einer Spalte, genau wie
-- payment_recorded_at seit 0015.
--
-- NULL HEISST AKTIV. Jede bestehende Position ist damit nach dieser Migration
-- aktiv, ohne dass eine einzige Zeile angefasst würde — es gibt keinen
-- Backfill, weil es nichts zu füllen gibt. Dieselbe Regel wie bei
-- customers.price_list_id in 0013 und catalog_products.unit_cost_cents in
-- 0017: Der Zustand „nicht gesetzt" ist ein Wert und keine Lücke.
--
-- DIE BESTEHENDEN CHECK-BEDINGUNGEN AUS 0004 BLEIBEN UNBERÜHRT — und das ist
-- die eigentliche Aussage dieser Spalte. Eine stornierte Position behält ihre
-- Menge, ihren Stückpreis und ihren Positionsbetrag; sie wird nicht auf 0
-- gesetzt und nicht geleert. „quantity > 0" gilt weiterhin für JEDE Zeile,
-- weil die Stornierung die Menge nicht widerruft, sondern die Position.
--
-- WAS EINE MENGE VON 0 WÄRE: eine Position, die aktiv ist und nichts bedeutet
-- — genau der mehrdeutige Zustand, den es hier nicht geben soll. Wer eine
-- Menge auf 0 setzen will, storniert die Position; das ist eine Entscheidung
-- und kein Rechenergebnis.
--
-- WER cancelled_at LIEST, MUSS ES AUCH FILTERN. Ab hier gilt für jede Abfrage
-- auf order_items: `AND i.cancelled_at IS NULL`, wenn sie den GÜLTIGEN Stand
-- meint. Das betrifft das Bestelldokument, den Produktionstag und die beiden
-- Auswertungen — eine stornierte Position darf weder gebacken noch
-- abgerechnet werden.
--
-- KEIN FORMATCHECK auf den Zeitstempel: order_items trägt bislang gar keine
-- Zeitspalte, und orders.created_at/updated_at haben aus demselben Grund
-- keinen. Die Form ist eine Zusicherung des Anwendungscodes (toUtcTimestamp),
-- nicht des Schemas.
ALTER TABLE order_items
    ADD COLUMN cancelled_at TEXT;


-- ============================================================================
-- 2. order_item_changes — die Spur.
-- ============================================================================
--
-- WARUM ÜBERHAUPT EINE TABELLE, WO orders SEIT 0011 MIT ZWEI SPALTEN AUSKOMMT.
--
-- status_changed_by_account_id und status_changed_at halten den LETZTEN
-- Statuswechsel und sind dafür richtig: Der Status einer Bestellung ist ein
-- Zustand, und wo sie gerade steht, sagt die Spalte status selbst.
--
-- Eine Mengenänderung ist das nicht. „5 → 3" ist ein EREIGNIS, und die
-- Position, die danach 3 lautet, kann nicht mehr erzählen, dass sie einmal 5
-- war. Genau das ist die Anforderung: Eine Änderung darf nicht so aussehen,
-- als habe der Kunde von Anfang an 3 bestellt. Zwei Spalten an order_items
-- könnten das für die erste Änderung leisten und für die zweite nicht mehr —
-- und die zweite ist der Anruf am nächsten Tag.
--
-- SIE IST BEWUSST KEIN ALLGEMEINES AUDIT-LOG. Kein `entity_type`, kein
-- `field_name`, kein `old_value TEXT`. Eine Tabelle, die alles aufnehmen
-- kann, kann nichts prüfen: In den CHECK-Bedingungen unten steht, was eine
-- gültige Änderung IST, und das ginge in einer generischen Form nicht. Wer
-- eines Tages Statuswechsel, Zahlungen und Positionen in einer Tabelle führen
-- will, trifft damit eine eigene Entscheidung und nicht die Fortsetzung
-- dieser.
--
-- SIE WIRD NUR GESCHRIEBEN UND GELESEN, NIE GEÄNDERT. Es gibt im Code kein
-- UPDATE und kein DELETE auf diese Tabelle.
CREATE TABLE order_item_changes (
    id                    INTEGER PRIMARY KEY,

    -- Die Bestellung steht MIT in der Zeile, obwohl sie über order_item_id
    -- erreichbar wäre. Der Grund ist die Abfrage, die es geben wird: „was
    -- wurde an DIESER Bestellung geändert?" — sie soll die Positionen dafür
    -- nicht erst verbinden müssen. Die Redundanz ist durch den Fremdschlüssel
    -- unten nicht gegen Abweichung gesichert; der Anwendungscode liest sie
    -- aus derselben Zeile, aus der er order_item_id nimmt (siehe das
    -- INSERT ... SELECT in edit-order-item.ts).
    order_id              INTEGER NOT NULL,
    order_item_id         INTEGER NOT NULL,

    -- WAS geschah. Zwei Werte und kein dritter: Ein Produkttausch und eine
    -- neu hinzugefügte Position gehören nicht in diese Phase, und ein Wert,
    -- den niemand schreibt, wäre ein Versprechen an eine Oberfläche, die es
    -- nicht gibt.
    change_type           TEXT    NOT NULL,

    -- Die Menge VOR der Änderung. NOT NULL, immer — sie ist der ganze Zweck
    -- dieser Tabelle.
    previous_quantity     INTEGER NOT NULL,

    -- Die Menge DANACH — oder NULL, wenn es danach keine aktive Menge mehr
    -- gibt. Die Kopplung an change_type steht im CHECK darunter und nicht nur
    -- im Anwendungscode: „Mengenänderung ohne neue Menge" und „Stornierung
    -- mit neuer Menge" sind beides Zeilen, aus denen später niemand mehr
    -- herauslesen kann, was gemeint war — dieselbe Überlegung wie bei
    -- payment_status/payment_recorded_at in 0015.
    new_quantity          INTEGER,

    -- ISO-8601-UTC wie überall sonst; er wird übergeben und nicht abgeleitet.
    changed_at            TEXT    NOT NULL,

    -- WER es war — aus dem bereits geprüften Admin-Kontext, niemals aus einer
    -- Anfrage. NULL ist zulässig, weil das Konto später gelöscht werden kann
    -- (ON DELETE SET NULL, wie orders.status_changed_by_account_id seit
    -- 0011): Wer es war, kann verloren gehen; WAS geschah, nicht.
    changed_by_account_id INTEGER,

    CONSTRAINT chk_order_item_changes_type CHECK (
        change_type IN ('quantity_changed', 'item_cancelled')
    ),

    CONSTRAINT chk_order_item_changes_previous CHECK (
        typeof(previous_quantity) = 'integer' AND previous_quantity > 0
    ),

    -- Die Kopplung von Art und neuer Menge — und zugleich die Regel, dass
    -- eine Mengenänderung etwas ändern muss. Eine Zeile „5 → 5" wäre eine
    -- Spur ohne Aussage; sie entsteht nicht durch Absicht, sondern durch ein
    -- Formular, das unverändert abgeschickt wurde, und sie würde die Historie
    -- mit Rauschen füllen, in dem die echten Änderungen untergehen.
    CONSTRAINT chk_order_item_changes_new CHECK (
        (change_type = 'item_cancelled' AND new_quantity IS NULL)
        OR (
            change_type = 'quantity_changed'
            AND new_quantity IS NOT NULL
            AND typeof(new_quantity) = 'integer'
            AND new_quantity > 0
            AND new_quantity <> previous_quantity
        )
    ),

    -- CASCADE wie bei order_items selbst (0004): Eine Spur zu einer
    -- Bestellung, die es nicht mehr gibt, ist keine Auskunft. Gelöscht wird
    -- eine Bestellung im Betrieb ohnehin nicht — sie wird storniert.
    CONSTRAINT fk_order_item_changes_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_order_item_changes_item FOREIGN KEY (order_item_id)
        REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_order_item_changes_account FOREIGN KEY (changed_by_account_id)
        REFERENCES auth_accounts (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- „Was wurde an dieser Bestellung geändert?" — in der Reihenfolge, in der es
-- geschah. id ist monoton steigend und damit dieselbe Ordnung wie changed_at,
-- ohne von der Genauigkeit eines Zeitstempels abzuhängen: Zwei Änderungen
-- innerhalb derselben Millisekunde bleiben unterscheidbar sortiert.
CREATE INDEX idx_order_item_changes_order ON order_item_changes (order_id, id);
