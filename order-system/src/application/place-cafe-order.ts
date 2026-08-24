import { businessDay, plusDays } from '../domain/clock';
import { AccessDeniedError, ValidationError } from '../domain/errors';
import { Order } from '../domain/order';
import { OrderDraft } from '../domain/order-draft';
import { findCustomerByAccessToken } from '../infrastructure/d1/access-token-repository';
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
  /** Der Klartext-Token aus dem persönlichen Link. */
  token: string;
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
 *   1. Zugang auflösen. Ohne gültigen Token wird nichts weiter getan.
 *   2. Absendekennung prüfen und nachsehen, ob dieser Absendevorgang schon
 *      eine Bestellung hat. Der schnelle Weg gegen den Doppelklick.
 *   3. Entwurf lesen. Ein Eingabefehler kostet so keine Bestellnummer.
 *   4. Katalog laden, Nummer ziehen, rechnen, atomar speichern.
 *   5. Scheitert das Speichern am UNIQUE-Index über
 *      (customer_id, submission_id), war es doch ein Doppelklick — dann
 *      gewinnt die zuerst geschriebene Bestellung.
 *
 * Schritt 2 UND Schritt 5 sind nötig, nicht einer von beiden: Schritt 2
 * fängt die Wiederholung nach einer abgebrochenen Verbindung ab, Schritt 5
 * die echte Gleichzeitigkeit, bei der beide Anfragen in Schritt 2 noch
 * nichts sehen.
 *
 * Der Kunde kommt ausschließlich aus dem Token. Es gibt in dieser Funktion
 * keine Stelle, an der ein customer_id aus der Anfrage gelesen werden könnte.
 */
export async function placeCafeOrder(
  db: D1Database,
  command: PlaceCafeOrderCommand,
): Promise<CafeOrderResult> {
  const customer = await findCustomerByAccessToken(db, command.token);
  if (customer === null) {
    throw new AccessDeniedError();
  }

  if (!SUBMISSION_ID.test(command.submissionId)) {
    throw ValidationError.field('submission_id', 'Die Bestellung konnte nicht gelesen werden.');
  }

  const existing = await findOrderBySubmission(db, customer.id, command.submissionId);
  if (existing !== null) {
    return { order: existing, created: false };
  }

  const draft = OrderDraft.fromInput(withServerDecisions(command.input, customer.defaultFulfillment), command.now);
  assertWithinLeadTime(draft.fulfillmentDate.value, command.now);

  const catalog = await loadCatalog(db);
  const year = Number(businessDay(command.now).slice(0, 4));
  const orderNumber = await reserveOrderNumber(db, year);

  const order = Order.place({ customer, catalog, draft, orderNumber, now: command.now });

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
