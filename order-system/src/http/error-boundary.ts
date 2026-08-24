import { AccessDeniedError, ValidationError } from '../domain/errors';
import { json } from './responses';
import { privateHeaders } from './security';

/**
 * Die einzige Stelle, an der aus einem Fehler eine Antwort wird.
 *
 * Die Regel ist kurz: Es gibt genau drei Ausgänge, und nur zwei davon sagen
 * überhaupt etwas.
 *
 *   ValidationError    → 422 mit den feldweisen Meldungen. Diese Texte sind
 *                        für Menschen geschrieben und dürfen angezeigt
 *                        werden; sie entstehen in der Domäne, nicht aus einer
 *                        Ausnahme.
 *   AccessDeniedError  → 401. Ohne Begründung, weil jede Begründung eine
 *                        Auskunft über die Existenz eines Zugangs wäre.
 *   alles Übrige       → 500 mit einem konstanten Körper.
 *
 * Der letzte Fall ist der wichtige. Was hier ankommt, kann ein D1-Fehler mit
 * SQL-Fragment sein, eine verletzte Invariante mit Kundendaten in der
 * Nachricht oder ein Stacktrace mit Dateipfaden. Nichts davon verlässt den
 * Worker: Der Körper wird nicht aus dem Fehler GEBILDET, er ist eine
 * Konstante. Ein Filter über Fehlermeldungen wäre eine Liste von Ausnahmen,
 * die irgendwann eine vergisst.
 *
 * Bewusst wird auch nichts protokolliert: Cloudflare erfasst unbehandelte
 * Ausnahmen ohnehin, und ein eigenes console.error mit dem Anfrageinhalt
 * wäre der kürzeste Weg, einen Token in ein Log zu schreiben.
 */
export function toSafeResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return json({ error: 'validation_failed', errors: error.errors }, 422, privateHeaders());
  }

  if (error instanceof AccessDeniedError) {
    return json({ error: 'unauthorized' }, 401, privateHeaders());
  }

  return json({ error: 'internal_error' }, 500, privateHeaders());
}
