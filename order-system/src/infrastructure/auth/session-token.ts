import type { AuthRole } from '../../domain/auth-role';
import { InvalidArgumentError } from '../../domain/errors';

/**
 * Sitzungs- und CSRF-Token.
 *
 * Ein Sitzungstoken ist das einzige, was der Browser nach der Anmeldung
 * besitzt. Er ist damit gleichwertig zum Passwort — mit einem entscheidenden
 * Unterschied: Er ist kein Menschenwerk, sondern 32 Byte aus
 * crypto.getRandomValues.
 *
 * WARUM SHA-256 UND KEIN PASSWORT-KDF FÜR DIE SPEICHERUNG
 *
 * Ein langsamer KDF schützt SCHWACHE Geheimnisse gegen Offline-Raten. Dieses
 * Geheimnis ist 256 Bit gleichverteilter Zufall — dagegen gibt es weder ein
 * Rateverfahren noch eine Tabelle, unabhängig davon, wie schnell der Hash ist.
 * Ein KDF kostete stattdessen bei JEDEM geschützten Request 45 ms und brächte
 * nichts. Dieselbe Begründung wie beim Zugangstoken aus Phase 2, und sie
 * stimmt hier wie dort.
 *
 * Aus demselben Grund kein Salt: Ein Salt verhindert Tabellen gegen ratbare
 * Werte. Gegen 2^256 gibt es keine Tabelle — und ein Salt je Zeile machte die
 * Suche über den UNIQUE-Index unmöglich und jede Anfrage zu einem
 * Tabellenscan mit einer Hashberechnung pro Zeile.
 */

/** 32 Byte = 256 Bit. */
const TOKEN_BYTES = 32;

/** 32 Byte in base64url ohne Padding sind genau 43 Zeichen. */
export const SESSION_TOKEN_LENGTH = 43;

/**
 * Anders als beim Phase-2-Zugangstoken ist die Länge hier EXAKT und keine
 * Spanne. Der Token steht in einem Cookie und nicht in einem Link, den ein
 * Mensch vorliest; es gibt keinen Grund, jemals eine andere Länge zu
 * akzeptieren, und eine exakte Prüfung schließt einen abgeschnittenen Wert
 * sicher aus.
 */
const WELL_FORMED = /^[A-Za-z0-9_-]{43}$/;

/**
 * Wie lange eine Sitzung gilt — die eine Stelle, an der das steht.
 *
 *   customer  30 Tage. Ein Stammcafé bestellt zweimal die Woche. Häufigeres
 *             Anmelden wäre die eine Reibung, die den ganzen Bestellfluss
 *             entwertet: Wer sich vor jeder Bestellung anmelden muss, greift
 *             wieder zum Telefon.
 *
 *   admin     12 Stunden. Deckt eine Arbeitsschicht ab und läuft über Nacht
 *             ab. Ein Adminzugang ist ein Zugang zum Betrieb, kein
 *             Tresengerät — und er liegt auf einem Gerät, das abends mit nach
 *             Hause geht.
 *
 * Keine ewigen Sitzungen. Der Unterschied zwischen beiden Werten ist kein
 * Versehen, sondern die Aussage: Die Rolle bestimmt das Risiko.
 */
export const SESSION_TTL_SECONDS: Readonly<Record<AuthRole, number>> = {
  customer: 30 * 24 * 60 * 60,
  admin: 12 * 60 * 60,
};

export function generateSessionToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * Der CSRF-Token einer Sitzung.
 *
 * Technisch dasselbe Verfahren wie beim Sitzungstoken, aber ein eigener Wert
 * und eine eigene Funktion — denn es sind zwei Geheimnisse mit
 * unterschiedlicher Aufgabe: Der Sitzungstoken liegt HttpOnly im Cookie und
 * darf nie in ein Dokument geraten. Der CSRF-Token steht lesbar im HTML, weil
 * der Client ihn zurücksenden muss. Wären es dieselben Werte, stünde der
 * Sitzungstoken im Quelltext der Seite.
 */
export function generateCsrfToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export function isWellFormedSessionToken(value: unknown): value is string {
  return typeof value === 'string' && WELL_FORMED.test(value);
}

/**
 * SHA-256 als Hex. In D1 liegt AUSSCHLIESSLICH dieser Wert.
 *
 * Die Formprüfung steht vor der Berechnung: Ein Token, der die Form verfehlt,
 * kann in der Tabelle nicht stehen. Ihn erst zu hashen wäre Rechenarbeit für
 * ein sicheres Nein.
 */
export async function hashSessionToken(token: string): Promise<string> {
  if (!isWellFormedSessionToken(token)) {
    throw new InvalidArgumentError('Der Sitzungstoken hat kein gültiges Format.');
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Der Ablaufzeitpunkt einer neuen Sitzung als ISO-8601 in UTC.
 *
 * Feste Länge mit Millisekunden und Z-Suffix, damit die lexikografische
 * Ordnung die chronologische ist — nur so ist `WHERE expires_at > ?` in SQLite
 * ohne Datumsfunktion korrekt.
 *
 * Gerechnet wird in Millisekunden auf der UTC-Achse und nicht über eine lokale
 * Zeit: Ein Zeitpunkt hat keine Zeitzone, und über die Sommerzeitumstellung
 * hinweg wären „30 Tage" als lokale Kalenderarithmetik um eine Stunde daneben.
 * Das ist der Gegenpol zu domain/clock.ts, wo ein LIEFERTAG bewusst als
 * Kalendertag in Europe/Berlin gerechnet wird — Zeitpunkt und Tag sind
 * verschiedene Dinge, und diese Datei hat es mit Zeitpunkten zu tun.
 */
export function sessionExpiry(role: AuthRole, now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_SECONDS[role] * 1000).toISOString();
}

/**
 * base64url ohne Padding, von Hand.
 *
 * Nicht über btoa(): Das erwartet einen Binärstring, liefert Standard-Base64
 * mit '+', '/' und '=' und müsste dreifach nachbearbeitet werden. Der direkte
 * Weg ist kürzer und hat keinen Zwischenzustand, in dem ein falsches Zeichen
 * entstehen könnte.
 *
 * '+' und '/' wären hier besonders unangenehm: Ein Cookie-Wert mit diesen
 * Zeichen ist zwar zulässig, aber jede Kodierungsschicht auf dem Weg ist eine
 * Gelegenheit, ihn zu verändern.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];

    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 0b111111];
  }
  return out;
}
