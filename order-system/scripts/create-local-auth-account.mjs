#!/usr/bin/env node
/**
 * Erzeugt ein Anmeldekonto — genauer: das INSERT dafür.
 *
 * DAS SKRIPT SCHREIBT NICHT IN EINE DATENBANK.
 *
 * Es rechnet den Verifier aus und gibt ein fertiges INSERT aus; angewendet
 * wird es von Hand, bewusst und mit Blick darauf, gegen welche Datenbank. Ein
 * Werkzeug, das selbst schreiben kann, schreibt irgendwann versehentlich in
 * die falsche. Dieselbe Entscheidung wie beim Phase-2-Token-Werkzeug, und aus
 * demselben Grund.
 *
 * DAS GEHEIMNIS WIRD NICHT AUSGEGEBEN. Wer die PIN vergibt, kennt sie schon;
 * sie hier noch einmal auf den Bildschirm zu schreiben hieße nur, sie
 * zusätzlich in den Scrollback und womöglich in eine Bildschirmaufnahme zu
 * legen.
 *
 * NUR FÜR LOKALE ENTWICKLUNG GEDACHT. Es gibt keinen Production-Seeder, und
 * es soll keinen geben.
 *
 *   AUTH_PEPPER=... node scripts/create-local-auth-account.mjs \
 *       --role customer --identifier TESTCAFE --customer 1 --secret 01234567
 *
 *   AUTH_PEPPER=... node scripts/create-local-auth-account.mjs \
 *       --role admin --identifier admin@example.test --secret '<16+ Zeichen>'
 */

/**
 * Dieselben Werte wie in src/infrastructure/auth/credential.ts.
 *
 * Sie stehen hier ein zweites Mal, weil dieses Skript in Node läuft und der
 * Worker in workerd — es gibt keinen gemeinsamen Modulbaum ohne Build-Schritt.
 * Die Kopie ist gegen ein Auseinanderlaufen abgesichert: Ein Test in
 * tests/domain/create-local-auth-account.test.ts prüft die hier erzeugten
 * Verifier gegen verifyCredential aus dem Worker.
 */
export const PBKDF2_ITERATIONS = 600_000;
export const CREDENTIAL_ALGORITHM = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;

/** 8 Ziffern, führende Null ausdrücklich erlaubt. */
const PIN = /^[0-9]{8}$/;

/**
 * Länge schlägt Zeichenklassen.
 *
 * Keine Regel über Großbuchstaben, Ziffern oder Sonderzeichen: Solche Regeln
 * senken die tatsächliche Entropie, weil Menschen sie auf immer dieselbe
 * vorhersagbare Art erfüllen — und sie erhöhen die Wahrscheinlichkeit, dass
 * das Geheimnis irgendwo notiert wird.
 */
const MIN_ADMIN_SECRET_LENGTH = 16;

/**
 * Die Normalisierung MUSS Zeichen für Zeichen der aus
 * src/domain/login-identifier.ts entsprechen. Weicht sie ab, entsteht ein
 * Konto, das niemand finden kann — der beim Anmelden berechnete Wert wäre ein
 * anderer als der hier geschriebene.
 */
const ALLOWED_IDENTIFIER = /^[a-z0-9._@+-]+$/;

export function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') return null;

  const normalized = value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    .toLowerCase();

  if (normalized.length === 0 || normalized.length > 190) return null;
  return ALLOWED_IDENTIFIER.test(normalized) ? normalized : null;
}

const encoder = new TextEncoder();

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** HMAC(pepper, secret) → PBKDF2 — identisch zum Worker. */
export async function deriveCredential(secret, pepper, options = {}) {
  if (typeof pepper !== 'string' || pepper.length === 0) {
    throw new Error('AUTH_PEPPER fehlt.');
  }

  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const saltHex = options.saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

  const pepperKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const peppered = await crypto.subtle.sign('HMAC', pepperKey, encoder.encode(secret));
  const material = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    material,
    VERIFIER_BYTES * 8,
  );

  return { algorithm: CREDENTIAL_ALGORITHM, iterations, saltHex, verifierHex: toHex(new Uint8Array(bits)) };
}

/**
 * Prüft die Eingaben und wirft mit einer verständlichen Meldung.
 *
 * Getrennt vom Ein- und Ausgabeteil, damit ein Test sie ohne Prozessabbruch
 * aufrufen kann.
 */
export function validateInput({ role, identifier, customerId, secret }) {
  if (role !== 'customer' && role !== 'admin') {
    throw new Error("--role muss 'customer' oder 'admin' sein.");
  }

  const normalized = normalizeLoginIdentifier(identifier);
  if (normalized === null) {
    throw new Error(
      '--identifier ist unbrauchbar. Erlaubt sind Buchstaben, Ziffern und . _ @ + - ' +
        '(nach Kleinschreibung und Unicode-Normalisierung).',
    );
  }

  if (role === 'customer') {
    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new Error('--customer <id> ist für ein Café Pflicht.');
    }
    if (typeof secret !== 'string' || !PIN.test(secret)) {
      throw new Error('--secret muss für ein Café genau 8 Ziffern sein (führende Null erlaubt).');
    }
  } else {
    if (customerId !== null) {
      throw new Error('--customer ist für einen Admin nicht zulässig: Ein Admin ist kein Café.');
    }
    if (typeof secret !== 'string' || secret.length < MIN_ADMIN_SECRET_LENGTH) {
      throw new Error(`--secret muss für einen Admin mindestens ${MIN_ADMIN_SECRET_LENGTH} Zeichen haben.`);
    }
  }

  return { role, identifier: normalized, customerId, secret };
}

/**
 * Baut das INSERT. Ausschließlich aus dem berechneten Verifier — der Klartext
 * kommt in dieser Funktion nicht vor.
 */
export function buildInsert({ identifier, role, customerId, credential, now }) {
  return `INSERT INTO auth_accounts (
    login_identifier_normalized, role, customer_id,
    credential_algorithm, credential_iterations, credential_salt, credential_verifier,
    is_active, failed_attempts, created_at, updated_at
) VALUES (
    '${identifier}', '${role}', ${customerId === null ? 'NULL' : customerId},
    '${credential.algorithm}', ${credential.iterations},
    '${credential.saltHex}', '${credential.verifierHex}',
    1, 0, '${now}', '${now}'
);`;
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/** Wird beim direkten Aufruf ausgeführt, beim Import aus einem Test nicht. */
export async function main() {
  const pepper = process.env['AUTH_PEPPER'];
  if (typeof pepper !== 'string' || pepper.length < 32) {
    console.error(
      'AUTH_PEPPER fehlt oder ist zu kurz (mindestens 32 Zeichen).\n' +
        'Lokal steht er in .dev.vars — siehe .dev.vars.example.',
    );
    process.exit(1);
  }

  const kundenId = arg('customer');

  let eingabe;
  try {
    eingabe = validateInput({
      role: arg('role'),
      identifier: arg('identifier'),
      customerId: kundenId === null ? null : Number(kundenId),
      secret: arg('secret'),
    });
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    console.error(
      '\nAufruf:\n' +
        '  AUTH_PEPPER=... node scripts/create-local-auth-account.mjs \\\n' +
        '      --role customer --identifier TESTCAFE --customer 1 --secret 01234567\n' +
        '  AUTH_PEPPER=... node scripts/create-local-auth-account.mjs \\\n' +
        '      --role admin --identifier admin@example.test --secret "<mindestens 16 Zeichen>"',
    );
    process.exit(1);
  }

  const credential = await deriveCredential(eingabe.secret, pepper);
  const now = new Date().toISOString();

  console.log(`
────────────────────────────────────────────────────────────────────────
 Anmeldekonto für ${eingabe.role === 'admin' ? 'einen Admin' : `Kunde ${eingabe.customerId}`}

 Kennung (normalisiert, so steht sie in der Datenbank):

   ${eingabe.identifier}

 In die Datenbank kommt ausschließlich der Verifier — niemals das
 Geheimnis, niemals der Pepper:

${buildInsert({ ...eingabe, credential, now })}

 Lokal anwenden:

   npx wrangler d1 execute DB --local --command "<das INSERT von oben>"

 Deaktivieren (später, bei Verlust oder Austritt):

   UPDATE auth_accounts SET is_active = 0, updated_at = '<Zeitpunkt>'
    WHERE login_identifier_normalized = '${eingabe.identifier}';
────────────────────────────────────────────────────────────────────────
`);
}

// Nur beim direkten Aufruf laufen lassen — beim Import aus einem Test nicht.
if (process.argv[1]?.endsWith('create-local-auth-account.mjs')) {
  await main();
}
