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
 * Ist das ein Kalendertag, den es wirklich gibt?
 *
 * DIE EINZIGE STELLE, an der diese Frage beantwortet wird. Sie stand vorher
 * zweimal wörtlich in FulfillmentDate und wird seit Phase 3B auch vom
 * Produktions-Endpunkt gebraucht — drei Kopien derselben Regel wären drei
 * Gelegenheiten, dass eine davon den 30. Februar durchlässt.
 *
 * ZWEI PRÜFUNGEN, UND DIE ZWEITE IST DIE WICHTIGE:
 *
 * Das Muster allein genügt nicht. '2026-02-30' und '2026-13-01' passen darauf
 * und existieren trotzdem nicht. JavaScript rollt sie still auf den 2. März
 * und den 1. Januar weiter, statt zu scheitern — deshalb wird der Tag
 * zurückgerechnet und mit der Eingabe verglichen. Ein übergelaufener Monat
 * fällt dabei auf.
 *
 * Das ausdrückliche 'T00:00:00Z' ist kein Zierrat: Ohne Zonenangabe
 * interpretieren manche Laufzeiten eine reine Datumszeichenkette als lokale
 * Zeit, und dann kann der Rückvergleich in einer Zone westlich von Greenwich
 * einen Tag daneben liegen. Mit Z ist die Rechnung überall dieselbe.
 *
 * WAS DIESE FUNKTION NICHT PRÜFT: ob der Tag in der Vergangenheit liegt, ob
 * das Jahr plausibel ist und ob an diesem Tag geliefert wird. Das sind Regeln
 * des BESTELLENS und stehen dort, wo bestellt wird. Ein Lesezugriff auf einen
 * vergangenen Produktionstag ist völlig in Ordnung.
 */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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
  // date() in SQLite und Date in JavaScript sind sich einig, dass es den
  // 30. Februar nicht gibt — aber JavaScript rollt ihn still auf den 2. März
  // weiter, statt zu scheitern. isCalendarDay fängt das ab.
  if (!isCalendarDay(day)) {
    throw new InvalidArgumentError('Der Tag ist kein gültiger Kalendertag.');
  }

  const parsed = new Date(`${day}T00:00:00Z`);

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Der MONTAG der Kalenderwoche, in der dieser Tag liegt.
 *
 * DIE WOCHE IST MONTAG BIS SONNTAG und nicht „die letzten sieben Tage". Der
 * Unterschied ist der Grund, warum diese Funktion überhaupt existiert: Ein
 * rollendes Fenster hätte für jeden Tag eine andere Woche — dieselbe Ansicht
 * zweimal geöffnet zeigte zweimal etwas anderes, ein Lesezeichen zeigte
 * morgen einen anderen Ausschnitt als heute, und „diese Woche" wäre für einen
 * vergangenen oder künftigen Tag gar nicht definiert. Die Kalenderwoche ist
 * dagegen für JEDEN Tag dieselbe, gestern wie in drei Monaten.
 *
 * Montag als erster Tag ist die deutsche und die ISO-8601-Zählung; ein Betrieb
 * plant seine Woche ab Montag, und der Sonntag schließt sie ab.
 *
 * GERECHNET WIRD IN UTC, aus demselben Grund wie in plusDays(): Ein Tag hat
 * dort immer 86 400 Sekunden. `getUTCDay()` zählt von 0 = Sonntag; `(tag + 6)
 * % 7` macht daraus den Abstand zum Montag — Montag 0, Sonntag 6. Das ist der
 * ganze Trick, und er kommt ohne Sonderfall für den Sonntag aus, an dem die
 * naive Fassung `tag - 1` einen Tag in die FOLGENDE Woche springt.
 *
 * Der Tag wird über plusDays() zurückgerechnet und nicht von Hand: Damit
 * gelten Monats-, Jahres- und Schaltjahresgrenzen hier automatisch so wie
 * überall sonst, und es gibt keine zweite Datumsarithmetik im System.
 */
export function weekStart(day: string): string {
  if (!isCalendarDay(day)) {
    throw new InvalidArgumentError('Der Tag ist kein gültiger Kalendertag.');
  }

  const wochentag = new Date(`${day}T00:00:00Z`).getUTCDay();
  return plusDays(day, -((wochentag + 6) % 7));
}
