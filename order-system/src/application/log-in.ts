import type { AuthRole } from '../domain/auth-role';
import { normalizeLoginIdentifier } from '../domain/login-identifier';
import type { AppConfig } from '../config/app-config';
import { verifyCredential, verifyDummyCredential } from '../infrastructure/auth/credential';
import { SESSION_TTL_SECONDS } from '../infrastructure/auth/session-token';
import {
  findAccountByIdentifier,
  recordFailedAttempt,
  resetFailedAttempts,
  type AuthAccount,
} from '../infrastructure/d1/auth-account-repository';
import {
  createSession,
  findValidSession,
  revokeAllSessionsOfAccount,
  revokeSession,
} from '../infrastructure/d1/auth-session-repository';
import { findCustomer } from '../infrastructure/d1/customer-repository';

/**
 * Der Anmeldevorgang.
 *
 * Diese Funktion kennt genau zwei Ausgänge: eine neue Sitzung oder `null`.
 * Der GRUND einer Ablehnung verlässt sie nicht — nicht als Fehlerart, nicht
 * als Feld, nicht als abweichende Laufzeit. Jede Unterscheidung wäre eine
 * Auskunft darüber, ob ein bestimmtes Konto existiert.
 */

export interface LogInCommand {
  /** Ungeprüft aus dem Formular. */
  identifier: unknown;
  /** Ungeprüft aus dem Formular. Immer als Zeichenkette behandelt. */
  secret: unknown;
  now: Date;
  /**
   * Eine mitgeschickte Sitzung — sie wird bei Erfolg WIDERRUFEN, nie
   * übernommen. Das ist der Schutz gegen Session Fixation.
   */
  existingSessionToken: string | null;
}

export interface LogInSuccess {
  role: AuthRole;
  /** Der Rohtoken. Geht ausschließlich ins Cookie. */
  token: string;
  csrfToken: string;
  maxAgeSeconds: number;
}

/**
 * Meldet an — oder lehnt ab, ohne zu sagen warum.
 *
 * DIE REIHENFOLGE IST DURCHWEG ABSICHT:
 *
 *   1. Kennung normalisieren. Was hier durchfällt, kann kein Konto treffen.
 *   2. Konto laden — auch ein deaktiviertes (siehe Repository).
 *   3. Gesperrt? Dann Dummy-Verifikation und Ablehnung.
 *   4. Sonst: Credential prüfen.
 *   5. Erst DANACH Konto-Aktivität und Café-Aktivität prüfen.
 *   6. Zähler zurücksetzen, alte Sitzungen widerrufen, neue Sitzung anlegen.
 *
 * WARUM SCHRITT 5 NACH SCHRITT 4 STEHT
 *
 * Ein deaktiviertes Konto, das ohne Credential-Prüfung abgelehnt würde, wäre
 * an der Antwortzeit erkennbar — und damit wäre genau die Menge der
 * existierenden, deaktivierten Konten aufzählbar. Die Prüfung kostet 8 bis
 * 45 ms für einen Zugang, der ohnehin abgelehnt wird; das ist der Preis
 * dafür, dass die Ablehnung nichts verrät.
 *
 * WARUM AUCH EIN GESPERRTES KONTO EINE ABLEITUNG KOSTET
 *
 * Naheliegend wäre, bei laufender Sperre sofort abzulehnen und die 45 ms zu
 * sparen. Das erzeugte aber ein Aufzählungsverfahren: Wer fünfmal auf eine
 * geratene Kennung tippt und danach schnellere Antworten bekommt, hat
 * bestätigt, dass es sie gibt. Der Einwand „ein gesperrtes Konto soll keine
 * CPU kosten" trägt nicht — eine UNBEKANNTE Kennung kostet dieselbe
 * Ableitung, ein Angreifer gewinnt durch das Sperren also nichts.
 *
 * Die echte Verifikation läuft bei einer Sperre trotzdem nicht: Sie wäre
 * sinnlos, weil das Ergebnis nicht zählt. Stattdessen die Dummy-Ableitung,
 * die denselben Aufwand hat.
 */
export async function logIn(
  db: D1Database,
  config: AppConfig,
  command: LogInCommand,
): Promise<LogInSuccess | null> {
  const identifier = normalizeLoginIdentifier(command.identifier);
  const secret = typeof command.secret === 'string' ? command.secret : null;

  const account =
    identifier === null || secret === null ? null : await findAccountByIdentifier(db, identifier);

  /**
   * Kein Konto — sei es, weil die Kennung unbekannt ist, formal unmöglich
   * oder gar keine Zeichenkette. Alle drei Fälle kosten dieselbe Ableitung
   * und liefern dieselbe Antwort.
   */
  if (account === null || secret === null) {
    await verifyDummyCredential(config.pepper);
    return null;
  }

  if (isLocked(account, command.now)) {
    await verifyDummyCredential(config.pepper);
    return null;
  }

  const stimmt = await verifyCredential(secret, config.pepper, account.credential);
  if (!stimmt) {
    await recordFailedAttempt(db, account.id, command.now);
    return null;
  }

  /**
   * Ab hier ist das Geheimnis richtig — und trotzdem kann die Anmeldung noch
   * scheitern. Diese beiden Prüfungen sind die Antwort auf „das Café ist
   * nicht mehr Kunde" und „dieser Zugang wurde gesperrt": Sie sind
   * ausdrücklich KEIN Fehlversuch und zählen deshalb auch keinen hoch. Wer
   * das richtige Geheimnis kennt, soll sich nicht selbst aussperren können.
   */
  if (!account.isActive) {
    return null;
  }

  if (account.role === 'customer') {
    if (account.customerId === null) {
      // Vom Schema ausgeschlossen. Wenn es doch vorkommt, ist es kein Zugang.
      return null;
    }

    const customer = await findCustomer(db, account.customerId);
    if (customer === null || !customer.isActive) {
      return null;
    }
  }

  await resetFailedAttempts(db, account.id, command.now);
  await revokePreviousSessions(db, account.id, command.existingSessionToken, command.now);

  const { token, csrfToken } = await createSession(db, account.id, account.role, command.now);

  return {
    role: account.role,
    token,
    csrfToken,
    maxAgeSeconds: SESSION_TTL_SECONDS[account.role],
  };
}

/**
 * Die Sperre ist abgelaufen, sobald ihr Zeitpunkt erreicht ist.
 *
 * Zeichenkettenvergleich: Beide Werte sind ISO-8601-UTC mit fester Länge, dort
 * ist die lexikografische Ordnung die chronologische — dieselbe Eigenschaft,
 * auf der schon `expires_at > ?` in SQL beruht.
 */
function isLocked(account: AuthAccount, now: Date): boolean {
  return account.lockedUntil !== null && account.lockedUntil > now.toISOString();
}

/**
 * Kein Session Fixation Pattern: Vor der neuen Sitzung endet jede alte.
 *
 * Zwei Schritte, weil es zwei verschiedene Dinge sind:
 *
 *   Alle Sitzungen DIESES Kontos — damit eine ältere Anmeldung desselben
 *   Cafés nicht weiterläuft.
 *
 *   Die MITGESCHICKTE Sitzung, auch wenn sie zu einem anderen Konto gehört.
 *   Sonst bliebe eine untergeschobene fremde Sitzung in D1 gültig, während
 *   der Browser sie nur nicht mehr im Cookie trägt.
 */
async function revokePreviousSessions(
  db: D1Database,
  accountId: number,
  existingSessionToken: string | null,
  now: Date,
): Promise<void> {
  await revokeAllSessionsOfAccount(db, accountId, now);

  const mitgeschickt = await findValidSession(db, existingSessionToken, now);
  if (mitgeschickt !== null) {
    await revokeSession(db, mitgeschickt.id, now);
  }
}
