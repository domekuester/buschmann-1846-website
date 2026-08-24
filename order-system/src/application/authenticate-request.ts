import type { Customer } from '../domain/customer';
import { findAccountById } from '../infrastructure/d1/auth-account-repository';
import { findValidSession } from '../infrastructure/d1/auth-session-repository';
import { findCustomer } from '../infrastructure/d1/customer-repository';

/**
 * Die Prüfung eines Sitzungstokens — und die einzige Stelle, an der aus einem
 * Cookie eine Identität wird.
 *
 * EIN SITZUNGSTOKEN IST KEIN DAUERAUSWEIS.
 *
 * Das ist der Satz, um den es hier geht. Naheliegend wäre, beim Anmelden
 * Rolle und Kunde zu ermitteln und beides der Sitzung mitzugeben — dann
 * genügte später ein Blick in die Sitzungszeile, und jeder Request wäre eine
 * Abfrage billiger. Genau das wird hier NICHT getan: Rolle, Konto-Aktivität
 * und Café-Aktivität werden bei JEDEM geschützten Request neu aus D1 gelesen.
 *
 * Der Unterschied ist der Betrieb. Wird ein Café deaktiviert, endet sein
 * Zugriff beim nächsten Request — nicht in 30 Tagen, wenn die Sitzung von
 * selbst abläuft. Wer eine Kundensitzung 30 Tage gültig lässt, muss sie auch
 * 30 Tage lang beenden können.
 */

/**
 * Was der Server über den Aufrufer weiß — und ausschließlich das.
 *
 * Ein diskriminierter Verbund und kein Objekt mit optionalem `customer`: So
 * ist es dem Typsystem nach unmöglich, für einen Admin einen Kunden zu lesen
 * oder für ein Café zu vergessen, dass es einen gibt. Die Rollentrennung
 * steht damit im Typ und nicht in einer Prüfung, die jemand vergessen kann.
 *
 * Der `csrfToken` gehört hierher, weil jede schreibende Route ihn braucht und
 * er an der Sitzung hängt — ihn ein zweites Mal zu laden wäre eine zweite
 * Abfrage für einen Wert, der bereits vorliegt.
 */
export type AuthContext =
  | {
      readonly role: 'customer';
      readonly accountId: number;
      readonly sessionId: number;
      readonly csrfToken: string;
      readonly customer: Customer;
    }
  | {
      readonly role: 'admin';
      readonly accountId: number;
      readonly sessionId: number;
      readonly csrfToken: string;
    };

/**
 * Löst einen Sitzungstoken zu einem AuthContext auf — oder zu null.
 *
 * ALLE ABLEHNUNGSGRÜNDE SIND EIN EINZIGES null:
 *
 *   kein Cookie · formal ungültig · unbekannt · abgelaufen · widerrufen ·
 *   Konto weg · Konto deaktiviert · Café weg · Café deaktiviert
 *
 * Der Aufrufer kann sie nicht unterscheiden, weil er es nicht muss: Für die
 * HTTP-Schicht ist die Antwort in jedem Fall dieselbe — Weiterleitung zum
 * Login bei einer Seite, 401 bei einer API. Eine Unterscheidung wäre eine
 * Auskunft ohne Zweck.
 *
 * Die Rolle kommt aus D1, niemals aus dem Token. Der Token trägt überhaupt
 * keine Information: Er ist 32 Byte Zufall und bedeutet nichts außer sich
 * selbst.
 */
export async function authenticateRequest(
  db: D1Database,
  token: string | null,
  now: Date,
): Promise<AuthContext | null> {
  const session = await findValidSession(db, token, now);
  if (session === null) {
    return null;
  }

  const account = await findAccountById(db, session.accountId);
  if (account === null || !account.isActive) {
    return null;
  }

  if (account.role === 'admin') {
    return {
      role: 'admin',
      accountId: account.id,
      sessionId: session.id,
      csrfToken: session.csrfToken,
    };
  }

  /**
   * Das Schema erzwingt einen Kundenbezug für die Rolle 'customer'. Die
   * Prüfung steht trotzdem hier — ohne sie wäre der Zugriff auf
   * `account.customerId` eine Behauptung, und ein Konto in unmöglichem
   * Zustand würde dann nicht abgelehnt, sondern führte zu einer Ausnahme.
   */
  if (account.customerId === null) {
    return null;
  }

  const customer = await findCustomer(db, account.customerId);
  if (customer === null || !customer.isActive) {
    return null;
  }

  return {
    role: 'customer',
    accountId: account.id,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    customer,
  };
}
