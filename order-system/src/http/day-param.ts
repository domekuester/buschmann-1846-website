import { isCalendarDay } from '../domain/clock';

/**
 * DER GEMEINSAME DATUMSPARAMETER ALLER TAGESBEZOGENEN ADMINSEITEN.
 *
 * Er stand bis Phase 6A als private Funktion in http/admin-page.ts. Mit dem
 * Dashboard gibt es eine zweite Seite mit derselben Frage — und zwei
 * Fassungen dieser Prüfung wären zwei Meinungen darüber, was ein Tag ist:
 * Die eine würde eines Tages mehrfache Parameter zulassen, die andere nicht,
 * und welche das ist, merkte niemand.
 *
 * Die Begründungen unten sind unverändert die aus Phase 3C.
 */

/**
 * Liest den angefragten Kalendertag aus der URL.
 *
 * Drei Ergebnisse, und alle drei sind verschieden:
 *
 *   string      ein gültiger Tag wurde angefragt.
 *   null        es wurde keiner angefragt — der Standardtag greift.
 *   'invalid'   es wurde etwas angefragt, das kein Kalendertag ist.
 *
 * Der Unterschied zwischen null und 'invalid' ist der Kern dieser Funktion:
 * Ein fehlender Parameter ist der Normalfall und bekommt den Standardtag; ein
 * FALSCHER Parameter darf ihn NICHT bekommen. Sonst zeigte ein Lesezeichen
 * mit einem Tippfehler eine korrekt aussehende Backliste für einen anderen
 * Tag, ohne es zu sagen — und jemand backt nach der falschen Liste.
 *
 * MEHRFACHE PARAMETER WERDEN ABGELEHNT, statt still den ersten zu nehmen —
 * wie in production-api.ts. Welcher der erste ist, hängt an der Reihenfolge
 * in der URL; ein Endpunkt, dessen Antwort von einer solchen Feinheit
 * abhängt, lädt zu Parameter-Schmuggel ein.
 *
 * GEPRÜFT WIRD MIT isCalendarDay — derselben Funktion, die der
 * Produktions-Endpunkt und FulfillmentDate benutzen. Es gibt im System genau
 * eine Stelle, die weiß, ob es einen Tag gibt; '2026-02-30' passt auf das
 * Muster und existiert trotzdem nicht.
 *
 * DAMIT IST AUCH JEDE WEITERLEITUNG NACH DRAUSSEN AUSGESCHLOSSEN: Was diese
 * Funktion zurückgibt, ist entweder null oder eine Zeichenkette der Form
 * JJJJ-MM-TT. '//angreifer.test' und 'https://angreifer.test' sind keine
 * Kalendertage und kommen nicht durch.
 */
export function readDayParam(request: Request): string | null | 'invalid' {
  const werte = new URL(request.url).searchParams.getAll('date');

  if (werte.length === 0) {
    return null;
  }
  if (werte.length > 1) {
    return 'invalid';
  }

  const wert = werte[0];
  return isCalendarDay(wert) ? wert : 'invalid';
}
