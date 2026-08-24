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

export function methodNotAllowed(allowed: string): Response {
  return json({ error: 'method_not_allowed' }, 405, { allow: allowed });
}
