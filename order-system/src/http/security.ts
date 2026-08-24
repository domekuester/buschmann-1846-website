/**
 * Die Kopfzeilen, die jede tokenbezogene Antwort trägt.
 *
 * „Tokenbezogen" heißt: Der Inhalt hängt daran, WER fragt. Das gilt für die
 * Bestellseite und für die Bestell-API — nicht für /assets/*, die für alle
 * Cafés identisch sind und ihre Kopfzeilen aus public/_headers bekommen.
 */
export function privateHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    /**
     * no-store, nicht no-cache: no-cache erlaubt das Ablegen und verlangt nur
     * eine Rückfrage. Diese Antworten sollen gar nicht erst irgendwo liegen —
     * weder in einem Zwischenspeicher noch im Browser eines geteilten
     * Tresengeräts.
     */
    'cache-control': 'no-store',

    /**
     * Der Token steht in der URL. Ohne diese Zeile stünde er in der
     * Referer-Kopfzeile jeder Anfrage, die die Seite auslöst. Die Seite löst
     * bewusst keine an fremde Hosts aus — das hier ist die zweite
     * Verteidigungslinie, nicht die erste.
     */
    'referrer-policy': 'no-referrer',

    'x-content-type-options': 'nosniff',

    /** Kein Einbetten. Zusammen mit frame-ancestors in der CSP. */
    'x-frame-options': 'DENY',

    /** Ein indexierter /o/<token> wäre ein Sicherheitsvorfall. */
    'x-robots-tag': 'noindex, nofollow',

    ...extra,
  };
}

/**
 * Die Richtlinie der Bestellseite.
 *
 * Ausgangspunkt ist 'none': Alles, was nicht ausdrücklich erlaubt ist, ist
 * verboten — Bilder, Schriften, Frames, Medien, Verbindungen zu fremden
 * Hosts. Erlaubt sind ausschließlich eigene Stylesheets und Skripte.
 *
 * Kein 'unsafe-inline' und kein Nonce, weil es nichts Inline gibt: CSS und JS
 * liegen als eigene Dateien unter /assets/.
 *
 * form-action 'none' ist Absicht und keine Härte um ihrer selbst willen: Das
 * Formular wird ausschließlich per fetch abgesendet. Eine native Absendung
 * wäre ein Fehler — sie würde die Seite verlassen und die eingegebenen Mengen
 * mitnehmen.
 */
export const ORDER_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const ORDER_PAGE_PERMISSIONS = 'geolocation=(), camera=(), microphone=(), payment=()';

/** Die Kopfzeilen einer HTML-Antwort der Bestelloberfläche. */
export function orderPageHeaders(): Record<string, string> {
  return privateHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': ORDER_PAGE_CSP,
    'permissions-policy': ORDER_PAGE_PERMISSIONS,
  });
}
