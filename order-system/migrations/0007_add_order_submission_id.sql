-- Die Absendekennung — der Schutz gegen den Daumen, der zweimal auf
-- „Bestellung senden" tippt.
--
-- Die Kennung entsteht SERVERSEITIG beim Rendern der Bestellseite und wird im
-- Formular mitgeführt. Nicht im Client: Ein Client, der bei jedem Klick eine
-- neue Kennung erzeugte, wäre gegen Doppelklicks ungeschützt — er hätte
-- lediglich zwei verschiedene Kennungen für dieselbe Absicht.
--
-- Die Spalte liegt auf orders und nicht in einer eigenen Tabelle, weil sie
-- dadurch im SELBEN INSERT wie die Bestellung geschrieben wird. Eine eigene
-- Tabelle bedeutete einen zweiten Schreibvorgang und damit ein zweites
-- Zeitfenster, in dem genau der Zustand entstehen kann, den diese Spalte
-- verhindern soll.
ALTER TABLE orders ADD COLUMN submission_id TEXT;

-- PARTIELL. Je Café und Absendevorgang höchstens eine Bestellung — aber
-- Bestellungen ohne Kennung bleiben unbeschränkt, denn nicht jede Bestellung
-- entsteht über die Bestellseite (der Phase-1-Pfad tut es nicht, eine spätere
-- Erfassung im Backoffice täte es auch nicht).
--
-- Das WHERE ist in SQLite streng genommen entbehrlich, weil NULL dort ohnehin
-- nicht eindeutigkeitspflichtig ist. Es steht trotzdem da: Die Absicht soll im
-- Schema stehen und nicht in einer Fußnote über SQLite-Eigenheiten.
CREATE UNIQUE INDEX uq_orders_submission
    ON orders (customer_id, submission_id)
    WHERE submission_id IS NOT NULL;
