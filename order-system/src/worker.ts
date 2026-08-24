import { health } from './http/health';
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
 * Phase 1 kennt genau einen Endpunkt. Eine Bestell-API gibt es noch nicht —
 * ein Endpunkt ohne Nutzen wäre nur eine Zusage, die später eingehalten
 * werden müsste.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      if (request.method !== 'GET') {
        return methodNotAllowed('GET');
      }
      return health(env.DB);
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;
