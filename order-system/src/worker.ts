import { readAppConfig } from './config/app-config';
import { loginPage, loginSubmit, logout } from './http/auth-routes';
import { health } from './http/health';
import { toSafeResponse } from './http/error-boundary';
import { createOrder } from './http/order-api';
import { orderPage } from './http/order-page';
import { methodNotAllowed, notFound } from './http/responses';

/**
 * Die äußere Hülle des Systems — und bewusst nicht mehr als das.
 *
 * Hier steht keine Geschäftslogik, keine Preisberechnung und keine
 * Validierung. Der Worker nimmt eine Anfrage entgegen, entscheidet über den
 * Pfad und gibt eine Antwort zurück. Alles Fachliche liegt in src/domain/ und
 * ist ohne Request, Worker-Kontext und D1 testbar; genau das prüft das
 * Vitest-Projekt "domain", das ohne Worker-Runtime läuft.
 *
 * Die Pfade, und jeder hat einen Grund:
 *
 *   GET  /api/health   unverändert aus Phase 1. Braucht als einziger KEINE
 *                      Auth-Konfiguration — sonst wäre nicht zu unterscheiden,
 *                      ob der Worker läuft oder nur falsch eingerichtet ist.
 *   GET  /login        die Loginseite. Ein echtes Formular, kein Skript.
 *   POST /login        die Anmeldung.
 *   POST /logout       die Abmeldung. Niemals GET — ein GET-Logout wird von
 *                      Link-Prefetch und Virenscannern ausgelöst.
 *   GET  /o/<token>    die Phase-2-Bestellseite. Noch da, bis der
 *                      sitzungsbasierte Weg vollständig nachgewiesen ist.
 *   POST /api/orders   die Bestellung.
 *
 * /assets/* taucht hier nicht auf: Diese Dateien liefert die Plattform aus,
 * bevor der Worker überhaupt erreicht wird (siehe wrangler.jsonc).
 *
 * DIE KONFIGURATION WIRD FRÜH GELESEN UND KANN WERFEN.
 *
 * readAppConfig prüft Pepper, Origin und Umgebung und bricht ab, wenn etwas
 * fehlt oder sich widerspricht. Der Aufruf steht INNERHALB des try, damit
 * daraus eine 500 ohne Details wird — und NACH /api/health, damit ein
 * falsch konfigurierter Worker immer noch sagen kann, dass er läuft.
 *
 * Der try/catch ist die einzige Fehlergrenze des Systems. Was hier ankommt,
 * kann ein D1-Fehler mit SQL-Fragment oder ein Stacktrace mit Dateipfaden
 * sein; toSafeResponse sorgt dafür, dass nichts davon den Worker verlässt.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = new Date();

    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET') {
          return methodNotAllowed('GET');
        }
        return await health(env.DB);
      }

      const config = readAppConfig(env);

      if (pathname === '/login') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          return await loginPage(env.DB, config, request, now);
        }
        if (request.method === 'POST') {
          return await loginSubmit(env.DB, config, request, now);
        }
        return methodNotAllowed('GET, POST');
      }

      if (pathname === '/logout') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST');
        }
        return await logout(env.DB, config, request, now);
      }

      if (pathname === '/api/orders') {
        if (request.method !== 'POST') {
          return methodNotAllowed('POST');
        }
        return await createOrder(env.DB, request, now);
      }

      const token = orderPageToken(pathname);
      if (token !== null) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed('GET');
        }
        return await orderPage(env.DB, token, now);
      }

      return notFound();
    } catch (error) {
      return toSafeResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Zieht den Token aus '/o/<token>' — und zwar nur aus genau dieser Form.
 *
 * Kein Präfixvergleich: '/o/abc/def' und '/o/' sind keine Bestellseiten und
 * dürfen es auch nicht beinahe sein. Die inhaltliche Prüfung des Tokens
 * passiert danach in der Domäne; hier geht es allein um die Pfadform.
 */
function orderPageToken(pathname: string): string | null {
  const match = /^\/o\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}
