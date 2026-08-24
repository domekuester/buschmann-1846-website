import { authenticateRequest, type AuthContext } from '../application/authenticate-request';
import { logIn } from '../application/log-in';
import type { AppConfig } from '../config/app-config';
import type { AuthRole } from '../domain/auth-role';
import {
  clearSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
} from '../infrastructure/auth/cookie';
import { revokeSession } from '../infrastructure/d1/auth-session-repository';
import { GENERIC_LOGIN_ERROR, renderLoginPage } from '../ui/login-page-html';
import { UnauthenticatedError, assertCsrf, assertSameOrigin } from './guard';
import { json } from './responses';
import { pageHeaders, privateHeaders } from './security';

/**
 * Die Routen der Anmeldung.
 *
 *   GET  /login    das Formular — oder eine Weiterleitung, wenn schon
 *                  angemeldet.
 *   POST /login    die Anmeldung. Ein echtes Formular, kein fetch.
 *   POST /logout   die Abmeldung. Niemals GET.
 *
 * Alles im selben Tab, alles auf derselben Domain. Es gibt keine externe
 * Loginseite, kein Popup und keine Weiterleitung zu einem fremden Anbieter.
 */

/**
 * Wohin jemand nach der Anmeldung geht — eine Funktion der ROLLE und sonst
 * nichts.
 *
 * Es gibt bewusst KEIN `next`-Konzept. Ein solches bräuchte einen Parser für
 * fremde Eingaben und eine Allowlist, die jemand pflegt — und beides ist der
 * übliche Weg zu einem Open Redirect. Bei zwei Rollen mit je einem Ziel ist
 * der Gewinn null: Wer `/admin` ohne Sitzung aufruft, landet nach der
 * Anmeldung ohnehin auf `/admin`, weil das das Adminziel ist.
 */
const ZIEL: Readonly<Record<AuthRole, string>> = {
  customer: '/bestellen',
  admin: '/admin',
};

/**
 * 303 und nicht 302: Nach einem POST soll der Browser dem Ziel mit GET
 * folgen. Ein 302 überlässt das der Auslegung, und manche Clients wiederholen
 * dann den POST.
 */
function seeOther(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location, ...extra }),
  });
}

function loginSeite(errorMessage: string | null, status = 200): Response {
  return new Response(renderLoginPage({ errorMessage }), { status, headers: pageHeaders() });
}

/** Liest die aktuelle Sitzung — oder null. */
async function aktuelleSitzung(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<AuthContext | null> {
  const token = readSessionCookie(config, request.headers.get('cookie'));
  return authenticateRequest(db, token, now);
}

/**
 * GET /login
 *
 * Wer schon angemeldet ist, sieht kein Formular. Das ist keine Bequemlichkeit,
 * sondern verhindert den häufigsten Bedienfehler: sich ein zweites Mal
 * anzumelden und dabei die laufende Sitzung zu ersetzen.
 */
export async function loginPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const kontext = await aktuelleSitzung(db, config, request, now);
  if (kontext !== null) {
    return seeOther(ZIEL[kontext.role]);
  }

  return loginSeite(null);
}

/**
 * POST /login
 *
 * KEIN CSRF-TOKEN, UND DAS IST RICHTIG.
 *
 * Vor der Anmeldung gibt es keine Sitzung und damit nichts, woran ein
 * Synchronizer-Token hängen könnte. Ein Pre-Session-Cookie nur für diesen
 * Zweck wäre ein zweites Cookie mit eigenem Lebenszyklus und eigener
 * Fehlerquelle. Login-CSRF ist zudem die deutlich schwächere Bedrohung: Ein
 * Angreifer kann ein Opfer höchstens in SEINEN EIGENEN Account einloggen.
 * Dagegen wirken `SameSite=Lax` und die Origin-Prüfung, die hier verbindlich
 * ist.
 *
 * Der Statuscode einer Ablehnung ist 200 und nicht 401: Die Antwort IST die
 * Loginseite, und ein 401 ohne WWW-Authenticate ist eine Aussage, die kein
 * Browser sinnvoll auswertet. Wichtiger als der Code ist ohnehin, dass alle
 * Ablehnungsgründe byteweise dieselbe Antwort erzeugen.
 */
export async function loginSubmit(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  assertSameOrigin(request, config);

  const body = await formularKoerper(request);

  /**
   * Eine mitgeschickte Sitzung wird an logIn durchgereicht und dort
   * WIDERRUFEN, nicht übernommen — der Schutz gegen Session Fixation. Sie
   * wird hier bewusst nicht geprüft: Wer sich anmeldet, will sich anmelden,
   * auch wenn er noch eine gültige Sitzung hat.
   */
  const ergebnis = await logIn(db, config, {
    identifier: body.get('identifier'),
    secret: body.get('secret'),
    now,
    existingSessionToken: readSessionCookie(config, request.headers.get('cookie')),
  });

  if (ergebnis === null) {
    return loginSeite(GENERIC_LOGIN_ERROR);
  }

  return seeOther(ZIEL[ergebnis.role], {
    'set-cookie': serializeSessionCookie(config, ergebnis.token, ergebnis.maxAgeSeconds),
  });
}

/**
 * POST /logout
 *
 * Die Sitzung wird in D1 WIDERRUFEN, nicht nur das Cookie gelöscht. Ein
 * gelöschtes Cookie beendet nur, was dieser Browser weiß; der Token bliebe
 * gültig, und wer ihn hätte, bliebe angemeldet.
 *
 * Ohne Sitzung: 401. Nicht etwa „ist ja schon abgemeldet, dann eben 303" —
 * denn ohne Sitzung gibt es auch keinen CSRF-Token, und ein Endpunkt, der
 * ohne beides antwortet, ist einer ohne Prüfung.
 */
export async function logout(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  assertSameOrigin(request, config);

  const kontext = await aktuelleSitzung(db, config, request, now);
  if (kontext === null) {
    throw new UnauthenticatedError();
  }

  const body = await formularKoerper(request);
  assertCsrf(request, kontext, body);

  await revokeSession(db, kontext.sessionId, now);

  return seeOther('/login', { 'set-cookie': clearSessionCookie(config) });
}

/**
 * Der Körper eines echten Formulars.
 *
 * Ein abweichender Content-Type ist eine 415 und keine Nachsicht: Diese
 * Routen sind für `<form method="post">` gebaut, und ein JSON-Körper wäre ein
 * Aufrufer, der etwas anderes vorhat.
 *
 * Die Größengrenze ist großzügig und trotzdem da — ein Anmeldeformular mit
 * zwei Feldern hat keinen Grund, mehr als ein paar hundert Byte zu senden.
 */
const MAX_FORM_BYTES = 8 * 1024;

async function formularKoerper(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.split(';')[0]?.trim().toLowerCase().endsWith('application/x-www-form-urlencoded')) {
    throw new UnsupportedMediaTypeError();
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_FORM_BYTES) {
    throw new UnsupportedMediaTypeError();
  }

  return new URLSearchParams(text);
}

/**
 * Eine eigene Fehlerart, damit die Fehlergrenze daraus eine 415 macht.
 *
 * Sie steht hier und nicht in guard.ts: Ein falscher Content-Type ist keine
 * Frage der Berechtigung, sondern der Anfrageform.
 */
export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super('Dieser Endpunkt nimmt ausschließlich Formulardaten entgegen.');
    this.name = 'UnsupportedMediaTypeError';
  }
}

/** Die Antwort auf einen falschen Content-Type — von der Fehlergrenze benutzt. */
export function unsupportedMediaType(): Response {
  return json({ error: 'unsupported_media_type' }, 415, privateHeaders());
}
