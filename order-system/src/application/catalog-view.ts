import type { ProductCatalog } from '../domain/product-catalog';

/**
 * Ein Produkt, wie ein Café es sieht.
 *
 * Diese fünf Felder sind vollständig — das ist die Aussage des Typs. Was hier
 * nicht steht, verlässt das System nicht: keine Zeitstempel, kein isActive
 * (wer die Liste bekommt, sieht ohnehin nur Aktives), keine Sortiernummer
 * (die Reihenfolge der Liste IST die Sortierung), keine internen Notizen,
 * keine Kalkulationsdaten.
 *
 * priceCents bleibt eine ganze Zahl in Cent bis in die Anzeige hinein. Aus 435
 * wird erst beim Rendern „4,35 €", und auch das rein zeichenbasiert.
 */
export interface CatalogItemView {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: number;
  readonly unit: string;
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
 */
export function toCatalogView(catalog: ProductCatalog): CatalogItemView[] {
  return catalog.orderable().map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceCents: product.unitPrice.cents,
    unit: product.unit,
  }));
}
