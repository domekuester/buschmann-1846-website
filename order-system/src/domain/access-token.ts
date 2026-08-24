import { InvalidArgumentError } from './errors';

/**
 * Der Zugangstoken eines Cafés.
 *
 * Er ersetzt Registrierung, Passwort und Sitzung. Wer den vollständigen Link
 * besitzt, darf für dieses Café bestellen — ein Capability Link. Das ist eine
 * bewusste Entscheidung für das Produktziel: Ein Stammcafé soll in zwanzig
 * Sekunden bestellen, nicht sich anmelden.
 *
 * Daraus folgt alles Weitere in dieser Datei:
 *
 *   ENTROPIE — 32 Byte aus crypto.getRandomValues, also 256 Bit. Der Wert ist
 *   nicht aus Caféname, ID, laufender Nummer, E-Mail oder Telefonnummer
 *   ableitbar; er enthält überhaupt keinen Kundenbezug. Es gibt keinen
 *   Aufzählungspfad, weil es keine öffentliche Kunden-ID gibt.
 *
 *   KODIERUNG — base64url ohne Padding. Der Token steht in einer URL; '+',
 *   '/' und '=' müssten dort kodiert werden und wären beim Vorlesen,
 *   Kopieren und in Chatprogrammen eine Fehlerquelle.
 */
const BYTE_LENGTH = 32;

/** 32 Byte in base64url ohne Padding sind genau 43 Zeichen. */
export const ACCESS_TOKEN_LENGTH = 43;

/**
 * Die Spanne statt exakt 43 ist Absicht: Eine spätere Verlängerung des Tokens
 * soll keine Änderung an dieser Prüfung erzwingen. Kürzer als 32 Zeichen wird
 * nie akzeptiert — das wäre der Punkt, an dem Raten überhaupt erst denkbar
 * würde.
 */
const WELL_FORMED = /^[A-Za-z0-9_-]{32,64}$/;

export function generateAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTE_LENGTH));
  return base64url(bytes);
}

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && WELL_FORMED.test(value);
}

/**
 * SHA-256 als Hex. In D1 liegt AUSSCHLIESSLICH dieser Wert, niemals der
 * Klartext.
 *
 * Warum kein PBKDF2, Argon2 oder bcrypt: Ein langsamer KDF schützt SCHWACHE
 * Geheimnisse gegen Offline-Raten. Dieses Geheimnis ist 256 Bit
 * gleichverteilter Zufall — Raten ist unabhängig von der Hashgeschwindigkeit
 * unmöglich. Ein KDF brächte keinen Sicherheitsgewinn und kostete bei jedem
 * Seitenaufruf Rechenzeit.
 *
 * Warum ohne Salt: Ein Salt verhindert Rainbow-Tables gegen RATBARE Werte.
 * Gegen 2^256 gibt es keine Tabelle. Ein Salt je Zeile würde zusätzlich die
 * Suche über den UNIQUE-Index unmöglich machen und jede Anfrage in einen
 * Tabellenscan mit einer Hashberechnung pro Zeile verwandeln.
 *
 * Die Formprüfung steht VOR der Hashberechnung: Ein Token, der die Form
 * verfehlt, kann in der Datenbank nicht stehen. Ihn erst zu hashen wäre
 * Rechenarbeit für ein sicheres Nein.
 */
export async function hashAccessToken(token: string): Promise<string> {
  if (!isWellFormedToken(token)) {
    throw new InvalidArgumentError('Der Zugangstoken hat kein gültiges Format.');
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Von Hand, nicht über btoa(): btoa erwartet einen Binärstring, liefert
 * Standard-Base64 mit '+', '/' und '=' und müsste anschließend dreifach
 * nachbearbeitet werden. Der direkte Weg ist kürzer und hat keinen
 * Zwischenzustand, in dem ein falsches Zeichen entstehen könnte.
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
