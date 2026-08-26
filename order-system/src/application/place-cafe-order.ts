import { businessDay, plusDays } from '../domain/clock';
import type { Customer } from '../domain/customer';
import { ValidationError } from '../domain/errors';
import { Order } from '../domain/order';
import { OrderDraft } from '../domain/order-draft';
import { assertOrderableDay } from '../domain/order-policy';
import { loadCustomerPriceBook } from '../infrastructure/d1/customer-price-book-repository';
import { loadOrderPolicy } from '../infrastructure/d1/order-policy-repository';
import { reserveOrderNumber } from '../infrastructure/d1/order-number-sequence';
import {
  findOrderBySubmission,
  saveOrder,
} from '../infrastructure/d1/order-repository';
import { loadCatalog } from '../infrastructure/d1/product-repository';

/**
 * Wie weit im Voraus ein Café bestellen darf.
 *
 * Das ist ausdrücklich KEINE Lieferkalender-Regel und keine Vorlaufzeit,
 * sondern eine Plausibilitätsgrenze gegen einen Tippfehler: '2036-08-25'
 * statt '2026-08-25' stünde sonst zehn Jahre lang in der Produktionsliste.
 * Kundenspezifische Liefertage gibt es weiterhin nicht — die Architektur
 * verhindert sie aber auch nicht.
 */
const MAX_LEAD_DAYS = 365;

/** Die Absendekennung stammt vom Server; geprüft wird sie trotzdem. */
const SUBMISSION_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface PlaceCafeOrderCommand {
  /**
   * Das bestellende Café — AUSSCHLIESSLICH aus der geprüften Sitzung.
   *
   * Ein `customerId: number` an dieser Stelle wäre der Unterschied zwischen
   * „der Aufrufer muss den Kunden geladen haben" und „der Aufrufer darf eine
   * Zahl nennen". Ein fertiger Customer lässt sich nicht aus einem
   * Anfragekörper herbeireden.
   */
  customer: Customer;
  /** Serverseitig beim Rendern der Seite erzeugt, vom Formular zurückgesendet. */
  submissionId: string;
  /** Der ungeprüfte Anfragekörper. */
  input: unknown;
  now: Date;
}

export interface CafeOrderResult {
  order: Order;
  /**
   * false bedeutet: Diese Bestellung gab es schon, sie wurde nur erneut
   * abgesendet. Der Aufrufer antwortet darauf mit 200 statt 201 — dem
   * Café gegenüber sieht beides gleich aus, und das ist beabsichtigt.
   */
  created: boolean;
}

/**
 * Der Bestellvorgang eines Cafés.
 *
 * Die Reihenfolge ist durchweg Absicht:
 *
 *   1. Absendekennung prüfen und nachsehen, ob dieser Absendevorgang schon
 *      eine Bestellung hat. Der schnelle Weg gegen den Doppelklick.
 *   2. Entwurf lesen. Ein Eingabefehler kostet so keine Bestellnummer.
 *   3. Katalog laden, Nummer ziehen, rechnen, atomar speichern.
 *   4. Scheitert das Speichern am UNIQUE-Index über
 *      (customer_id, submission_id), war es doch ein Doppelklick — dann
 *      gewinnt die zuerst geschriebene Bestellung.
 *
 * Schritt 1 UND Schritt 4 sind nötig, nicht einer von beiden: Schritt 1
 * fängt die Wiederholung nach einer abgebrochenen Verbindung ab, Schritt 4
 * die echte Gleichzeitigkeit, bei der beide Anfragen in Schritt 1 noch
 * nichts sehen.
 *
 * DIE ZUGANGSPRÜFUNG STEHT NICHT MEHR HIER. In Phase 2 löste diese Funktion
 * selbst einen Token zu einem Café auf; seit Phase 3A bekommt sie ein
 * bereits geprüftes Café aus der Sitzung. Der Unterschied ist nicht bloß
 * Verschiebung: Es gibt in dieser Funktion keinen Parameter mehr, über den
 * sich der Kunde beeinflussen ließe — und damit auch keine Prüfung, die man
 * vergessen könnte.
 */
export async function placeCafeOrder(
  db: D1Database,
  command: PlaceCafeOrderCommand,
): Promise<CafeOrderResult> {
  const customer = command.customer;

  if (!SUBMISSION_ID.test(command.submissionId)) {
    throw ValidationError.field('submission_id', 'Die Bestellung konnte nicht gelesen werden.');
  }

  const existing = await findOrderBySubmission(db, customer.id, command.submissionId);
  if (existing !== null) {
    return { order: existing, created: false };
  }

  const draft = OrderDraft.fromInput(withServerDecisions(command.input, customer.defaultFulfillment), command.now);
  assertWithinLeadTime(draft.fulfillmentDate.value, command.now);

  /**
   * SORTIMENT UND PREISWELT WERDEN HIER GELADEN — BEIM SCHREIBEN, NICHT BEIM
   * RENDERN DER SEITE.
   *
   * Das ist §14 des Auftrags. Zwischen dem Aufruf der Bestellseite und dem
   * Absenden können Minuten oder Stunden liegen; in dieser Zeit kann ein
   * Katalogpreis geändert oder eine Preisgruppe umgestellt worden sein. Der
   * Server nimmt deshalb den Preis, der im Moment des Schreibens gilt, und
   * NICHT den, der im Browser steht — der Browser sendet ohnehin keinen.
   *
   * Eine Bestätigung „der Preis hat sich geändert, bitte prüfen" wird
   * bewusst nicht gebaut: Sie wäre ein zweiter Absendeweg mit eigener
   * Idempotenz, und die Antwort nennt den tatsächlich gespeicherten Preis
   * ohnehin.
   */
  const [catalog, priceBook, richtlinie] = await Promise.all([
    loadCatalog(db),
    loadCustomerPriceBook(db, customer),
    loadOrderPolicy(db),
  ]);

  /**
   * DIE BESTELLRICHTLINIE, FRISCH GELESEN UND UNMITTELBAR VOR DEM SCHREIBEN
   * GEPRÜFT — nicht bei der Anzeige der Seite.
   *
   * Zwischen dem Rendern der Bestellseite und diesem Augenblick können
   * Stunden liegen. In dieser Zeit kann ein Wochentag abgeschaltet worden
   * sein, und vor allem: Die Uhr kann über den Bestellschluss gesprungen
   * sein. Eine Seite, die um 11:58 geladen und um 12:01 abgeschickt wird,
   * zeigte einen Tag als bestellbar an, der es nicht mehr ist. HIER
   * entscheidet sich das, und hier gewinnt der Server — dieselbe Überlegung
   * wie bei den Preisen einen Absatz weiter oben (§14).
   *
   * DIE PRÜFUNG STEHT VOR reserveOrderNumber(). Eine abgelehnte Bestellung
   * soll keine Bestellnummer verbrauchen; sie ist der häufigste Fall dieser
   * Ablehnung und der einzige, der einem Café begegnet.
   *
   * Die Abfrage läuft im Promise.all darüber mit und kostet deshalb keine
   * zusätzliche Wartezeit — sie hängt weder am Kunden noch am Katalog.
   */
  assertOrderableDay(richtlinie.policy, draft.fulfillmentDate.value, command.now);

  const year = Number(businessDay(command.now).slice(0, 4));
  const orderNumber = await reserveOrderNumber(db, year);

  const order = Order.place({ customer, catalog, priceBook, draft, orderNumber, now: command.now });

  try {
    await saveOrder(db, order, command.submissionId);
  } catch (error) {
    // Zwei überlappende Absendungen. Die zuerst geschriebene Bestellung ist
    // die gültige; diese hier hat nie existiert (der Batch ist vollständig
    // zurückgerollt). Verbraucht ist lediglich eine Bestellnummer, und
    // Lücken sind zulässig.
    const raced = await findOrderBySubmission(db, customer.id, command.submissionId);
    if (raced !== null) {
      return { order: raced, created: false };
    }
    throw error;
  }

  return { order, created: true };
}

/**
 * Ersetzt in der Anfrage genau das, worüber der Client nicht entscheidet.
 *
 * fulfillment_type steht am Kunden, nicht in der Anfrage: Die
 * Bestelloberfläche fragt ein Stammcafé nicht bei jeder Bestellung, ob
 * geliefert oder abgeholt wird — das ist ein Klick ohne Erkenntnisgewinn.
 * Ein trotzdem mitgesendeter Wert wird überschrieben und nicht etwa
 * übernommen; sonst könnte ein Lieferkunde versehentlich oder absichtlich
 * eine Abholung erzeugen.
 *
 * Preise, Beträge, Status und Bestellnummer stehen hier NICHT, weil sie
 * ohnehin nie gelesen werden: OrderDraft hat keine Felder dafür.
 */
function withServerDecisions(input: unknown, fulfillmentType: string): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    // Unverändert weiterreichen — OrderDraft.fromInput meldet den Formfehler
    // mit derselben Meldung wie für jede andere Anfrage.
    return input;
  }
  return { ...(input as Record<string, unknown>), fulfillment_type: fulfillmentType };
}

function assertWithinLeadTime(day: string, now: Date): void {
  const latest = plusDays(businessDay(now), MAX_LEAD_DAYS);
  // Zeichenkettenvergleich: Bei festem Format 'JJJJ-MM-TT' ist die
  // lexikografische Ordnung die chronologische.
  if (day > latest) {
    throw ValidationError.field(
      'fulfillment_date',
      'Der Liefertag liegt zu weit in der Zukunft. Bitte einen Tag innerhalb des nächsten Jahres wählen.',
    );
  }
}
