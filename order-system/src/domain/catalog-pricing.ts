export type CatalogPrice =
  | { readonly type: 'fixed'; readonly priceCents: number }
  | { readonly type: 'from'; readonly minPriceCents: number }
  | { readonly type: 'range'; readonly minPriceCents: number; readonly maxPriceCents: number }
  | { readonly type: 'on_request' };

export interface AdminCatalogProduct {
  /**
   * catalog_products.id — seit Phase 7A, weil die Seite jetzt SCHREIBT.
   *
   * Bis 6F war dieser Bereich rein lesend und brauchte keine Kennung. Das
   * Herstellkostenformular adressiert das Katalogprodukt im PFAD, und die
   * Kennung dafür muss aus der Datenbank kommen — nicht aus einem Namen und
   * nicht aus der Zeilenposition (§3 von 0014).
   */
  readonly id: number;
  readonly name: string;
  readonly variant: string | null;
  readonly unit: string | null;
  readonly gastroPrice: CatalogPrice | null;
  readonly privatePrice: CatalogPrice | null;
  /**
   * Die internen Herstellkosten je Verkaufseinheit in ganzzahligen Cent —
   * oder null für „noch nicht gepflegt".
   *
   * DIESES FELD VERLÄSST DIE ADMINOBERFLÄCHE NIE. AdminCatalogProduct wird
   * ausschließlich von /admin/catalog gerendert; die kundenseitige
   * Produktansicht ist CatalogItemView (application/catalog-view.ts) und hat
   * kein Kostenfeld — auch keines, das sie nicht anzeigt (§11).
   */
  readonly unitCostCents: number | null;
}
