import { assignCustomerPriceGroup } from '../application/assign-customer-price-group';
import type { AppConfig } from '../config/app-config';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { parseIdSegment } from './id-param';
import { RequestError, readBody } from './json-body';
import { privateHeaders } from './security';

/**
 * POST /api/admin/customers/:customerId/price-list
 *
 * Der zweite schreibende Adminvorgang des Systems — und er folgt Zeile für
 * Zeile derselben Ordnung wie der erste (http/admin-order-api.ts):
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — 'admin'. Ohne sie wird der Körper nicht gelesen
 *      und kein Kunde gesucht.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform und Feld.
 *   5. Erst danach der Kunde und die Preisgruppe.
 *
 * ER IST NUR EIN FORMULARENDPUNKT. Anders als der Statuswechsel hat er
 * keinen JSON-Zwilling: Es gibt keinen Client, der ihn per fetch aufriefe,
 * und einen zweiten Weg zu bauen, den niemand benutzt, hieße, ihn auch
 * absichern zu müssen, ohne dass ihn jemand prüft. Ein anderer Content-Type
 * bekommt eine 415 — aber erst NACH der Wache, damit ein Fremder daraus
 * nicht erfährt, welche Anfrageform hier erwartet wird.
 *
 * WAS DER KÖRPER TRAGEN DARF: den CSRF-Token und die gewünschte Preisgruppe.
 * Sonst nichts. In dieser Datei gibt es keine Zeile, die eine Rolle, eine
 * Konto-ID, einen Kundennamen, einen Preis oder ein Rückkehrziel läse — und
 * was nicht gelesen wird, kann auch nicht geschmuggelt werden.
 *
 * ER WÄHLT KEINEN BESTELLPREIS. Nach einer Zuordnung rechnet der bestehende
 * Bestellfluss unverändert weiter; hier wird eine Zugehörigkeit gespeichert
 * und kein Cent-Betrag. Das ist Absicht und die Grenze zu Phase 5C.
 */

/**
 * 1 KiB. Der Körper trägt einen Token und ein kurzes Codewort; eine echte
 * Anfrage liegt weit darunter. Großzügig gewählt: Sie soll nichts Echtes
 * abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 1024;

const PFAD = /^\/api\/admin\/customers\/([^/]+)\/price-list$/;

/**
 * Gehört dieser Pfad zu diesem Endpunkt — und welcher Kunde steht darin?
 *
 * Der Rückgabewert ist das ROHE Pfadsegment und noch keine Kundenkennung: Es
 * kommt vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der
 * Aufrufer Admin ist. `[^/]+` sorgt dafür, dass ein Segment ein Segment
 * bleibt — '../../etwas' passt nicht auf dieses Muster.
 */
export function matchCustomerPriceListPath(pathname: string): string | null {
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
 * Sie sind eine feste Aufzählung und keine freien Zeichenketten: Was in der
 * Adresszeile steht, schlägt die Kundenseite in ihrer eigenen festen Tabelle
 * nach. Damit kann in der angezeigten Meldung nichts stehen, was nicht in
 * einer dieser beiden Dateien im Quelltext steht.
 */
type Notice =
  | 'saved'
  | 'unknown_customer'
  | 'unknown_price_group'
  | 'inactive_price_group'
  | 'invalid'
  | 'internal';

export async function changeCustomerPriceGroupEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  customerIdSegment: string,
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

    const customerId = parseIdSegment(customerIdSegment);
    const priceListCode = lesePreisgruppe(felder);

    /**
     * EINE UNMÖGLICHE KUNDENKENNUNG IST DIESELBE ANTWORT WIE EINE UNBEKANNTE.
     * „Das Format stimmt nicht" gegenüber „den gibt es nicht" wäre eine
     * Auskunft darüber, wie eine gültige Kennung aussieht — dieselbe
     * Überlegung wie bei der Bestellnummer im Statusendpunkt.
     */
    if (customerId === null) {
      return zurueck('unknown_customer');
    }

    const ergebnis = await assignCustomerPriceGroup(db, { customerId, priceListCode, now });

    switch (ergebnis.outcome) {
      case 'assigned':
        return zurueck('saved');
      case 'unknown_customer':
        return zurueck('unknown_customer');
      case 'unknown_price_group':
        return zurueck('unknown_price_group');
      case 'inactive_price_group':
        return zurueck('inactive_price_group');
    }
  } catch (error) {
    /**
     * EINE ANFRAGE, DIE NICHT LESBAR WAR — zu groß oder in der falschen Form.
     *
     * Die 415 bleibt eine 415: Sie sagt einem maschinellen Aufrufer etwas
     * Richtiges und kann keinen Menschen verwirren, weil kein Formular dieser
     * Seite sie auslöst. Alles Übrige (etwa ein zu großer Körper) wird für
     * den Browser zu einer Weiterleitung mit Hinweis, statt zu JSON im
     * Fenster.
     */
    if (error instanceof RequestError) {
      if (error.status === 415) {
        return new Response(null, { status: 415, headers: privateHeaders() });
      }
      /**
       * Ein fehlendes oder mehrfach geschicktes Preisgruppenfeld ist etwas
       * anderes als ein technisches Scheitern, und der Admin soll den
       * Unterschied lesen können: „Die Auswahl war nicht lesbar" gegenüber
       * „konnte gerade nicht gespeichert werden". Beide Male wurde nichts
       * geschrieben — der Code sagt nur, woran es lag, und nennt dabei weder
       * Feldnamen noch Technik.
       */
      return zurueck(error.code === 'invalid_price_group' ? 'invalid' : 'internal');
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
     * Ein unerwarteter Fehler wird für den Browser zu einer Seite und nicht
     * zu JSON — dieselbe Überlegung wie in http/admin-order-api.ts. Der
     * Fehler wird dabei NICHT angesehen: Der Hinweis ist eine Konstante, und
     * kein SQL-Fragment, kein Bindingname und kein Dateipfad kann in ihn
     * geraten.
     */
    return zurueck('internal');
  }
}

/**
 * Der einzige Content-Type, den dieser Endpunkt annimmt.
 *
 * EXAKT und nicht mit endsWith — dieselbe Regel wie beim Statusendpunkt. Der
 * Zeichensatz darf angehängt sein, weil manche Browser ihn setzen.
 */
function istFormular(request: Request): boolean {
  const typ = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return typ === 'application/x-www-form-urlencoded';
}

/**
 * Die gewünschte Preisgruppe aus dem Formular.
 *
 * DREI FÄLLE, UND ALLE DREI SIND VERSCHIEDEN:
 *
 *   fehlt         das Formular war nicht das erwartete → Ablehnung. Ein
 *                 fehlendes Feld still als „nicht zugeordnet" zu deuten
 *                 hieße, eine kaufmännische Entscheidung aus einem Versehen
 *                 abzuleiten.
 *   leer          ausdrücklich „nicht zugeordnet". Ein Preislisten-Code darf
 *                 laut Schema nicht leer sein; der leere Wert kann deshalb
 *                 mit keiner echten Preisgruppe kollidieren.
 *   ein Wort      der Code einer Preisgruppe — welcher gültig ist,
 *                 entscheidet die Datenbank und nicht diese Datei.
 *
 * MEHRFACHE FELDER WERDEN ABGELEHNT, statt still das erste zu nehmen: Welches
 * das erste ist, hängt an der Reihenfolge im Körper, und ein Endpunkt, dessen
 * Ergebnis von einer solchen Feinheit abhängt, lädt zu Schmuggel ein.
 *
 * ES WIRD NICHTS NORMALISIERT — kein trim, kein toLowerCase, keine Zuordnung
 * von 'Gastronomie' auf 'gastro'. Der Wert ist ein Code oder er ist keiner.
 */
function lesePreisgruppe(felder: URLSearchParams): string | null {
  const werte = felder.getAll('price_list_code');
  if (werte.length !== 1) {
    throw new RequestError(400, 'invalid_price_group');
  }

  const wert = werte[0] ?? '';
  return wert === '' ? null : wert;
}

/**
 * ZURÜCK AUF DIE KUNDENLISTE — und das ist die Stelle, an der ein Open
 * Redirect entstünde, wenn man sie falsch baute.
 *
 * DAS ZIEL IST EINE KONSTANTE IM QUELLTEXT. Nicht aus einem Formularfeld,
 * nicht aus einem Parameter, nicht aus dem Referer. Es gibt in diesem
 * Endpunkt keine Zeile, die ein Wunschziel des Aufrufers läse — und damit
 * auch nichts, das eine Allowlist prüfen müsste. Dieselbe Entscheidung wie
 * beim Statuswechsel und beim Login, der bewusst kein `next` kennt.
 *
 * Der angehängte Code stammt aus der festen Aufzählung oben und niemals aus
 * der Anfrage.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das eine zweite Zuordnung.
 */
function zurueck(notice: Notice): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/customers?notice=${notice}` }),
  });
}
