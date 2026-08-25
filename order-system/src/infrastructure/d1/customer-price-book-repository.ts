import type { CatalogPrice } from '../../domain/catalog-pricing';
import type { Customer } from '../../domain/customer';
import { CustomerPriceBook } from '../../domain/order-pricing';

interface PriceListRow {
  id: number;
  is_active: number;
}

interface PriceRow {
  product_id: number;
  price_type: CatalogPrice['type'];
  price_cents: number | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
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
   */
  prices: `
    SELECT p.id AS product_id, pp.price_type, pp.price_cents,
           pp.min_price_cents, pp.max_price_cents
      FROM products p
      JOIN catalog_products cp
        ON cp.id = p.catalog_product_id AND cp.is_active = 1
      JOIN catalog_product_prices pp
        ON pp.product_id = cp.id AND pp.price_list_id = ?
  `,
} as const;

/**
 * Lädt die Preiswelt EINES Kunden.
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
  const priceListId = customer.priceListId;
  if (priceListId === null) {
    return CustomerPriceBook.unassigned();
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
    return CustomerPriceBook.inactive(priceListId);
  }

  const prices = new Map<number, CatalogPrice>();
  for (const row of (priceResult?.results as PriceRow[] | undefined) ?? []) {
    const price = toCatalogPrice(row);
    if (price !== null) {
      prices.set(row.product_id, price);
    }
  }

  return CustomerPriceBook.forPriceList(priceListId, prices);
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
