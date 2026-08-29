import type { CustomerPriceBook } from '../domain/order-pricing';
import type { ProductCatalog } from '../domain/product-catalog';

/**
 * Der Preis eines Produkts, wie ein Kunde ihn sieht.
 *
 * EINE PREISFORM UND KEINE ZAHL — der ganze Unterschied zwischen Phase 2 und
 * Phase 5C steckt in diesem Typ.
 *
 * Bis 5B stand hier ein `priceCents: number`, weil es je Produkt genau einen
 * Betrag gab. Die echten Buschmann-Preislisten kennen aber vier Formen, und
 * drei davon sind keine Zahl: „ab 55,00 €" ist eine Untergrenze,
 * „55,00–75,00 €" eine Spanne, „auf Anfrage" gar nichts. Wer diese drei in
 * eine Zahl presst, hat sich für einen Betrag entschieden, den niemand
 * vereinbart hat.
 *
 * `unavailable` ist die fünfte Form und die wichtigste: Für diesen Kunden ist
 * dieses Produkt nicht bepreist — weil er keine Preisgruppe hat, weil seine
 * Preisgruppe stillgelegt ist, weil das Produkt nicht mit dem Katalog
 * verknüpft ist oder weil es in SEINER Liste keinen Preis besitzt. Sie trägt
 * KEINEN Betrag, damit auf keinem Bildschirm „0,00 €" erscheinen kann.
 */
export type CatalogItemPrice =
  | { readonly kind: 'fixed'; readonly priceCents: number }
  | { readonly kind: 'from'; readonly minPriceCents: number }
  | { readonly kind: 'range'; readonly minPriceCents: number; readonly maxPriceCents: number }
  | { readonly kind: 'on_request' }
  | { readonly kind: 'unavailable' };

/**
 * Ein Produkt, wie ein Café es sieht.
 *
 * Diese fünf Felder sind vollständig — das ist die Aussage des Typs. Was hier
 * nicht steht, verlässt das System nicht: keine Zeitstempel, kein isActive
 * (wer die Liste bekommt, sieht ohnehin nur Aktives), keine Sortiernummer
 * (die Reihenfolge der Liste IST die Sortierung), keine internen Notizen,
 * keine Kalkulationsdaten.
 *
 * UND SEIT 5C AUCH NICHT: die Preislisten-ID, der Preislistencode, die
 * Katalogprodukt-ID, der Preistyp aus der Datenbank oder der Preis einer
 * ANDEREN Preisliste. Ein Gastronomiekunde bekommt hier nichts, woraus sich
 * ein Privatpreis ableiten ließe — auch nicht in einem Attribut, das die
 * Seite nicht anzeigt.
 *
 * Beträge bleiben ganze Zahlen in Cent bis in die Anzeige hinein. Aus 435
 * wird erst beim Rendern „4,35 €", und auch das rein zeichenbasiert.
 */
export interface CatalogItemView {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly unit: string;
  readonly price: CatalogItemPrice;
}

/**
 * Die Grenze zwischen dem, was Buschmann über ein Produkt weiß, und dem, was
 * ein Café davon zu sehen bekommt.
 *
 * Eine eigene Funktion und keine Schleife im Seitengerüst: So ist die Grenze
 * einzeln prüfbar, und ein Test kann darauf bestehen, dass die Feldliste
 * exakt diese fünf sind. Ein zusätzliches Feld ist damit ein
 * fehlschlagender Test statt einer stillen Preisgabe.
 *
 * Die Auswahl und Reihenfolge stammen aus ProductCatalog.orderable() — also
 * aus der Domäne, nicht aus einer SQL-Abfrage und nicht aus dieser Funktion.
 *
 * DIE PREISE STAMMEN AUS DEMSELBEN CustomerPriceBook, MIT DEM AUCH BESTELLT
 * WIRD. Das ist §18 des Auftrags in einer Zeile: Es gibt keine zweite
 * Preislogik für die Anzeige. Was die Seite zeigt und was der Server beim
 * Speichern nimmt, kommt aus demselben Objekt und derselben Methode — sie
 * können deshalb nicht auseinanderlaufen, weil sie dasselbe sind.
 */
export function toCatalogView(
  catalog: ProductCatalog,
  priceBook: CustomerPriceBook,
): CatalogItemView[] {
  return catalog.orderable().map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    unit: product.unit,
    price: toItemPrice(priceBook, product.id),
  }));
}

/**
 * Vom Auflösungsergebnis zur Anzeigeform.
 *
 * Die vier Nicht-Preis-Zustände des Resolvers werden hier auf ZWEI
 * Anzeigeformen abgebildet, und das ist Absicht:
 *
 *   price_not_fixed  → die quelltreue Form (ab / Spanne / auf Anfrage). Der
 *                      Kunde soll sehen, dass es einen Preis GIBT, nur keinen
 *                      berechenbaren.
 *   alles Übrige     → `unavailable`. Ob der Kunde keine Preisgruppe hat oder
 *                      das Produkt in seiner Liste fehlt, ist für ihn
 *                      dieselbe Auskunft — und die Unterscheidung wäre eine
 *                      Aussage über interne Verwaltungszustände.
 *
 * Der Preistyp `fixed` ist der einzige, der einen Betrag mitnimmt.
 */
function toItemPrice(priceBook: CustomerPriceBook, productId: number): CatalogItemPrice {
  const price = priceBook.priceFor(productId);

  if (price.kind === 'fixed') {
    return { kind: 'fixed', priceCents: price.unitPrice.cents };
  }

  if (price.kind === 'price_not_fixed') {
    const catalogPrice = price.catalogPrice;
    switch (catalogPrice.type) {
      case 'from':
        return { kind: 'from', minPriceCents: catalogPrice.minPriceCents };
      case 'range':
        return {
          kind: 'range',
          minPriceCents: catalogPrice.minPriceCents,
          maxPriceCents: catalogPrice.maxPriceCents,
        };
      default:
        return { kind: 'on_request' };
    }
  }

  return { kind: 'unavailable' };
}
