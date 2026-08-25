import {
  findCustomerAssignment,
  findPriceGroupByCode,
  updateCustomerPriceList,
} from '../infrastructure/d1/customer-price-group-repository';

/**
 * „Ordne diesen Kunden jener Preisgruppe zu."
 *
 * Der einzige schreibende Vorgang von Phase 5B — und bewusst der kleinste,
 * den es geben kann: ein Kunde, eine Preisgruppe, sonst nichts.
 *
 * WAS DIESE FUNKTION NICHT TUT, IST WICHTIGER ALS WAS SIE TUT:
 *
 *   Sie RÄT NICHTS. Es gibt hier keine Zeile, die einen Kundennamen ansieht,
 *   keine, die eine E-Mail-Domain auswertet, und keine, die aus bisherigen
 *   Bestellungen auf eine Preiswelt schließt. Eine Preisgruppe ist eine
 *   kaufmännische Entscheidung eines Menschen. Würde das System sie ableiten,
 *   rechnete irgendwann jemand nach Preisen ab, die niemand entschieden hat.
 *
 *   Sie WÄHLT KEINEN PREIS. Was eine Bestellung kostet, entscheidet
 *   weiterhin ausschließlich der bestehende Bestellfluss über
 *   products.price_cents. In dieser Datei steht kein Cent-Betrag — das ist
 *   Phase 5C.
 *
 *   Sie ENTSCHEIDET NICHT, OB SIE AUFGERUFEN WERDEN DARF. Rolle, Sitzung,
 *   Origin und CSRF-Token stehen in der HTTP-Schicht und ausschließlich dort
 *   — dieselbe Trennung wie bei changeOrderStatus. Der Parameter, über den
 *   sich hier eine Rolle behaupten ließe, existiert gar nicht.
 *
 * Der Zeitpunkt wird ÜBERGEBEN und nicht abgeleitet: Kein Date.now(), sonst
 * wäre updated_at in keinem Test prüfbar.
 */

/**
 * Was bei dem Versuch herausgekommen ist.
 *
 * Ein diskriminierter Verbund und keine Ausnahme — dieselbe Entscheidung wie
 * bei ChangeOrderStatusResult: Alle drei Ablehnungen sind normale
 * Betriebsfälle (ein zwischenzeitlich gelöschter Kunde, ein veralteter
 * Bildschirm, eine inzwischen deaktivierte Preisgruppe) und gehören in den
 * Rückgabetyp, wo der Aufrufer sie nicht übersehen kann.
 *
 * WELCHE HTTP-CODES daraus werden, steht nicht hier. Diese Datei kennt kein
 * HTTP.
 */
export type AssignCustomerPriceGroupResult =
  | { readonly outcome: 'assigned' }
  /** Diesen Kunden gibt es nicht (mehr). */
  | { readonly outcome: 'unknown_customer' }
  /** Diesen Preisgruppen-Code gibt es nicht. */
  | { readonly outcome: 'unknown_price_group' }
  /** Es gibt sie, aber sie ist deaktiviert und damit nicht neu wählbar. */
  | { readonly outcome: 'inactive_price_group' };

export interface AssignCustomerPriceGroupCommand {
  readonly customerId: number;
  /**
   * Der Code der gewünschten Preisgruppe — oder `null` für „nicht zugeordnet".
   *
   * EIN CODE UND KEINE ZEILEN-ID. Der Code ist die stabile fachliche Kennung
   * aus Phase 5A ('gastro', 'private'); eine Zeilennummer aus price_lists
   * wäre ein interner Wert ohne Nutzen in der Oberfläche und müsste trotzdem
   * durch das Formular wandern.
   *
   * `null` ist ein vollwertiges Ziel und kein Fehlerfall: „Diesen Kunden habe
   * ich noch nicht zugeordnet" muss aussprechbar bleiben, auch nachträglich.
   */
  readonly priceListCode: string | null;
  readonly now: Date;
}

export async function assignCustomerPriceGroup(
  db: D1Database,
  command: AssignCustomerPriceGroupCommand,
): Promise<AssignCustomerPriceGroupResult> {
  const { customerId, priceListCode, now } = command;

  /**
   * DIE PREISGRUPPE WIRD ZUERST AUFGELÖST — und zwar gegen die Datenbank.
   *
   * Es gibt in dieser Datei keine Liste erlaubter Codes. Stünde hier eine,
   * gäbe es zwei Fassungen der Wahrheit darüber, welche Preiswelten es gibt:
   * price_lists und diese Datei. Die zweite wäre diejenige, die niemand
   * pflegt.
   *
   * EINE DEAKTIVIERTE GRUPPE IST EIN EIGENER AUSGANG und nicht dasselbe wie
   * eine unbekannte. „Die gibt es nicht" und „die gibt es, sie wird aber
   * nicht mehr vergeben" sind für den Admin zwei verschiedene Lagen — und
   * beide führen dazu, dass NICHTS geschrieben wird.
   */
  let priceListId: number | null = null;
  if (priceListCode !== null) {
    const gruppe = await findPriceGroupByCode(db, priceListCode);
    if (gruppe === null) {
      return { outcome: 'unknown_price_group' };
    }
    if (!gruppe.isActive) {
      /**
       * VERBOTEN IST DIE NEUE VERGABE — nicht die unveränderte
       * Fortschreibung.
       *
       * Eine Preisliste kann deaktiviert werden, nachdem ihr Kunden
       * zugeordnet wurden. Diese Kunden behalten ihre Zuordnung (§15: sie
       * darf nicht still auf etwas anderes wechseln), und die Kundenliste
       * zeigt sie als ausgewählt an. Ihr eigenes Formular unverändert
       * abzuschicken darf deshalb nicht scheitern: Es ändert nichts.
       *
       * Für JEDEN ANDEREN Kunden bleibt die inaktive Gruppe unwählbar — die
       * Bedingung darunter vergleicht die bestehende Zuordnung, nicht bloß
       * die Existenz einer solchen.
       */
      const bestehend = await findCustomerAssignment(db, customerId);
      if (bestehend === null) {
        return { outcome: 'unknown_customer' };
      }
      if (bestehend.priceListId !== gruppe.id) {
        return { outcome: 'inactive_price_group' };
      }
    }
    priceListId = gruppe.id;
  }

  /**
   * Erst jetzt wird geschrieben — und der Kunde wird dabei nicht vorher
   * gesucht: Das UPDATE trifft entweder eine Zeile oder keine, und genau das
   * ist die Antwort auf die Frage, ob es ihn gibt.
   */
  const geschrieben = await updateCustomerPriceList(db, customerId, priceListId, now);

  return geschrieben ? { outcome: 'assigned' } : { outcome: 'unknown_customer' };
}
