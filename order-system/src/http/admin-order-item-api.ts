import {
  cancelOrderItem,
  changeOrderItemQuantities,
} from '../application/edit-order-item';
import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import { OrderNumber } from '../domain/order-number';
import type { RequestedQuantity } from '../domain/order-item-edit';
import { findEditableOrder } from '../infrastructure/d1/admin-order-edit-repository';
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
 * Die beiden schreibenden Endpunkte der Positionsbearbeitung.
 *
 *   POST /api/admin/orders/:orderNumber/items              Mengen speichern
 *   POST /api/admin/orders/:orderNumber/items/:itemId/cancel   Position stornieren
 *
 * SIE FOLGEN ZEILE FÜR ZEILE DERSELBEN ORDNUNG WIE DIE SCHREIBENDEN
 * ADMINVORGÄNGE DAVOR:
 *
 *   1. Origin. Kostet nichts und lehnt jede fremd ausgelöste Anfrage ab,
 *      bevor irgendetwas geschieht.
 *   2. Sitzung und Rolle — 'admin'. Ohne sie wird der Körper nicht gelesen
 *      und keine Bestellung gesucht.
 *   3. CSRF-Token. Er hängt an der Sitzung und ist erst hier prüfbar.
 *   4. Anfrageform.
 *   5. Erst danach die Bestellung.
 *
 * ES SIND REINE FORMULARENDPUNKTE — wie der Zahlungseintrag und die
 * Preisgruppe, anders als der Statuswechsel. Es gibt keinen Client, der sie
 * per fetch aufriefe; einen zweiten Weg zu bauen, den niemand benutzt, hieße,
 * ihn auch absichern zu müssen, ohne dass ihn jemand prüft. Ein anderer
 * Content-Type bekommt eine 415 — aber erst NACH der Wache.
 *
 * ES GIBT KEINEN KUNDENSEITIGEN WEG HIERHER. Beide Pfade beginnen mit
 * /api/admin/, beide verlangen die Rolle 'admin', und in der kundenseitigen
 * Bestellseite steht kein Formular, das auf sie zeigt. Ein Café kann eine
 * Bestellung weder ändern noch stornieren — das ist eine Absprache am
 * Telefon und keine Schaltfläche.
 *
 *
 * WAS DER KÖRPER TRAGEN DARF — und die Liste IST die Regel:
 *
 *   csrf_token   der Token der Sitzung.
 *   version      der Stand, den die Seite gezeigt hat.
 *   quantity_<id> je eine Menge.
 *
 * KEIN PREIS, KEIN PRODUKT, KEIN BETRAG, KEIN KUNDE, KEIN STATUS, KEIN
 * ZAHLUNGSSTAND, KEIN RÜCKKEHRZIEL. Es gibt in dieser Datei keine Zeile, die
 * eines davon läse.
 *
 * DIE MENGENFELDER WERDEN NICHT AUFGEZÄHLT, SONDERN NACHGESCHLAGEN. Der
 * Endpunkt geht über die POSITIONEN DER BESTELLUNG und holt zu jeder das Feld
 * `quantity_<id>` — nicht umgekehrt. Der Unterschied ist die ganze Absicherung
 * dieser Stelle: Ein erfundenes `quantity_4711` bewirkt nichts, weil niemand
 * danach sucht, und die Position einer FREMDEN Bestellung kann so nicht
 * genannt werden. Dass planQuantityChanges() eine unbekannte Position
 * trotzdem ablehnt, ist die zweite Absicherung für direkte Aufrufer.
 */

/**
 * 8 KiB. Der Körper trägt einen Token, einen Zeitstempel und je Position eine
 * Zahl; eine Bestellung mit vierzig Positionen liegt weit darunter.
 * Großzügig gewählt — er soll nichts Echtes abweisen und alles Absurde.
 */
const MAX_BODY_BYTES = 8 * 1024;

const MENGEN_PFAD = /^\/api\/admin\/orders\/([^/]+)\/items$/;
const STORNO_PFAD = /^\/api\/admin\/orders\/([^/]+)\/items\/([^/]+)\/cancel$/;

/**
 * Die Pfade dieser Datei kollidieren mit keinem anderen: /status, /payment
 * und /email-retry enden je auf ein anderes festes Segment, und ein Pfad kann
 * nicht auf zwei dieser Muster passen. Die beiden hier unterscheiden sich in
 * der Zahl ihrer Segmente.
 */
export function matchOrderItemsPath(pathname: string): string | null {
  return ersterTeil(MENGEN_PFAD.exec(pathname), 1);
}

export function matchOrderItemCancelPath(
  pathname: string,
): { readonly orderNumber: string; readonly itemId: string } | null {
  const treffer = STORNO_PFAD.exec(pathname);
  if (treffer === null) return null;

  const orderNumber = ersterTeil(treffer, 1);
  const itemId = ersterTeil(treffer, 2);
  return orderNumber === null || itemId === null ? null : { orderNumber, itemId };
}

/**
 * Der ROHE Pfadteil — noch keine Bestellnummer und keine Kennung. Er kommt
 * vom Aufrufer und wird erst geprüft, nachdem feststeht, dass der Aufrufer
 * Admin ist. decodeURIComponent wirft bei einer kaputten Prozentfolge; daraus
 * soll eine Ablehnung werden und keine 500.
 */
function ersterTeil(treffer: RegExpExecArray | null, gruppe: number): string | null {
  if (treffer === null) return null;
  try {
    return decodeURIComponent(treffer[gruppe] ?? '');
  } catch {
    return '';
  }
}

/**
 * Die Rückmeldungen, die als Code in der Weiterleitung landen.
 *
 * Eine feste Aufzählung und keine freien Zeichenketten: Was in der
 * Adresszeile steht, schlägt die Zielseite in ihrer eigenen festen Tabelle
 * nach. In der angezeigten Meldung kann damit nichts stehen, was nicht in
 * einer dieser Dateien im Quelltext steht.
 */
type EditNotice =
  | 'items_saved'
  | 'items_unchanged'
  | 'items_invalid'
  | 'items_conflict'
  | 'items_internal'
  | 'item_cancelled'
  | 'item_already_cancelled'
  | 'item_unknown';

export async function saveOrderItemQuantitiesEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<Response> {
  try {
    const wache = await wacheUndKoerper(db, config, request, now, orderNumberSegment);
    if (!wache.ok) return wache.response;

    const { felder, orderNumber } = wache;
    if (orderNumber === null) return zurueckZurListe(null, 'edit_unknown_order');

    /**
     * DIE WÜNSCHE ENTSTEHEN AUS DER BESTELLUNG, NICHT AUS DEM KÖRPER.
     *
     * Dafür wird die Bestellung hier gelesen — dieselbe Abfrage, die der
     * Anwendungsfall gleich noch einmal ausführt. Das ist eine zusätzliche
     * Runde und der Preis dafür, dass der Körper die Menge der betroffenen
     * Positionen nicht bestimmen kann: Er kann zu einer bekannten Position
     * eine Zahl liefern und sonst nichts.
     */
    const order = await findEditableOrder(db, orderNumber.value);
    if (order === null) return zurueckZurListe(null, 'edit_unknown_order');

    const requested: RequestedQuantity[] = order.items
      .filter((item) => item.cancelledAt === null)
      .flatMap((item) => {
        const werte = felder.getAll(`quantity_${item.id}`);
        // Ein fehlendes Feld heißt „unverändert"; ein MEHRFACHES wird
        // abgelehnt, statt still das erste zu nehmen — dieselbe Haltung wie
        // beim Zahlungsstand. Welches das erste ist, hängt an der Reihenfolge
        // im Körper, und daraus soll kein Ergebnis folgen.
        if (werte.length === 0) return [];
        if (werte.length > 1) throw new RequestError(400, 'invalid_quantity');
        return [{ id: item.id, quantity: werte[0] }];
      });

    const ergebnis = await changeOrderItemQuantities(db, {
      orderNumber,
      requested,
      expectedVersion: leseVersion(felder),
      now,
      actorAccountId: wache.accountId,
    });

    switch (ergebnis.outcome) {
      case 'saved':
        return ergebnis.orderCancelled
          ? zurueckZurListe(ergebnis.fulfillmentDate, 'order_cancelled_by_items')
          : zurueckZurSeite(orderNumber, 'items_saved');
      case 'unchanged':
        return zurueckZurSeite(orderNumber, 'items_unchanged');
      case 'unknown_order':
        return zurueckZurListe(null, 'edit_unknown_order');
      case 'not_editable':
        return zurueckZurListe(ergebnis.fulfillmentDate, 'edit_not_editable');
      case 'conflict':
        return zurueckZurSeite(orderNumber, 'items_conflict');
      case 'unknown_item':
      case 'duplicate_item':
        return zurueckZurSeite(orderNumber, 'item_unknown');
      case 'cancelled_item':
        return zurueckZurSeite(orderNumber, 'item_already_cancelled');
      case 'invalid_quantity':
        return zurueckZurSeite(orderNumber, 'items_invalid');
    }
  } catch (error) {
    return fehler(error, orderNumberSegment, 'items_invalid', 'items_internal');
  }
}

export async function cancelOrderItemEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
  itemIdSegment: string,
): Promise<Response> {
  try {
    const wache = await wacheUndKoerper(db, config, request, now, orderNumberSegment);
    if (!wache.ok) return wache.response;

    const { orderNumber } = wache;
    if (orderNumber === null) return zurueckZurListe(null, 'edit_unknown_order');

    /**
     * DIE POSITIONSKENNUNG STEHT IM PFAD und wird geprüft wie jede andere
     * Kennung. Sie ist KEINE Berechtigung: Der Anwendungsfall prüft, dass die
     * Position zu genau dieser Bestellung gehört, bevor er sie anfasst.
     */
    const orderItemId = Number(itemIdSegment);
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
      return zurueckZurSeite(orderNumber, 'item_unknown');
    }

    /**
     * DIE STORNIERUNG BRAUCHT KEIN version-FELD AUS DEM FORMULAR.
     *
     * Sie ist eine Entscheidung über EINE Position und keine Übernahme eines
     * ganzen Bildschirms: „diese Position soll weg" bleibt richtig, auch wenn
     * ein zweiter Admin inzwischen eine andere Menge geändert hat. Der Schutz
     * hängt hier an der Position selbst — `cancelled_at IS NULL` —, und eine
     * bereits stornierte Position wird ausdrücklich als solche gemeldet und
     * nicht als Konflikt.
     *
     * Der Anwendungsfall verlangt trotzdem einen Stand; er bekommt den
     * TATSÄCHLICHEN, gerade gelesenen. Damit bleibt jede seiner Anweisungen
     * an dieselbe Bedingung geknüpft, ohne dass ein Admin für einen Klick auf
     * „stornieren" die Seite neu laden müsste.
     */
    const order = await findEditableOrder(db, orderNumber.value);
    if (order === null) return zurueckZurListe(null, 'edit_unknown_order');

    const ergebnis = await cancelOrderItem(db, {
      orderNumber,
      orderItemId,
      expectedVersion: order.version,
      now,
      actorAccountId: wache.accountId,
    });

    switch (ergebnis.outcome) {
      case 'saved':
        return ergebnis.orderCancelled
          ? zurueckZurListe(ergebnis.fulfillmentDate, 'order_cancelled_by_items')
          : zurueckZurSeite(orderNumber, 'item_cancelled');
      case 'already_cancelled':
        return zurueckZurSeite(orderNumber, 'item_already_cancelled');
      case 'unknown_order':
        return zurueckZurListe(null, 'edit_unknown_order');
      case 'not_editable':
        return zurueckZurListe(ergebnis.fulfillmentDate, 'edit_not_editable');
      case 'unknown_item':
        return zurueckZurSeite(orderNumber, 'item_unknown');
      case 'conflict':
        return zurueckZurSeite(orderNumber, 'items_conflict');
    }
  } catch (error) {
    return fehler(error, orderNumberSegment, 'item_unknown', 'items_internal');
  }
}

/**
 * Origin, Rolle, CSRF, Anfrageform — für beide Endpunkte dieselben Zeilen.
 *
 * Sie stehen in EINER Funktion, damit es keinen Zweig geben kann, in dem eine
 * Prüfung fehlt. Der Rückgabewert enthält den bereits gelesenen Körper: Ein
 * Request-Body lässt sich nur einmal lesen, und die CSRF-Prüfung braucht ihn.
 */
type WacheErgebnis =
  | {
      readonly ok: true;
      readonly felder: URLSearchParams;
      readonly orderNumber: OrderNumber | null;
      readonly accountId: number;
    }
  | { readonly ok: false; readonly response: Response };

async function wacheUndKoerper(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<WacheErgebnis> {
  assertSameOrigin(request, config);

  /**
   * Fehlt die Sitzung, schickt die Wache den Browser mit 303 auf die
   * Loginseite — sie ist als 'html' gerufen, weil hier ein Formular
   * abgeschickt wurde. Diese Antwort wird DURCHGEREICHT und nicht in eine
   * Ausnahme verwandelt: Eine abgelaufene Sitzung ist kein Angriff, und
   * {"error":"unauthorized"} im Fenster wäre für einen Menschen die falsche
   * Antwort. Dieselbe Zeile wie im Zahlungs- und im Statusendpunkt.
   */
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) {
    return { ok: false, response: wache.response };
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
   * DIE KONTO-ID KOMMT AUS DEM GEPRÜFTEN KONTEXT und niemals aus der Anfrage.
   * Sie geht unverändert in die Audit-Spur; ein Feld im Körper, über das sich
   * eine andere Person behaupten ließe, gibt es nicht.
   */
  return {
    ok: true,
    felder,
    orderNumber: OrderNumber.parse(orderNumberSegment),
    accountId: wache.context.accountId,
  };
}

/**
 * Der Stand aus dem Formular.
 *
 * MEHRFACHE FELDER WERDEN ABGELEHNT, ein FEHLENDES ebenso: Ein leerer Stand
 * würde gegen keine Zeile prüfen und damit den Schutz aufheben, für den er da
 * ist. Der Wert wird NICHT normalisiert und nicht auf Form geprüft — er ist
 * ein Vergleichswert, kein Datum: Was nicht in der Spalte steht, trifft keine
 * Zeile.
 */
function leseVersion(felder: URLSearchParams): string {
  const werte = felder.getAll('version');
  const wert = werte.length === 1 ? werte[0] : undefined;
  if (wert === undefined || wert === '') {
    throw new RequestError(400, 'invalid_version');
  }
  return wert;
}

function istFormular(request: Request): boolean {
  const typ = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return typ === 'application/x-www-form-urlencoded';
}

/**
 * DIE ABLEHNUNGEN DER WACHE GEHEN WEITER NACH OBEN — an die zentrale
 * Fehlergrenze mit ihrer knappen 403 ohne Begründung. Ein fehlender Origin
 * und ein falscher CSRF-Token sind keine Bedienfehler, sondern der Abdruck
 * einer Anfrage, die so nicht aus der eigenen Seite kommen kann.
 *
 * Ein unerwarteter Fehler wird für den Browser zu einer Weiterleitung mit
 * Hinweis und nicht zu JSON im Fenster. Der Fehler wird dabei NICHT
 * angesehen: Der Hinweis ist eine Konstante, und kein SQL-Fragment, kein
 * Bindingname und kein Dateipfad kann in ihn geraten.
 */
function fehler(
  error: unknown,
  orderNumberSegment: string,
  beiEingabe: EditNotice,
  beiTechnik: EditNotice,
): Response {
  if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
    throw error;
  }

  const orderNumber = OrderNumber.parse(orderNumberSegment);

  if (error instanceof RequestError) {
    /**
     * Die 415 bleibt eine 415: Sie sagt einem maschinellen Aufrufer etwas
     * Richtiges und kann keinen Menschen verwirren, weil kein Formular dieser
     * Seite sie auslöst.
     */
    if (error.status === 415) {
      return new Response(null, { status: 415, headers: privateHeaders() });
    }
    return orderNumber === null
      ? zurueckZurListe(null, 'edit_unknown_order')
      : zurueckZurSeite(orderNumber, beiEingabe);
  }

  return orderNumber === null
    ? zurueckZurListe(null, 'edit_internal')
    : zurueckZurSeite(orderNumber, beiTechnik);
}

/**
 * ZURÜCK AUF DIE BEARBEITUNGSSEITE derselben Bestellung.
 *
 * Das Ziel ist eine Konstante im Quelltext; die Bestellnummer stammt aus dem
 * Pfad und ist durch OrderNumber.parse() gegangen, hat also die Form
 * BUS-JJJJ-NNNNNN und kann nichts anderes sein. Es gibt hier keine Zeile, die
 * ein Wunschziel des Aufrufers läse — dieselbe Entscheidung wie bei jedem
 * anderen Rücksprung im Adminbereich.
 *
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST — hier wäre das eine zweite Änderung.
 */
function zurueckZurSeite(orderNumber: OrderNumber, notice: EditNotice): Response {
  const ziel = `/admin/orders/${encodeURIComponent(orderNumber.value)}/bearbeiten?notice=${notice}`;
  return new Response(null, { status: 303, headers: privateHeaders({ location: ziel }) });
}

/**
 * ZURÜCK IN DIE BESTELLLISTE — für die Fälle, in denen die
 * Bearbeitungsseite nicht mehr das richtige Ziel ist: Die Bestellung ist
 * vollständig storniert, nicht mehr bearbeitbar oder gar nicht vorhanden.
 *
 * Der Tag kommt aus der BESTELLUNG IN D1 und niemals aus der Anfrage.
 * isCalendarDay hält diese Zusicherung an der Stelle fest, an der aus dem
 * Wert eine URL wird.
 */
function zurueckZurListe(day: string | null, notice: string): Response {
  const date = day !== null && isCalendarDay(day) ? `date=${day}&` : '';
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/orders?${date}notice=${notice}` }),
  });
}
