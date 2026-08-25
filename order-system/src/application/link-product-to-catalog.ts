import {
  findCatalogProduct,
  findProductLink,
  updateProductCatalogLink,
} from '../infrastructure/d1/product-catalog-link-repository';

/**
 * „Verknüpfe dieses bestellbare Produkt mit jenem Katalogprodukt."
 *
 * Der einzige schreibende Vorgang von Phase 5D — und bewusst der kleinste,
 * den es geben kann: ein Produkt, ein Katalogprodukt, sonst nichts.
 *
 * WAS DIESE FUNKTION NICHT TUT, IST WICHTIGER ALS WAS SIE TUT:
 *
 *   Sie RÄT NICHTS. Es gibt hier keine Zeile, die einen Produktnamen mit
 *   einem Katalognamen vergleicht, keine Ähnlichkeitsfunktion, keine
 *   Auswertung von sort_order, Einheit oder Preis. Die Zuordnung ist eine
 *   bewusste Entscheidung eines Menschen — §3. Würde das System sie ableiten,
 *   änderte sich der Preis einer Bestellung beim nächsten Tippfehler in einem
 *   Produktnamen, ohne dass jemand einen Preis geändert hätte. Das ist
 *   dieselbe Begründung, mit der Migration 0014 gegen einen Namensabgleich
 *   entschieden hat.
 *
 *   Sie BERECHNET KEINEN PREIS und kopiert keinen. In dieser Datei steht kein
 *   Cent-Betrag, keine Preisliste und kein Preistyp. Was ein verknüpftes
 *   Produkt einen bestimmten Kunden kostet, entscheidet unverändert der
 *   Resolver aus Phase 5C — 5D setzt ausschließlich catalog_product_id (§11).
 *
 *   Sie ENTSCHEIDET NICHT, OB SIE AUFGERUFEN WERDEN DARF. Rolle, Sitzung,
 *   Origin und CSRF-Token stehen in der HTTP-Schicht und ausschließlich dort
 *   — dieselbe Trennung wie bei changeOrderStatus und
 *   assignCustomerPriceGroup. Der Parameter, über den sich hier eine Rolle
 *   behaupten ließe, existiert gar nicht.
 *
 * Der Zeitpunkt wird ÜBERGEBEN und nicht abgeleitet: Kein Date.now(), sonst
 * wäre updated_at in keinem Test prüfbar.
 */

/**
 * Was bei dem Versuch herausgekommen ist.
 *
 * Ein diskriminierter Verbund und keine Ausnahme — dieselbe Entscheidung wie
 * bei AssignCustomerPriceGroupResult: Alle vier Ablehnungen sind normale
 * Betriebsfälle (ein zwischenzeitlich entferntes Produkt, ein veralteter
 * Bildschirm, ein inzwischen stillgelegtes Katalogprodukt, ein zweiter Admin,
 * der schneller war) und gehören in den Rückgabetyp, wo der Aufrufer sie
 * nicht übersehen kann.
 *
 * WELCHE HTTP-CODES ODER TEXTE DARAUS WERDEN, steht nicht hier. Diese Datei
 * kennt kein HTTP.
 */
export type LinkProductToCatalogResult =
  | { readonly outcome: 'linked' }
  /** Dieses bestellbare Produkt gibt es nicht (mehr). */
  | { readonly outcome: 'unknown_product' }
  /** Dieses Katalogprodukt gibt es nicht. */
  | { readonly outcome: 'unknown_catalog_product' }
  /** Es gibt es, aber es ist stillgelegt und damit nicht neu vergebbar. */
  | { readonly outcome: 'inactive_catalog_product' }
  /** Ein ANDERES Produkt hält dieses Katalogprodukt bereits — §5. */
  | { readonly outcome: 'catalog_product_taken' };

export interface LinkProductToCatalogCommand {
  readonly productId: number;
  /**
   * Die Kennung des gewünschten Katalogprodukts — oder `null` für „nicht
   * verknüpft".
   *
   * EINE ZEILEN-ID UND KEIN NAME. Anders als bei der Preisgruppe aus 5B, die
   * über ihren stabilen fachlichen Code adressiert wird, hat ein
   * Katalogprodukt keinen solchen Code in der Oberfläche: source_key ist ein
   * Importschlüssel, und der Name ist genau das, worüber hier NICHT
   * zugeordnet werden darf. Die ID ist der einzige Wert, der eine Identität
   * bezeichnet, statt sie zu beschreiben.
   *
   * `null` ist ein vollwertiges Ziel und kein Fehlerfall: „Dieses Produkt
   * habe ich bewusst nicht verknüpft" muss aussprechbar bleiben, auch
   * nachträglich (§9).
   */
  readonly catalogProductId: number | null;
  readonly now: Date;
}

export async function linkProductToCatalog(
  db: D1Database,
  command: LinkProductToCatalogCommand,
): Promise<LinkProductToCatalogResult> {
  const { productId, catalogProductId, now } = command;

  /**
   * DAS KATALOGPRODUKT WIRD ZUERST AUFGELÖST — und zwar gegen die Datenbank.
   *
   * Es gibt in dieser Datei keine Liste erlaubter Kennungen. Stünde hier eine,
   * gäbe es zwei Fassungen der Wahrheit darüber, welche Katalogprodukte es
   * gibt: catalog_products und diese Datei. Die zweite wäre diejenige, die
   * niemand pflegt.
   */
  if (catalogProductId !== null) {
    const katalogprodukt = await findCatalogProduct(db, catalogProductId);
    if (katalogprodukt === null) {
      return { outcome: 'unknown_catalog_product' };
    }

    if (!katalogprodukt.isActive) {
      /**
       * VERBOTEN IST DIE NEUE VERGABE — nicht die unveränderte
       * Fortschreibung.
       *
       * Ein Katalogprodukt kann stillgelegt werden, NACHDEM ein Produkt daran
       * hängt. Dieses Produkt behält seine Zuordnung, und der
       * Zuordnungsbereich zeigt sie als ausgewählt an. Sein eigenes Formular
       * unverändert abzuschicken darf deshalb nicht scheitern: Es ändert
       * nichts.
       *
       * Für JEDES ANDERE Produkt bleibt das stillgelegte Katalogprodukt
       * unwählbar — die Bedingung darunter vergleicht die bestehende
       * Zuordnung, nicht bloß die Existenz einer solchen. Dieselbe Regel wie
       * bei der inaktiven Preisgruppe in assign-customer-price-group.ts.
       */
      const bestehend = await findProductLink(db, productId);
      if (bestehend === null) {
        return { outcome: 'unknown_product' };
      }
      if (bestehend.catalogProductId !== catalogProductId) {
        return { outcome: 'inactive_catalog_product' };
      }
    }
  }

  /**
   * Erst jetzt wird geschrieben — und das Produkt wird dabei nicht vorher
   * gesucht: Das UPDATE trifft entweder eine Zeile oder keine.
   *
   * Die Belegungsprüfung steckt in derselben Anweisung (siehe
   * updateProductCatalogLink), damit zwischen „ist frei" und „schreibe" kein
   * Zeitfenster liegt, in dem ein zweiter Admin dasselbe Katalogprodukt
   * belegt. Ein SQL-Fehler aus dem UNIQUE-Index erreicht die Oberfläche
   * deshalb nicht — §5.
   */
  if (await updateProductCatalogLink(db, productId, catalogProductId, now)) {
    return { outcome: 'linked' };
  }

  /**
   * NICHTS GESCHRIEBEN — und jetzt erst die Frage, woran es lag.
   *
   * Zwei Gründe kommen infrage, und sie sind für den Admin verschieden:
   * „dieses Produkt gibt es nicht mehr" (sein Bildschirm ist veraltet) und
   * „ein anderes Produkt hält dieses Katalogprodukt bereits" (er muss dort
   * zuerst auflösen). Diese Abfrage läuft nur im Fehlerfall — im Regelfall
   * kostet die Unterscheidung keine Datenbankrunde.
   */
  const bestehend = await findProductLink(db, productId);
  return bestehend === null
    ? { outcome: 'unknown_product' }
    : { outcome: 'catalog_product_taken' };
}
