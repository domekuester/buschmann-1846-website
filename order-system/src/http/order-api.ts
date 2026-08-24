import { placeCafeOrder } from '../application/place-cafe-order';
import type { Order } from '../domain/order';
import { json } from './responses';
import { privateHeaders } from './security';

/**
 * 64 KiB. Eine echte Bestellung mit 200 Positionen und voller Notiz liegt
 * unter 10 KiB; alles darüber ist kein Café, das Kuchen bestellt.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Der Token steht im HEADER, nicht im Körper und nicht im Pfad.
 *
 * Zwei Gründe, und beide zählen:
 *
 *   Kopfzeilen tauchen in Zugriffsprotokollen nicht auf, Pfade schon.
 *
 *   Ein Header ist keine ambiente Autorität. Ein fremdes Formular kann ihn
 *   nicht setzen, und ein Cross-Origin-fetch scheitert am Preflight, weil
 *   dieser Worker keine CORS-Kopfzeilen sendet. CSRF ist damit konstruktiv
 *   ausgeschlossen — es gibt kein Cookie, das ein Browser von sich aus
 *   mitschicken würde.
 */
const TOKEN_HEADER = 'x-order-token';

/**
 * Ein Fehler, den die Fehlergrenze in eine bestimmte Antwort übersetzt.
 * Getrennt von ValidationError, weil es hier nicht um ein Eingabefeld geht,
 * sondern um die Anfrage als Ganzes.
 */
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * Nimmt eine Bestellung entgegen.
 *
 * Die Prüfungen stehen in der Reihenfolge, in der sie billig sind: Verfahren,
 * Content-Type und angekündigte Größe kosten keinen Lesevorgang und keinen
 * Datenbankzugriff. Erst danach wird der Körper gelesen.
 */
export async function createOrder(db: D1Database, request: Request, now: Date): Promise<Response> {
  try {
    assertJsonContentType(request);
    assertAnnouncedSizeOk(request);

    const input = parseBody(await readBody(request));

    const { order, created } = await placeCafeOrder(db, {
      token: request.headers.get(TOKEN_HEADER) ?? '',
      submissionId: readSubmissionId(input),
      input,
      now,
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
    total_cents: order.total().cents,
    items: order.items.map((item) => ({
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unit: item.productUnitSnapshot,
    })),
  };
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type') ?? '';
  // Der Zeichensatz darf angehängt sein: 'application/json; charset=utf-8'.
  if (!contentType.split(';')[0]?.trim().toLowerCase().endsWith('application/json')) {
    throw new RequestError(415, 'unsupported_media_type');
  }
}

/**
 * Die angekündigte Größe zuerst: Sie kostet nichts und lehnt den offensichtlich
 * zu großen Körper ab, bevor er überhaupt gelesen wird.
 */
function assertAnnouncedSizeOk(request: Request): void {
  const announced = Number(request.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > MAX_BODY_BYTES) {
    throw new RequestError(413, 'payload_too_large');
  }
}

/**
 * Und danach die tatsächliche: Eine Anfrage ohne content-length — etwa mit
 * chunked transfer encoding — käme sonst an der ersten Prüfung vorbei.
 */
async function readBody(request: Request): Promise<string> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new RequestError(413, 'payload_too_large');
  }
  return text;
}

function parseBody(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Die Meldung des Parsers wird bewusst verworfen: Sie nennt Position und
    // Zeichen und beschreibt damit, was der Server erwartet hat.
    throw new RequestError(400, 'bad_request');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RequestError(400, 'bad_request');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Die Absendekennung wird hier aus dem Körper gelesen und getrennt
 * weitergereicht, statt sie in OrderDraft aufzunehmen: Sie ist keine
 * Eigenschaft der Bestellung, sondern des Absendevorgangs.
 *
 * Hier wird sie NICHT geprüft, sondern nur gelesen — ein fehlender Wert wird
 * zur leeren Zeichenkette. Die Prüfung findet in placeCafeOrder statt, also
 * NACH der Zugangsprüfung.
 *
 * Das ist kein Detail: Würde hier ein 422 entstehen, bekäme ein Aufrufer
 * ohne gültigen Token eine Rückmeldung über die erwartete Anfrageform. Wer
 * keinen Zugang hat, erfährt nichts — auch nicht, wie eine richtige Anfrage
 * aussähe.
 */
function readSubmissionId(input: Record<string, unknown>): string {
  const value = input['submission_id'];
  return typeof value === 'string' ? value : '';
}
