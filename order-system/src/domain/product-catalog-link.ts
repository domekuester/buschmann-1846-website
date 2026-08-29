/**
 * Die Verknüpfung zwischen einem BESTELLBAREN Produkt und seinem
 * Katalogprodukt — als Lesemodell des Adminbereichs.
 *
 * DIE FACHLICHE QUELLE IST products.catalog_product_id AUS MIGRATION 0014.
 * Es gibt bewusst KEINE zweite Tabelle, keine `product_mappings`, keine
 * `catalog_links`: Eine zweite Fassung derselben Zuordnung wäre eine Fassung,
 * die irgendwann von der ersten abweicht — und dann entschiede die Reihenfolge
 * der Abfragen darüber, was ein Kunde bezahlt. Phase 5D fügt der Datenbank
 * nichts hinzu; sie macht ausschließlich BEDIENBAR, was 0014 bereits kann.
 *
 * DIESE DATEI KENNT KEINEN PREIS. Kein Feld hier trägt einen Cent-Betrag,
 * keinen Preistyp und keine Preislisten-ID. Was ein verknüpftes Produkt einen
 * bestimmten Kunden kostet, beantwortet ausschließlich der Resolver aus
 * Phase 5C (domain/order-pricing.ts) — Phase 5D setzt die Identität und
 * rechnet nicht.
 *
 * SIE RÄT AUCH NICHTS. Es gibt hier keine Ähnlichkeitsfunktion, keinen
 * Namensabgleich, keine Sortierheuristik. Die Zuordnung ist eine bewusste
 * Entscheidung eines Menschen; würde das System sie ableiten, änderte sich der
 * Preis einer Bestellung beim nächsten Tippfehler im Produktnamen.
 */

/** Die Katalogfelder, aus denen ein wiedererkennbares Label entsteht. */
export interface CatalogProductIdentity {
  readonly name: string;
  readonly variant: string | null;
  readonly unit: string | null;
}

/**
 * Das Trennzeichen zwischen Name, Variante und Einheit.
 *
 * Ein Mittelpunkt mit Leerraum und kein Bindestrich: „Käsekuchen - 26-cm-Ring"
 * hätte zwei Bindestriche mit verschiedener Bedeutung in einer Zeile.
 */
const TRENNER = ' · ';

/**
 * „Käsekuchen · 26-cm-Ring" — ein Katalogprodukt, wie ein Mensch es in einer
 * Auswahlliste wiedererkennt.
 *
 * EINDEUTIGKEIT GEHT VOR KÜRZE. Stehen Variante UND Einheit im Katalog,
 * werden beide genannt. Zwei Zeilen desselben Namens, die sich nur in der
 * Einheit unterscheiden, dürfen in dieser Liste nicht gleich aussehen — wer
 * sich hier vergreift, verknüpft das falsche Produkt und merkt es erst an
 * einer Rechnung.
 *
 * DIE ZEILEN-ID KOMMT NICHT VOR. Sie ist ein interner Wert ohne Aussage; sie
 * steht im `value` der Option, wo der Server sie braucht, und nicht in dem,
 * was ein Mensch liest.
 *
 * Ein leerer oder nur aus Leerraum bestehender Zusatz wird behandelt wie ein
 * fehlender. Das Schema aus 0012 schließt ihn bereits aus (CHECK auf
 * length(trim(...)) > 0); hier steht die Regel trotzdem, weil ein Label mit
 * einem hängenden „ · " am Ende nach einem kaputten System aussieht.
 */
export function catalogProductLabel(identity: CatalogProductIdentity): string {
  return [identity.name, identity.variant, identity.unit]
    .map((teil) => (teil ?? '').trim())
    .filter((teil) => teil.length > 0)
    .join(TRENNER);
}

/**
 * Ein Katalogprodukt, wie es zur Auswahl steht.
 *
 * Die ID ist der einzige technische Wert — sie ist der Wert, den das Formular
 * schickt. Ein Preis steht hier nicht: Für die Frage „welches Produkt ist
 * das?" ist er ohne Belang, und in einer Auswahlliste sähe er aus wie eine
 * Zusage.
 */
export interface CatalogProductOption {
  readonly id: number;
  readonly label: string;
}

/**
 * Das Katalogprodukt, mit dem ein bestellbares Produkt bereits verknüpft IST.
 *
 * Es trägt zusätzlich `isActive`, und das ist kein Detail — es ist dieselbe
 * Überlegung wie bei AssignedPriceGroup aus 5B: Ein Katalogprodukt kann
 * stillgelegt werden, NACHDEM ein Produkt daran hängt. Die bestehende
 * Verknüpfung wird dann nicht still aufgelöst und nicht durch eine andere
 * ersetzt; sie bleibt sichtbar bestehen, und die Oberfläche sagt dazu, dass
 * das Katalogprodukt nicht mehr aktiv ist.
 */
export interface LinkedCatalogProduct extends CatalogProductOption {
  readonly isActive: boolean;
}

/** Eine Zeile des Zuordnungsbereichs auf /admin/catalog. */
export interface ProductLinkRow {
  /**
   * Die interne Kennung. Sie hat hier einen echten Nutzen in der Oberfläche —
   * sie adressiert das Produkt im Pfad des Änderungsformulars — und ist der
   * einzige technische Wert dieser Zeile.
   */
  readonly id: number;
  readonly name: string;
  /**
   * Ob das Produkt noch bestellbar ist. Deaktivierte Produkte werden
   * ANGEZEIGT und nicht ausgeblendet: Ein unsichtbares Produkt, das ein
   * Katalogprodukt belegt, ließe dieses für jedes andere Produkt als vergeben
   * erscheinen, ohne dass irgendwo stünde, wer es hält.
   */
  readonly isActive: boolean;
  /** `null` heißt: nicht verknüpft. Es heißt niemals „Standardzuordnung". */
  readonly catalogProduct: LinkedCatalogProduct | null;
}

/**
 * Ein Katalogprodukt in der Auswahlliste — mitsamt der Frage, wer es hält.
 *
 * `linkedProductId` ist der Grund, warum die Oberfläche NICHTS anbieten kann,
 * was der Server dann ablehnen müsste: Ein Katalogprodukt, das bereits einem
 * ANDEREN Produkt gehört, taucht in dessen Auswahl gar nicht erst auf. Das
 * ist dieselbe Entscheidung wie bei loadAssignablePriceGroups aus 5B — und
 * sie ERSETZT die Prüfung im Server nicht, sie erspart dem Admin bloß den
 * Fehlversuch. Die letzte Instanz bleibt der partielle UNIQUE-Index aus 0014.
 */
export interface CatalogProductChoice extends CatalogProductOption {
  /** products.id des Produkts, das dieses Katalogprodukt hält — oder null. */
  readonly linkedProductId: number | null;
}
