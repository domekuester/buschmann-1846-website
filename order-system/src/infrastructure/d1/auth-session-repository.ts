import type { AuthRole } from '../../domain/auth-role';
import {
  generateCsrfToken,
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionExpiry,
} from '../auth/session-token';
import type { AuthSessionRow } from './rows';

/**
 * Der Zugriff auf die Sitzungen.
 *
 * Die zentrale Zusage dieser Datei steht in createSession: Der Rohtoken wird
 * ZURÜCKGEGEBEN, aber nicht GESPEICHERT. In D1 landet ausschließlich sein
 * SHA-256-Hash. Es gibt in diesem Modul keine Funktion, die einen Rohtoken aus
 * der Datenbank holen könnte — weil er dort nicht steht.
 */

export interface AuthSession {
  readonly id: number;
  readonly accountId: number;
  /** Der Synchronizer-Token dieser Sitzung. Steht lesbar im ausgelieferten HTML. */
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface NewSession {
  /** Der Rohtoken. Geht ausschließlich ins Cookie und nirgendwo sonst hin. */
  readonly token: string;
  readonly csrfToken: string;
}

/**
 * Legt eine neue Sitzung an.
 *
 * Die Lebensdauer hängt an der ROLLE, nicht am Aufrufer: 30 Tage für ein Café,
 * 12 Stunden für einen Admin. Ein Parameter dafür wäre eine Gelegenheit, es an
 * einer Aufrufstelle anders zu machen.
 */
export async function createSession(
  db: D1Database,
  accountId: number,
  role: AuthRole,
  now: Date,
): Promise<NewSession> {
  const token = generateSessionToken();
  const csrfToken = generateCsrfToken();

  await db
    .prepare(
      `INSERT INTO auth_sessions (account_id, token_hash, csrf_token, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(accountId, await hashSessionToken(token), csrfToken, now.toISOString(), sessionExpiry(role, now))
    .run();

  return { token, csrfToken };
}

/**
 * Sucht eine GÜLTIGE Sitzung — und zwar nur eine solche.
 *
 * Ablauf und Widerruf stehen in der WHERE-Klausel und nicht in einer Prüfung
 * danach. Das ist kein Stil, sondern eine Absicherung: Eine Funktion, die eine
 * abgelaufene Sitzung zurückgäbe und sich darauf verließe, dass jeder Aufrufer
 * anschließend das Datum prüft, hätte irgendwann einen Aufrufer, der es
 * vergisst. Hier kann es diesen Aufrufer nicht geben.
 *
 * Der Vergleich `expires_at > ?` funktioniert ohne Datumsfunktion, weil beide
 * Werte ISO-8601-UTC mit fester Länge sind: Die lexikografische Ordnung ist
 * dort die chronologische.
 *
 * Die Formprüfung steht vor dem Datenbankzugriff. Was die Form verfehlt, kann
 * in der Tabelle nicht stehen — die Anfrage zu stellen wäre Arbeit für ein
 * sicheres Nein.
 */
export async function findValidSession(
  db: D1Database,
  token: string | null,
  now: Date,
): Promise<AuthSession | null> {
  if (!isWellFormedSessionToken(token)) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT id, account_id, csrf_token, expires_at
         FROM auth_sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?`,
    )
    .bind(await hashSessionToken(token), now.toISOString())
    .first<Pick<AuthSessionRow, 'id' | 'account_id' | 'csrf_token' | 'expires_at'>>();

  return row === null
    ? null
    : {
        id: row.id,
        accountId: row.account_id,
        csrfToken: row.csrf_token,
        expiresAt: row.expires_at,
      };
}

/**
 * Widerruft eine Sitzung — beim Abmelden.
 *
 * Die Zeile wird nicht gelöscht, sondern bekommt einen Widerrufszeitpunkt.
 * Dieselbe Regel wie bei customer_access_tokens: Ein Widerruf ohne Beleg wäre
 * eine Behauptung.
 *
 * `revoked_at IS NULL` in der WHERE-Klausel: Ein zweiter Widerruf soll den
 * ersten Zeitpunkt nicht überschreiben. Wann eine Sitzung endete, ist die
 * Information — nicht, wann jemand zuletzt auf den Knopf gedrückt hat.
 */
export async function revokeSession(db: D1Database, id: number, now: Date): Promise<void> {
  await db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now.toISOString(), id)
    .run();
}

/**
 * Widerruft alle Sitzungen eines Kontos.
 *
 * Aufgerufen beim ANMELDEN, nicht nur beim Abmelden — das ist der Schutz gegen
 * Session Fixation: Eine vorhandene, womöglich von jemand anderem
 * untergeschobene Sitzung wird beendet, bevor die neue entsteht. Es gibt damit
 * keinen Weg, eine Sitzungs-ID über eine Anmeldung hinweg am Leben zu halten.
 *
 * Die Nebenwirkung ist bewusst: Wer sich auf dem Telefon anmeldet, ist auf dem
 * Tresengerät abgemeldet. Für ein Café mit einem Bestellgerät ist das kein
 * Verlust, und die Alternative — mehrere gleichzeitige Sitzungen je Konto —
 * bräuchte eine Verwaltung, nach der niemand gefragt hat.
 */
export async function revokeAllSessionsOfAccount(
  db: D1Database,
  accountId: number,
  now: Date,
): Promise<void> {
  await db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL')
    .bind(now.toISOString(), accountId)
    .run();
}
