import type { CatalogPrice } from '../../domain/catalog-pricing';
import type { Customer } from '../../domain/customer';
import type { Money } from '../../domain/money';
import { CustomerPriceBook } from '../../domain/order-pricing';
import { ProductCostBook, unitCostFromCents } from '../../domain/product-cost';

interface PriceListRow {
  id: number;
  is_active: number;
}

interface PriceContextRow {
  code: string;
  is_active: number;
}

interface PriceRow {
  product_id: number;
  price_type: CatalogPrice['type'];
  price_cents: number | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
  /** Seit 0017 — die internen Herstellkosten des Katalogprodukts, oder NULL. */
  unit_cost_cents: number | null;
}

/**
 * Die beiden Abfragen, für den Query-Plan-Test nach außen sichtbar — dieselbe
 * Begründung wie in production-day-repository.ts: Ein Test, der die Abfrage
 * abschreibt, prüft den Plan einer Abfrage, die niemand ausführt.
 */
export const CUSTOMER_PRICE_BOOK_QUERIES = {
  priceList: `SELECT id, is_active FROM price_lists WHERE id = ?`,

  /**
   * DIE PREISE DES GESAMTEN SORTIMENTS IN EINEM ZUGRIFF — §20.
   *
   * Der Schlüssel des Ergebnisses ist products.id, NICHT catalog_products.id.
   * Das ist kein Detail: Bestellungen, Entwürfe und order_items sprechen
   * ausschließlich in products.id. Würde die Theke in Katalog-IDs antworten,
   * müsste irgendjemand zwischen beiden Welten übersetzen — und diese
   * Übersetzung wäre eine zweite Preislogik.
   *
   * Der JOIN über p.catalog_product_id IST die Verknüpfung aus 0014. Ein
   * Produkt ohne Verknüpfung fällt hier heraus und hat damit keinen Preis;
   * ein stillgelegtes Katalogprodukt (cp.is_active = 0) ebenso. Beides wird
   * in der Domäne zu `product_not_priced` — nicht zu 0 € und nicht zu
   * products.price_cents.
   *
   * products.price_cents kommt in dieser Abfrage NICHT vor. Was nicht
   * geladen wird, kann nicht versehentlich als Preis verwendet werden.
   *
   * SEIT PHASE 7A KOMMEN DIE HERSTELLKOSTEN AUS DERSELBEN ZEILE — §21.
   *
   * cp.unit_cost_cents ist eine weitere SPALTE und keine weitere ABFRAGE:
   * Das Katalogprodukt ist für die Preisauflösung ohnehin verbunden, der
   * Kostenwert steht seit 0017 daran, und ihn hier mitzunehmen kostet weder
   * einen zusätzlichen Zugriff noch einen zusätzlichen JOIN. Eine eigene
   * Kostenabfrage je Position wäre das N+1, das §21 ausschließt; selbst eine
   * einzelne zusätzliche Abfrage wäre eine, die niemand braucht.
   *
   * ES IST EINE INNERE VERBINDUNG AUF DEN PREIS, UND DAS GENÜGT: Ein
   * Produkt ohne Preis in dieser Liste fällt heraus und ist für diesen Kunden
   * nicht bestellbar. Jedes Produkt, das bestellt werden KANN, steht also in
   * diesem Ergebnis — und damit auch sein Kostenwert, falls einer gepflegt
   * ist.
   */
  prices: `
    SELECT p.id AS product_id, pp.price_type, pp.price_cents,
           pp.min_price_cents, pp.max_price_cents, cp.unit_cost_cents
      FROM products p
      JOIN catalog_products cp
        ON cp.id = p.catalog_product_id AND cp.is_active = 1
      JOIN catalog_product_prices pp
        ON pp.product_id = cp.id AND pp.price_list_id = ?
  `,
} as const;

/**
 * Lädt NUR die Preiswelt eines Kunden — der Weg der kundenseitigen
 * Bestellseite.
 *
 * SEIT PHASE 7A IST DAS EIN AUSSCHNITT UND KEIN VOLLSTÄNDIGES ERGEBNIS: Er
 * verwirft die Herstellkosten, die dieselbe Abfrage mitliefert. Wer sie
 * braucht, ruft loadOrderPricing() — und das tut ausschließlich der
 * schreibende Bestellweg.
 *
 * DER KUNDE KOMMT ALS FERTIGES OBJEKT, NICHT ALS ID UND SCHON GAR NICHT AUS
 * EINEM ANFRAGEKÖRPER. Dieselbe Überlegung wie bei placeCafeOrder: Ein
 * `priceListId: number` an dieser Stelle wäre der Unterschied zwischen „der
 * Aufrufer muss den Kunden geladen haben" und „der Aufrufer darf eine Zahl
 * nennen". Die Preisliste wird hier ausschließlich aus dem Kunden gelesen.
 *
 * Ein Kunde ohne Preisgruppe kostet KEINE Abfrage. Es gibt nichts
 * nachzuschlagen, und ein Rückfall auf eine Standardliste existiert nicht.
 *
 * Die beiden übrigen Abfragen laufen als ein batch(): D1 führt ihn als eine
 * Transaktion aus, sodass beide Teilergebnisse aus demselben Stand stammen.
 * Eine Preisliste, die zwischen den beiden Abfragen stillgelegt wird, kann so
 * nicht zu einem Buch führen, das die Liste für aktiv hält und ihre Preise
 * schon geladen hat.
 */
export async function loadCustomerPriceBook(
  db: D1Database,
  customer: Customer,
): Promise<CustomerPriceBook> {
  return (await loadOrderPricing(db, customer)).priceBook;
}

/**
 * Der kurze, rein informative Preiskontext der Kundenoberfläche.
 *
 * Die Zuordnung kommt ausschließlich aus dem bereits authentifizierten
 * Customer. Zurückgegeben wird kein Code und keine ID, sondern nur eine
 * fertige Anzeige. Eine unbekannte oder inaktive Liste wird niemals geraten.
 */
export async function loadCustomerPriceContextLabel(
  db: D1Database,
  customer: Customer,
): Promise<string> {
  if (customer.priceListId === null) return 'Preise noch nicht verfügbar';

  const row = await db
    .prepare('SELECT code, is_active FROM price_lists WHERE id = ?')
    .bind(customer.priceListId)
    .first<PriceContextRow>();

  if (row === null || row.is_active !== 1) return 'Preise noch nicht verfügbar';
  if (row.code === 'gastro') return 'Geschäftskundenpreise';
  if (row.code === 'private') return 'Privatkundenpreise';
  return 'Kundenpreise';
}

/**
 * Preise UND Herstellkosten eines Kunden — der Weg, den NUR das Bestellen
 * nimmt.
 *
 * ZWEI RÜCKGABEWERTE STATT EINES ERWEITERTEN PREISBUCHS, und das ist die
 * Datenschutzentscheidung dieser Phase (§11):
 *
 *   loadCustomerPriceBook()  die Bestellseite des Cafés. Bekommt AUSSCHLIESSLICH
 *                            das Preisbuch — sie kann keine Herstellkosten
 *                            anzeigen, weil sie keine hat.
 *   loadOrderPricing()       das Schreiben einer Bestellung. Bekommt beides.
 *
 * Ein Kostenfeld im CustomerPriceBook wäre der bequemere Weg gewesen und
 * hätte die Trennung zu einer Frage der Sorgfalt beim Rendern gemacht. So ist
 * sie eine Frage des Typs.
 *
 * ES KOSTET KEINE ZUSÄTZLICHE ABFRAGE. Beide Bücher entstehen aus demselben
 * batch() aus zwei Anweisungen — genau wie vor Phase 7A. Die Kosten sind eine
 * Spalte in einer Zeile, die ohnehin gelesen wird.
 */
export interface CustomerOrderPricing {
  readonly priceBook: CustomerPriceBook;
  readonly costBook: ProductCostBook;
}

export async function loadOrderPricing(
  db: D1Database,
  customer: Customer,
): Promise<CustomerOrderPricing> {
  const priceListId = customer.priceListId;
  if (priceListId === null) {
    /**
     * Ein Kunde ohne Preisgruppe kostet weiterhin KEINE Abfrage — und
     * bekommt folgerichtig auch kein Kostenbuch mit Inhalt. Er kann nicht
     * bestellen; ein Kostenwert wäre eine Angabe zu einer Position, die nie
     * entsteht.
     */
    return { priceBook: CustomerPriceBook.unassigned(), costBook: ProductCostBook.empty() };
  }

  const [listResult, priceResult] = await db.batch<PriceListRow | PriceRow>([
    db.prepare(CUSTOMER_PRICE_BOOK_QUERIES.priceList).bind(priceListId),
    db.prepare(CUSTOMER_PRICE_BOOK_QUERIES.prices).bind(priceListId),
  ]);

  const list = (listResult?.results as PriceListRow[] | undefined)?.[0];

  /**
   * Eine fehlende Zeile ist mit dem Fremdschlüssel aus 0013 eigentlich
   * unmöglich — ON DELETE RESTRICT lässt eine Preisliste nicht löschen,
   * solange Kunden an ihr hängen. Sollte sie trotzdem fehlen (Daten aus der
   * Zeit vor dem Fremdschlüssel, ein Eingriff an der Anwendung vorbei), gilt
   * dasselbe wie für eine stillgelegte Liste: nicht auflösbar, und KEIN
   * Rückfall auf eine andere. Der Kunde bekommt eine kontrollierte Meldung
   * und keine geratenen Preise.
   */
  if (list === undefined || list.is_active !== 1) {
    return { priceBook: CustomerPriceBook.inactive(priceListId), costBook: ProductCostBook.empty() };
  }

  const prices = new Map<number, CatalogPrice>();
  const costs = new Map<number, Money>();
  for (const row of (priceResult?.results as PriceRow[] | undefined) ?? []) {
    const price = toCatalogPrice(row);
    if (price !== null) {
      prices.set(row.product_id, price);
    }

    /**
     * DIE KOSTEN HÄNGEN NICHT AM PREISTYP. Auch ein Produkt mit „auf
     * Anfrage" hat gepflegte Herstellkosten, wenn jemand sie eingetragen hat
     * — bestellbar ist es deswegen trotzdem nicht, und dann wird der Wert
     * eben nie abgefragt. Ihn hier an eine Preisform zu koppeln wäre eine
     * zweite Regel für dieselbe Zahl.
     *
     * KEIN EINTRAG BEI NULL. Der Unterschied zwischen „nicht im Buch" und
     * „im Buch mit 0 €" ist der ganze Punkt von §14.
     */
    const cost = unitCostFromCents(row.unit_cost_cents ?? null);
    if (cost !== null) {
      costs.set(row.product_id, cost);
    }
  }

  return {
    priceBook: CustomerPriceBook.forPriceList(priceListId, prices),
    costBook: ProductCostBook.fromCosts(costs),
  };
}

/**
 * Eine Preiszeile in die Domänenform.
 *
 * Die Bedingung chk_catalog_price_shape aus 0012 garantiert, dass die
 * jeweils passenden Spalten gefüllt sind. Geprüft wird trotzdem: Fehlt der
 * erwartete Wert, entsteht KEIN Preis (null) statt eines Preises aus einer
 * anderen Spalte. Ein „from" ohne min_price_cents wird nicht zu einem
 * Festpreis, und ein „fixed" ohne price_cents nicht zu 0 €.
 */
function toCatalogPrice(row: PriceRow): CatalogPrice | null {
  switch (row.price_type) {
    case 'fixed':
      return row.price_cents === null ? null : { type: 'fixed', priceCents: row.price_cents };
    case 'from':
      return row.min_price_cents === null ? null : { type: 'from', minPriceCents: row.min_price_cents };
    case 'range':
      return row.min_price_cents === null || row.max_price_cents === null
        ? null
        : { type: 'range', minPriceCents: row.min_price_cents, maxPriceCents: row.max_price_cents };
    case 'on_request':
      return { type: 'on_request' };
    default:
      // Ein unbekannter Preistyp ist kein Preis. Er wird nicht geraten.
      return null;
  }
}
