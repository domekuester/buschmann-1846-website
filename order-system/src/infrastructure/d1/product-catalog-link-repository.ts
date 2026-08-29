import {
  catalogProductLabel,
  type CatalogProductChoice,
  type ProductLinkRow,
} from '../../domain/product-catalog-link';
import { toBoolean } from './rows';

/**
 * Die Datenbankzugriffe des Zuordnungsbereichs auf /admin/catalog.
 *
 * ZWEI LESENDE ABFRAGEN FÜR DIE GANZE SEITE — §23. Nicht eine je Produkt und
 * nicht eine je Auswahloption: Die Zuordnungsliste ist EIN Zugriff, die
 * Auswahlliste ist EIN Zugriff, und beide bleiben es, egal wie viele Produkte
 * es gibt.
 *
 * Jede Abfrage hier liest AUSDRÜCKLICH aufgezählte Spalten. products.price_cents
 * kommt in keiner davon vor — dieselbe Regel wie in product-repository.ts seit
 * 5C: Was nicht geladen wird, kann nicht versehentlich als Preis verwendet
 * werden. Diese Datei kennt überhaupt keinen Preis.
 */

/**
 * DIE BEIDEN LESEABFRAGEN DES ZUORDNUNGSBEREICHS — nach außen sichtbar.
 *
 * Dieselbe Begründung wie bei PRODUCTION_DAY_QUERIES und
 * CUSTOMER_PRICE_BOOK_QUERIES: Ein Test, der die Abfrage ABSCHREIBT, prüft den
 * Plan einer Abfrage, die niemand ausführt. Und die ANZAHL der Schlüssel
 * dieses Objekts ist der Wächter gegen ein N+1, das sich später einschleicht
 * — eine Schleife über Produkte oder Auswahloptionen fiele dort sofort auf
 * (§23).
 */
export const PRODUCT_CATALOG_LINK_QUERIES = {
  /**
   * Alle Produkte mit ihrer bestehenden Zuordnung — in EINEM Zugriff.
   *
   * LEFT JOIN und nicht INNER JOIN: Ein unverknüpftes Produkt ist der
   * Normalfall nach Migration 0014 und muss in der Liste stehen — es ist sogar
   * genau das Produkt, dessentwegen es diesen Bereich gibt.
   *
   * OHNE FILTER AUF cp.is_active. Eine bestehende Verknüpfung auf ein
   * inzwischen stillgelegtes Katalogprodukt soll SICHTBAR bleiben; sie hier
   * wegzujoinen ließe das Produkt fälschlich als „nicht verknüpft" erscheinen,
   * und der nächste Klick löste eine Zuordnung auf, die jemand bewusst gesetzt
   * hat. Ob ein Katalogprodukt NEU wählbar ist, beantwortet die zweite
   * Abfrage.
   *
   * OHNE FILTER AUF p.is_active. Ein deaktiviertes Produkt bleibt sichtbar,
   * weil es ein Katalogprodukt HÄLT: Wäre die Zeile ausgeblendet, erschiene
   * dessen Katalogplatz für jedes andere Produkt als vergeben, ohne dass
   * irgendwo stünde, wer ihn hält.
   *
   * Die Sortierung entspricht dem Index idx_products_orderable und damit der
   * Reihenfolge der Bestellseite.
   */
  links: `
    SELECT p.id, p.name, p.is_active,
           cp.id        AS catalog_id,
           cp.name      AS catalog_name,
           cp.variant   AS catalog_variant,
           cp.unit      AS catalog_unit,
           cp.is_active AS catalog_is_active
      FROM products p
      LEFT JOIN catalog_products cp ON cp.id = p.catalog_product_id
     ORDER BY p.is_active DESC, p.sort_order, p.id
  `,

  /**
   * Die Katalogprodukte, die NEU zugeordnet werden dürfen — in EINEM Zugriff.
   *
   * Nur aktive, in der fachlichen Reihenfolge aus Phase 5A. Der LEFT JOIN
   * beantwortet nebenbei die Frage, wer ein Katalogprodukt bereits hält; ohne
   * ihn bräuchte die Oberfläche je Option eine eigene Abfrage, und genau das
   * verbietet §23. Er läuft über idx_products_catalog_product — den partiellen
   * UNIQUE-Index aus 0014, der hier ein zweites Mal Nutzen stiftet.
   *
   * Ein STILLGELEGTES Katalogprodukt steht hier nicht: Es soll nicht neu
   * vergeben werden. Eine BESTEHENDE Zuordnung auf ein stillgelegtes
   * Katalogprodukt bleibt davon unberührt — sie kommt aus der ersten Abfrage
   * und wird von der Oberfläche als Fortschreibung angeboten.
   */
  choices: `
    SELECT cp.id, cp.name, cp.variant, cp.unit, p.id AS linked_product_id
      FROM catalog_products cp
      LEFT JOIN products p ON p.catalog_product_id = cp.id
     WHERE cp.is_active = 1
     ORDER BY cp.sort_order, cp.id
  `,
} as const;

interface ProductLinkQueryRow {
  id: number;
  name: string;
  is_active: number;
  catalog_id: number | null;
  catalog_name: string | null;
  catalog_variant: string | null;
  catalog_unit: string | null;
  catalog_is_active: number | null;
}

/** Alle Produkte mit ihrer bestehenden Zuordnung — siehe PRODUCT_CATALOG_LINK_QUERIES.links. */
export async function loadProductLinks(db: D1Database): Promise<ProductLinkRow[]> {
  const { results } = await db.prepare(PRODUCT_CATALOG_LINK_QUERIES.links)
    .all<ProductLinkQueryRow>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: toBoolean(row.is_active),
    catalogProduct:
      row.catalog_id === null || row.catalog_name === null
        ? null
        : {
            id: row.catalog_id,
            label: catalogProductLabel({
              name: row.catalog_name,
              variant: row.catalog_variant,
              unit: row.catalog_unit,
            }),
            isActive: toBoolean(row.catalog_is_active ?? 0),
          },
  }));
}

interface CatalogChoiceQueryRow {
  id: number;
  name: string;
  variant: string | null;
  unit: string | null;
  linked_product_id: number | null;
}

/** Die neu vergebbaren Katalogprodukte — siehe PRODUCT_CATALOG_LINK_QUERIES.choices. */
export async function loadLinkableCatalogProducts(db: D1Database): Promise<CatalogProductChoice[]> {
  const { results } = await db.prepare(PRODUCT_CATALOG_LINK_QUERIES.choices)
    .all<CatalogChoiceQueryRow>();

  return results.map((row) => ({
    id: row.id,
    label: catalogProductLabel({ name: row.name, variant: row.variant, unit: row.unit }),
    linkedProductId: row.linked_product_id,
  }));
}

/** Ein Katalogprodukt anhand seiner Kennung — mitsamt der Frage, ob es aktiv ist. */
export async function findCatalogProduct(
  db: D1Database,
  catalogProductId: number,
): Promise<{ readonly id: number; readonly isActive: boolean } | null> {
  const row = await db
    .prepare('SELECT id, is_active FROM catalog_products WHERE id = ?')
    .bind(catalogProductId)
    .first<{ id: number; is_active: number }>();

  return row === null ? null : { id: row.id, isActive: toBoolean(row.is_active) };
}

/**
 * Die bestehende Zuordnung eines Produkts — und ob es das Produkt überhaupt
 * gibt.
 *
 * `null` heißt „dieses Produkt gibt es nicht"; ein Verbund mit
 * `catalogProductId: null` heißt „es gibt es, es ist nur nicht verknüpft".
 * Die beiden Lagen zu vermischen hieße, ein gelöschtes Produkt wie ein
 * unverknüpftes zu behandeln — dieselbe Unterscheidung wie bei
 * findCustomerAssignment aus 5B.
 */
export async function findProductLink(
  db: D1Database,
  productId: number,
): Promise<{ readonly catalogProductId: number | null } | null> {
  const row = await db
    .prepare('SELECT catalog_product_id FROM products WHERE id = ?')
    .bind(productId)
    .first<{ catalog_product_id: number | null }>();

  return row === null ? null : { catalogProductId: row.catalog_product_id };
}

/**
 * Der einzige Schreibvorgang dieser Phase.
 *
 * EINE SPALTE UND EIN ZEITSTEMPEL. Name, Beschreibung, Einheit, Aktivität,
 * Sortierung — und vor allem products.price_cents — kommen in diesem UPDATE
 * nicht vor. Es gibt hier keine Zeile, die einen Preis setzte, und damit auch
 * keine, die ihn versehentlich überschriebe. Das ist §10 und §11 des Auftrags
 * an der einzigen Stelle, an der sie technisch verletzt werden könnten.
 *
 * DIE BELEGUNGSPRÜFUNG STEHT IN DERSELBEN ANWEISUNG WIE DER SCHREIBVORGANG.
 *
 * Der partielle UNIQUE-Index aus 0014 lässt ein Katalogprodukt an höchstens
 * einem Produkt hängen. Ein vorgeschaltetes „ist es frei?"-SELECT wäre ein
 * Zeitfenster: Zwischen der Frage und dem Schreiben kann ein zweiter Admin
 * dasselbe Katalogprodukt belegen, und dann käme ein SQL-Fehler bis in die
 * Oberfläche — genau das verbietet §5. Das NOT EXISTS macht die Prüfung zum
 * Teil der Bedingung; SQLite wertet beides in einer Anweisung aus.
 *
 * Die Bedingung `andere.id <> ?` nimmt das Produkt selbst aus: Eine
 * unveränderte Fortschreibung derselben Zuordnung darf nicht an sich selbst
 * scheitern.
 *
 * Beim Auflösen (catalogProductId = NULL) ist `andere.catalog_product_id = NULL`
 * für keine Zeile wahr — NULL ist kein Wert. Das NOT EXISTS ist damit
 * automatisch erfüllt, und ein Unlink gelingt immer.
 *
 * Der Rückgabewert sagt NUR, ob geschrieben wurde. Ob eine 0 an einem
 * unbekannten Produkt oder an einem belegten Katalogprodukt lag, entscheidet
 * der Anwendungsfall — eine Datenbankfunktion, die das unterscheidet, müsste
 * dafür raten oder eine zweite Abfrage aufmachen, die sie nicht immer braucht.
 */
export async function updateProductCatalogLink(
  db: D1Database,
  productId: number,
  catalogProductId: number | null,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE products
          SET catalog_product_id = ?, updated_at = ?
        WHERE id = ?
          AND NOT EXISTS (
                SELECT 1 FROM products andere
                 WHERE andere.catalog_product_id = ?
                   AND andere.id <> ?)`,
    )
    .bind(catalogProductId, now.toISOString(), productId, catalogProductId, productId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
