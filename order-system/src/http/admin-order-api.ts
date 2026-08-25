import { changeOrderStatus } from '../application/change-order-status';
import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import { OrderNumber } from '../domain/order-number';
import { isOrderStatus, type OrderStatus } from '../domain/order-status';
import {
  renderStatusChangeFailurePage,
  type StatusChangeFailure,
} from '../ui/admin-page-html';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { RequestError, readBody, readJsonObject } from './json-body';
import { json } from './responses';
import { pageHeaders, privateHeaders } from './security';

/**
 * POST /api/admin/orders/:orderNumber/status
 *
 * Der erste Adminvorgang, der SCHREIBT. Bis Phase 3C konnte der Adminbereich
 * ausschließlich lesen; ein Endpunkt, der eine Zeile ändert, ist eine andere
 * Art von Ziel, und deshalb steht hier mehr Prüfung als in production-api.ts.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE IN order-api.ts:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — hier 'admin'. Ohne sie wird der Körper nicht
 *      gelesen und die Bestellung nicht gesucht.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform: Content-Type, Größe, JSON.
 *   5. Zielstatus.
 *   6. Erst danach die Bestellung.
 *
 * Schritt 2 vor Schritt 4 ist Absicht: Wer keinen Zugang hat, bekommt keine
 * Rückmeldung über die erwartete Anfrageform und keine darüber, ob es diese
 * Bestellung gibt.
 *
 * ES GIBT HIER KEINE STATUSREGEL.
 *
 * In dieser Datei kommt kein `if (status === 'confirmed')` vor und keine
 * Liste erlaubter Folgezustände. Welcher Übergang möglich ist, entscheidet
 * canTransitionTo() in domain/order-status.ts; diese Datei übersetzt nur das
 * Ergebnis in einen Status-Code. Stünde die Regel auch hier, gäbe es zwei
 * Fassungen — und die HTTP-Fassung wäre diejenige, die niemand pflegt.
 *
 * WAS DER KÖRPER TRAGEN DARF: den Zielstatus. Sonst nichts. Rolle, Kunde,
 * bisheriger Status, Preis, Positionen und Zeitstempel werden nicht gelesen —
 * es gibt in dieser Datei keine Zeile, die sie läse. Was nicht gelesen wird,
 * kann auch nicht geschmuggelt werden.
 *
 * PHASE 4B HAT GENAU DAS GETAN, WAS HIER ANGEKÜNDIGT WAR — und nicht mehr.
 *
 * Die Statusschaltflächen der Produktionsansicht sind echte
 * `<form method="post">`. Dieser Endpunkt nimmt dafür zusätzlich
 * `application/x-www-form-urlencoded` entgegen und antwortet einem Formular
 * mit 303 statt mit 200. Hinzugekommen sind ein zweiter Weg, den Körper zu
 * lesen, und ein zweiter Weg, das Ergebnis darzustellen.
 *
 * NICHT hinzugekommen sind: ein zweiter Endpunkt, eine zweite Statusregel,
 * eine zweite Prüfreihenfolge, ein zweiter Schreibvorgang. Die Zeilen von
 * assertSameOrigin bis changeOrderStatus sind für beide Anfrageformen
 * DIESELBEN — es gibt keinen Zweig, in dem eine Prüfung fehlt.
 *
 * DER JSON-WEG IST UNVERÄNDERT. Statuscodes, Körper und Kopfzeilen aus Phase
 * 4A gelten weiter; ein JSON-Aufruf bekommt niemals eine Weiterleitung und
 * ein Formular niemals JSON als Nutzdaten.
 */

/**
 * 1 KiB. Der Körper trägt ein Feld mit einem von fünf Wörtern; eine echte
 * Anfrage liegt unter 50 Byte. Die Grenze ist nicht knapp gewählt, sondern
 * großzügig — sie soll nichts Echtes abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 1024;

const PFAD = /^\/api\/admin\/orders\/([^/]+)\/status$/;

/**
 * Gehört dieser Pfad zu diesem Endpunkt — und wie heißt die Bestellung darin?
 *
 * Die Erkennung steht hier und nicht im Worker, weil sie zum Endpunkt gehört:
 * Der Worker entscheidet, WELCHE Datei zuständig ist, nicht wie deren Adresse
 * aussieht.
 *
 * Der Rückgabewert ist das ROHE Pfadsegment und noch keine Bestellnummer. Es
 * kommt vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der
 * Aufrufer Admin ist. `[^/]+` sorgt dafür, dass ein Segment ein Segment
 * bleibt: '../../etwas' passt nicht auf dieses Muster.
 */
export function matchOrderStatusPath(pathname: string): string | null {
  const treffer = PFAD.exec(pathname);
  if (treffer === null) {
    return null;
  }

  // %2F und Verwandte kommen hier als das an, was sie sind. decodeURIComponent
  // wirft bei einer kaputten Prozentfolge — daraus soll eine Ablehnung werden
  // und keine 500.
  try {
    return decodeURIComponent(treffer[1] ?? '');
  } catch {
    return '';
  }
}

export async function changeOrderStatusEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<Response> {
  /**
   * WELCHE ART VON AUFRUFER DAS IST — und das ist die einzige Verzweigung
   * dieser Funktion, die VOR der Wache steht.
   *
   * Sie entscheidet nicht darüber, ob jemand darf, sondern ausschließlich
   * darüber, WIE eine Antwort aussieht: ein Browser, der ein Formular
   * abgeschickt hat, soll bei fehlender Sitzung auf die Loginseite geschickt
   * werden und nicht {"error":"unauthorized"} im Fenster stehen haben. Beide
   * Wege lehnen dieselben Anfragen ab; nur die Darstellung unterscheidet sich.
   *
   * Ein UNBEKANNTER Content-Type gilt hier als JSON und wird erst nach der
   * Wache abgelehnt — sonst bekäme ein Fremder eine 415 und damit die
   * Auskunft, welche Anfrageform dieser Endpunkt erwartet.
   */
  const alsFormular = istFormular(request);

  try {
    assertSameOrigin(request, config);

    const wache = await requireRole(
      db,
      config,
      request,
      now,
      'admin',
      alsFormular ? 'html' : 'api',
    );
    if (!wache.ok) {
      return wache.response;
    }

    /**
     * CSRF-TOKEN UND ZIELSTATUS — zwei Wege, ein Ergebnis.
     *
     * Ein `fetch` schickt den Token als Kopfzeile, ein echtes Formular als
     * verstecktes Feld; ein Formular KANN keine Kopfzeilen setzen. Deshalb
     * muss beim Formular der Körper vor der CSRF-Prüfung gelesen werden — die
     * gleiche Reihenfolge wie bei POST /logout, das seit Phase 3A so
     * funktioniert. Geprüft wird in beiden Fällen von assertCsrf gegen die
     * Sitzungszeile in D1; eine zweite Prüfung gibt es nicht.
     */
    let target: OrderStatus;
    if (alsFormular) {
      const felder = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
      assertCsrf(request, wache.context, felder);
      target = leseZielstatus(felder.get('status'));
    } else {
      assertCsrf(request, wache.context);
      target = leseZielstatus(readJsonStatus(await readJsonObject(request, MAX_BODY_BYTES)));
    }

    /**
     * Die Bestellnummer wird GEPRÜFT, nicht bloß weitergereicht — und eine
     * formal falsche ist dieselbe Antwort wie eine unbekannte. „Das Format
     * stimmt nicht" gegenüber „die gibt es nicht" wäre eine Auskunft darüber,
     * wie eine gültige Nummer aussieht.
     */
    const orderNumber = OrderNumber.parse(orderNumberSegment);
    if (orderNumber === null) {
      return alsFormular ? fehlerseite('unknown_order', null, 404) : nichtGefunden();
    }

    const ergebnis = await changeOrderStatus(db, { orderNumber, target, now });

    switch (ergebnis.outcome) {
      case 'changed':
        return alsFormular
          ? zurueckZumProduktionstag(ergebnis.order.fulfillmentDate.value)
          : json(
              {
                order_number: ergebnis.order.orderNumber.value,
                status: ergebnis.order.status,
              },
              200,
              privateHeaders(),
            );

      case 'unknown_order':
        return alsFormular ? fehlerseite('unknown_order', null, 404) : nichtGefunden();

      /**
       * 409 und nicht 400: Die Anfrage ist in Ordnung, sie passt nur nicht
       * zum Zustand der Bestellung. Genau das ist die Bedeutung von Conflict.
       *
       * DIE ANTWORT NENNT DEN ERLAUBTEN WEG NICHT. Sie sagt nicht, in welchem
       * Status die Bestellung steht und was von dort aus ginge; die
       * Übergangstabelle ist eine Eigenschaft des Systems und gehört nicht in
       * eine Fehlerantwort. Das gilt für die Seite genauso wie für das JSON —
       * die Seite sagt, dass nichts geändert wurde, und bietet den Weg
       * zurück auf den Produktionstag an.
       */
      case 'invalid_transition':
        return alsFormular
          ? fehlerseite('invalid_transition', ergebnis.fulfillmentDate, 409)
          : json({ error: 'invalid_transition' }, 409, privateHeaders());

      /**
       * Ebenfalls 409, aber ein eigener Code: „Jemand anderes war schneller"
       * ist eine andere Lage als „das geht von hier aus nicht" — dort hilft
       * ein Neuladen, hier nicht. Über den Zustand der Bestellung sagt auch
       * dieser Fall nichts.
       */
      case 'conflict':
        return alsFormular
          ? fehlerseite('conflict', ergebnis.fulfillmentDate, 409)
          : json({ error: 'conflict' }, 409, privateHeaders());
    }
  } catch (error) {
    if (error instanceof RequestError) {
      return alsFormular
        ? fehlerseite('unavailable', null, error.status)
        : json({ error: error.code }, error.status, privateHeaders());
    }

    /**
     * DIE ABLEHNUNGEN DER WACHE GEHEN WEITER NACH OBEN — auch beim Formular.
     *
     * Ein fehlender Origin und ein falscher CSRF-Token sind keine
     * Bedienfehler, sondern der Abdruck einer Anfrage, die so nicht aus der
     * eigenen Seite kommen kann: Das Token steht in jedem Formular dieser
     * Seite, und der Origin setzt der Browser selbst. Für diese Lage gibt es
     * nichts zu erklären und keinen Weg zurück anzubieten; sie gehört zur
     * zentralen Fehlergrenze, die für beide Anfrageformen dieselbe knappe
     * 403 ohne Begründung gibt. WELCHE Prüfung gescheitert ist, sagt auch
     * hier niemand — das wäre eine Anleitung.
     *
     * Der abgelaufenen Sitzung begegnet der Admin ohnehin früher: Die Wache
     * schickt ihn beim Formular mit 303 auf die Loginseite.
     */
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      throw error;
    }

    /**
     * EIN UNERWARTETER FEHLER WIRD FÜR EIN FORMULAR ZU EINER SEITE.
     *
     * Nicht, weil er hier anders behandelt würde — der Fehler wird NICHT
     * angesehen, nicht protokolliert und nicht in die Antwort gebildet; der
     * Text ist eine Konstante. Sondern weil die zentrale Fehlergrenze mit
     * JSON antwortet, und das ist für eine API richtig und für einen Browser
     * falsch: Der Admin sähe {"error":"internal_error"} im Fenster.
     * Dieselbe Überlegung wie in http/admin-page.ts.
     *
     * Der Statuscode bleibt 500, und für JSON bleibt die zentrale Grenze
     * zuständig — das `throw` ist der Normalfall.
     */
    if (alsFormular) {
      return fehlerseite('unavailable', null, 500);
    }
    throw error;
  }
}

/**
 * Der einzige Content-Type, der die Formularbehandlung auslöst.
 *
 * EXAKT und nicht mit endsWith: Ein Aufrufer, der etwas anderes schickt, soll
 * den JSON-Weg gehen und dort die gewohnte 415 bekommen — das ist genau das
 * Verhalten aus Phase 4A. Der Zeichensatz darf angehängt sein, weil manche
 * Browser ihn setzen.
 */
function istFormular(request: Request): boolean {
  const typ = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return typ === 'application/x-www-form-urlencoded';
}

/**
 * ZURÜCK AUF DENSELBEN PRODUKTIONSTAG — und das ist die Stelle, an der ein
 * Open Redirect entstünde, wenn man sie falsch baute.
 *
 * DER TAG KOMMT AUS DER BESTELLUNG IN D1. Nicht aus einem Formularfeld, nicht
 * aus einem Parameter, nicht aus dem Referer. Es gibt in diesem Endpunkt
 * keine Zeile, die ein Wunschziel des Aufrufers läse — und damit auch nichts,
 * das eine Allowlist prüfen müsste. Dieselbe Entscheidung wie beim Login, der
 * bewusst kein `next` kennt.
 *
 * DIE PRÜFUNG MIT isCalendarDay IST TROTZDEM DA. FulfillmentDate.restore()
 * lässt nichts anderes zu, der Wert kann hier also gar nichts Fremdes sein —
 * die Zeile hält diese Zusicherung an der Stelle fest, an der aus dem Wert
 * eine URL wird. Fiele sie eines Tages weg, stünde hier immer noch ein
 * Kalendertag oder gar nichts.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das ein zweiter Statuswechsel.
 */
function zurueckZumProduktionstag(fulfillmentDate: string): Response {
  const ziel = isCalendarDay(fulfillmentDate) ? `/admin?date=${fulfillmentDate}` : '/admin';

  return new Response(null, { status: 303, headers: privateHeaders({ location: ziel }) });
}

/**
 * Die servergerenderte Fehlerantwort eines Formulars.
 *
 * Sie trägt pageHeaders() und damit no-store, dieselbe CSP und dieselbe
 * Referrer-Policy wie jede andere angemeldete Seite. Der Statuscode bleibt
 * derselbe wie im JSON-Weg: 404 bleibt 404, 409 bleibt 409. Eine Seite ist
 * eine andere Darstellung und keine andere Semantik.
 */
function fehlerseite(
  reason: StatusChangeFailure,
  day: string | null,
  status: number,
): Response {
  return new Response(renderStatusChangeFailurePage(reason, day), {
    status,
    headers: pageHeaders(),
  });
}

function nichtGefunden(): Response {
  return json({ error: 'not_found' }, 404, privateHeaders());
}

/**
 * Der Rohwert aus einem JSON-Körper. Ein Formular liefert seinen über
 * URLSearchParams.get(); beide landen in derselben Prüfung darunter.
 */
function readJsonStatus(body: Record<string, unknown>): unknown {
  return body['status'];
}

/**
 * Prüft den gewünschten Zielstatus — für BEIDE Anfrageformen dieselbe Zeile.
 *
 * ES WIRD NICHTS NORMALISIERT. Kein trim(), kein toLowerCase(), keine
 * Zuordnung von 'Bestätigt' auf 'confirmed'. Der Wert ist entweder einer der
 * fünf bekannten Status oder er ist keiner; aus einer beliebigen Zeichenkette
 * hier einen Status zu machen hieße, die Menge der Zustände an der HTTP-Grenze
 * zu erweitern. Ein fehlendes Formularfeld ist null und damit keiner.
 *
 * isOrderStatus() ist dabei dieselbe Funktion, mit der das Repository einen
 * GESPEICHERTEN Status prüft. Es gibt keine zweite Liste — und erst recht
 * keine, die nur der Formularweg kennt.
 *
 * DASS EIN STATUS BEKANNT IST, HEISST NICHT, DASS ER ERLAUBT IST. Ob der
 * Übergang möglich ist, entscheidet canTransitionTo() im Anwendungsfall. In
 * dieser Datei steht dazu kein Wort.
 */
function leseZielstatus(value: unknown): OrderStatus {
  if (!isOrderStatus(value)) {
    throw new RequestError(400, 'invalid_status');
  }
  return value;
}
