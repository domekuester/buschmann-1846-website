import type { AppConfig } from '../config/app-config';
import { loadAdminCatalog } from '../infrastructure/d1/catalog-pricing-repository';
import {
  loadLinkableCatalogProducts,
  loadProductLinks,
} from '../infrastructure/d1/product-catalog-link-repository';
import { renderAdminCatalogPage } from '../ui/admin-catalog-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/catalog — die Katalogpreise und, seit Phase 5D, der
 * Zuordnungsbereich darunter.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE: erst die
 * Rolle, dann die Daten. Wer keinen Zugang hat, löst keine einzige Abfrage
 * aus.
 *
 * DIE SEITE SCHREIBT NICHTS. Der Schreibvorgang steht in
 * http/admin-product-catalog-api.ts und ist ein eigener Endpunkt mit eigener
 * Origin- und CSRF-Prüfung; eine Seite, die nebenbei speichert, wäre über
 * einen vorgeladenen Link auslösbar.
 *
 * DREI ABFRAGEN FÜR DIE GANZE SEITE — §23, und sie bleiben drei, egal wie
 * viele Produkte, Katalogprodukte und Auswahloptionen es gibt:
 *
 *   1. die Katalogpreise (Bereich „Katalogpreise", unverändert seit 5A)
 *   2. die bestellbaren Produkte mit ihrer bestehenden Zuordnung
 *   3. die Katalogprodukte, die neu vergeben werden dürfen
 *
 * Sie laufen nebenläufig: Keine hängt vom Ergebnis einer anderen ab, und
 * nacheinander zu warten wäre reine Verzögerung. Die Zuordnung EINER Zeile
 * mit ihrer Auswahlliste zusammenzuführen ist danach reine Rechnerei in der
 * Oberfläche — und ausdrücklich keine vierte Abfrage je Zeile.
 */
export async function adminCatalogPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;

  const [products, productLinks, catalogChoices] = await Promise.all([
    loadAdminCatalog(db),
    loadProductLinks(db),
    loadLinkableCatalogProducts(db),
  ]);

  return new Response(renderAdminCatalogPage({
    loginIdentifier: guard.context.loginIdentifier,
    csrfToken: guard.context.csrfToken,
    products,
    productLinks,
    catalogChoices,
    noticeCode: readNotice(request),
  }), { status: 200, headers: pageHeaders() });
}

/**
 * Der Rückmeldungscode aus der Weiterleitung nach dem Speichern.
 *
 * ER WIRD HIER NICHT GEPRÜFT UND NICHT ÜBERSETZT — nur weitergereicht. Die
 * Oberfläche schlägt ihn in einer festen Tabelle nach und zeigt für einen
 * unbekannten Code gar nichts an; damit kann in der Meldung nichts stehen,
 * was nicht im Quelltext steht.
 *
 * MEHRFACHE PARAMETER ERGEBEN KEINE MELDUNG, statt still den ersten zu
 * nehmen — dieselbe Entscheidung wie bei der Kundenliste und beim Datum der
 * Produktionsansicht.
 */
function readNotice(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('notice');
  return werte.length === 1 ? (werte[0] ?? null) : null;
}
