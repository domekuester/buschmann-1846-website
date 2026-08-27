-- Herstellkosten: was ein Produkt Buschmann selbst kostet.
--
-- ZWEI SPALTEN, KEINE NEUE TABELLE. Das ist die Entscheidung dieser
-- Migration, und sie ist gegen etwas gerichtet: gegen ein Rezepturmodell.
-- Rohstoffe, Zutatenmengen, Lieferanten, Einkaufspreise und
-- Chargenverbräuche wären der ehrlichere Weg zu einer echten
-- Vollkostenrechnung — und ein System, das ein Betreiber nie pflegt. Was
-- hier entsteht, ist bewusst eine SCHÄTZUNG, die in zehn Sekunden je Produkt
-- eingetragen ist: „Käsekuchen kostet uns etwa 2,10 € pro Stück."
--
-- WO DIE KOSTEN HÄNGEN: an catalog_products und nicht an products.
--
-- Seit 0014 ist catalog_products die PREISIDENTITÄT des Sortiments; products
-- ist die BESTELLBARKEIT, die über catalog_product_id daran hängt. Kosten
-- gehören zur Identität eines Artikels, nicht zu seiner Bestellbarkeit —
-- derselbe Käsekuchen kostet dieselbe Herstellung, egal ob er gerade
-- bestellbar ist. Damit steht der Kostenwert außerdem genau dort, wo der
-- Bestellfluss ohnehin nachschlägt (customer-price-book-repository.ts), und
-- die Bestellung braucht für ihn KEINE zusätzliche Abfrage.
--
-- WAS DIE VERKAUFSEINHEIT IST, ENTSCHEIDET DAS KATALOGPRODUKT. unit_cost_cents
-- gilt für genau die Einheit, die in catalog_products.unit steht — Stück,
-- Torte, Blech. Es gibt hier keine zweite Einheit und keine Umrechnung; eine
-- Kostenangabe je Kilogramm neben einem Verkauf je Blech wäre ein
-- Umrechnungsfaktor, den niemand pflegt.
--
-- NULL IST NICHT 0.
--
-- NULL heißt „noch keine Herstellkosten gepflegt". 0 heißt „dieses Produkt
-- kostet uns tatsächlich nichts" — eine Aussage, die jemand ausdrücklich
-- getroffen hat. Beides auf dieselbe Zahl abzubilden hieße, jedem
-- ungepflegten Produkt eine Marge von 100 % zu bescheinigen; genau daraus
-- entstehen Auswertungen, die besser aussehen als der Betrieb. Dieselbe Regel
-- wie bei customers.price_list_id in 0013 und products.catalog_product_id in
-- 0014.
--
-- KEIN BACKFILL UND KEINE HISTORIE. Kein bestehendes Katalogprodukt bekommt
-- einen geschätzten Wert, und es gibt keine Tabelle, die frühere Kostenstände
-- führt. Was gestern galt, steht in den Bestellungen von gestern — siehe
-- unten.
ALTER TABLE catalog_products
    ADD COLUMN unit_cost_cents INTEGER
    CONSTRAINT chk_catalog_products_unit_cost CHECK (
        unit_cost_cents IS NULL
        OR (typeof(unit_cost_cents) = 'integer' AND unit_cost_cents >= 0)
    );

-- Der Kostenstand ZUM BESTELLZEITPUNKT — dieselbe Bauart wie
-- unit_price_cents seit 0004.
--
-- WARUM ÜBERHAUPT EIN SNAPSHOT: Ohne ihn müsste jede spätere Auswertung die
-- heutigen Kosten auf eine Bestellung von vor drei Monaten anwenden. Die
-- Butter ist seitdem teurer geworden, der Wert oben wurde nachgezogen — und
-- die Märzbestellung sähe rückwirkend unrentabler aus, als sie war. Eine
-- Bestellung ist ein DOKUMENT: Was sie gekostet hat, hat sie gekostet.
--
-- WARUM NULLABLE: Kostenpflege ist optional. Ein Katalogprodukt ohne
-- gepflegte Kosten führt zu einer Position ohne Kostenschnappschuss — die
-- Bestellung entsteht trotzdem, denn niemand soll ein Café abweisen müssen,
-- weil im Backoffice eine Zahl fehlt.
--
-- BESTEHENDE POSITIONEN BLEIBEN NULL. Sie bekommen KEINEN aus heutigen
-- Katalogdaten errechneten Wert — der wäre erfunden. „Kosten historisch nicht
-- vorhanden" ist die einzige wahre Aussage über eine Bestellung, die vor
-- dieser Migration geschrieben wurde, und eine Auswertung, die das nicht
-- unterscheiden kann, ist keine Auswertung.
--
-- KEIN line_cost_cents. Der Positionskostenbetrag wäre die zweite Zahl für
-- dieselbe Sache (Stückkosten × Menge) und damit die Vorlage für eine
-- Differenz. line_total_cents in 0004 gibt es, weil der VERKAUFSbetrag
-- gebucht wird; ein geschätzter Kostenwert wird nicht gebucht, sondern
-- gerechnet.
ALTER TABLE order_items
    ADD COLUMN unit_cost_cents_snapshot INTEGER
    CONSTRAINT chk_order_items_unit_cost CHECK (
        unit_cost_cents_snapshot IS NULL
        OR (typeof(unit_cost_cents_snapshot) = 'integer' AND unit_cost_cents_snapshot >= 0)
    );
