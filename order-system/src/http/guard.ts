import type { AuthContext } from '../application/authenticate-request';
import type { AppConfig } from '../config/app-config';
import { constantTimeEquals } from '../infrastructure/auth/constant-time';

/**
 * Die Prüfungen, die jeder ZUSTANDSVERÄNDERNDE Request bestehen muss.
 *
 * Mit einem Sitzungscookie entsteht CSRF-Risiko: Ein Browser schickt Cookies
 * von sich aus mit, auch wenn die Anfrage von einer fremden Seite ausgelöst
 * wurde. In Phase 2 gab es dieses Risiko nicht — dort trug ein HEADER die
 * Autorisierung, und den kann ein fremdes Formular nicht setzen. Der Wechsel
 * auf eine Sitzung bringt das Problem zurück, und diese Datei ist die
 * Antwort.
 *
 * DREI SCHICHTEN, NICHT EINE:
 *
 *   SameSite=Lax   im Cookie (siehe infrastructure/auth/cookie.ts). Der
 *                  Browser schickt das Cookie bei einem fremd ausgelösten
 *                  POST gar nicht erst mit.
 *   Origin         diese Datei. Was trotzdem ankommt, muss vom eigenen
 *                  Ursprung kommen.
 *   CSRF-Token     diese Datei. Ein Wert, den nur bekommt, wer die Seite
 *                  tatsächlich geladen hat.
 *
 * Jede einzelne Schicht wäre für sich vertretbar. Alle drei zusammen sind
 * der Grund, warum ein Fehler in einer davon nicht sofort ein Vorfall ist.
 */

/**
 * Der Aufrufer darf nicht, was er versucht — oder er beweist nicht, dass er
 * es darf.
 *
 * Der Fehler trägt bewusst KEINE Angabe darüber, welche der Prüfungen
 * fehlgeschlagen ist. „Origin falsch" gegenüber „CSRF-Token falsch" wäre eine
 * Anleitung.
 */
export class ForbiddenError extends Error {
  constructor(message = 'Diese Anfrage ist nicht zulässig.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Es fehlt eine gültige Sitzung.
 *
 * Getrennt von ForbiddenError, weil die HTTP-Schicht daraus etwas anderes
 * macht: 401 bei einer API, Weiterleitung zum Login bei einer Seite. „Melde
 * dich an" und „das darfst du nicht" sind zwei verschiedene Aussagen.
 */
export class UnauthenticatedError extends Error {
  constructor(message = 'Für diese Anfrage wird eine Anmeldung gebraucht.') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Der Request muss vom eigenen Ursprung kommen.
 *
 * DER VERGLEICH IST EXAKT. Kein startsWith, kein Vergleich der Hosts, keine
 * Nachsicht bei Groß- und Kleinschreibung. 'https://buschmann1846.de.angreifer.test'
 * beginnt mit dem erwarteten Origin und gehört jemand anderem.
 *
 * EIN FEHLENDER ORIGIN WIRD ABGELEHNT. Bei einem POST aus einem modernen
 * Browser kommt er nicht vor; „vielleicht ist es ein alter Browser" wäre die
 * Lücke, durch die dann jedes Skript passt. Auch der wörtliche Wert 'null' —
 * den ein sandboxed iframe sendet — ist kein gültiger Ursprung.
 *
 * FAIL CLOSED: Ist kein Origin konfiguriert, gibt es nichts zu vergleichen,
 * und dann wird abgelehnt. Eine Ableitung aus `request.url` wäre keine
 * Prüfung, sondern eine Zeremonie — der Wert käme vom Aufrufer selbst.
 *
 * Kein Rückfall auf `Referer`: Der Header ist optional, wird von
 * Datenschutzeinstellungen entfernt und ist damit als Prüfgrundlage
 * unbrauchbar. Die eigene Referrer-Policy setzt ihn ohnehin auf 'no-referrer'.
 */
export function assertSameOrigin(request: Request, config: AppConfig): void {
  if (config.appOrigin.length === 0) {
    throw new ForbiddenError();
  }

  const origin = request.headers.get('origin');
  if (origin === null || origin !== config.appOrigin) {
    throw new ForbiddenError();
  }
}

/** Die Kopfzeile für fetch-Anfragen — die Bestell-API benutzt sie. */
const CSRF_HEADER = 'x-csrf-token';

/** Das Formularfeld für echte Formulare — Login und Logout benutzen es. */
const CSRF_FIELD = 'csrf_token';

/**
 * Der Synchronizer-Token muss zur Sitzung passen.
 *
 * ZWEI WEGE, EIN WERT: Ein `fetch` schickt ihn als Kopfzeile, ein echtes
 * `<form method="post">` als verstecktes Feld. Ein Formular kann keine
 * Kopfzeilen setzen, ein fetch soll den Körper nicht dafür umbauen müssen —
 * deshalb beide.
 *
 * Die KOPFZEILE hat Vorrang. Beides gleichzeitig kommt nicht vor; wenn doch,
 * gewinnt der Wert, der nicht aus dem Formularkörper stammt.
 *
 * Der Token ist an die SITZUNG gebunden und liegt in D1, nicht in einem
 * zweiten Cookie. Ein Double-Submit-Cookie wäre gegen einen Angreifer auf
 * einer Subdomain schwächer: Der kann Cookies für die Hauptdomain setzen und
 * damit beide Seiten der Gleichung bestimmen. Einen Wert aus der
 * Sitzungszeile kann er nicht.
 */
export function assertCsrf(
  request: Request,
  context: AuthContext,
  body?: URLSearchParams | undefined,
): void {
  const kopfzeile = request.headers.get(CSRF_HEADER);
  const mitgeschickt = kopfzeile ?? body?.get(CSRF_FIELD) ?? null;

  if (mitgeschickt === null || !constantTimeEquals(mitgeschickt, context.csrfToken)) {
    throw new ForbiddenError();
  }
}
