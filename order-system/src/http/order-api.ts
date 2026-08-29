import { placeCafeOrder } from '../application/place-cafe-order';
import type { AppConfig } from '../config/app-config';
import type { Order } from '../domain/order';
import type { EmailSender } from '../infrastructure/email/email-sender';
import { assertCsrf, assertSameOrigin, requireRole } from './guard';
import {
  RequestError,
  assertAnnouncedSizeOk,
  assertJsonContentType,
  parseBody,
  readBody,
} from './json-body';
import { json } from './responses';
import { privateHeaders } from './security';

/**
 * 64 KiB. Eine echte Bestellung mit 200 Positionen und voller Notiz liegt
 * unter 10 KiB; alles darüber ist kein Café, das Kuchen bestellt.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Nimmt eine Bestellung entgegen.
 *
 * DIE REIHENFOLGE IST DIE DES AUFWANDS — und zugleich die der Sicherheit:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle. Ohne gültige Kundensitzung wird nichts weiter
 *      getan — insbesondere wird der Körper nicht gelesen.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist deshalb erst hier prüfbar.
 *   4. Content-Type und angekündigte Größe.
 *   5. Erst danach der Körper.
 *
 * Schritt 2 vor Schritt 4 ist Absicht: Wer keinen gültigen Zugang hat, soll
 * keine Rückmeldung über die erwartete Anfrageform bekommen. Ein 415 für
 * einen Fremden wäre die Auskunft „hier ist ein JSON-Endpunkt, versuch es
 * anders".
 *
 * SEIT PHASE 3A GIBT ES KEIN TOKEN IM HEADER MEHR. Phase 2 hatte damit
 * konstruktiv kein CSRF-Risiko — ein fremdes Formular kann keine Kopfzeile
 * setzen. Ein Cookie schickt der Browser dagegen von sich aus mit, und
 * genau deshalb stehen Origin-Prüfung und CSRF-Token jetzt hier.
 */
export async function createOrder(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  emailSender?: EmailSender,
): Promise<Response> {
  try {
    assertSameOrigin(request, config);

    const wache = await requireRole(db, config, request, now, 'customer', 'api');
    if (!wache.ok) {
      return wache.response;
    }

    assertCsrf(request, wache.context);

    assertJsonContentType(request);
    assertAnnouncedSizeOk(request, MAX_BODY_BYTES);

    const input = parseBody(await readBody(request, MAX_BODY_BYTES));

    const { order, created } = await placeCafeOrder(db, {
      customer: wache.context.customer,
      submissionId: readSubmissionId(input),
      input,
      now,
      appOrigin: config.appOrigin,
      emailSender,
    });

    // 201 für eine neue Bestellung, 200 für dieselbe noch einmal. Für das
    // Café sieht beides gleich aus — es soll nicht erfahren, dass es doppelt
    // getippt hat, weil es das nicht wissen muss.
    return json(confirmation(order), created ? 201 : 200, privateHeaders());
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.code }, error.status, privateHeaders());
    }
    throw error;
  }
}

/**
 * Was das Café nach einer erfolgreichen Bestellung zurückbekommt.
 *
 * Ausschließlich aus der GESPEICHERTEN Bestellung — nicht aus der Anfrage.
 * Sonst bestätigte die Antwort, was gesendet wurde, statt was in der
 * Datenbank steht; bei einer wiederholten Absendung wäre das sogar
 * nachweislich falsch.
 *
 * Nicht enthalten: Kunden-ID, Absendekennung, Status, Zeitstempel,
 * Einzelpreise, Adresse. Nichts davon braucht ein Bestätigungsbildschirm.
 */
function confirmation(order: Order): unknown {
  return {
    order_number: order.orderNumber.value,
    fulfillment_date: order.fulfillmentDate.value,
    fulfillment_type: order.fulfillmentType,
    total_cents: order.total().cents,
    items: order.items.map((item) => ({
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unit: item.productUnitSnapshot,
    })),
  };
}

/**
 * Die Absendekennung wird hier aus dem Körper gelesen und getrennt
 * weitergereicht, statt sie in OrderDraft aufzunehmen: Sie ist keine
 * Eigenschaft der Bestellung, sondern des Absendevorgangs.
 *
 * Hier wird sie NICHT geprüft, sondern nur gelesen — ein fehlender Wert wird
 * zur leeren Zeichenkette. Die Prüfung findet in placeCafeOrder statt, also
 * NACH der Sitzungs- und CSRF-Prüfung.
 *
 * Das ist kein Detail: Würde hier ein 422 entstehen, bekäme ein Aufrufer
 * ohne gültige Sitzung eine Rückmeldung über die erwartete Anfrageform. Wer
 * keinen Zugang hat, erfährt nichts — auch nicht, wie eine richtige Anfrage
 * aussähe.
 */
function readSubmissionId(input: Record<string, unknown>): string {
  const value = input['submission_id'];
  return typeof value === 'string' ? value : '';
}
