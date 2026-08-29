/**
 * Die geprüfte Konfiguration der Authentifizierung.
 *
 * Diese Datei rät nicht. Sie hat keinen Standardpepper, keinen abgeleiteten
 * Origin und keinen „dann eben unsicher"-Zweig. Fehlt etwas oder passt etwas
 * nicht zusammen, wirft sie — und die Fehlergrenze macht daraus eine 500 ohne
 * Details.
 *
 * Das ist die Umsetzung von „fail closed": Der teure Fehler wäre nicht ein
 * Worker, der nicht startet, sondern einer, der startet und dabei Cookies ohne
 * Secure ausstellt.
 */

/**
 * Bewusst NICHT `Env`, obwohl `Env` zuweisbar ist.
 *
 * `Env` trägt das D1-Binding und wächst mit jeder weiteren Ressource. Diese
 * Funktion braucht drei Zeichenketten und soll auch nur diese drei sehen
 * können — dann ist sie ohne Worker-Runtime und ohne Datenbank prüfbar, und
 * genau das tut tests/domain/app-config.test.ts.
 */
export interface AuthEnvironmentBindings {
  AUTH_PEPPER?: string | undefined;
  APP_ORIGIN?: string | undefined;
  ENVIRONMENT?: string | undefined;
}

export type Environment = 'development' | 'production';

export interface AppConfig {
  readonly environment: Environment;
  readonly appOrigin: string;
  readonly pepper: string;
}

/**
 * Ein Fehler in der Betriebsumgebung, kein Fehler eines Benutzers.
 *
 * Die Nachricht sagt, WAS fehlt, und niemals, WAS stattdessen dastand: Sie
 * kann in einem Stacktrace landen, und ein Stacktrace kann in einem Log
 * landen. Ein „AUTH_PEPPER ist zu kurz: abc123" wäre der kürzeste Weg, ein
 * Geheimnis zu protokollieren.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * 32 Zeichen. Der vorgesehene Wert ist ein base64url-kodierter 256-Bit-Zufall
 * und damit 43 Zeichen lang; die Untergrenze liegt darunter, damit ein
 * abweichendes Kodierungsverfahren nicht zwingend eine Codeänderung braucht.
 * Sie liegt aber hoch genug, dass ein hingeschriebenes Wort durchfällt.
 */
const MIN_PEPPER_LENGTH = 32;

/** Genau dieses Wort. Alles andere ist Produktion — auch ein Tippfehler. */
const DEVELOPMENT = 'development';

export function readAppConfig(env: AuthEnvironmentBindings): AppConfig {
  const pepper = readPepper(env.AUTH_PEPPER);
  const appOrigin = readOrigin(env.APP_ORIGIN);
  const environment: Environment = env.ENVIRONMENT === DEVELOPMENT ? 'development' : 'production';

  assertOriginMatchesEnvironment(appOrigin, environment);

  return { environment, appOrigin, pepper };
}

function readPepper(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigurationError(
      'AUTH_PEPPER ist nicht gesetzt. Ohne serverseitigen Pepper ist keine Anmeldung möglich.',
    );
  }
  if (value.length < MIN_PEPPER_LENGTH) {
    throw new ConfigurationError(
      `AUTH_PEPPER ist zu kurz. Erwartet werden mindestens ${MIN_PEPPER_LENGTH} Zeichen.`,
    );
  }
  return value;
}

/**
 * Der Origin muss ein Origin sein — nicht eine URL, aus der sich einer machen
 * ließe.
 *
 * Der Rückvergleich `url.origin === value` ist der ganze Trick: `new URL()`
 * normalisiert großzügig und macht aus 'https://buschmann1846.de/login' klaglos
 * einen gültigen Wert mit dem Origin 'https://buschmann1846.de'. Verglichen
 * wird deshalb gegen die EINGABE. Wer einen Pfad, einen Query-String oder auch
 * nur einen abschließenden Schrägstrich einträgt, bekommt einen Abbruch statt
 * einer stillen Korrektur — sonst stünde in der Konfiguration etwas anderes
 * als das, wogegen geprüft wird.
 */
function readOrigin(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigurationError(
      'APP_ORIGIN ist nicht gesetzt. Ohne erwarteten Origin wird jeder schreibende Request abgelehnt.',
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('APP_ORIGIN ist keine gültige Adresse.');
  }

  if (url.origin !== value) {
    throw new ConfigurationError(
      'APP_ORIGIN muss genau ein Origin sein — Schema, Host und gegebenenfalls Port, sonst nichts.',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigurationError('APP_ORIGIN muss http oder https verwenden.');
  }

  return value;
}

/**
 * Die Prüfung aus Abschnitt 24 der Vorgabe, und sie geht in beide Richtungen.
 *
 *   development + https  Der versehentliche Produktionsstart. Die
 *                        Cookie-Policy würde Secure weglassen, obwohl die
 *                        Verbindung es hergäbe — und der Browser bekäme ein
 *                        Sitzungscookie, das er auch über HTTP schicken würde.
 *
 *   production  + http   Der umgekehrte Fall. Die Policy verlangt Secure, der
 *                        Browser bekommt das Cookie über HTTP gar nicht erst
 *                        gesetzt, und niemand könnte sich anmelden. Das wäre
 *                        kein Sicherheitsproblem, aber eine halbe Stunde
 *                        Fehlersuche — und die Ursache steht dann hier.
 *
 * Beides ist ein Abbruch und keine Warnung. Eine Warnung liest niemand.
 */
function assertOriginMatchesEnvironment(appOrigin: string, environment: Environment): void {
  const isSecureOrigin = appOrigin.startsWith('https://');

  if (environment === 'development' && isSecureOrigin) {
    throw new ConfigurationError(
      'ENVIRONMENT=development mit einem https-APP_ORIGIN ist eine Fehlkonfiguration: ' +
        'Die Entwicklungspolicy stellt Cookies ohne Secure aus.',
    );
  }

  if (environment === 'production' && !isSecureOrigin) {
    throw new ConfigurationError(
      'Ein Produktionsstart verlangt einen https-APP_ORIGIN: ' +
        'Die Produktionspolicy stellt ausschließlich Secure-Cookies aus.',
    );
  }
}
