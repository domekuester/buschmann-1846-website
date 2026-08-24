import { toCatalogView } from '../application/catalog-view';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays } from '../domain/clock';
import { loadCatalog } from '../infrastructure/d1/product-repository';
import { renderOrderPage } from '../ui/order-page-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * Die Bestellseite.
 *
 * Ein einziger Roundtrip liefert alles: Café erkannt, Sortiment gerendert,
 * Liefertag vorbelegt, Absendekennung gesetzt, CSRF-Token mitgegeben. Danach
 * braucht die Seite bis zum Absenden keine Verbindung mehr — Mengen einstellen
 * ist reine DOM-Arbeit.
 *
 * DER KUNDE KOMMT AUS DER SITZUNG.
 *
 * In Phase 2 stand er im Link; wer den Link hatte, war das Café. Jetzt steht
 * er in der Sitzung, und die Sitzung wird bei JEDEM Aufruf frisch geprüft:
 * Rolle, Konto-Aktivität, Café-Aktivität. Ein deaktiviertes Café sieht diese
 * Seite deshalb nicht mehr — nicht erst beim Absenden, sondern sofort.
 *
 * Es gibt in dieser Datei keinen Parameter, über den sich der Kunde
 * beeinflussen ließe. Das ist keine Prüfung, die man vergessen könnte,
 * sondern ein fehlender Eingang.
 */
export async function orderPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'customer', 'html');
  if (!wache.ok) {
    return wache.response;
  }


  const catalog = await loadCatalog(db);
  const today = businessDay(now);

  const html = renderOrderPage({
    customerName: wache.context.customer.name,
    products: toCatalogView(catalog),

    /**
     * Serverseitig erzeugt, einmal je Seitenaufruf. Nicht im Client: Ein
     * Client, der bei jedem Klick eine neue Kennung erzeugte, hätte
     * lediglich zwei Kennungen für dieselbe Absicht und wäre gegen
     * Doppelklicks ungeschützt.
     */
    submissionId: crypto.randomUUID(),

    /**
     * Der Synchronizer-Token der Sitzung. Er steht LESBAR im Dokument, weil
     * das Client-Skript ihn zurücksenden muss — im Unterschied zum
     * Sitzungstoken, der HttpOnly im Cookie bleibt und hier nirgends
     * auftaucht.
     */
    csrfToken: wache.context.csrfToken,

    today,

    /**
     * Vorbelegt mit morgen. Das ist der mit Abstand häufigste Fall und spart
     * einen Tap — der Wert steht sichtbar im Feld, in der Zusammenfassung und
     * in der Bestätigung, sodass ein abweichender Tag nicht übersehen werden
     * kann.
     */
    defaultDate: plusDays(today, 1),
  });

  return new Response(html, { status: 200, headers: pageHeaders() });
}
