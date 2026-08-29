/**
 * Der einzige Schreibweg für Herstellkosten.
 *
 * EINE DATEI, EINE SPALTE, EINE ANWEISUNG. Es gibt in diesem System keinen
 * zweiten UPDATE auf catalog_products.unit_cost_cents — wer den Wert ändern
 * will, kommt hier vorbei, und diese Funktion nimmt nichts entgegen, was
 * nicht Kennung, Betrag oder Zeitpunkt ist.
 */

export interface CatalogProductCostUpdate {
  readonly catalogProductId: number;
  /**
   * Der neue Wert in ganzzahligen Cent — oder null für „keine Herstellkosten
   * hinterlegt".
   *
   * `null` IST EIN WERT UND KEIN FEHLENDES ARGUMENT. Es löscht einen
   * gepflegten Kostenwert ausdrücklich und macht daraus wieder „nicht
   * gepflegt" — nicht 0 €.
   */
  readonly unitCostCents: number | null;
  /** ISO-8601-UTC. catalog_products.updated_at wird mitgeführt. */
  readonly now: string;
}

/**
 * Trägt die Herstellkosten eines Katalogprodukts ein.
 *
 * DIE BEDINGUNG `is_active = 1` IST ABSICHT und keine Sicherheitsprüfung: Die
 * Katalogseite zeigt ausschließlich aktive Katalogprodukte, und ein
 * Schreibvorgang auf eine Zeile, die man danach nirgends wiederfindet, wäre
 * eine Eingabe ins Leere. Wird ein Produkt zwischen Seitenaufruf und
 * Absenden stillgelegt, meldet der Rückgabewert das, statt es zu verschweigen.
 *
 * KEIN BEDINGTER UPDATE AUF DEN ALTEN WERT, anders als beim Statuswechsel.
 * Der Kostenwert hat keinen Lebenszyklus; er ist eine Schätzung, und wenn
 * zwei Leute nacheinander eintragen, ist der letzte Eintrag der jüngere Blick
 * auf dieselbe Sache — dieselbe Begründung wie beim Zahlungsstand aus 6A.
 *
 * ES WIRD KEINE BESTELLUNG ANGEFASST. In dieser Datei steht kein UPDATE und
 * kein DELETE auf order_items. Ein geänderter Kostenwert gilt ab jetzt und
 * für neue Bestellungen; was bestellt ist, behält seinen Snapshot.
 *
 * Der Rückgabewert ist `changes === 1` und nicht `void`: Er unterscheidet
 * „geschrieben" von „diese Zeile gibt es nicht (mehr)". id ist PRIMARY KEY,
 * mehr als eine Zeile kann es nicht sein.
 */
export async function updateCatalogProductCost(
  db: D1Database,
  update: CatalogProductCostUpdate,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE catalog_products
          SET unit_cost_cents = ?,
              updated_at = ?
        WHERE id = ?
          AND is_active = 1`,
    )
    .bind(update.unitCostCents, update.now, update.catalogProductId)
    .run();

  return meta.changes === 1;
}
