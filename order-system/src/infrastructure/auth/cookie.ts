import type { AppConfig } from '../../config/app-config';

/**
 * Das Sitzungscookie — die einzige Stelle, an der es entsteht und gelesen
 * wird.
 *
 * ZWEI NAMEN STATT EINES NAMENS MIT ZWEI FLAG-SÄTZEN
 *
 * Der `__Host-`-Präfix ist keine Namenskonvention, sondern eine Zusage an den
 * Browser: Dieses Cookie hat Secure, hat Path=/ und hat kein Domain. Der
 * Browser setzt sie durch — ein `__Host-`-Cookie ohne Secure wird schlicht
 * verworfen. Es gibt also gar keine Fassung dieses Namens, die über HTTP
 * funktioniert.
 *
 * Damit bleiben zwei Möglichkeiten: den Präfix umgebungsabhängig an- und
 * abschalten, oder zwei Namen. Die erste macht die Zusage zur Variablen — und
 * eine Zusage, die manchmal gilt, ist keine. Die zweite kostet eine Konstante
 * und hat eine nützliche Nebenwirkung: Ein lokal entstandenes Cookie kann in
 * Produktion nicht gelten, und ein Produktionscookie nicht lokal. Die
 * Umgebungen können einander nicht verwechseln.
 */
export const PRODUCTION_COOKIE_NAME = '__Host-buschmann_session';
export const DEVELOPMENT_COOKIE_NAME = 'buschmann_session_dev';

export function sessionCookieName(config: AppConfig): string {
  return config.environment === 'production' ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
}

/**
 * Die Attribute, die jedes Sitzungscookie trägt — gesetzte wie gelöschte.
 *
 *   HttpOnly       JavaScript liest den Token nie. Das ist die eine Maßnahme,
 *                  die auch dann noch wirkt, wenn eine XSS-Lücke aufgeht.
 *   SameSite=Lax   Ein fremdes Formular schickt das Cookie bei einem POST
 *                  nicht mit. Lax und nicht Strict, weil sonst der ganz
 *                  normale Fall bricht: Ein Café klickt einen Link aus einer
 *                  Nachricht und wäre trotz gültiger Sitzung abgemeldet.
 *   Path=/         Das Cookie gilt für /login, /bestellen, /admin und /api.
 *   kein Domain    Ohne Domain gilt es exakt für den setzenden Host. Mit
 *                  Domain gälte es für jede Subdomain — und eine kompromittierte
 *                  Subdomain könnte Sitzungen übernehmen.
 *   Secure         Nur in Produktion, siehe unten.
 */
function attributes(config: AppConfig, maxAgeSeconds: number): string[] {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];

  /**
   * Secure hängt an der Umgebung, und die Umgebung ist fail closed:
   * app-config.ts liefert 'production' für alles außer dem exakten Wort
   * 'development' — auch für einen Tippfehler, auch für einen fehlenden Wert.
   * Ein versehentlicher Produktionsstart kann hier deshalb nicht in den
   * unsicheren Zweig geraten.
   *
   * Zusätzlich schließt app-config.ts die Kombination 'development' mit einem
   * https-Origin schon beim Lesen aus. Diese Zeile ist also die letzte von
   * zwei Absicherungen, nicht die einzige.
   */
  if (config.environment === 'production') {
    parts.push('Secure');
  }

  return parts;
}

export function serializeSessionCookie(
  config: AppConfig,
  token: string,
  maxAgeSeconds: number,
): string {
  return [`${sessionCookieName(config)}=${token}`, ...attributes(config, maxAgeSeconds)].join('; ');
}

/**
 * Löscht das Cookie.
 *
 * Max-Age=0 und ein leerer Wert — und ansonsten EXAKT dieselben Attribute wie
 * beim Setzen. Weicht auch nur eines ab, betrachtet der Browser es als
 * anderes Cookie und löscht gar nichts; die Sitzung bliebe im Browser stehen,
 * während sie serverseitig widerrufen ist.
 *
 * Der serverseitige Widerruf ist ohnehin der wirksame Teil des Abmeldens.
 * Dieses Cookie räumt nur auf.
 */
export function clearSessionCookie(config: AppConfig): string {
  return [`${sessionCookieName(config)}=`, ...attributes(config, 0)].join('; ');
}

/**
 * Liest den Sitzungstoken aus dem Cookie-Header.
 *
 * Der Namensvergleich ist EXAKT und kein Präfixvergleich:
 * '__Host-buschmann_session_alt' ist ein anderes Cookie, und wer es setzen
 * kann, soll damit keine Sitzung übernehmen.
 *
 * Die inhaltliche Prüfung des Werts passiert hier NICHT. Diese Funktion
 * reicht heraus, was dasteht; ob es ein wohlgeformter Token ist und ob es
 * dazu eine gültige Sitzung gibt, entscheidet das Session-Repository. Eine
 * Formprüfung an zwei Stellen wäre eine Stelle zu viel, die irgendwann von
 * der anderen abweicht.
 */
export function readSessionCookie(config: AppConfig, header: string | null): string | null {
  if (header === null || header.length === 0) {
    return null;
  }

  const name = sessionCookieName(config);

  for (const paar of header.split(';')) {
    const trennung = paar.indexOf('=');
    if (trennung === -1) {
      continue;
    }

    if (paar.slice(0, trennung).trim() === name) {
      const wert = paar.slice(trennung + 1).trim();
      return wert.length === 0 ? null : wert;
    }
  }

  return null;
}
