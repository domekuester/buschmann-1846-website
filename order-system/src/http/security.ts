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
     * same-origin statt no-referrer — und das ist eine Korrektur, keine
     * Lockerung.
     *
     * Phase 2 setzte 'no-referrer', weil das Geheimnis in der URL stand:
     * /o/<token>. Ein abfließender Referer wäre dort ein abfließender Zugang
     * gewesen. Seit Phase 3A steht in keiner URL mehr ein Geheimnis — der
     * Sitzungstoken liegt im Cookie.
     *
     * DER GRUND FÜR DIE ÄNDERUNG IST EIN BEFUND AUS DEM BROWSER:
     *
     * Nach dem Fetch-Standard wird der Origin einer Anfrage als 'null'
     * serialisiert, wenn die Referrer-Policy 'no-referrer' lautet. Ein echtes
     * `<form method="post">` schickte damit `Origin: null` — und die
     * Origin-Prüfung lehnte jede Anmeldung ab. In den Worker-Tests fiel das
     * nicht auf, weil sie die Kopfzeile selbst setzen; erst der Browser hat
     * es gezeigt.
     *
     * 'same-origin' sendet einen Referer ausschließlich an die eigene
     * Herkunft und an keinen fremden Host. Der Verlust gegenüber
     * 'no-referrer' ist damit auf Anfragen beschränkt, die ohnehin an uns
     * selbst gehen — und die CSP mit `default-src 'none'` lässt gar keine
     * fremden Anfragen zu. Eingetauscht wird das gegen eine funktionierende
     * CSRF-Abwehr, und das ist kein knapper Handel.
     *
     * DIESE KOPFZEILE IST DIE EINZIGE QUELLE DER POLICY. Die Seitengerüste
     * trugen zusätzlich ein `<meta name="referrer">`, und das Meta-Tag
     * gewinnt gegenüber der Kopfzeile — die Korrektur hier blieb deshalb
     * zunächst wirkungslos. Eine Regel an zwei Orten ist eine Regel, von der
     * eine Hälfte irgendwann vergessen wird; das Meta-Tag ist entfernt.
     */
    'referrer-policy': 'same-origin',

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
 * verboten — Bilder, Frames, Medien, Verbindungen zu fremden Hosts. Erlaubt
 * sind ausschließlich eigene Stylesheets, Skripte und lokale Markenschriften.
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
  "font-src 'self'",
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
