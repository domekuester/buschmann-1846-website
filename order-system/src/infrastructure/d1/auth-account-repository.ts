import { isAuthRole, type AuthRole } from '../../domain/auth-role';
import { InvalidArgumentError } from '../../domain/errors';
import type { StoredCredential } from '../auth/credential';
import { toBoolean, type AuthAccountRow } from './rows';

/**
 * Der Zugriff auf die Anmeldekonten.
 *
 * Diese Datei gibt einen AuthAccount heraus, keine Datenbankzeile — dieselbe
 * Entscheidung wie beim Zugangstoken-Repository aus Phase 2 und aus demselben
 * Grund: Was nicht im Typ steht, kann nirgends versehentlich in eine Antwort,
 * ein Log oder eine Fehlermeldung geraten. `created_at`, `updated_at` und
 * `credential_algorithm` als lose Felder wären drei Gelegenheiten dafür.
 */

/**
 * Fünf Fehlversuche, dann 15 Minuten Pause.
 *
 * FÜNF, weil vier Vertipper bei einer 8-stelligen PIN am Tresen vorkommen und
 * fünf schon selten sind.
 *
 * FÜNFZEHN MINUTEN, weil das die beiden Größen trennt, um die es geht:
 * Systematisches Raten wird aussichtslos (5 Versuche je 15 Minuten sind 480
 * am Tag; für 10^8 PINs also rund 570 000 Jahre), während ein Café, dessen
 * Mitarbeiter sich vertippt hat, nach einer Kaffeepause weiterarbeiten kann.
 *
 * DER LOCKOUT-DoS IST REAL UND IN KAUF GENOMMEN. Kundencodes sind
 * ausdrücklich nicht geheim; wer einen kennt, kann ein Café durch fünf falsche
 * Versuche für 15 Minuten aussperren. Die Abwägung: Ein erfolgreicher
 * Bruteforce ist ein dauerhafter Fremdzugriff auf Bestelldaten, eine Sperre
 * ist eine Verzögerung, die von selbst endet — und das Café hat einen
 * Ausweichweg, den es seit Jahrzehnten benutzt: anrufen. Die richtige
 * zusätzliche Antwort ist Cloudflare Rate Limiting nach IP, und das ist
 * ausdrücklich eine spätere Phase.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;

export interface AuthAccount {
  readonly id: number;
  readonly role: AuthRole;
  /** Gesetzt bei 'customer', null bei 'admin' — das Schema erzwingt beides. */
  readonly customerId: number | null;
  readonly credential: StoredCredential;
  readonly isActive: boolean;
  readonly failedAttempts: number;
  /** ISO-8601-UTC oder null. */
  readonly lockedUntil: string | null;
}

const SPALTEN = `id, login_identifier_normalized, role, customer_id, credential_algorithm,
                 credential_iterations, credential_salt, credential_verifier, is_active,
                 failed_attempts, locked_until`;

/**
 * Sucht ein Konto über die bereits normalisierte Kennung.
 *
 * Der Vergleich ist EXAKT. Normalisiert wird im Anwendungsfall, bevor hier
 * gesucht wird; eine zweite Normalisierung an dieser Stelle hieße, die Regel
 * an zwei Orten zu führen — und zwei Orte laufen auseinander.
 *
 * EIN DEAKTIVIERTES KONTO WIRD GELADEN, NICHT AUSGEFILTERT.
 *
 * Das ist der wichtigste Satz dieser Datei. Ein `AND is_active = 1` in der
 * WHERE-Klausel wäre naheliegend und falsch: Die Ablehnung eines
 * deaktivierten Cafés käme dann ohne Credential-Prüfung zurück und wäre am
 * Zeitverhalten von einer echten Prüfung zu unterscheiden. Damit wäre genau
 * die Menge der existierenden Konten aufzählbar. Die Entscheidung über
 * `isActive` fällt deshalb im Anwendungsfall, NACH der Verifikation.
 */
export async function findAccountByIdentifier(
  db: D1Database,
  identifier: string,
): Promise<AuthAccount | null> {
  const row = await db
    .prepare(`SELECT ${SPALTEN} FROM auth_accounts WHERE login_identifier_normalized = ?`)
    .bind(identifier)
    .first<AuthAccountRow>();

  return row === null ? null : toAccount(row);
}

export async function findAccountById(db: D1Database, id: number): Promise<AuthAccount | null> {
  const row = await db
    .prepare(`SELECT ${SPALTEN} FROM auth_accounts WHERE id = ?`)
    .bind(id)
    .first<AuthAccountRow>();

  return row === null ? null : toAccount(row);
}

/**
 * Zählt einen Fehlversuch — in EINER Anweisung.
 *
 * Ein Lesen mit anschließendem Zurückschreiben wäre hier der klassische
 * Fehler: Zwei gleichzeitige Fehlversuche läsen denselben Ausgangswert und
 * schrieben beide dieselbe Zahl. Der Zähler zählte dann bei paralleler
 * Absendung nicht mehr, und das ist genau die Situation, gegen die er da ist.
 * SQLite serialisiert Schreibvorgänge; diese Anweisung ist damit atomar.
 *
 * DIE WHERE-KLAUSEL IST TEIL DES SCHUTZES, nicht Kosmetik:
 *
 *   Während einer LAUFENDEN Sperre ist der Aufruf wirkungslos. Sonst könnte
 *   ein Angreifer die Sperre durch weiteres Probieren beliebig verlängern und
 *   aus 15 Minuten einen Dauerzustand machen. Der Anwendungsfall prüft den
 *   Cooldown ohnehin vorher — das Repository verlässt sich nicht darauf.
 *
 * DIE ZÄHLUNG BEGINNT NACH EINER ABGELAUFENEN SPERRE VON VORN:
 *
 *   Bliebe der Zähler bei 5 stehen, bekäme ein Café nach der Kaffeepause genau
 *   EINEN Versuch, bevor es wieder 15 Minuten gesperrt wäre. Das doppelte CASE
 *   ist unschön; SQLite erlaubt es nicht, in einer UPDATE-Anweisung auf einen
 *   gerade berechneten Wert zurückzugreifen. Zwei Anweisungen wären lesbarer
 *   und nicht mehr atomar — und Atomarität ist hier der ganze Punkt.
 */
export async function recordFailedAttempt(db: D1Database, id: number, now: Date): Promise<void> {
  const jetzt = now.toISOString();
  const bis = new Date(now.getTime() + LOCKOUT_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `UPDATE auth_accounts
          SET failed_attempts = CASE WHEN locked_until IS NULL THEN failed_attempts + 1 ELSE 1 END,
              locked_until = CASE
                  WHEN (CASE WHEN locked_until IS NULL THEN failed_attempts + 1 ELSE 1 END) >= ?
                  THEN ? ELSE NULL END,
              updated_at = ?
        WHERE id = ?
          AND (locked_until IS NULL OR locked_until <= ?)`,
    )
    .bind(MAX_FAILED_ATTEMPTS, bis, jetzt, id, jetzt)
    .run();
}

/**
 * Nach einer erfolgreichen Anmeldung: Zähler auf 0, Sperre weg.
 *
 * Ohne diesen Schritt summierten sich Vertipper über Wochen zu einer Sperre
 * mitten im Betrieb — ein Café, das sich viermal im Jahr vertippt, wäre beim
 * fünften Mal ausgesperrt, obwohl dazwischen jedes Mal die richtige PIN kam.
 */
export async function resetFailedAttempts(db: D1Database, id: number, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE auth_accounts
          SET failed_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(now.toISOString(), id)
    .run();
}

function toAccount(row: AuthAccountRow): AuthAccount {
  /**
   * Der Wert kommt aus einer Spalte mit CHECK-Bedingung und wird trotzdem
   * geprüft — dieselbe Begründung wie beim Fulfillment-Typ in
   * customer-repository.ts: Ein CHECK schützt gegen künftige Schreibvorgänge,
   * nicht gegen Daten, die vor einer Schemaänderung entstanden sind.
   *
   * Hier wiegt das schwerer als dort: Ein unbekannter Rollenwert, der
   * stillschweigend als 'customer' oder 'admin' durchginge, wäre eine
   * Rechtevergabe durch Zufall.
   */
  if (!isAuthRole(row.role)) {
    throw new InvalidArgumentError('Die gespeicherte Rolle des Auth-Kontos ist unbekannt.');
  }

  return {
    id: row.id,
    role: row.role,
    customerId: row.customer_id,
    credential: {
      algorithm: row.credential_algorithm,
      iterations: row.credential_iterations,
      saltHex: row.credential_salt,
      verifierHex: row.credential_verifier,
    },
    isActive: toBoolean(row.is_active),
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
  };
}
