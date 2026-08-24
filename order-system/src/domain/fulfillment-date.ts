import { ValidationError } from './errors';
import { businessDay } from './clock';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Liefer- oder Abholtag — ein Kalendertag ohne Uhrzeit.
 *
 * Ein Café bestellt „für Freitag", nicht „für Freitag 14:32". Deshalb ist der
 * gespeicherte Wert eine Zeichenkette 'JJJJ-MM-TT' und kein Zeitstempel: Ein
 * Zeitstempel müsste eine Zeitzone mitführen, die es hier fachlich nicht gibt,
 * und würde bei jeder Umrechnung um einen Tag springen können.
 *
 * Der Vergleichszeitpunkt wird übergeben. Ein interner Zugriff auf Date.now()
 * würde die Regel untestbar machen und Tests am Jahreswechsel kippen lassen.
 *
 * Vorlaufzeiten („bis Mittwoch für Freitag") sind Phase 2 und gehören dann an
 * genau diese Stelle.
 */
export class FulfillmentDate {
  private constructor(readonly value: string) {}

  static fromString(value: string, now: Date): FulfillmentDate {
    if (!ISO_DAY.test(value)) {
      throw FulfillmentDate.invalid();
    }

    // Die Formatprüfung allein genügt nicht: '2026-02-30' und '2026-13-01'
    // passen auf das Muster. Deshalb wird der Tag zurückgerechnet und mit der
    // Eingabe verglichen — ein überrollter Monat fällt dabei auf.
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw FulfillmentDate.invalid();
    }
    // Ein vierstelliges Jahr vor 2000 ist kein Liefertag, sondern ein Tippfehler.
    if (value.slice(0, 4) < '2000') {
      throw FulfillmentDate.invalid();
    }

    // Zeichenkettenvergleich statt Datumsarithmetik: Bei festem Format
    // 'JJJJ-MM-TT' ist die lexikografische Ordnung die chronologische.
    if (value < businessDay(now)) {
      throw ValidationError.field(
        'fulfillment_date',
        'Der Liefer- oder Abholtag darf nicht in der Vergangenheit liegen.',
      );
    }

    return new FulfillmentDate(value);
  }

  toString(): string {
    return this.value;
  }

  private static invalid(): ValidationError {
    return ValidationError.field(
      'fulfillment_date',
      'Bitte ein gültiges Datum im Format JJJJ-MM-TT angeben.',
    );
  }
}
