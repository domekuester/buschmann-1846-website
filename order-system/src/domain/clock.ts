import { InvalidArgumentError } from './errors';

/**
 * Das Zeitmodell des Bestellsystems in zwei Sätzen:
 *
 *   Ein ZEITPUNKT (created_at, updated_at) ist ein Augenblick auf der
 *   Weltzeitachse und wird als ISO-8601 in UTC gespeichert.
 *
 *   Ein TAG (fulfillment_date) ist ein Kalendertag im Geschäftskontext
 *   Europe/Berlin und wird als 'JJJJ-MM-TT' gespeichert — ohne Uhrzeit,
 *   ohne Zeitzone, weil er keine hat. „Freitag" ist in Düsseldorf Freitag.
 *
 * Beides sauber zu trennen ist hier keine Förmlichkeit: Der Worker läuft in
 * UTC. Zwischen Mitternacht und 02:00 Uhr Berliner Zeit ist in UTC noch der
 * Vortag. Würde „heute" aus der UTC-Uhr abgeleitet, lehnte das System um
 * 00:30 Uhr eine Bestellung für den laufenden Tag als „in der Vergangenheit"
 * ab und ließe eine für den Vortag durch.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Berlin';

const BERLIN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Der Kalendertag, der an diesem Zeitpunkt in Düsseldorf gilt, als
 * 'JJJJ-MM-TT'. `en-CA` liefert genau dieses Format; die Workers-Runtime
 * bringt die vollständigen ICU-Zeitzonendaten mit.
 */
export function businessDay(instant: Date): string {
  return BERLIN_DATE_FORMAT.format(instant);
}

/**
 * Ein Zeitpunkt als ISO-8601 in UTC, mit Millisekunden und abschließendem Z.
 * Feste Länge, damit die Spalte lexikografisch sortierbar bleibt — genau das
 * macht `ORDER BY created_at` in SQLite korrekt, ohne Datumsfunktion.
 */
export function toUtcTimestamp(instant: Date): string {
  return instant.toISOString();
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Verschiebt einen Kalendertag um n Tage und liefert wieder einen
 * Kalendertag.
 *
 * Gerechnet wird über Date.UTC und NICHT über eine lokale Zeit: Ein Tag hat
 * in UTC immer exakt 86 400 Sekunden. In einer Zeitzone mit Sommerzeit hat er
 * das zweimal im Jahr nicht — dort wäre „+1 Tag" als „+24 Stunden" an einem
 * Umstellungstag um eine Stunde daneben und könnte auf denselben oder den
 * übernächsten Kalendertag fallen.
 *
 * Das ist kein Widerspruch dazu, dass ein Liefertag in Europe/Berlin gilt:
 * Der Bezugstag kommt aus businessDay() und ist damit bereits der richtige
 * Berliner Tag. Ab dort ist „der Tag danach" reine Kalenderarithmetik ohne
 * Zeitzone — genau deshalb trägt ein Liefertag auch keine Uhrzeit.
 */
export function plusDays(day: string, days: number): string {
  if (!ISO_DAY.test(day)) {
    throw new InvalidArgumentError('Der Tag muss im Format JJJJ-MM-TT vorliegen.');
  }
  if (!Number.isInteger(days)) {
    throw new InvalidArgumentError('Die Anzahl der Tage muss ganzzahlig sein.');
  }

  const parsed = new Date(`${day}T00:00:00Z`);
  // date() in SQLite und Date in JavaScript sind sich einig, dass es den
  // 30. Februar nicht gibt — aber JavaScript rollt ihn still auf den 2. März
  // weiter, statt zu scheitern. Der Rückvergleich fängt das ab.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new InvalidArgumentError('Der Tag ist kein gültiger Kalendertag.');
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
