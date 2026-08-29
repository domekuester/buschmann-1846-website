import { ValidationError } from './errors';
import { businessDay, isCalendarDay } from './clock';

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
    // Form UND Existenz des Tages — isCalendarDay prüft beides und ist die
    // einzige Stelle im System, an der diese Prüfung steht. '2026-02-30'
    // passt auf das Muster und existiert trotzdem nicht.
    if (!isCalendarDay(value)) {
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

  /**
   * Rekonstruiert einen gespeicherten Tag. Geprüft wird die Form, NICHT die
   * Vergangenheit: Die Regel „nicht in der Vergangenheit" gehört zum
   * Bestellvorgang, nicht zum Lesen. Eine Bestellung von letzter Woche muss
   * lesbar bleiben.
   */
  static restore(value: string): FulfillmentDate {
    if (!isCalendarDay(value)) {
      throw FulfillmentDate.invalid();
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
