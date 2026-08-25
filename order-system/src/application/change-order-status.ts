import type { Order } from '../domain/order';
import type { OrderNumber } from '../domain/order-number';
import { canTransitionTo, type OrderStatus } from '../domain/order-status';
import { findOrderByNumber, updateOrderStatus } from '../infrastructure/d1/order-repository';

/**
 * „Setze diese Bestellung auf jenen Status."
 *
 * Der erste SCHREIBENDE Adminvorgang des Systems — und bewusst der kleinste,
 * den es geben kann: eine Bestellung, eine Spalte, ein Zeitstempel.
 *
 * DIESE FUNKTION ENTSCHEIDET NICHT, OB SIE AUFGERUFEN WERDEN DARF.
 *
 * Rolle, Sitzung, Origin und CSRF-Token stehen in der HTTP-Schicht und
 * ausschließlich dort — dieselbe Trennung wie bei placeCafeOrder. Hier noch
 * einmal zu prüfen hieße, die Autorisierung an zwei Stellen zu führen, und
 * zwei Stellen weichen irgendwann voneinander ab. Der Parameter, über den
 * sich hier eine Rolle behaupten ließe, existiert deshalb gar nicht.
 *
 * ES GIBT KEINE ZWEITE STATE MACHINE.
 *
 * Welcher Übergang erlaubt ist, steht in domain/order-status.ts und wird hier
 * GEFRAGT, nicht wiederholt. In dieser Datei kommt kein einziger
 * Statusvergleich der Form `if (status === 'confirmed')` vor; sie kennt die
 * Namen der Zustände überhaupt nicht.
 *
 * Der Zeitpunkt wird ÜBERGEBEN und nicht abgeleitet. Kein Date.now() — sonst
 * hinge das Ergebnis daran, wann die Funktion läuft, und updated_at wäre in
 * keinem Test prüfbar.
 */

/**
 * Was bei dem Versuch herausgekommen ist.
 *
 * Ein diskriminierter Verbund und keine Ausnahme: Drei der vier Ausgänge sind
 * normale Betriebsfälle — eine getippte Nummer, ein Klick auf einen veralteten
 * Bildschirm, zwei Admins gleichzeitig. Ausnahmen sind für das Unerwartete da;
 * dies hier ist erwartet und gehört in den Rückgabetyp, wo der Aufrufer es
 * nicht übersehen kann.
 *
 * Die HTTP-Schicht übersetzt sie in Status-Codes. WELCHE das sind, steht
 * nicht hier — diese Datei kennt kein HTTP.
 */
export type ChangeOrderStatusResult =
  | { readonly outcome: 'changed'; readonly order: Order }
  /** Diese Bestellnummer gibt es nicht. */
  | { readonly outcome: 'unknown_order' }
  /** Die Domäne erlaubt diesen Übergang nicht. */
  | { readonly outcome: 'invalid_transition'; readonly fulfillmentDate: string }
  /** Jemand anderes war schneller; der geprüfte Ausgangsstatus gilt nicht mehr. */
  | { readonly outcome: 'conflict'; readonly fulfillmentDate: string };

/**
 * WARUM DIE BEIDEN ABLEHNUNGEN EINEN TAG TRAGEN — und ausgerechnet DIESEN.
 *
 * Eine Oberfläche, die einen Fehlschlag anzeigt, muss den Weg zurück
 * anbieten, und der führt zu dem Produktionstag, auf dem die Bestellung
 * steht. Ihn hier mitzugeben ist billiger und ehrlicher, als ihn in der
 * HTTP-Schicht ein zweites Mal aus der Datenbank zu holen.
 *
 * Es ist ausdrücklich NICHT die ganze Bestellung. Im Konfliktfall ist der
 * gelesene Stand VERALTET — ihn herauszureichen hieße, einen Wert anzubieten,
 * der schon falsch ist, wenn er ankommt. Der Liefertag ist der einzige Teil,
 * den kein Statuswechsel verändert; er kann nicht veralten.
 */

export interface ChangeOrderStatusCommand {
  /**
   * Eine bereits GEPRÜFTE Bestellnummer, kein String.
   *
   * Der Unterschied ist derselbe wie bei `customer: Customer` in
   * placeCafeOrder: Ein OrderNumber lässt sich nicht aus einem Anfragepfad
   * herbeireden — wer einen hat, hat ihn durch OrderNumber.parse() geholt.
   */
  readonly orderNumber: OrderNumber;
  /** Der gewünschte Zielstatus, bereits als solcher erkannt. */
  readonly target: OrderStatus;
  readonly now: Date;
}

export async function changeOrderStatus(
  db: D1Database,
  command: ChangeOrderStatusCommand,
): Promise<ChangeOrderStatusResult> {
  const { orderNumber, target, now } = command;

  const order = await findOrderByNumber(db, orderNumber.value);
  if (order === null) {
    return { outcome: 'unknown_order' };
  }

  /**
   * DIE EINZIGE FACHLICHE ENTSCHEIDUNG DIESER FUNKTION — und sie wird nicht
   * hier getroffen, sondern in der Domäne.
   *
   * Die Abfrage steht vor withStatus(), weil withStatus() bei einem
   * verbotenen Übergang WIRFT. Eine Ausnahme wäre hier der falsche Weg: „Der
   * Kuchen ist schon ausgeliefert" ist keine Störung, sondern eine Antwort.
   * Beide Wege fragen dieselbe Funktion; es gibt keine Fassung der Regel, die
   * nur einer von beiden kennt.
   */
  if (!canTransitionTo(order.status, target)) {
    return { outcome: 'invalid_transition', fulfillmentDate: order.fulfillmentDate.value };
  }

  /**
   * withStatus() erzeugt die neue Bestellung — und prüft den Übergang dabei
   * ein zweites Mal. Das ist keine Redundanz aus Versehen: Das Aggregat lässt
   * sich nicht in einen ungültigen Zustand bringen, ganz gleich, wer es
   * aufruft. Hier kann die Prüfung nach der Zeile darüber nicht mehr
   * anschlagen.
   */
  const geaendert = order.withStatus(target, now);

  /**
   * `order.status` ist die BEDINGUNG des Schreibvorgangs, nicht bloß der
   * bisherige Wert: Geschrieben wird nur, wenn die Bestellung immer noch dort
   * steht, wo canTransitionTo() sie eben gesehen hat. Zwischen dem Lesen oben
   * und dieser Zeile kann ein zweiter Admin geschrieben haben.
   */
  const geschrieben = await updateOrderStatus(db, {
    orderNumber: order.orderNumber.value,
    expectedStatus: order.status,
    newStatus: geaendert.status,
    updatedAt: geaendert.updatedAt,
  });

  /**
   * KEINE ERFOLGSMELDUNG OHNE GESCHRIEBENE ZEILE. Genau hier entstünde sonst
   * der verlorene Schreibvorgang: Der Aufrufer bekäme „in Produktion"
   * bestätigt, während in der Datenbank etwas anderes steht.
   */
  if (!geschrieben) {
    return { outcome: 'conflict', fulfillmentDate: order.fulfillmentDate.value };
  }

  return { outcome: 'changed', order: geaendert };
}
