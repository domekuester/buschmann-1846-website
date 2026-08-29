import { recordOrderPayment } from '../application/record-order-payment';
import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import { OrderNumber } from '../domain/order-number';
import { isPaymentStatus, type PaymentStatus } from '../domain/payment-status';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { RequestError, readBody } from './json-body';
import { privateHeaders } from './security';

/**
 * POST /api/admin/orders/:orderNumber/payment
 *
 * Der vierte schreibende Adminvorgang des Systems — und er folgt Zeile für
 * Zeile derselben Ordnung wie die drei davor:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — 'admin'. Ohne sie wird der Körper nicht gelesen
 *      und keine Bestellung gesucht.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform und Feld.
 *   5. Erst danach die Bestellung.
 *
 * ER IST NUR EIN FORMULARENDPUNKT — wie der Preisgruppenendpunkt und anders
 * als der Statuswechsel. Es gibt keinen Client, der ihn per fetch aufriefe,
 * und einen zweiten Weg zu bauen, den niemand benutzt, hieße, ihn auch
 * absichern zu müssen, ohne dass ihn jemand prüft. Ein anderer Content-Type
 * bekommt eine 415 — aber erst NACH der Wache.
 *
 * WAS DER KÖRPER TRAGEN DARF: den CSRF-Token und den gewünschten
 * Zahlungsstand. Sonst nichts. In dieser Datei gibt es keine Zeile, die einen
 * BETRAG, einen Kunden, einen Produktionsstatus, eine Rolle oder ein
 * Rückkehrziel läse — und was nicht gelesen wird, kann auch nicht
 * geschmuggelt werden. Das Betragsfeld fehlt hier nicht aus Sparsamkeit: Ein
 * Zahlungsbetrag aus einem Formular wäre die Behauptung des Aufrufers
 * darüber, was eine Bestellung gekostet hat, und stünde damit gegen den
 * Snapshot in der Bestellung selbst.
 *
 * ER ÄNDERT DEN UMSATZ NICHT. Er schreibt zwei Spalten, und keine davon ist
 * ein Geldbetrag.
 *
 * ES GIBT HIER KEINE ZAHLUNGSREGEL. Welcher Wert zulässig ist, entscheidet
 * isPaymentStatus() in der Domäne; welcher Zeitpunkt dazugehört, entscheidet
 * paymentRecordedAtFor(). In dieser Datei kommt kein `if (status ===
 * 'unpaid')` vor.
 */

/**
 * 1 KiB. Der Körper trägt einen Token und ein kurzes Codewort; eine echte
 * Anfrage liegt weit darunter. Großzügig gewählt: Sie soll nichts Echtes
 * abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 1024;

const PFAD = /^\/api\/admin\/orders\/([^/]+)\/payment$/;

/**
 * Gehört dieser Pfad zu diesem Endpunkt — und welche Bestellung steht darin?
 *
 * Der Rückgabewert ist das ROHE Pfadsegment und noch keine Bestellnummer: Es
 * kommt vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der
 * Aufrufer Admin ist. `[^/]+` sorgt dafür, dass ein Segment ein Segment
 * bleibt — '../../etwas' passt nicht auf dieses Muster.
 */
export function matchOrderPaymentPath(pathname: string): string | null {
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

/**
 * Die Rückmeldungen, die als Code in der Weiterleitung landen.
 *
 * Eine feste Aufzählung und keine freien Zeichenketten: Was in der Adresszeile
 * steht, schlägt das Dashboard in seiner eigenen festen Tabelle nach. In der
 * angezeigten Meldung kann damit nichts stehen, was nicht in einer dieser
 * beiden Dateien im Quelltext steht.
 */
type Notice = 'payment_saved' | 'unknown_order' | 'invalid' | 'internal';

export async function recordOrderPaymentEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<Response> {
  try {
    assertSameOrigin(request, config);

    const wache = await requireRole(db, config, request, now, 'admin', 'html');
    if (!wache.ok) {
      return wache.response;
    }

    /**
     * DER CONTENT-TYPE WIRD ERST HIER GEPRÜFT — nach der Wache. Ein Fremder
     * soll aus einer 415 nicht erfahren, welche Anfrageform dieser Endpunkt
     * erwartet.
     */
    if (!istFormular(request)) {
      throw new RequestError(415, 'unsupported_media_type');
    }

    const felder = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
    assertCsrf(request, wache.context, felder);

    /**
     * EINE UNMÖGLICHE BESTELLNUMMER IST DIESELBE ANTWORT WIE EINE UNBEKANNTE.
     * „Das Format stimmt nicht" gegenüber „die gibt es nicht" wäre eine
     * Auskunft darüber, wie eine gültige Bestellnummer aussieht — dieselbe
     * Überlegung wie im Statusendpunkt und bei der Kundenkennung.
     */
    const orderNumber = OrderNumber.parse(orderNumberSegment);
    if (orderNumber === null) {
      return zurueck('unknown_order', null);
    }

    const target = leseZahlungsstand(felder);
    const ergebnis = await recordOrderPayment(db, { orderNumber, target, now });

    switch (ergebnis.outcome) {
      case 'recorded':
        return zurueck('payment_saved', ergebnis.fulfillmentDate);
      case 'unknown_order':
        return zurueck('unknown_order', null);
    }
  } catch (error) {
    if (error instanceof RequestError) {
      /**
       * Die 415 bleibt eine 415: Sie sagt einem maschinellen Aufrufer etwas
       * Richtiges und kann keinen Menschen verwirren, weil kein Formular
       * dieser Seite sie auslöst.
       */
      if (error.status === 415) {
        return new Response(null, { status: 415, headers: privateHeaders() });
      }
      /**
       * Ein fehlender, mehrfacher oder unbekannter Zahlungsstand ist etwas
       * anderes als ein technisches Scheitern, und der Admin soll den
       * Unterschied lesen können. Beide Male wurde nichts geschrieben — der
       * Code sagt nur, woran es lag, und nennt dabei weder Feldnamen noch
       * Technik und schon gar nicht die Liste der zulässigen Werte.
       */
      return zurueck(error.code === 'invalid_payment_status' ? 'invalid' : 'internal', null);
    }

    /**
     * DIE ABLEHNUNGEN DER WACHE GEHEN WEITER NACH OBEN.
     *
     * Ein fehlender Origin und ein falscher CSRF-Token sind keine
     * Bedienfehler, sondern der Abdruck einer Anfrage, die so nicht aus der
     * eigenen Seite kommen kann. Für diese Lage gibt es nichts zu erklären
     * und keinen Weg zurück anzubieten; sie gehört zur zentralen Fehlergrenze
     * mit ihrer knappen 403 ohne Begründung. WELCHE Prüfung gescheitert ist,
     * sagt auch hier niemand.
     */
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      throw error;
    }

    /**
     * Ein unerwarteter Fehler wird für den Browser zu einer Weiterleitung mit
     * Hinweis und nicht zu JSON im Fenster. Der Fehler wird dabei NICHT
     * angesehen: Der Hinweis ist eine Konstante, und kein SQL-Fragment, kein
     * Bindingname und kein Dateipfad kann in ihn geraten.
     */
    return zurueck('internal', null);
  }
}

/**
 * Der einzige Content-Type, den dieser Endpunkt annimmt.
 *
 * EXAKT und nicht mit endsWith — dieselbe Regel wie bei den übrigen
 * Formularendpunkten. Der Zeichensatz darf angehängt sein, weil manche
 * Browser ihn setzen.
 */
function istFormular(request: Request): boolean {
  const typ = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return typ === 'application/x-www-form-urlencoded';
}

/**
 * Der gewünschte Zahlungsstand aus dem Formular.
 *
 * MEHRFACHE FELDER WERDEN ABGELEHNT, statt still das erste zu nehmen: Welches
 * das erste ist, hängt an der Reihenfolge im Körper, und ein Endpunkt, dessen
 * Ergebnis von einer solchen Feinheit abhängt, lädt zu Schmuggel ein. Ein
 * FEHLENDES Feld ist ebenfalls eine Ablehnung — es still als „offen" zu
 * deuten hieße, aus einem Versehen eine kaufmännische Aussage abzuleiten.
 *
 * ES WIRD NICHTS NORMALISIERT — kein trim, kein toLowerCase, keine Zuordnung
 * von 'Bar' auf 'paid_cash'. Der Wert ist einer der fünf oder er ist keiner;
 * geprüft wird mit isPaymentStatus(), also mit DERSELBEN Allowlist, mit der
 * das Repository einen GESPEICHERTEN Wert prüft. Es gibt keine zweite Liste
 * — und erst recht keine, die nur der Formularweg kennt.
 */
function leseZahlungsstand(felder: URLSearchParams): PaymentStatus {
  const werte = felder.getAll('payment_status');
  if (werte.length !== 1) {
    throw new RequestError(400, 'invalid_payment_status');
  }

  const wert = werte[0];
  if (!isPaymentStatus(wert)) {
    throw new RequestError(400, 'invalid_payment_status');
  }
  return wert;
}

/**
 * ZURÜCK AUF DAS DASHBOARD DESSELBEN TAGES — und das ist die Stelle, an der
 * ein Open Redirect entstünde, wenn man sie falsch baute.
 *
 * DAS ZIEL IST EINE KONSTANTE IM QUELLTEXT, der Tag kommt aus der BESTELLUNG
 * IN D1. Nicht aus einem Formularfeld, nicht aus einem Parameter, nicht aus
 * dem Referer. Es gibt in diesem Endpunkt keine Zeile, die ein Wunschziel des
 * Aufrufers läse — und damit auch nichts, das eine Allowlist prüfen müsste.
 * Dieselbe Entscheidung wie beim Statuswechsel, bei der Preisgruppe und beim
 * Login, der bewusst kein `next` kennt.
 *
 * DIE PRÜFUNG MIT isCalendarDay IST TROTZDEM DA. Der Wert stammt aus einer
 * Spalte mit CHECK-Bedingung und kann hier nichts Fremdes sein — die Zeile
 * hält diese Zusicherung an der Stelle fest, an der aus dem Wert eine URL
 * wird. Fiele sie eines Tages weg, stünde hier immer noch ein Kalendertag
 * oder gar nichts.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das ein zweiter Zahlungseintrag.
 */
function zurueck(notice: Notice, day: string | null): Response {
  const ziel =
    day !== null && isCalendarDay(day)
      ? `/admin/orders?date=${day}&notice=${notice}`
      : `/admin/orders?notice=${notice}`;

  return new Response(null, { status: 303, headers: privateHeaders({ location: ziel }) });
}
