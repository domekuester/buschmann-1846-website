/**
 * Wie ein JSON-Körper gelesen wird, bevor irgendetwas mit ihm geschieht.
 *
 * Diese Datei entstand beim zweiten schreibenden Endpunkt. Bis dahin stand
 * alles hier in order-api.ts, und das war richtig: Eine Regel gehört dorthin,
 * wo sie gebraucht wird, solange es genau eine Stelle gibt. Mit dem
 * Status-Endpunkt wären es zwei geworden — und zwei Fassungen derselben
 * Größenprüfung sind zwei Gelegenheiten, bei einer davon die tatsächliche
 * Länge nicht mehr zu messen.
 *
 * WAS HIER NICHT STEHT: Autorisierung. Diese Funktionen werden NACH Origin,
 * Sitzung, Rolle und CSRF-Token aufgerufen — nie davor. Ein 415 für einen
 * Fremden wäre die Auskunft „hier ist ein JSON-Endpunkt, versuch es anders".
 * Die Reihenfolge steht bei jedem Endpunkt in seiner eigenen Datei, weil sie
 * dort auch gelesen wird.
 */

/**
 * Ein Fehler, den der Aufrufer in eine bestimmte Antwort übersetzt.
 * Getrennt von ValidationError, weil es hier nicht um ein Eingabefeld geht,
 * sondern um die Anfrage als Ganzes.
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'RequestError';
  }
}

export function assertJsonContentType(request: Request): void {
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
export function assertAnnouncedSizeOk(request: Request, maxBytes: number): void {
  const announced = Number(request.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new RequestError(413, 'payload_too_large');
  }
}

/**
 * Und danach die tatsächliche: Eine Anfrage ohne content-length — etwa mit
 * chunked transfer encoding — käme sonst an der ersten Prüfung vorbei.
 */
export async function readBody(request: Request, maxBytes: number): Promise<string> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new RequestError(413, 'payload_too_large');
  }
  return text;
}

export function parseBody(text: string): Record<string, unknown> {
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
 * Content-Type, angekündigte Größe, tatsächliche Größe, JSON — in dieser
 * Reihenfolge, weil jede Stufe billiger ist als die nächste.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  assertJsonContentType(request);
  assertAnnouncedSizeOk(request, maxBytes);
  return parseBody(await readBody(request, maxBytes));
}
