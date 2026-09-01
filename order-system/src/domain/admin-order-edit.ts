import type { OrderStatus } from './order-status';
import type { PaymentStatus } from './payment-status';

/**
 * Eine Bestellung, wie die BEARBEITUNGSANSICHT sie sieht.
 *
 * DER UNTERSCHIED ZUM Order-AGGREGAT IST DIE AUSSAGE DIESER DATEI. Order ist
 * das gültige Dokument: Es kennt nur aktive Positionen, es kennt keine
 * Datenbank-IDs, und sein Gesamtbetrag ist die Summe dessen, was noch gilt.
 * Genau deshalb taugt es für diese Seite nicht — sie muss zeigen, was einmal
 * bestellt war, und sie muss jede Zeile beim Namen nennen können, den ein
 * Formular zurückschickt.
 *
 * ES IST EIN LESEMODELL UND KEIN ZWEITES AGGREGAT. Es hat keine Methoden, es
 * prüft nichts und es kann nichts ändern. Was eine gültige Mengenänderung
 * ist, steht in order-item-edit.ts; was geschrieben wird, in
 * application/edit-order-item.ts.
 *
 * WAS FEHLT, IST ABSICHT: keine Herstellkosten, kein Rohertrag, keine Marge.
 * Die Bearbeitungsansicht ist Betrieb und kein Controlling — dieselbe
 * Entscheidung wie bei der Kundendetailseite aus Phase 7C. Ebenso fehlen
 * Kunden-E-Mail, Telefon und Ansprechpartner: Wer eine Menge ändert, braucht
 * sie nicht.
 */

export interface EditableOrderItem {
  /**
   * Die Zeilen-ID aus order_items — und der einzige Ort im System, an dem sie
   * eine Rolle spielt.
   *
   * Sie muss hier stehen, weil das Formular eine Position BENENNEN muss. Die
   * Produkt-ID wäre der naheliegende Weg und der falsche: Eine stornierte und
   * eine aktive Position desselben Produkts sind zwei Zeilen, und der
   * UNIQUE-Schlüssel aus 0004 verhindert das nur, solange niemand eine
   * stornierte Position ersetzt. Die Zeilen-ID ist eindeutig, ohne von einer
   * fachlichen Annahme abzuhängen.
   *
   * Sie ist KEINE Berechtigung. Der Endpunkt prüft, dass die Position zu der
   * Bestellung im Pfad gehört, bevor er sie anfasst.
   */
  readonly id: number;
  readonly productId: number;
  /** Aus dem Snapshot der Position — niemals der heutige Produktname. */
  readonly productName: string;
  readonly productUnit: string;
  /** Der Preis-Snapshot zum Bestellzeitpunkt. Er wird nie neu ermittelt. */
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly lineTotalCents: number;
  /** Wann storniert — oder null für „gilt noch". */
  readonly cancelledAt: string | null;
}

export interface EditableOrder {
  /** Die Zeilen-ID der Bestellung; die Positionen hängen daran. */
  readonly id: number;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly fulfillmentDate: string;
  readonly status: OrderStatus;
  /**
   * Der Zahlungsstand — gelesen, um zu WARNEN, und nicht, um ihn zu ändern.
   *
   * Eine Mengenänderung an einer bereits bezahlten Bestellung verschiebt den
   * Betrag; die Seite muss das sagen, bevor gespeichert wird. Sie versöhnt
   * dabei nichts: Es gibt in dieser Phase keine Erstattung, keine
   * Nachforderung und keinen automatisch korrigierten Zahlungsstand.
   */
  readonly paymentStatus: PaymentStatus;
  /** Der gespeicherte Gesamtbetrag in Cent — die Summe der AKTIVEN Positionen. */
  readonly totalCents: number;
  /**
   * Der Stand der Bestellung — orders.updated_at.
   *
   * ER IST DER OPTIMISTISCHE SCHUTZ und heißt deshalb `version` und nicht
   * `updatedAt`: Auf dieser Seite ist er kein Zeitpunkt, den jemand liest,
   * sondern das Merkmal, an dem sich erkennen lässt, ob die Bestellung seit
   * dem Anzeigen der Seite angefasst wurde. Er reist als verstecktes Feld im
   * Formular mit; was daraus folgt, steht in application/edit-order-item.ts.
   */
  readonly version: string;
  /** Aktive UND stornierte Positionen, in der Reihenfolge des Sortiments. */
  readonly items: readonly EditableOrderItem[];
}
