import { authenticateRequest, type AuthContext } from '../application/authenticate-request';
import type { AppConfig } from '../config/app-config';
import type { AuthRole } from '../domain/auth-role';
import { constantTimeEquals } from '../infrastructure/auth/constant-time';
import { clearSessionCookie, readSessionCookie } from '../infrastructure/auth/cookie';
import { renderForbiddenPage } from '../ui/notice-page-html';
import { json } from './responses';
import { pageHeaders, privateHeaders } from './security';

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

/**
 * Das Ergebnis einer Rollenprüfung.
 *
 * Ein Verbund und keine Ausnahme: Die Ablehnungen brauchen verschiedene
 * Antworten — eine Weiterleitung zum Login, eine Ablehnungsseite, ein JSON —,
 * und die über Fehlerarten zu unterscheiden hieße, drei Ausnahmetypen für
 * drei Antworten zu erfinden. So steht die Antwort dort, wo die Entscheidung
 * fällt.
 *
 * Der `ok`-Diskriminator zwingt jeden Aufrufer, beide Fälle zu behandeln: Es
 * gibt keinen Weg, das Ergebnis zu ignorieren und trotzdem an den Kontext zu
 * kommen.
 */
export type GuardResult<C extends AuthContext = AuthContext> =
  | { readonly ok: true; readonly context: C }
  | { readonly ok: false; readonly response: Response };

/**
 * Der Kontext, der zu einer Rolle gehört.
 *
 * Damit trägt das ERGEBNIS der Wache die Rolle, die sie geprüft hat: Wer
 * requireRole(..., 'customer', ...) aufruft und `ok` bekommt, hat einen
 * Kontext MIT Kunden — ohne zweite Prüfung, ohne Typzusicherung, ohne die
 * Möglichkeit, es zu vergessen. Die Autorisierung steht damit nicht nur zur
 * Laufzeit fest, sondern schon beim Übersetzen.
 */
export type ContextForRole<R extends AuthRole> = Extract<AuthContext, { role: R }>;

/** Seite oder Schnittstelle — davon hängt ab, wie eine Ablehnung aussieht. */
export type RequestKind = 'html' | 'api';

/**
 * Die Rollenprüfung. SERVERSEITIG, AN JEDEM GESCHÜTZTEN ENDPUNKT.
 *
 * Ein versteckter Button ist keine Autorisierung. Eine Navigation, die einen
 * Link nicht anzeigt, ist keine Autorisierung. Nur diese Funktion ist eine.
 *
 * DREI AUSGÄNGE, UND JEDER SAGT ETWAS ANDERES:
 *
 *   keine Sitzung, Seite   303 auf /login. Das Cookie wird dabei gelöscht —
 *                          sonst schickt der Browser einen abgelaufenen Token
 *                          bei jedem Request wieder mit, und die
 *                          Weiterleitung sähe für den Benutzer aus wie eine
 *                          Schleife.
 *   keine Sitzung, API     401. Ein fetch, der eine Loginseite als HTML
 *                          zurückbekäme, verarbeitete sie als Nutzdaten.
 *   falsche Rolle          403 — und ausdrücklich KEINE Weiterleitung zum
 *                          Login. Wer angemeldet ist, hat kein
 *                          Anmeldeproblem; ihn zum Login zu schicken wäre
 *                          verwirrend und zugleich die Auskunft, dass die
 *                          Route existiert und nur die Rolle fehlt. Die
 *                          Sitzung bleibt bestehen: Ein Tippfehler in der
 *                          Adresszeile darf niemanden abmelden.
 */
export async function requireRole<R extends AuthRole>(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  role: R,
  kind: RequestKind,
): Promise<GuardResult<ContextForRole<R>>> {
  const angemeldet = await requireSession(db, config, request, now, kind);
  if (!angemeldet.ok) {
    return angemeldet;
  }

  if (angemeldet.context.role !== role) {
    return { ok: false, response: falscheRolle(kind) };
  }

  // Der Laufzeitvergleich oben stellt genau das sicher, was hier behauptet
  // wird. TypeScript kann eine Verengung über eine generische Variable nicht
  // selbst führen — das ist die einzige Zusicherung in dieser Datei, und sie
  // steht unmittelbar hinter ihrer Begründung.
  return { ok: true, context: angemeldet.context as ContextForRole<R> };
}

/**
 * Verlangt eine gültige Sitzung — ohne Aussage über die Rolle.
 *
 * Genau EIN Endpunkt braucht das: `GET /api/auth/session` beantwortet „wer
 * bin ich?" und muss dafür beide Rollen zulassen. Ihn über zwei
 * requireRole-Aufrufe zu bauen hätte funktioniert und dabei zwei
 * Datenbankrunden für eine Frage gekostet.
 *
 * Diese Funktion ist ausdrücklich KEIN allgemeiner Ersatz für requireRole.
 * Wer eine geschützte Seite oder API baut, nennt die Rolle — sonst steht die
 * Autorisierung wieder in der Zuständigkeit des Aufrufers, und genau davon
 * soll die Wache befreien.
 */
export async function requireSession(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  kind: RequestKind,
): Promise<GuardResult> {
  const token = readSessionCookie(config, request.headers.get('cookie'));
  const context = await authenticateRequest(db, token, now);

  if (context === null) {
    return { ok: false, response: nichtAngemeldet(config, kind) };
  }

  return { ok: true, context };
}

function nichtAngemeldet(config: AppConfig, kind: RequestKind): Response {
  const cookieLoeschen = { 'set-cookie': clearSessionCookie(config) };

  if (kind === 'api') {
    return json({ error: 'unauthorized' }, 401, privateHeaders(cookieLoeschen));
  }

  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: '/login', ...cookieLoeschen }),
  });
}

function falscheRolle(kind: RequestKind): Response {
  if (kind === 'api') {
    return json({ error: 'forbidden' }, 403, privateHeaders());
  }

  return new Response(renderForbiddenPage(), { status: 403, headers: pageHeaders() });
}
