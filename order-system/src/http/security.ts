/**
 * Die Kopfzeilen, die jede tokenbezogene Antwort trägt.
 *
 * „Sitzungsbezogen" heißt: Der Inhalt hängt daran, WER fragt. Das gilt für
 * Login, Bestellseite, Adminbereich und alle authentifizierten APIs — nicht
 * für /assets/*, die für alle identisch sind und ihre Kopfzeilen aus
 * public/_headers bekommen.
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
     * Seit Phase 3A steht kein Geheimnis mehr in der URL — der Token liegt im
     * Cookie. Die Zeile bleibt trotzdem: Ein Referer verrät auch ohne
     * Geheimnis, DASS jemand /bestellen oder /admin geöffnet hat, und diese
     * Seiten lösen ohnehin keine Anfrage an einen fremden Host aus. Was
     * nicht gesendet wird, kann nichts mitnehmen.
     */
    'referrer-policy': 'no-referrer',

    'x-content-type-options': 'nosniff',

    /** Kein Einbetten. Zusammen mit frame-ancestors in der CSP. */
    'x-frame-options': 'DENY',

    /** Angemeldete Seiten gehören in keinen Suchindex. */
    'x-robots-tag': 'noindex, nofollow',

    ...extra,
  };
}

/**
 * Die Richtlinie aller angemeldeten Seiten — Login, Bestellung, Adminbereich.
 *
 * Ausgangspunkt ist 'none': Alles, was nicht ausdrücklich erlaubt ist, ist
 * verboten — Bilder, Schriften, Frames, Medien, Verbindungen zu fremden
 * Hosts. Erlaubt sind ausschließlich eigene Stylesheets und Skripte.
 *
 * Kein 'unsafe-inline' und kein Nonce, weil es nichts Inline gibt: CSS und JS
 * liegen als eigene Dateien unter /assets/.
 *
 * FORM-ACTION 'SELF' STATT 'NONE' — die eine Änderung gegenüber Phase 2.
 *
 * Phase 2 kannte kein echtes Formular: Die Bestellung ging ausschließlich per
 * fetch hinaus, eine native Absendung wäre ein Fehler gewesen, und 'none'
 * hielt das fest. Mit der First-Party-Anmeldung gibt es echte Formulare —
 * `POST /login` und `POST /logout` sind bewusst keine fetch-Aufrufe, damit
 * die Anmeldung ohne JavaScript funktioniert.
 *
 * 'self' ist die kleinste Erlaubnis, die das zulässt: Ein Formular darf zum
 * eigenen Ursprung absenden und zu keinem anderen. Ein untergeschobenes
 * `action="https://angreifer.test/"` — der klassische Weg, ein Passwort aus
 * einer XSS-Lücke herauszutragen — bleibt damit blockiert.
 */
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const APP_PERMISSIONS = 'geolocation=(), camera=(), microphone=(), payment=()';

/**
 * Die Kopfzeilen jeder HTML-Antwort, deren Inhalt davon abhängt, WER fragt.
 *
 * Das sind inzwischen vier Seiten — Login, Bestellung, Adminbereich und die
 * Ablehnungsseiten. Sie teilen sich eine Funktion und nicht vier ähnliche:
 * Vier Fassungen wären vier Gelegenheiten, bei einer davon `no-store` zu
 * vergessen.
 */
export function pageHeaders(): Record<string, string> {
  return privateHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': APP_CSP,
    'permissions-policy': APP_PERMISSIONS,
  });
}
