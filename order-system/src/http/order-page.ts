import { toCatalogView } from '../application/catalog-view';
import { businessDay, plusDays } from '../domain/clock';
import { findCustomerByAccessToken } from '../infrastructure/d1/access-token-repository';
import { loadCatalog } from '../infrastructure/d1/product-repository';
import { renderInvalidLinkPage, renderOrderPage } from '../ui/order-page-html';
import { orderPageHeaders } from './security';

/**
 * Die Bestellseite.
 *
 * Ein einziger Roundtrip liefert alles: Café erkannt, Sortiment gerendert,
 * Liefertag vorbelegt, Absendekennung gesetzt. Danach braucht die Seite bis
 * zum Absenden keine Verbindung mehr — Mengen einstellen ist reine DOM-Arbeit.
 *
 * Ein ungültiger Zugang führt zu einer 404 mit einer freundlichen Seite. Nicht
 * zu 401: Ein 401 lädt zu einem Anmeldeverfahren ein, das es hier nicht gibt.
 * 404 ist die ehrliche Aussage — diesen Link gibt es nicht.
 *
 * Alle vier Ablehnungsgründe erzeugen dieselbe Antwort. Der Grund steht in
 * access-token-repository.ts: Jede Unterscheidung wäre eine Auskunft.
 */
export async function orderPage(db: D1Database, token: string, now: Date): Promise<Response> {
  const customer = await findCustomerByAccessToken(db, token);

  if (customer === null) {
    return new Response(renderInvalidLinkPage(), { status: 404, headers: orderPageHeaders() });
  }

  const catalog = await loadCatalog(db);
  const today = businessDay(now);

  const html = renderOrderPage({
    customerName: customer.name,
    products: toCatalogView(catalog),

    /**
     * Serverseitig erzeugt, einmal je Seitenaufruf. Nicht im Client: Ein
     * Client, der bei jedem Klick eine neue Kennung erzeugte, hätte
     * lediglich zwei Kennungen für dieselbe Absicht und wäre gegen
     * Doppelklicks ungeschützt.
     */
    submissionId: crypto.randomUUID(),

    today,

    /**
     * Vorbelegt mit morgen. Das ist der mit Abstand häufigste Fall und spart
     * einen Tap — der Wert steht sichtbar im Feld, in der Zusammenfassung und
     * in der Bestätigung, sodass ein abweichender Tag nicht übersehen werden
     * kann.
     */
    defaultDate: plusDays(today, 1),
  });

  return new Response(html, { status: 200, headers: orderPageHeaders() });
}
