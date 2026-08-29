/**
 * Die Speicherung und Prüfung von Anmeldegeheimnissen.
 *
 * Ein Café meldet sich mit einer 8-stelligen PIN an, ein Admin mit einem
 * langen Passwort. Beides läuft durch dieselbe Rechnung:
 *
 *     verifier = PBKDF2-HMAC-SHA256(
 *         password = HMAC-SHA256(key = AUTH_PEPPER, message = geheimnis),
 *         salt     = 16 zufällige Byte je Account,
 *         c        = 100 000,
 *         dkLen    = 32 Byte
 *     )
 *
 * WARUM PBKDF2 UND NICHT ARGON2ID
 *
 * Argon2id wäre die bessere Wahl und ist es überall, wo es zur Verfügung
 * steht. Die Web-Crypto-Implementierung von Cloudflare Workers kennt PBKDF2,
 * HKDF, AES, ECDSA, RSA und die Digest-Verfahren — sie kennt kein Argon2, kein
 * scrypt und kein bcrypt. Eine WASM-Portierung wäre möglich, brächte aber ein
 * Binärartefakt in den Worker, das hier niemand prüfen kann; und ein
 * speicherhartes Verfahren ist in einem Isolate mit 128 MB genau das falsche
 * Werkzeug. Keine selbst erfundene Kryptografie — und keine importierte, die
 * niemand liest.
 *
 * WARUM DER PEPPER VORGESCHALTET IST UND NICHT ANGEHÄNGT
 *
 * Ein angehängter Pepper (`PBKDF2(geheimnis + pepper, …)`) ist eine
 * Zeichenkette in einem Feld, das eine Zeichenkette erwartet — es funktioniert,
 * sagt aber nichts aus. HMAC ist die dafür gebaute Konstruktion: Der Pepper ist
 * ein SCHLÜSSEL, das Ergebnis ist ohne ihn von Zufall nicht zu unterscheiden,
 * und eine spätere Rotation ist ein wohldefinierter Vorgang statt einer
 * Bastelei.
 *
 * WAS DER WORK FACTOR LEISTET — UND WAS NICHT
 *
 * Gegen einen D1-Dump OHNE Pepper schützt der Pepper, nicht die
 * Iterationszahl: Ein Angreifer steht vor einem 256-Bit-Schlüssel und kann
 * nicht einmal anfangen. Gegen einen Dump MIT Pepper kauft die Iterationszahl
 * Stunden, keine Sicherheit — eine 8-stellige PIN hat 10^8 Möglichkeiten und
 * fällt auf einer GPU in beiden Fällen. Die Zahl steht hier trotzdem hoch,
 * weil sie nichts kostet, was der Betrieb merkt: Ein Café meldet sich alle
 * 30 Tage an.
 *
 * Cloudflare Workers begrenzt PBKDF2 derzeit auf 100 000 Iterationen. Dieser
 * Plattformhöchstwert ist deshalb zugleich der Work Factor der Anwendung.
 */
import { constantTimeEquals } from './constant-time';

const encoder = new TextEncoder();

/**
 * Der zentrale Work Factor. Die eine Stelle, an der er steht.
 *
 * 100 000 ist der von Cloudflare Workers unterstützte Höchstwert für PBKDF2.
 * Eine Änderung hier macht bestehende Verifier NICHT ungültig: Jede Zeile in
 * auth_accounts trägt ihre eigene Iterationszahl mit (siehe StoredCredential).
 */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * Die Untergrenze, die auch die CHECK-Bedingung in D1 verlangt.
 *
 * Sie wird hier bewusst NICHT erzwungen. deriveCredential und
 * verifyCredential sind Primitive: Sie rechnen mit dem, was ihnen gegeben
 * wird. Durchgesetzt wird die Grenze dort, wo geschrieben wird — vom
 * Provisionierungswerkzeug und von der Datenbank. Das ist dieselbe Schichtung
 * wie im Rest des Systems: die Anwendung als erste Verteidigungslinie, das
 * Schema als zweite.
 *
 * Der praktische Nutzen: Datenbank und Anwendung teilen eine explizite
 * Untergrenze; ein späterer höherer Plattformwert kann ohne Flag Day über die
 * je Konto gespeicherte Iterationszahl eingeführt werden.
 */
export const MIN_ITERATIONS = 100_000;

export const CREDENTIAL_ALGORITHM = 'pbkdf2-sha256';

/** 16 Byte. Ein Salt muss eindeutig sein, nicht geheim und nicht lang. */
export const SALT_BYTES = 16;

/** 32 Byte — die volle Ausgabelänge von SHA-256. Mehr wäre Streckung ohne Gewinn. */
export const VERIFIER_BYTES = 32;

/**
 * Was in auth_accounts steht. Genau das und nichts weiter.
 *
 * `algorithm` und `iterations` stehen je Zeile und nicht als Konstante im
 * Code: Ohne sie wäre eine Erhöhung des Work Factors ein Flag Day, nach dem
 * sich niemand mehr anmelden kann. Mit ihnen ist sie ein Neuberechnen beim
 * nächsten erfolgreichen Login — die Mechanik dafür ist in dieser Phase
 * bewusst nicht gebaut, die Möglichkeit steht offen.
 */
export interface StoredCredential {
  readonly algorithm: string;
  readonly iterations: number;
  /** 16 Byte als 32 Hex-Zeichen. */
  readonly saltHex: string;
  /** 32 Byte als 64 Hex-Zeichen. */
  readonly verifierHex: string;
}

export interface DeriveOptions {
  /** Ohne Angabe: 16 frische Zufallsbyte. */
  saltHex?: string | undefined;
  /** Ohne Angabe: PBKDF2_ITERATIONS. */
  iterations?: number | undefined;
}

/**
 * Erzeugt einen speicherbaren Verifier.
 *
 * Der Klartext verlässt diese Funktion nicht und wird nirgends festgehalten —
 * weder im Rückgabewert noch in einer Fehlermeldung.
 */
export async function deriveCredential(
  secret: string,
  pepper: string,
  options: DeriveOptions = {},
): Promise<StoredCredential> {
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const saltHex = options.saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

  const verifierHex = await derive(secret, pepper, fromHex(saltHex), iterations);

  return { algorithm: CREDENTIAL_ALGORITHM, iterations, saltHex, verifierHex };
}

/**
 * Prüft ein Geheimnis gegen einen gespeicherten Verifier.
 *
 * FAIL CLOSED: Jeder Datensatz, den diese Fassung nicht verifizieren KANN —
 * unbekannter Algorithmus, kaputte Hexform, unsinnige Iterationszahl —, führt
 * zu `false`. Nicht zu einer Ausnahme und schon gar nicht zu `true`. Ein
 * unbekannter Algorithmus ist kein Grund, jemanden einzulassen.
 */
export async function verifyCredential(
  secret: string,
  pepper: string,
  stored: StoredCredential,
): Promise<boolean> {
  if (!isUsable(stored)) {
    return false;
  }

  const berechnet = await derive(secret, pepper, fromHex(stored.saltHex), stored.iterations);
  return constantTimeEquals(berechnet, stored.verifierHex);
}

/**
 * Der feste Salt der Dummy-Verifikation.
 *
 * Er ist eine Konstante und kein Zufall, damit die Dummy-Prüfung reproduzierbar
 * ist. Geheim muss er nicht sein: Sein einziger Zweck ist, dass überhaupt
 * gerechnet wird. Was dabei herauskommt, wird verworfen.
 */
const DUMMY_SALT_HEX = '00112233445566778899aabbccddeeff';
const DUMMY_SECRET = 'kein-konto-vorhanden';

/**
 * Verbrennt denselben Aufwand wie eine echte Verifikation und liefert immer
 * `false`.
 *
 * Ohne diese Funktion wäre eine unbekannte Kennung daran erkennbar, dass die
 * Ablehnung sofort kommt, während eine bekannte 45 ms braucht. Das wäre ein
 * Aufzählungspfad für Kundencodes und Adminadressen.
 *
 * Was hier NICHT versprochen wird: mathematisch ununterscheidbare Netzzeiten.
 * D1-Latenz, Scheduling und Netz streuen ohnehin stärker. Versprochen wird
 * nur, dass es keinen OFFENSICHTLICHEN Unterschied gibt — keine Antwort in
 * 3 ms neben einer in 90 ms.
 *
 * Gerechnet wird mit PBKDF2_ITERATIONS, also mit dem Work Factor, den heute
 * angelegte Accounts tragen.
 */
export async function verifyDummyCredential(pepper: string): Promise<false> {
  await derive(DUMMY_SECRET, pepper, fromHex(DUMMY_SALT_HEX), PBKDF2_ITERATIONS);
  return false;
}

/**
 * Die eigentliche Rechnung — die einzige Stelle, an der abgeleitet wird.
 *
 * Dass Dummy- und echte Verifikation durch dieselbe Funktion laufen, ist keine
 * Sparsamkeit: Es ist die Zusage, dass beide denselben Aufwand haben. Zwei
 * getrennte Implementierungen würden irgendwann auseinanderlaufen, und das
 * Zeitverhalten wäre wieder ein Oracle.
 */
async function derive(
  secret: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  /**
   * Ein fehlender Pepper ist ein Betriebsfehler, KEIN falsches Passwort — und
   * deshalb wird hier geworfen statt `false` geliefert.
   *
   * Der Unterschied ist der ganze Punkt: Ein `false` sähe für jeden Aufrufer
   * wie „Zugangsdaten stimmen nicht" aus. Ein Worker, dem das Secret fehlt,
   * meldete dann allen Cafés und allen Admins gleichzeitig falsche
   * Zugangsdaten — und niemand käme auf die Ursache. Eine Ausnahme wird von
   * der Fehlergrenze zu einer 500 ohne Details, und das ist die ehrliche
   * Aussage: Hier stimmt der Server nicht, nicht der Benutzer.
   *
   * Erreichbar ist dieser Zweig im Normalbetrieb nicht — readAppConfig lehnt
   * einen leeren oder zu kurzen Pepper schon beim Lesen ab. Er steht hier für
   * den Fall, dass jemand die Konfiguration umgeht.
   */
  if (pepper.length === 0) {
    throw new Error('AUTH_PEPPER fehlt. Ohne Pepper kann kein Credential geprüft werden.');
  }

  const pepperKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Der Pepper als Schlüssel, das Geheimnis als Nachricht. Das Ergebnis geht
  // als Passwortmaterial in PBKDF2 — ohne den Pepper ist es nicht herstellbar.
  const peppered = await crypto.subtle.sign('HMAC', pepperKey, encoder.encode(secret));

  const material = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    VERIFIER_BYTES * 8,
  );

  return toHex(new Uint8Array(bits));
}

const SALT_FORM = /^[0-9a-f]{32}$/;
const VERIFIER_FORM = /^[0-9a-f]{64}$/;

function isUsable(stored: StoredCredential): boolean {
  return (
    stored.algorithm === CREDENTIAL_ALGORITHM &&
    Number.isInteger(stored.iterations) &&
    stored.iterations > 0 &&
    SALT_FORM.test(stored.saltHex) &&
    VERIFIER_FORM.test(stored.verifierHex)
  );
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
