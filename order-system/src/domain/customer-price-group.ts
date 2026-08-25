/**
 * Die Preisgruppe eines Kunden — als Lesemodell des Adminbereichs.
 *
 * DIE FACHLICHE QUELLE IST price_lists AUS PHASE 5A. Es gibt bewusst KEINE
 * zweite Tabelle für Kundengruppen, keine `customer_types`, keine
 * `pricing_groups`: Eine zweite Liste derselben Preiswelten wäre eine Liste,
 * die irgendwann von der ersten abweicht. „Preisgruppe" ist ausschließlich
 * das Wort, mit dem die Oberfläche über eine Preisliste spricht.
 *
 * WAS HIER NICHT STEHT, VERLÄSST DIE DATENBANK NICHT: keine Zugangsdaten,
 * kein Salt, kein Verifier, keine Sitzungs-ID, kein Fehlversuchszähler, keine
 * Adresse, keine Notiz, kein Preis. Eine Kundenliste, die die Preisgruppe
 * pflegt, braucht den Namen des Kunden und seine Zuordnung — sonst nichts.
 */

/** Eine Preisgruppe, wie sie zur Auswahl steht. */
export interface PriceGroupOption {
  readonly code: string;
  readonly label: string;
}

/**
 * Die Preisgruppe, die einem Kunden bereits zugeordnet IST.
 *
 * Sie trägt zusätzlich `isActive`, und das ist kein Detail: Eine Preisliste
 * kann deaktiviert werden, NACHDEM ihr Kunden zugeordnet wurden. Diese
 * Zuordnung wird dann nicht still aufgelöst und nicht durch eine andere
 * ersetzt — sie bleibt sichtbar bestehen, und die Oberfläche sagt dazu, dass
 * die Gruppe nicht mehr aktiv ist. Alles andere hieße, eine kaufmännische
 * Entscheidung hinter dem Rücken desjenigen zu ändern, der sie getroffen hat.
 */
export interface AssignedPriceGroup extends PriceGroupOption {
  readonly isActive: boolean;
}

/** Eine Zeile der Kundenliste im Adminbereich. */
export interface AdminCustomerRow {
  /**
   * Die interne Kennung. Sie hat hier einen echten Nutzen in der Oberfläche —
   * sie adressiert den Kunden im Änderungsformular — und ist der einzige
   * technische Wert dieser Zeile.
   */
  readonly id: number;
  readonly name: string;
  /**
   * Ob der Kunde noch aktiv ist. Deaktivierte Kunden werden ANGEZEIGT und
   * nicht ausgeblendet: Ihre Preisgruppe muss pflegbar bleiben, und ein
   * stillschweigend verschwundener Kunde ist schwerer zu erklären als ein
   * sichtbar deaktivierter.
   */
  readonly isActive: boolean;
  /** `null` heißt: noch nicht zugeordnet. Es heißt niemals „Standardgruppe". */
  readonly priceGroup: AssignedPriceGroup | null;
}
