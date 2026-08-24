import type { AppConfig } from '../config/app-config';
import { renderAdminPage } from '../ui/admin-page-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/**
 * GET /admin
 *
 * Die gesamte Autorisierung steht in EINER Zeile — requireRole. Alles davor
 * und dahinter ist Rendern. Das ist die Absicht: Wer diese Datei liest, soll
 * die Sicherheitsentscheidung nicht suchen müssen, und wer sie entfernt, soll
 * es nicht übersehen können.
 *
 * Bewusst KEINE zusätzliche Prüfung auf `context.role === 'admin'` im
 * Anschluss: Die Wache hat sie schon geführt, und der Typ des Ergebnisses
 * hält sie fest. Eine zweite Prüfung wäre eine zweite Stelle, die irgendwann
 * von der ersten abweicht.
 */
export async function adminPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const wache = await requireRole(db, config, request, now, 'admin', 'html');
  if (!wache.ok) {
    return wache.response;
  }

  const html = renderAdminPage({
    loginIdentifier: wache.context.loginIdentifier,
    csrfToken: wache.context.csrfToken,
  });

  return new Response(html, { status: 200, headers: pageHeaders() });
}
