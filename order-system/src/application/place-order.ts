import { businessDay } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import { Order } from '../domain/order';
import { OrderDraft } from '../domain/order-draft';
import { findCustomer } from '../infrastructure/d1/customer-repository';
import { reserveOrderNumber } from '../infrastructure/d1/order-number-sequence';
import { saveOrder } from '../infrastructure/d1/order-repository';
import { loadCatalog } from '../infrastructure/d1/product-repository';

export interface PlaceOrderCommand {
  /** Kommt aus der Sitzung, NICHT aus der Anfrage — sonst könnte man fremd bestellen. */
  customerId: number;
  /** Der ungeprüfte Anfragekörper. */
  input: unknown;
  now: Date;
}

/**
 * Der einzige Anwendungsfall, den Phase 1 vollständig durchführt — und der
 * Nachweis, dass die Architektur trägt.
 *
 * Die Reihenfolge ist Absicht:
 *
 *   1. Entwurf lesen. Scheitert die Eingabe — falsches Datum, fehlende
 *      Position, unbekannter Fulfillment-Typ —, wird die Datenbank gar nicht
 *      erst angefasst.
 *   2. Kunde und Katalog laden, beides parallel.
 *   3. Bestellnummer ziehen.
 *   4. Order.place() rechnet — mit Preisen aus dem Katalog, nie aus der
 *      Anfrage.
 *   5. Atomar speichern.
 *
 * Schritt 3 liegt VOR Schritt 4, weil Order.place() die Nummer bereits zum
 * Bauen braucht. Scheitert die fachliche Prüfung dort — inaktives Produkt,
 * inaktiver Kunde, Lieferung ohne Adresse —, ist die Nummer verbraucht und es
 * entsteht eine Lücke. Das ist hingenommen, nicht übersehen: Lückenlosigkeit
 * ist eine Anforderung an Rechnungsnummern, nicht an Bestellnummern, und die
 * Alternative wäre, die Prüfung aus dem Aggregat herauszuziehen und damit an
 * zwei Stellen zu führen. Ein Test hält dieses Verhalten fest.
 *
 * Die grobe Eingabeprüfung in Schritt 1 liegt trotzdem davor — sie ist die
 * häufigere Fehlerquelle und kostet keine Nummer.
 *
 * Das Jahr der Bestellnummer kommt aus dem Geschäftstag in Europe/Berlin,
 * nicht aus der UTC-Uhr: Eine Bestellung am 1. Januar um 00:30 Uhr Berliner
 * Zeit gehört ins neue Jahr, nicht ins alte.
 */
export async function placeOrder(db: D1Database, command: PlaceOrderCommand): Promise<Order> {
  const draft = OrderDraft.fromInput(command.input, command.now);

  const [customer, catalog] = await Promise.all([
    findCustomer(db, command.customerId),
    loadCatalog(db),
  ]);

  if (customer === null) {
    throw ValidationError.field('customer', 'Dieser Kunde ist nicht bekannt.');
  }

  const year = Number(businessDay(command.now).slice(0, 4));
  const orderNumber = await reserveOrderNumber(db, year);

  const order = Order.place({ customer, catalog, draft, orderNumber, now: command.now });
  await saveOrder(db, order);

  return order;
}
