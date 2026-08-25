import type { CatalogPrice } from './catalog-pricing';
import { InvalidArgumentError } from './errors';
import { Money } from './money';

/**
 * Das Ergebnis einer Preisauflösung.
 *
 * EIN DISCRIMINATED UNION UND KEINE NULLBARE ZAHL — und das ist der ganze
 * Punkt dieser Datei.
 *
 * Eine Funktion mit dem Rückgabetyp `number | null` hätte genau zwei
 * Zustände: „Preis" und „kein Preis". Die Fachlichkeit hat aber fünf, und
 * vier davon sind KEIN Preis aus jeweils anderem Grund — der Kunde hat keine
 * Preisgruppe, seine Preisgruppe ist stillgelegt, das Produkt steht in dieser
 * Liste nicht, oder es steht darin mit einer Angabe, die kein Endpreis ist.
 * Wer diese vier auf `null` abbildet, hat an der Aufrufstelle nur noch die
 * Wahl zwischen einer falschen Meldung und einem Fallback. Beides ist in
 * diesem System verboten.
 *
 * ENTSCHEIDEND IST, WAS AN DEN VIER NICHT-PREISEN FEHLT: Sie tragen kein
 * `unitPrice`. Es gibt in diesem Typ keinen Weg, aus „ab 55,00 €" einen
 * Betrag von 5500 zu machen — nicht, weil eine Regel es untersagt, sondern
 * weil das Feld nicht existiert. Ein Entwickler, der es später doch versucht,
 * bekommt einen Typfehler und keinen falschen Rechnungsbetrag.
 */
export type OrderPrice =
  /** Der einzige Zustand, in dem bestellt werden darf. */
  | { readonly kind: 'fixed'; readonly unitPrice: Money; readonly priceListId: number }
  /** customers.price_list_id IS NULL — „noch nicht zugeordnet", nie „Standardgruppe". */
  | { readonly kind: 'price_list_unassigned' }
  /** Die zugeordnete Preisliste ist stillgelegt. KEIN Rückfall auf eine andere. */
  | { readonly kind: 'price_list_inactive' }
  /** Kein Katalogpreis für dieses Produkt in DIESER Liste. Nicht 0 €. */
  | { readonly kind: 'product_not_priced' }
  /** from / range / on_request — eine Preisangabe, aber kein Endpreis. */
  | { readonly kind: 'price_not_fixed'; readonly catalogPrice: CatalogPrice };

/**
 * Die Preise, mit denen für EINEN Kunden gerechnet werden darf.
 *
 * Der Typ ist das Gegenstück zu ProductCatalog und aus demselben Grund eine
 * Klasse und keine Map: Er ist Teil des Sicherheitsmodells. Ein Preis, der
 * nicht aus einem CustomerPriceBook stammt, kommt in keine Bestellung — und
 * ein CustomerPriceBook entsteht ausschließlich aus dem Kunden in der Sitzung
 * und der Datenbank, niemals aus einem Anfragekörper.
 *
 * Er enthält die Preise GENAU EINER Preisliste. Es gibt keine Methode, mit
 * der man eine zweite befragen könnte, und keinen Parameter, über den sich
 * die Liste beim Nachschlagen wechseln ließe. Ein Gastronomiekunde kann
 * deshalb keinen Privatpreis bekommen — nicht, weil eine Prüfung es
 * verhindert, sondern weil die Privatpreise gar nicht erst in diesem Objekt
 * sind.
 *
 * DIE THEKE RECHNET NICHT. Sie schlägt nach und gibt zurück, was in der
 * Datenbank steht. Menge, Positions- und Bestellsumme entstehen weiterhin in
 * OrderItem und Order.
 */
export class CustomerPriceBook {
  private constructor(
    private readonly priceListId: number | null,
    private readonly priceListActive: boolean,
    private readonly prices: ReadonlyMap<number, CatalogPrice>,
  ) {}

  /** Ein Kunde ohne Preisgruppe. Er bekommt keine Preise — auch keine geerbten. */
  static unassigned(): CustomerPriceBook {
    return new CustomerPriceBook(null, false, new Map());
  }

  /**
   * Ein Kunde, dessen Preisgruppe stillgelegt wurde.
   *
   * Die Zuordnung BLEIBT — sie ist eine kaufmännische Entscheidung und wird
   * nicht hinter dem Rücken dessen aufgelöst, der sie getroffen hat (siehe
   * 0013). Auflösbar ist sie trotzdem nicht: Die Preise einer stillgelegten
   * Liste sind nicht mehr gültig, und die einer anderen Liste waren nie für
   * diesen Kunden gemeint.
   */
  static inactive(priceListId: number): CustomerPriceBook {
    return new CustomerPriceBook(assertPriceListId(priceListId), false, new Map());
  }

  /**
   * Die aktive Preiswelt eines Kunden.
   *
   * Die Map wird KOPIERT. Der Aufrufer ist das Repository, und eine Theke,
   * deren Preise sich nach dem Bauen noch ändern lassen, wäre keine
   * Momentaufnahme, sondern eine Sicht — genau der Unterschied, um den es in
   * §14 geht.
   */
  static forPriceList(
    priceListId: number,
    prices: ReadonlyMap<number, CatalogPrice>,
  ): CustomerPriceBook {
    return new CustomerPriceBook(assertPriceListId(priceListId), true, new Map(prices));
  }

  /**
   * Der Preis EINES Produkts für DIESEN Kunden.
   *
   * Die Reihenfolge der Prüfungen ist die der Fachlichkeit, nicht die der
   * Bequemlichkeit: Ob der Kunde überhaupt eine gültige Preiswelt hat, ist
   * eine Aussage über den KUNDEN und gilt für jedes Produkt gleich. Erst
   * danach wird über das Produkt gesprochen. Andersherum meldete das System
   * einem nicht zugeordneten Kunden „dieses Produkt ist nicht bepreist" —
   * für jedes Produkt einzeln und in jedem Fall an der falschen Stelle.
   */
  priceFor(productId: number): OrderPrice {
    if (this.priceListId === null) {
      return { kind: 'price_list_unassigned' };
    }
    if (!this.priceListActive) {
      return { kind: 'price_list_inactive' };
    }

    const catalogPrice = this.prices.get(productId);
    if (catalogPrice === undefined) {
      return { kind: 'product_not_priced' };
    }
    if (catalogPrice.type !== 'fixed') {
      return { kind: 'price_not_fixed', catalogPrice };
    }

    /**
     * Money.fromCents prüft: ganzzahlig, nicht negativ, im sicheren Bereich.
     *
     * Die Spalte hat dieselben CHECK-Bedingungen — geprüft wird trotzdem, und
     * zwar aus demselben Grund wie in customer-repository.ts: Ein CHECK
     * schützt gegen künftige Schreibvorgänge, nicht gegen Daten, die vor
     * einer Schemaänderung entstanden sind oder an der Anwendung vorbei
     * eingespielt wurden. Ein kaputter Preis soll hier lautstark scheitern
     * und nicht leise in einer Bestellung landen.
     */
    return {
      kind: 'fixed',
      unitPrice: Money.fromCents(catalogPrice.priceCents),
      priceListId: this.priceListId,
    };
  }

  /** Ob dieser Kunde überhaupt eine auflösbare Preiswelt hat. */
  isResolvable(): boolean {
    return this.priceListId !== null && this.priceListActive;
  }

  /** Ob in dieser Preiswelt irgendein Produkt eine Preisangabe besitzt. */
  hasAnyPrice(): boolean {
    return this.isResolvable() && this.prices.size > 0;
  }
}

function assertPriceListId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidArgumentError('Die Preislisten-ID ist ungültig.');
  }
  return value;
}
