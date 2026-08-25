-- Die Preisidentität des Bestellsystems.
--
-- Bis hierher standen zwei Sortimente unverbunden nebeneinander: products
-- seit 0002 (das BESTELLBARE Sortiment, an dem order_items hängt) und
-- catalog_products seit 0012 (die quelltreuen Preislisten). 0012 hat das
-- ausdrücklich so gewollt — Phase 5A sollte den Bestellfluss nicht anfassen.
--
-- Phase 5C braucht die Verbindung, und zwar EXPLIZIT. Diese Migration fügt
-- genau EINE Spalte hinzu und beantwortet genau EINE Frage: „Welches
-- Katalogprodukt ist dieses bestellbare Produkt?"
--
-- WARUM EINE SPALTE UND KEIN NAMENSABGLEICH.
--
-- Ein Abgleich über name oder lower(name) wäre in zehn Minuten geschrieben
-- und wäre eine Zeitbombe: Ein Tippfehler, ein „Käsekuchen" gegen
-- „Käsekuchen (klein)", eine spätere Umbenennung im Backoffice — und der
-- Preis einer Bestellung ändert sich, ohne dass jemand einen Preis geändert
-- hat. Eine Preisidentität, die an einer Zeichenkette hängt, ist keine
-- Identität. Dasselbe gilt für sort_order und für die Reihenfolge der Zeilen.
--
-- NULLABLE, OHNE DEFAULT, OHNE BACKFILL.
--
-- Bestehende Produkte bekommen KEINE Zuordnung — weder geraten noch
-- gemappt. NULL heißt sichtbar und eindeutig: „nicht verknüpft", und ein
-- nicht verknüpftes Produkt ist für keinen Kunden bepreisbar. Das ist die
-- Regel aus 0013 (customers.price_list_id) noch einmal, aus demselben Grund:
-- Wer den Preis rät, rechnet irgendwann mit geratenen Preisen ab.
--
-- Diese Spalte ersetzt products.price_cents NICHT und deutet sie nicht um.
-- price_cents bleibt unverändert stehen, wird vom Kundenbestellfluss aber ab
-- Phase 5C nicht mehr GELESEN — der Preis kommt ausschließlich aus
-- catalog_product_prices, ausgewählt über die Preisliste des Kunden.
--
-- ON DELETE RESTRICT wie in 0012 und 0013: Ein Katalogprodukt, an dem ein
-- bestellbares Produkt hängt, wird nicht gelöscht, sondern über is_active
-- deaktiviert.
ALTER TABLE products
    ADD COLUMN catalog_product_id INTEGER
    CONSTRAINT fk_products_catalog_product REFERENCES catalog_products(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Ein Katalogprodukt gehört zu HÖCHSTENS EINEM bestellbaren Produkt.
--
-- Ohne diese Bedingung könnten zwei products-Zeilen auf dasselbe
-- Katalogprodukt zeigen; die Bestellseite zeigte denselben Artikel dann
-- zweimal zum selben Preis, und niemand könnte sagen, welche Zeile gemeint
-- ist. TEILINDEX mit WHERE ... IS NOT NULL, weil NULL kein Wert ist: Beliebig
-- viele Produkte dürfen unverknüpft sein, denn genau das ist der
-- Ausgangszustand nach dieser Migration.
CREATE UNIQUE INDEX idx_products_catalog_product
    ON products (catalog_product_id)
    WHERE catalog_product_id IS NOT NULL;
