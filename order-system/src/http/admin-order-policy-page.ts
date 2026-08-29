import type { AppConfig } from '../config/app-config';
import { loadOrderPolicy } from '../infrastructure/d1/order-policy-repository';
import { renderAdminOrderPolicyPage } from '../ui/admin-order-policy-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin/bestellregeln — die geltende Bestellrichtlinie.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE AUF JEDER ANDEREN ADMINSEITE: erst die
 * Rolle, dann die Daten. Wer keinen Zugang hat, löst keine einzige Abfrage
 * aus.
 *
 * EINE EINZIGE ABFRAGE, auf eine Tabelle mit einer Zeile. Die Seite zeigt,
 * was gilt, und rechnet den Beispielsatz aus derselben Regel — sie liest
 * dafür weder Bestellungen noch Kunden noch Produkte.
 *
 * DIE SEITE SCHREIBT NICHTS. Der Schreibvorgang steht in
 * http/admin-order-policy-api.ts und ist ein eigener Endpunkt mit eigener
 * Origin- und CSRF-Prüfung; eine Seite, die nebenbei speichert, wäre über
 * einen vorgeladenen Link auslösbar.
 *
 * `now` KOMMT VOM WORKER UND NICHT AUS new Date() HIER. Der Beispielsatz
 * nennt ein echtes künftiges Datum; käme die Uhr aus dieser Datei, wäre er
 * nicht mehr gegen einen festen Zeitpunkt prüfbar.
 */
export async function adminOrderPolicyPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) return wache.response;

  const { policy, updatedAt } = await loadOrderPolicy(db);

  return new Response(
    renderAdminOrderPolicyPage({
      loginIdentifier: wache.context.loginIdentifier,
      csrfToken: wache.context.csrfToken,
      policy,
      updatedAt,
      now,
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
 * nehmen — dieselbe Entscheidung wie auf der Kundenseite.
 */
function readNotice(request: Request): string | null {
  const werte = new URL(request.url).searchParams.getAll('notice');
  return werte.length === 1 ? (werte[0] ?? null) : null;
}
