import type { AppConfig } from '../config/app-config';
import { loadAdminCustomerWorkspace } from '../infrastructure/d1/admin-customer-repository';
import { loadAssignablePriceGroups } from '../infrastructure/d1/customer-price-group-repository';
import { renderAdminCustomersPage } from '../ui/admin-customers-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/customers — Kunden und ihre Preisgruppen.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE: erst die
 * Rolle, dann die Daten. Wer keinen Zugang hat, löst keine einzige Abfrage
 * aus.
 *
 * Die Seite SCHREIBT NICHTS. Der Schreibvorgang steht in
 * http/admin-customer-api.ts und ist ein eigener Endpunkt mit eigener
 * Origin- und CSRF-Prüfung; eine Seite, die nebenbei speichert, wäre über
 * einen vorgeladenen Link auslösbar.
 *
 * ZWEI ABFRAGEN UND NICHT EINE: die Kunden mit ihrer bestehenden Zuordnung,
 * und getrennt davon die Preisgruppen, die NEU vergeben werden dürfen. Das
 * ist genau der Unterschied, den §15 verlangt — eine inaktiv gewordene
 * Zuordnung bleibt sichtbar, taucht aber in keiner Auswahlliste eines anderen
 * Kunden auf.
 */
export async function adminCustomersPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) return wache.response;

  const [customers, priceGroups] = await Promise.all([
    loadAdminCustomerWorkspace(db),
    loadAssignablePriceGroups(db),
  ]);

  return new Response(
    renderAdminCustomersPage({
      loginIdentifier: wache.context.loginIdentifier,
      csrfToken: wache.context.csrfToken,
      customers,
      priceGroups,
      noticeCode: readNotice(request),
    }),
    { status: 200, headers: pageHeaders() },
  );
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
 * nehmen — dieselbe Entscheidung wie beim Datum der Produktionsansicht.
 */
function readNotice(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('notice');
  return werte.length === 1 ? (werte[0] ?? null) : null;
}
