/**
 * Die einzige Stelle, an der eine Response entsteht. Damit haben alle
 * Antworten denselben Content-Type und dieselbe Form — und eine spätere
 * Fehlerbehandlung muss nicht an fünf Stellen nachgezogen werden.
 */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function notFound(): Response {
  return json({ error: 'not_found' }, 404);
}

/**
 * `allow` ist bei einer 405 vorgeschrieben und keine Höflichkeit: Ohne sie
 * weiß der Aufrufer nicht, womit es ginge.
 *
 * Die zusätzlichen Kopfzeilen sind optional, weil nicht jede 405 sie braucht.
 * Die Routen des Adminbereichs geben privateHeaders() mit — dort soll auch
 * eine Ablehnung no-store tragen, weil sie zu einem sitzungsgebundenen
 * Endpunkt gehört.
 */
export function methodNotAllowed(allowed: string, headers: HeadersInit = {}): Response {
  return json({ error: 'method_not_allowed' }, 405, { ...headers, allow: allowed });
}
