import { changeOrderStatus } from '../application/change-order-status';
import type { AppConfig } from '../config/app-config';
import { OrderNumber } from '../domain/order-number';
import { isOrderStatus } from '../domain/order-status';
import { assertCsrf, assertSameOrigin, requireRole } from './guard';
import { RequestError, readJsonObject } from './json-body';
import { json } from './responses';
import { privateHeaders } from './security';

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
 * SPÄTER (PHASE 4B): Die Statusschaltflächen der Produktionsansicht werden
 * ein echtes `<form method="post">` sein. Dafür braucht es hier zwei
 * Ergänzungen und keinen Umbau — einen zweiten Content-Type
 * (application/x-www-form-urlencoded, aus dem assertCsrf ohnehin schon lesen
 * kann) und statt der 200 eine 303 zurück auf den Produktionstag. Die
 * Prüfreihenfolge, die Domänenentscheidung und der Schreibvorgang bleiben
 * unverändert. HEUTE WIRD DAS NICHT GEBAUT.
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
  try {
    assertSameOrigin(request, config);

    const wache = await requireRole(db, config, request, now, 'admin', 'api');
    if (!wache.ok) {
      return wache.response;
    }

    assertCsrf(request, wache.context);

    const target = readTargetStatus(await readJsonObject(request, MAX_BODY_BYTES));

    /**
     * Die Bestellnummer wird GEPRÜFT, nicht bloß weitergereicht — und eine
     * formal falsche ist dieselbe Antwort wie eine unbekannte. „Das Format
     * stimmt nicht" gegenüber „die gibt es nicht" wäre eine Auskunft darüber,
     * wie eine gültige Nummer aussieht.
     */
    const orderNumber = OrderNumber.parse(orderNumberSegment);
    if (orderNumber === null) {
      return nichtGefunden();
    }

    const ergebnis = await changeOrderStatus(db, { orderNumber, target, now });

    switch (ergebnis.outcome) {
      case 'changed':
        return json(
          {
            order_number: ergebnis.order.orderNumber.value,
            status: ergebnis.order.status,
          },
          200,
          privateHeaders(),
        );

      case 'unknown_order':
        return nichtGefunden();

      /**
       * 409 und nicht 400: Die Anfrage ist in Ordnung, sie passt nur nicht
       * zum Zustand der Bestellung. Genau das ist die Bedeutung von Conflict.
       *
       * DIE ANTWORT NENNT DEN ERLAUBTEN WEG NICHT. Sie sagt nicht, in welchem
       * Status die Bestellung steht und was von dort aus ginge; die
       * Übergangstabelle ist eine Eigenschaft des Systems und gehört nicht in
       * eine Fehlerantwort. Die spätere Oberfläche braucht sie auch nicht —
       * sie zeigt ohnehin den geladenen Stand und kann zum Neuladen auffordern.
       */
      case 'invalid_transition':
        return json({ error: 'invalid_transition' }, 409, privateHeaders());

      /**
       * Ebenfalls 409, aber ein eigener Code: „Jemand anderes war schneller"
       * ist für die spätere Oberfläche eine andere Lage als „das geht von hier
       * aus nicht" — dort hilft ein Neuladen, hier nicht. Über den Zustand der
       * Bestellung sagt auch dieser Code nichts.
       */
      case 'conflict':
        return json({ error: 'conflict' }, 409, privateHeaders());
    }
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.code }, error.status, privateHeaders());
    }
    throw error;
  }
}

function nichtGefunden(): Response {
  return json({ error: 'not_found' }, 404, privateHeaders());
}

/**
 * Liest den gewünschten Zielstatus — oder lehnt ab.
 *
 * ES WIRD NICHTS NORMALISIERT. Kein trim(), kein toLowerCase(), keine
 * Zuordnung von 'Bestätigt' auf 'confirmed'. Der Wert ist entweder einer der
 * fünf bekannten Status oder er ist keiner; aus einer beliebigen Zeichenkette
 * hier einen Status zu machen hieße, die Menge der Zustände an der HTTP-Grenze
 * zu erweitern.
 *
 * isOrderStatus() ist dabei dieselbe Funktion, mit der das Repository einen
 * GESPEICHERTEN Status prüft. Es gibt keine zweite Liste.
 */
function readTargetStatus(body: Record<string, unknown>) {
  const value = body['status'];
  if (!isOrderStatus(value)) {
    throw new RequestError(400, 'invalid_status');
  }
  return value;
}
