import { getProductionDay } from '../application/get-production-day';
import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import type { ProductionDay } from '../domain/production-day';
import { requireRole } from './guard';
import { json } from './responses';
import { privateHeaders } from './security';

/**
 * GET /api/admin/production-day?date=JJJJ-MM-TT
 *
 * Die Antwort auf „was muss Buschmann an diesem Tag produzieren?" — für
 * Administration, und ausschließlich für sie.
 *
 * DIE REIHENFOLGE IST ABSICHT, und sie ist dieselbe wie in order-api.ts:
 *
 *   1. Rolle. Ohne gültige Adminsitzung wird nichts weiter getan — auch nicht
 *      der Parameter angeschaut.
 *   2. Datum.
 *   3. Abfrage.
 *
 * Schritt 1 vor Schritt 2 heißt: Wer keinen Zugang hat, bekommt 401 oder 403
 * und nicht 400. Ein „invalid_date" für einen Fremden wäre die Auskunft „hier
 * ist ein Endpunkt, und er will ein Datum" — eine kleine Auskunft, aber eine
 * kostenlose.
 *
 * Die Methodenprüfung steht davor, im Worker, wie bei allen anderen Routen
 * auch.
 *
 * KEINE ORIGIN- UND KEINE CSRF-PRÜFUNG. Beide gehören zu
 * zustandsverändernden Anfragen, und diese Anfrage verändert nichts; die
 * vorhandenen GET-Endpunkte /admin und /api/auth/session verfahren genauso.
 * Das ist kein Verzicht auf Schutz: Das Sitzungscookie ist SameSite=Lax, eine
 * fremde Seite kann die Antwort mangels CORS-Kopfzeilen nicht lesen, und
 * no-store verhindert, dass sie irgendwo liegen bleibt. Eine CSRF-Prüfung auf
 * einem GET hätte den einzigen Effekt, dass die spätere Oberfläche einen
 * Token mitschicken müsste, um etwas zu LESEN.
 *
 * READ ONLY. Diese Datei schreibt nichts und hat keine Gegenrichtung.
 */
export async function productionDay(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'api');
  if (!wache.ok) {
    return wache.response;
  }

  const tag = readDay(request);
  if (tag === null) {
    return json({ error: 'invalid_date' }, 400, privateHeaders());
  }

  return json(toResponseBody(await getProductionDay(db, tag)), 200, privateHeaders());
}

/**
 * Liest den angefragten Kalendertag — oder null.
 *
 * EIN EINZIGER FEHLERCODE FÜR ALLE FÄLLE. „Format falsch" gegenüber „diesen
 * Tag gibt es nicht" wäre eine Auskunft ohne Zweck: Der Aufrufer ist ein
 * Admin mit einem Datumsfeld, und die Oberfläche kennt das erwartete Format.
 *
 * MEHRFACHE PARAMETER WERDEN ABGELEHNT, statt still den ersten zu nehmen.
 * `get()` liefert den ersten Treffer; welcher das ist, hängt an der
 * Reihenfolge in der URL. Ein Endpunkt, dessen Antwort von einer solchen
 * Feinheit abhängt, lädt zu Parameter-Schmuggel ein — und die Ablehnung
 * kostet eine Zeile.
 *
 * ES WIRD NICHTS UMGERECHNET. Der Wert kommt als Zeichenkette herein, wird
 * als Zeichenkette geprüft und als Zeichenkette weitergereicht. Genau deshalb
 * kann aus dem 25. hier nicht der 24. werden: Es gibt keine Zeitzone, durch
 * die er laufen könnte.
 */
function readDay(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('date');

  if (werte.length !== 1) {
    return null;
  }

  const wert = werte[0];
  return isCalendarDay(wert) ? wert : null;
}

/**
 * Die Grenze zwischen dem, was das System über einen Produktionstag weiß, und
 * dem, was den Worker verlässt.
 *
 * DIE FELDLISTE IST AUSGESCHRIEBEN, und das ist der Sinn dieser Funktion. Ein
 * `JSON.stringify(tag)` wäre kürzer und hätte eine unangenehme Eigenschaft:
 * Jedes Feld, das später ins Lesemodell wandert, stünde ohne Zutun in der
 * Antwort. So ist ein zusätzliches Feld eine bewusste Zeile hier — und ein
 * Test kann darauf bestehen, dass es genau diese sind.
 *
 * toCatalogView() und confirmation() machen es aus demselben Grund genauso.
 *
 * WAS HIER FEHLT, FEHLT ABSICHTLICH:
 *
 *   sortOrder      internes Sortiermerkmal. Die Reihenfolge der Liste IST die
 *                  Sortierung; die Zahl dazu braucht niemand.
 *   Preise         gibt es im Lesemodell gar nicht. Diese Antwort kann keinen
 *                  Preis preisgeben, weil keiner geladen wird.
 *   Kontaktdaten   werden nicht abgefragt.
 *   Kennungen      keine Bestell-ID, keine Kunden-ID, keine Positions-ID.
 *
 * snake_case auf der Leitung folgt POST /api/orders, das bereits
 * `order_number` und `fulfillment_date` liefert. Zwei Namenskonventionen in
 * einer API wären eine zu viel.
 */
function toResponseBody(tag: ProductionDay): unknown {
  return {
    date: tag.date,
    order_count: tag.orderCount,
    total_units: tag.totalUnits,
    products: tag.products.map((line) => ({
      product_id: line.productId,
      name: line.productName,
      unit: line.productUnit,
      quantity: line.quantity,
    })),
    orders: tag.orders.map((order) => ({
      order_number: order.orderNumber,
      customer_name: order.customerName,
      status: order.status,
      fulfillment_type: order.fulfillmentType,
      // Kundeneingabe, unverändert. Wer sie später in HTML rendert, escapet
      // sie — hier ist sie ein Datum und kein Markup.
      note: order.note,
      items: order.items.map((item) => ({
        product_id: item.productId,
        name: item.productName,
        unit: item.productUnit,
        quantity: item.quantity,
      })),
    })),
  };
}
