import { businessDay, businessTime, isCalendarDay, plusDays, weekdayIndex } from './clock';
import { InvalidArgumentError, ValidationError } from './errors';

/**
 * Die Bestellrichtlinie — DIE EINZIGE STELLE, an der entschieden wird, ob für
 * einen Tag noch bestellt werden darf.
 *
 * Das ist der ganze Zweck dieser Datei, und er ist wichtiger als jede
 * Einzelregel darin: Die Bestellseite fragt sie, um zu zeigen, was möglich
 * ist, und der Bestell-Endpunkt fragt sie noch einmal, unmittelbar bevor er
 * schreibt. Beide bekommen dieselbe Antwort aus demselben Code. Eine zweite
 * Fassung „nur für die Anzeige" wäre die Sorte Abweichung, die niemandem
 * auffällt, bis ein Café eine Bestellung sieht, die der Server dann ablehnt —
 * oder schlimmer: bis eine durchgeht, die es nicht sollte.
 *
 * DIE REGEL BESTEHT AUS ZWEI TEILEN, UND SIE SIND UNABHÄNGIG VONEINANDER:
 *
 *   WOCHENTAG — an welchen Tagen überhaupt produziert wird. Gilt immer; nach
 *   der Migration stehen alle sieben auf „erlaubt", womit die Regel nichts
 *   verbietet, bis jemand einen Tag ausschaltet.
 *
 *   BESTELLSCHLUSS — bis wann für einen erlaubten Tag bestellt werden kann.
 *   Hat einen eigenen Schalter und ist nach der Migration AUS.
 *
 * Die Reihenfolge der Prüfung ist fachlich und nicht beliebig: Ein Sonntag,
 * an dem nicht gebacken wird, ist kein „Bestellschluss verpasst" — er ist gar
 * kein Produktionstag. Die Meldung soll das Richtige sagen.
 *
 * WAS HIER NICHT STEHT: Feiertage, einzelne Sperrtage, Betriebsferien,
 * kundenspezifische oder produktabhängige Fristen. Diese Datei kennt sieben
 * Wahrheitswerte, eine Zahl und eine Uhrzeit — mehr nicht.
 */

/** Montag zuerst, Sonntag zuletzt — die deutsche und die ISO-8601-Zählung. */
export type WeekdayFlags = readonly [
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
];

export interface OrderPolicy {
  /** Index 0 = Montag … Index 6 = Sonntag, wie weekdayIndex() zählt. */
  readonly weekdays: WeekdayFlags;
  /** Ob der Bestellschluss überhaupt geprüft wird. */
  readonly cutoffEnabled: boolean;
  /** Kalendertage Vorlauf, 0 bis MAX_LEAD_DAYS. */
  readonly leadDays: number;
  /** Ortszeit 'HH:MM' in Europe/Berlin. */
  readonly cutoffTime: string;
}

/**
 * Die Voreinstellung — identisch mit den DEFAULTs in migrations/0016.
 *
 * SIE STEHT ZWEIMAL, UND DAS IST ABSICHT: Die Datenbank braucht sie, damit
 * eine frische Installation eine gültige Zeile hat; der Code braucht sie als
 * Rückfallwert, falls die Zeile jemals fehlt. Ein Rückfall auf „alles
 * verboten" wäre die gefährlichere Wahl — ein Lesefehler nähme dem Betrieb
 * dann sämtliche Bestellungen weg.
 */
export const DEFAULT_ORDER_POLICY: OrderPolicy = {
  weekdays: [true, true, true, true, true, true, true],
  cutoffEnabled: false,
  leadDays: 1,
  cutoffTime: '12:00',
};

/**
 * Die Obergrenze des Vorlaufs — dieselbe Zahl wie im CHECK von 0016.
 *
 * Eine Plausibilitätsgrenze gegen einen Tippfehler, keine fachliche Aussage.
 * 0 ist ausdrücklich erlaubt und heißt „am Produktionstag selbst".
 */
export const MAX_LEAD_DAYS = 30;

/**
 * Wie weit nextOrderableDay() höchstens sucht.
 *
 * DIE SCHRANKE IST DER GRUND, WARUM DIE SUCHE ÜBERHAUPT EINE SCHLEIFE SEIN
 * DARF. Ohne sie liefe sie bei sieben ausgeschalteten Wochentagen endlos —
 * und zwar in einem Worker, der dann nichts anderes mehr tut.
 *
 * 60 ist reichlich bemessen: Der schlechteste denkbare Fall ist ein Vorlauf
 * von 30 Tagen und ein einziger erlaubter Wochentag, also höchstens 30 + 7
 * Tage. Was darüber hinaus nichts findet, findet auch mit 600 nichts.
 */
export const NEXT_DAY_SEARCH_LIMIT = 60;

/** Die Formularwerte der sieben Kästchen — Reihenfolge wie WeekdayFlags. */
export const WEEKDAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

/** Die deutschen Namen, Reihenfolge wie WeekdayFlags. */
export const WEEKDAY_LABELS = [
  'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag',
] as const;

/**
 * Warum eine Bestellung nicht angenommen wird — eine feste Aufzählung und
 * keine freie Zeichenkette.
 *
 * 'allowed' ist ausdrücklich Teil davon: Der Aufrufer soll nicht zwischen
 * „Grund" und „kein Grund" unterscheiden müssen, und ein Wert, der nur
 * manchmal da ist, wird irgendwo nicht geprüft.
 */
export type OrderAvailabilityReason = 'allowed' | 'day_disabled' | 'cutoff_passed';

export interface OrderDeadline {
  /** Der Kalendertag des Bestellschlusses, 'JJJJ-MM-TT'. */
  readonly day: string;
  /** Die Ortszeit des Bestellschlusses, 'HH:MM'. */
  readonly time: string;
}

export interface OrderAvailability {
  readonly allowed: boolean;
  readonly reason: OrderAvailabilityReason;
  /**
   * Der Bestellschluss für DIESEN Tag — oder null, wenn keiner gilt.
   *
   * Er steht auch dann da, wenn die Bestellung erlaubt ist: Genau dann ist er
   * die Auskunft, die ein Café braucht („bis morgen 12:00 Uhr").
   */
  readonly deadline: OrderDeadline | null;
}

/**
 * Der Bestellschluss für einen Produktionstag.
 *
 * Tag minus lead_days KALENDERTAGE, um cutoff_time Ortszeit. Ohne aktiven
 * Bestellschluss: null.
 *
 * KALENDERTAGE UND KEINE WERKTAGE — die Regel überspringt bewusst nichts.
 * „Ein Tag vorher" heißt der Vortag, auch wenn das ein Sonntag ist. Eine
 * Werktagsrechnung müsste wissen, was ein Werktag ist, und damit wäre man
 * beim Feiertagskalender, den es in dieser Phase nicht geben soll. Der
 * Betreiber kann die Regel im Kopf nachrechnen; das ist mehr wert als eine
 * clevere Automatik, die ihn zweimal im Jahr überrascht.
 */
export function orderDeadline(policy: OrderPolicy, fulfillmentDate: string): OrderDeadline | null {
  if (!policy.cutoffEnabled) {
    return null;
  }
  return { day: plusDays(fulfillmentDate, -policy.leadDays), time: policy.cutoffTime };
}

/**
 * Darf für diesen Tag jetzt noch bestellt werden?
 *
 * DIE INKLUSIVREGEL, EINMAL UND VERBINDLICH FESTGELEGT:
 *
 *   jetzt <  Bestellschluss  →  erlaubt
 *   jetzt >= Bestellschluss  →  geschlossen
 *
 * „Bestellschluss 12:00 Uhr" heißt: um 12:00:00 ist Schluss, nicht um
 * 12:00:59. Das ist die Auslegung, die jeder Ladenschluss hat, und sie ist
 * die einzige, die an einer Stelle steht — genau hier. Eine zweite
 * Implementierung mit '>' statt '>=' wäre eine Minute Unterschied, die
 * niemand bemerkt, bis sich zwei Ansichten widersprechen.
 *
 * VERGLICHEN WERDEN ZWEI ORTSZEITEN ALS ZEICHENKETTE, nicht zwei Zeitpunkte.
 * Bei festem Format ist die lexikografische Ordnung die chronologische — es
 * ist dieselbe Entscheidung wie bei fulfillment_date, und sie erspart hier
 * die Umrechnung eines Zonenversatzes für einen fremden Tag. Warum das
 * zugleich die vollständige Sommerzeit-Behandlung ist, steht bei
 * businessTime() in clock.ts.
 *
 * WAS HIER NICHT GEPRÜFT WIRD: ob der Tag in der Vergangenheit liegt. Das ist
 * die Regel von FulfillmentDate und steht dort. Diese Funktion beantwortet
 * ausschließlich die Frage der Richtlinie.
 */
export function evaluateOrderAvailability(
  policy: OrderPolicy,
  now: Date,
  fulfillmentDate: string,
): OrderAvailability {
  if (!isCalendarDay(fulfillmentDate)) {
    throw new InvalidArgumentError('Der Produktionstag ist kein gültiger Kalendertag.');
  }

  /**
   * DER WOCHENTAG ZUERST. Ein Sonntag, an dem nicht gebacken wird, hat keinen
   * Bestellschluss — er ist gar kein Produktionstag. Wäre die Reihenfolge
   * umgekehrt, hieße es „Der Bestellschluss ist vorbei" für einen Tag, an dem
   * es nie einen gab.
   */
  if (policy.weekdays[weekdayIndex(fulfillmentDate)] !== true) {
    return { allowed: false, reason: 'day_disabled', deadline: null };
  }

  const deadline = orderDeadline(policy, fulfillmentDate);
  if (deadline === null) {
    return { allowed: true, reason: 'allowed', deadline: null };
  }

  const jetzt = `${businessDay(now)} ${businessTime(now)}`;
  const schluss = `${deadline.day} ${deadline.time}`;

  if (jetzt >= schluss) {
    return { allowed: false, reason: 'cutoff_passed', deadline };
  }
  return { allowed: true, reason: 'allowed', deadline };
}

/**
 * Der nächste Tag, für den jetzt bestellt werden kann — oder null.
 *
 * Gesucht wird ab `from` (voreingestellt: heute) vorwärts, höchstens
 * NEXT_DAY_SEARCH_LIMIT Kalendertage weit. Geprüft wird mit derselben
 * Funktion, die auch der Bestell-Endpunkt fragt; ein eigener „welcher Tag
 * ginge denn?"-Algorithmus könnte anderer Meinung sein als die Regel selbst.
 *
 * NULL IST EIN ERGEBNIS UND KEIN FEHLER. Es bedeutet: In den nächsten zwei
 * Monaten geht kein Tag — weil kein Wochentag erlaubt ist oder weil der
 * Vorlauf alles davor wegnimmt. Der Aufrufer sagt dann nichts, statt zu
 * raten.
 */
export function nextOrderableDay(
  policy: OrderPolicy,
  now: Date,
  from: string = businessDay(now),
): string | null {
  for (let versatz = 0; versatz < NEXT_DAY_SEARCH_LIMIT; versatz += 1) {
    const tag = plusDays(from, versatz);
    if (evaluateOrderAvailability(policy, now, tag).allowed) {
      return tag;
    }
  }
  return null;
}

/**
 * Warum dieser Tag nicht geht — im Klartext für ein Café. Null, wenn er geht.
 *
 * DIESER TEXT IST DIE FEHLERMELDUNG DES BESTELL-ENDPUNKTS und steht deshalb
 * hier, direkt neben der Regel, die ihn auslöst. „422 fulfillment_date_
 * invalid_policy" wäre für ein Café keine Auskunft, sondern eine Zumutung.
 *
 * DER NÄCHSTE MÖGLICHE TAG WIRD NUR GENANNT, WENN ES IHN GIBT. Er kommt aus
 * derselben Richtlinie und ist damit keine Vermutung; findet die Suche
 * keinen, schweigt der Satz darüber, statt etwas anzubieten, das dann auch
 * abgelehnt würde.
 */
export function orderUnavailableMessage(
  policy: OrderPolicy,
  now: Date,
  fulfillmentDate: string,
): string | null {
  const ergebnis = evaluateOrderAvailability(policy, now, fulfillmentDate);
  if (ergebnis.allowed) {
    return null;
  }

  const grund = ergebnis.reason === 'day_disabled'
    ? 'Für diesen Tag können wir leider keine Bestellung annehmen.'
    : `Der Bestellschluss für ${tagText(fulfillmentDate)} ist bereits vorbei.`;

  const naechster = nextOrderableDay(policy, now);
  if (naechster === null) {
    return grund;
  }
  return `${grund} Nächster möglicher Produktionstag: ${tagText(naechster)}.`;
}

/**
 * Die Richtlinie als Bedingung — DIE STELLE, DIE EINE BESTELLUNG VERHINDERT.
 *
 * Sie wirft denselben ValidationError auf demselben Feld, den auch
 * FulfillmentDate wirft: Die HTTP-Grenze macht daraus eine 422 mit einer
 * Meldung am Datumsfeld, und die Bestellseite zeigt sie dort an, wo das Café
 * gerade hingesehen hat. Es braucht dafür keinen neuen Fehlertyp und keine
 * neue Zeile im Client.
 *
 * BEIDE BESTELLWEGE RUFEN DIESE FUNKTION — der Café-Bestellfluss und der
 * Anwendungsfall aus Phase 1. Das ist der Grund, warum sie existiert und die
 * Prüfung nicht zweimal ausgeschrieben dasteht: Ein Bestellweg ohne
 * Richtlinie ist genau die Lücke, die niemandem auffällt, bis sie benutzt
 * wird.
 */
export function assertOrderableDay(policy: OrderPolicy, day: string, now: Date): void {
  const meldung = orderUnavailableMessage(policy, now, day);
  if (meldung !== null) {
    throw ValidationError.field('fulfillment_date', meldung);
  }
}

/**
 * „Wir backen montags, dienstags und freitags." — oder null, wenn alle sieben
 * Tage erlaubt sind.
 *
 * BEI SIEBEN ERLAUBTEN TAGEN STEHT DA NICHTS. Ein Hinweis, der alle Tage
 * aufzählt, ist kein Hinweis, sondern Rauschen an einer Stelle, an der ein
 * Café gerade etwas anderes tut.
 */
export function orderDaysSentence(policy: OrderPolicy): string | null {
  const erlaubt = WEEKDAY_LABELS.filter((_, index) => policy.weekdays[index] === true);

  if (erlaubt.length === WEEKDAY_LABELS.length) {
    return null;
  }
  if (erlaubt.length === 0) {
    return 'Zurzeit nehmen wir keine Bestellungen an.';
  }
  return `Wir nehmen Bestellungen für ${aufzaehlung(erlaubt)} an.`;
}

/**
 * „Bestellschluss ist einen Tag vorher um 12:00 Uhr." — oder null, wenn kein
 * Bestellschluss gilt.
 */
export function cutoffSentence(policy: OrderPolicy): string | null {
  if (!policy.cutoffEnabled) {
    return null;
  }

  const vorlauf = policy.leadDays === 0
    ? 'am Produktionstag selbst'
    : policy.leadDays === 1
      ? 'einen Tag vorher'
      : `${policy.leadDays} Tage vorher`;

  return `Bestellschluss ist ${vorlauf} um ${policy.cutoffTime} Uhr.`;
}

/**
 * Das konkrete Beispiel für die Adminseite:
 *
 *   „Für Freitag, 4. September endet die Bestellung am Donnerstag,
 *    3. September um 12:00 Uhr."
 *
 * EIN ECHTES DATUM UND KEIN ERFUNDENES. Der Beispieltag ist der nächste Tag,
 * für den nach der GESPEICHERTEN Regel tatsächlich bestellt werden kann — er
 * kommt aus nextOrderableDay() und damit aus derselben Rechnung, die auch
 * Bestellungen annimmt oder ablehnt. Ein fest eingebauter „Freitag" wäre
 * falsch, sobald freitags nicht produziert wird, und ein Satz mit
 * Wochentagsnamen ohne Datum („am Donnerstag der Vorwoche") müsste für jeden
 * Vorlauf über sechs Tage neu formuliert werden.
 *
 * Null, wenn kein Bestellschluss gilt oder es keinen möglichen Tag gibt —
 * dann gibt es nichts zu erklären.
 */
export function cutoffExampleSentence(policy: OrderPolicy, now: Date): string | null {
  if (!policy.cutoffEnabled) {
    return null;
  }

  const beispieltag = nextOrderableDay(policy, now);
  if (beispieltag === null) {
    return null;
  }

  const schluss = orderDeadline(policy, beispieltag);
  if (schluss === null) {
    return null;
  }

  return `Für ${tagText(beispieltag)} endet die Bestellung am ${tagText(schluss.day)} um ${schluss.time} Uhr.`;
}

/**
 * Ist das eine Uhrzeit, die es gibt?
 *
 * DIE GEGENSTÜCK-PRÜFUNG ZU isCalendarDay() — und aus demselben Grund zwei
 * Schritte: Das Muster allein ließe '29:71' durch, weil es Ziffern prüft und
 * keine Bereiche. Die Regel steht hier UND im CHECK von 0016; das ist keine
 * Verdopplung aus Versehen, sondern die Einsicht, dass eine Regel im
 * Anwendungscode für den Anwendungscode gilt und nicht für die Konsole.
 */
export function isCutoffTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const stunde = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  return stunde <= 23 && minute <= 59;
}

/**
 * „Montag, 31. August" — ohne Jahr.
 *
 * WARUM NICHT ui/format.ts: Diese Datei ist Domäne und darf die
 * Oberflächenschicht nicht kennen; die Abhängigkeit liefe in die falsche
 * Richtung und wäre zudem zirkulär, weil format.ts seinerseits aus der Domäne
 * liest. Die Sätze oben sind Teil der REGEL — dieselbe Formulierung erreicht
 * die abgelehnte Bestellung und die Adminseite —, und deshalb steht ihre
 * Schreibweise hier.
 *
 * OHNE JAHR, weil ein Café innerhalb der nächsten zwei Monate bestellt und
 * „Montag, 31. August 2026" in einer Fehlermeldung nach Aktenzeichen klingt.
 *
 * timeZone: 'UTC' ist kein Widerspruch zu Europe/Berlin, sondern die
 * Voraussetzung dafür — ein Produktionstag hat keine Uhrzeit und wird als
 * Mitternacht-UTC gelesen und in derselben Zone wieder ausgegeben, damit kein
 * Umrechnungsschritt ihn um einen Tag verschiebt. Dieselbe Überlegung wie in
 * ui/format.ts.
 */
const TAG_TEXT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function tagText(day: string): string {
  if (!isCalendarDay(day)) {
    throw new InvalidArgumentError('Der Tag ist kein gültiger Kalendertag.');
  }
  return TAG_TEXT.format(new Date(`${day}T00:00:00Z`));
}

/** „Montag, Dienstag und Freitag" — deutsche Aufzählung mit „und" am Ende. */
function aufzaehlung(werte: readonly string[]): string {
  if (werte.length <= 1) {
    return werte[0] ?? '';
  }
  return `${werte.slice(0, -1).join(', ')} und ${werte[werte.length - 1]}`;
}
