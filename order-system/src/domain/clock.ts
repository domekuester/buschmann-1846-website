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
