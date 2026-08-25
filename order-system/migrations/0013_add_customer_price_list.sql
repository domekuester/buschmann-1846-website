-- Die erste Verbindung zwischen einem Kunden und einer Preiswelt.
--
-- Bis hierher standen beide Seiten unverbunden nebeneinander: customers seit
-- 0001, price_lists seit 0012. Diese Migration fügt genau EINE Spalte hinzu
-- und beantwortet damit genau EINE Frage: „Zu welcher Preisgruppe gehört
-- dieser Kunde?"
--
-- SIE BEANTWORTET NICHT, WELCHEN PREIS EINE BESTELLUNG BEKOMMT. Der
-- Bestellfluss rechnet weiterhin ausschließlich mit products.price_cents; in
-- dieser Migration steht keine Zeile, die daran etwas ändert.
--
-- NULLABLE, UND OHNE JEDE AUTOMATIK.
--
-- Bestehende Kunden bekommen KEINE Preisgruppe zugewiesen — weder per
-- DEFAULT, noch per Backfill, noch anhand ihres Namens, ihrer E-Mail-Domain
-- oder ihres bisherigen Bestellumfangs. Eine Preisgruppe ist eine bewusste
-- kaufmännische Zuordnung; sie zu RATEN hieße, dass irgendwann jemand nach
-- geratenen Preisen abrechnet, ohne dass es jemals jemand entschieden hat.
-- NULL heißt deshalb eindeutig und sichtbar: „noch nicht zugeordnet".
--
-- ON DELETE RESTRICT, NICHT CASCADE UND NICHT SET NULL.
--
-- CASCADE wäre eine Katastrophe: Das Löschen einer Preisliste nähme die
-- Kunden mit. SET NULL wäre leiser, aber immer noch falsch — eine gelöschte
-- Preisliste würde stillschweigend Zuordnungen auflösen, und niemand
-- bemerkte es. RESTRICT ist die Konvention aus 0012 (catalog_product_prices)
-- und sagt: Eine Preisliste, an der Kunden hängen, wird nicht gelöscht,
-- sondern über is_active deaktiviert. Der Kunde bleibt in jedem Fall
-- unangetastet.
--
-- Eine Aktivitätsregel steht hier ABSICHTLICH nicht: Eine Preisliste kann
-- deaktiviert werden, nachdem ihr Kunden zugeordnet wurden, und diese
-- bestehende Zuordnung darf dabei nicht verschwinden. Ob eine INAKTIVE Liste
-- neu gewählt werden darf, ist eine Frage der Anwendung — ein CHECK könnte
-- sie ohnehin nicht stellen, weil er die andere Tabelle nicht sieht.
ALTER TABLE customers
    ADD COLUMN price_list_id INTEGER
    CONSTRAINT fk_customers_price_list REFERENCES price_lists(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Für die Kundenliste des Backoffice, die je Kunde die Preisliste dazulädt,
-- und für die Frage „hängt an dieser Preisliste noch jemand?".
CREATE INDEX idx_customers_price_list ON customers (price_list_id);
