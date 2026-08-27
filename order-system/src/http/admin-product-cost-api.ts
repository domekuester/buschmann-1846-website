import type { AppConfig } from '../config/app-config';
import { toUtcTimestamp } from '../domain/clock';
import { parseUnitCost } from '../domain/product-cost';
import { updateCatalogProductCost } from '../infrastructure/d1/product-cost-repository';
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
 * POST /api/admin/catalog-products/:catalogProductId/cost
 *
 * Der sechste schreibende Adminvorgang des Systems — und er folgt Zeile für
 * Zeile derselben Ordnung wie die fünf davor:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — 'admin'. Ohne sie wird der Körper nicht gelesen
 *      und kein Katalogprodukt gesucht.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform und Feld.
 *   5. Erst danach der Schreibvorgang.
 *
 * ADMIN UND SONST NIEMAND. Herstellkosten sind der interne Blick auf die
 * eigene Kalkulation; ein Café hat auf diesem Endpunkt nichts zu suchen, und
 * die Wache lehnt es mit derselben 403 ab wie überall sonst — bevor der
 * Körper gelesen wird.
 *
 * WAS DER KÖRPER TRAGEN DARF: den CSRF-Token und den Betrag. Sonst nichts. In
 * dieser Datei gibt es keine Zeile, die eine Rolle, eine Konto-ID, einen
 * Produktnamen, einen Preis, eine Preisliste, eine Bestellnummer oder ein
 * Rückkehrziel läse — und was nicht gelesen wird, kann auch nicht
 * geschmuggelt werden.
 *
 * ER ÄNDERT KEINE EINZIGE BESTELLUNG. Diese Datei kennt order_items nicht.
 * Ein neuer Kostenwert gilt ab jetzt; die Snapshots bestehender Positionen
 * bleiben, was sie am Bestelltag waren.
 */

/**
 * 1 KiB. Der Körper trägt einen Token und einen kurzen Betrag; eine echte
 * Anfrage liegt weit darunter. Großzügig gewählt: Sie soll nichts Echtes
 * abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 1024;

const PFAD = /^\/api\/admin\/catalog-products\/([^/]+)\/cost$/;

/**
 * Gehört dieser Pfad zu diesem Endpunkt — und welches Katalogprodukt steht
 * darin?
 *
 * Der Rückgabewert ist das ROHE Pfadsegment und noch keine Kennung: Es kommt
 * vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der Aufrufer
 * Admin ist. `[^/]+` sorgt dafür, dass ein Segment ein Segment bleibt —
 * '../../etwas' passt nicht auf dieses Muster.
 */
export function matchCatalogProductCostPath(pathname: string): string | null {
  const treffer = PFAD.exec(pathname);
  if (treffer === null) {
    return null;
  }

  // %2F und Verwandte kommen hier als das an, was sie sind.
  // decodeURIComponent wirft bei einer kaputten Prozentfolge — daraus soll
  // eine Ablehnung werden und keine 500.
  try {
    return decodeURIComponent(treffer[1] ?? '');
  } catch {
    return '';
  }
}

/**
 * Die Rückmeldungen, die als Code in der Weiterleitung landen.
 *
 * SIE TRAGEN ALLE DAS PRÄFIX `cost_`, und das ist kein Schmuck: Die
 * Katalogseite hat seit 5D bereits einen Meldungsbereich für die
 * Produktzuordnung. Zwei Vorgänge auf einer Seite brauchen zwei
 * Meldungsstellen, sonst erscheint die Antwort auf ein Herstellkostenformular
 * unten bei der Zuordnung. Das Präfix entscheidet, wo die Meldung erscheint.
 *
 * `cost_cleared` IST EIN EIGENER ERFOLGSFALL. „Gespeichert" wäre für das
 * Löschen eines Kostenwerts zwar nicht falsch, aber es ist der Vorgang, bei
 * dem jemand am ehesten wissen will, ob wirklich passiert ist, was er wollte.
 */
type Notice =
  | 'cost_saved'
  | 'cost_cleared'
  | 'cost_unknown_product'
  | 'cost_invalid'
  | 'cost_internal';

export async function saveCatalogProductCostEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  catalogProductIdSegment: string,
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

    const catalogProductId = leseKennung(catalogProductIdSegment);

    /**
     * EINE UNMÖGLICHE KENNUNG IST DIESELBE ANTWORT WIE EINE UNBEKANNTE.
     * „Das Format stimmt nicht" gegenüber „das gibt es nicht" wäre eine
     * Auskunft darüber, wie eine gültige Kennung aussieht — dieselbe
     * Überlegung wie bei der Produktkennung in 5D.
     */
    if (catalogProductId === null) {
      return zurueck('cost_unknown_product');
    }

    const kosten = leseKosten(felder);
    if (kosten.kind === 'invalid') {
      return zurueck('cost_invalid');
    }

    const unitCostCents = kosten.kind === 'cleared' ? null : kosten.cents;
    const geschrieben = await updateCatalogProductCost(db, {
      catalogProductId,
      unitCostCents,
      now: toUtcTimestamp(now),
    });

    if (!geschrieben) {
      return zurueck('cost_unknown_product');
    }
    return zurueck(unitCostCents === null ? 'cost_cleared' : 'cost_saved');
  } catch (error) {
    if (error instanceof RequestError) {
      /**
       * Die 415 bleibt eine 415: Sie sagt einem maschinellen Aufrufer etwas
       * Richtiges und kann keinen Menschen verwirren, weil kein Formular
       * dieser Seite sie auslöst. Alles Übrige (etwa ein zu großer Körper)
       * wird für den Browser zu einer Weiterleitung mit Hinweis, statt zu
       * JSON im Fenster.
       */
      if (error.status === 415) {
        return new Response(null, { status: 415, headers: privateHeaders() });
      }
      return zurueck(error.code === 'invalid_cost' ? 'cost_invalid' : 'cost_internal');
    }

    /**
     * DIE ABLEHNUNGEN DER WACHE GEHEN WEITER NACH OBEN.
     *
     * Ein fehlender Origin und ein falscher CSRF-Token sind keine
     * Bedienfehler, sondern der Abdruck einer Anfrage, die so nicht aus der
     * eigenen Seite kommen kann. Sie gehören zur zentralen Fehlergrenze mit
     * ihrer knappen 403 ohne Begründung. WELCHE Prüfung gescheitert ist, sagt
     * auch hier niemand.
     */
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      throw error;
    }

    /**
     * Ein unerwarteter Fehler wird für den Browser zu einer Weiterleitung und
     * nicht zu JSON. Der Fehler wird dabei NICHT angesehen: Der Hinweis ist
     * eine Konstante, und kein SQL-Fragment, kein Bindingname und kein
     * Dateipfad kann in ihn geraten.
     */
    return zurueck('cost_internal');
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
 * Eine Zeilenkennung aus dem Pfad — geprüft, nicht bloß weitergereicht.
 *
 * Erlaubt ist ausschließlich eine positive ganze Dezimalzahl. Kein trim, kein
 * Vorzeichen, kein '1e3', kein '1.0', kein Leerraum: Number() allein wäre
 * hier zu nachsichtig — Number(' 1 ') ist 1 —, und aus einer Adresszeile soll
 * nichts durchkommen, was nur zufällig wie eine Zahl aussieht.
 */
function leseKennung(wert: string): number | null {
  if (!/^[1-9][0-9]{0,17}$/.test(wert)) {
    return null;
  }
  const zahl = Number(wert);
  return Number.isSafeInteger(zahl) ? zahl : null;
}

/**
 * Der Betrag aus dem Formular.
 *
 * DAS FELD MUSS GENAU EINMAL DA SEIN. Fehlt es, war das Formular nicht das
 * erwartete; steht es zweimal da, hinge das Ergebnis an der Reihenfolge im
 * Körper. Beides wird abgelehnt, statt still den ersten Wert zu nehmen —
 * dieselbe Entscheidung wie bei der Katalogkennung in 5D und den
 * Richtlinienfeldern in 6F.
 *
 * DER LEERE WERT IST „NICHT HINTERLEGT" und ein gültiges Ziel: Er setzt die
 * Spalte auf NULL zurück. Das ist der einzige Weg, einen versehentlich
 * gepflegten Kostenwert wieder loszuwerden — ohne ihn müsste jemand 0
 * eintragen, und 0 heißt etwas anderes (§2).
 *
 * DIE PRÜFUNG SELBST STEHT IN DER DOMÄNE. parseUnitCost() ist dieselbe
 * Funktion, gegen die auch die Tests der Geldeingabe laufen; ein eigener
 * regulärer Ausdruck an dieser Stelle wäre eine zweite Fassung derselben
 * Regel und damit die Gelegenheit, dass eine davon '2,105' durchlässt.
 */
function leseKosten(felder: URLSearchParams): ReturnType<typeof parseUnitCost> {
  const werte = felder.getAll('unit_cost');
  if (werte.length !== 1) {
    throw new RequestError(400, 'invalid_cost');
  }
  return parseUnitCost(werte[0] ?? '');
}

/**
 * Der Sprungpunkt des Preisbereichs.
 *
 * Ohne ihn landete der Admin nach jedem Speichern ganz oben auf der Seite,
 * und bei langem Sortiment stünde die Zeile, die er gerade bearbeitet hat,
 * außerhalb des Bildschirms. Er ist eine KONSTANTE im Quelltext und kommt —
 * wie das Ziel selbst — unter keinen Umständen aus der Anfrage.
 */
const ANKER = '#herstellkosten';

/**
 * ZURÜCK AUF DIE KATALOGSEITE — und das ist die Stelle, an der ein Open
 * Redirect entstünde, wenn man sie falsch baute.
 *
 * DAS ZIEL IST EINE KONSTANTE IM QUELLTEXT. Nicht aus einem Formularfeld,
 * nicht aus einem Parameter, nicht aus dem Referer. Es gibt in diesem
 * Endpunkt keine Zeile, die ein Wunschziel des Aufrufers läse — und damit
 * auch nichts, das eine Allowlist prüfen müsste.
 *
 * Der angehängte Code stammt aus der festen Aufzählung oben und niemals aus
 * der Anfrage.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das ein zweites Speichern.
 */
function zurueck(notice: Notice): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/catalog?notice=${notice}${ANKER}` }),
  });
}
