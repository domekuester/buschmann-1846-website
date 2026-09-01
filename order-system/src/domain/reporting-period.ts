import { isCalendarDay, plusDays, weekStart } from './clock';
import { InvalidArgumentError, ValidationError } from './errors';

/**
 * Der Zeitraum, über den die Auswertung spricht.
 *
 * ES GIBT GENAU EIN BERICHTSDATUM, UND ES STEHT HIER: der Liefer- und
 * Abholtag einer Bestellung (`orders.fulfillment_date`). Nicht der Zeitpunkt,
 * zu dem sie eingegangen ist. Der Grund ist fachlich und nicht technisch: Ein
 * Betrieb setzt an dem Tag um, an dem er backt und ausliefert — eine
 * Bestellung, die am Freitag für den folgenden Dienstag eingeht, gehört in
 * die Dienstagszahl. Es ist zugleich das Datum, mit dem Produktionsansicht,
 * Tagesüberblick und Wochenübersicht bereits rechnen; ein zweites
 * Berichtsdatum wäre eine zweite Wahrheit im selben Adminbereich.
 *
 * ALLE BEREICHE SIND HALBOFFEN — [start, end). Der letzte gemeinte Tag ist
 * `end` MINUS EINEN TAG. Die geschlossene Form (`<= sonntag`) der
 * Wochenübersicht ist für sieben feste Tage richtig; hier stoßen Monate,
 * Jahre und frei gewählte Spannen aneinander, und halboffene Bereiche sind
 * die Form, in der zwei aufeinanderfolgende Zeiträume sich weder überlappen
 * noch eine Lücke lassen. Der vergessene oder doppelt gezählte Randtag ist
 * der klassische Fehler einer Auswertung.
 *
 * DER WIRKSAME BEREICH ENDET SPÄTESTENS NACH HEUTE. Eine Auswertung
 * berichtet, was gewesen ist. Ein laufender September, der bis zum 30.
 * gerechnet würde, verglichen mit einem vollständigen August, meldete jeden
 * Monatsanfang einen Einbruch, den es nicht gibt — und Bestellungen für
 * kommende Tage gibt es in diesem System reichlich. Deshalb wird bei
 * „morgen 00:00" abgeschnitten, die Ansicht sagt „(bis heute)", und der
 * Vergleich bekommt dieselbe Spanne. Was danach kommt, steht in der
 * Übersicht und in der Produktion; dort gehört es hin.
 *
 * DIE ZEITZONE IST EUROPE/BERLIN und kommt als fertiger Tag herein. Diese
 * Datei ruft nirgends `Date.now()` auf: Ein Zeitraum, dessen Grenzen davon
 * abhängen, wann die Funktion läuft, wäre um 23:59 Uhr ein anderer als um
 * 00:01 Uhr und in keinem Test prüfbar.
 */
export const REPORTING_PERIOD_KINDS = ['heute', 'woche', 'monat', 'jahr', 'zeitraum'] as const;

export type ReportingPeriodKind = (typeof REPORTING_PERIOD_KINDS)[number];

export function isReportingPeriodKind(value: unknown): value is ReportingPeriodKind {
  return typeof value === 'string' && (REPORTING_PERIOD_KINDS as readonly string[]).includes(value);
}

/** Wie die Kurve gruppiert wird. Tage, Wochen oder Monate — mehr gibt es nicht. */
export type TrendGranularity = 'day' | 'week' | 'month';

/** Die Tage im Trend eines „Heute" — eine Woche, damit die Kurve etwas zeigt. */
const TREND_TAGE_BEI_HEUTE = 7;

/** Bis hierher zeigt eine freie Spanne Tage, bis hierher Wochen, danach Monate. */
const FREIE_SPANNE_TAGE_MAX = 31;
const FREIE_SPANNE_WOCHEN_MAX = 120;

export interface ReportingPeriod {
  readonly kind: ReportingPeriodKind;

  /** Erster gemeinter Tag, 'JJJJ-MM-TT'. */
  readonly start: string;
  /** Erster Tag DANACH. Der letzte gemeinte Tag ist `end` minus ein Tag. */
  readonly end: string;

  /** Der Vergleichszeitraum, ebenfalls halboffen. */
  readonly previousStart: string;
  readonly previousEnd: string;

  /** Der Bereich der Kurve — bei „Heute" weiter als der Zeitraum selbst. */
  readonly trendStart: string;
  readonly trendEnd: string;

  readonly granularity: TrendGranularity;

  /**
   * Der gewählte Zeitraum ist noch nicht zu Ende und wurde bei heute
   * abgeschnitten. Die Oberfläche sagt das ausdrücklich — eine Zahl „bis
   * heute", die wie eine Monatszahl aussieht, ist die unehrlichere Variante.
   */
  readonly isPartial: boolean;

  /**
   * Der Zeitraum hat überhaupt schon begonnen. Nur eine frei gewählte Spanne
   * kann vollständig in der Zukunft liegen; sie bekommt dann keine Nullen,
   * sondern einen Satz.
   */
  readonly hasStarted: boolean;

  /**
   * Der Bereich, den die beiden Bereichsabfragen lesen — Kurve,
   * Vergleichszeitraum und Zeitraum in EINEM Stück.
   *
   * Er ist der Grund, warum die Seite mit einer festen Zahl Abfragen
   * auskommt: Es gibt keine zweite Abfrage für den Vormonat und keine dritte
   * für die Kurve. Die Domäne verteilt die Tage danach selbst; Tage, die in
   * keinen der drei Bereiche fallen, zählt sie nirgends mit.
   */
  readonly queryStart: string;
  readonly queryEnd: string;
}

/**
 * Bildet den Zeitraum aus der Auswahl und dem heutigen Tag.
 *
 * @param today Der Geschäftstag in Europe/Berlin — 'JJJJ-MM-TT'.
 * @param from  Nur bei 'zeitraum': der erste gemeinte Tag, einschließlich.
 * @param to    Nur bei 'zeitraum': der letzte gemeinte Tag, EINSCHLIESSLICH.
 *              Die Oberfläche fragt „von … bis …", und „bis" heißt für einen
 *              Menschen einschließlich. Die halboffene Form entsteht hier.
 */
export function resolveReportingPeriod(
  kind: ReportingPeriodKind,
  today: string,
  from: string | null = null,
  to: string | null = null,
): ReportingPeriod {
  if (!isCalendarDay(today)) {
    throw new InvalidArgumentError('Der heutige Tag ist kein gültiger Kalendertag.');
  }
  const morgen = plusDays(today, 1);

  const spanne = kind === 'zeitraum' ? freieSpanne(from, to) : festeSpanne(kind, today);

  // Der Schnitt bei „morgen 00:00" — die eine Regel, die für alle fünf Arten
  // gleichermaßen gilt. Ein Zeitraum, der ganz in der Zukunft liegt, wird
  // dabei leer und nicht negativ.
  const end = spanne.naturalEnd < morgen ? spanne.naturalEnd : morgen;
  const hasStarted = spanne.start < morgen;
  const wirksamesEnde = hasStarted ? end : spanne.start;
  const isPartial = wirksamesEnde < spanne.naturalEnd;

  const vergleich = vergleichszeitraum(kind, spanne, wirksamesEnde, isPartial);
  const trend = kurvenbereich(kind, spanne.start, wirksamesEnde, today, morgen);

  return {
    kind,
    start: spanne.start,
    end: wirksamesEnde,
    previousStart: vergleich.start,
    previousEnd: vergleich.end,
    trendStart: trend.start,
    trendEnd: trend.end,
    granularity: koernung(kind, spanne.start, wirksamesEnde),
    isPartial,
    hasStarted,
    queryStart: kleinster([trend.start, vergleich.start, spanne.start]),
    queryEnd: groesster([trend.end, wirksamesEnde]),
  };
}

/** Der ungeschnittene Zeitraum einer der vier festen Arten. */
interface Spanne {
  readonly start: string;
  /** Das Ende, das der Kalender vorgibt — vor dem Schnitt bei heute. */
  readonly naturalEnd: string;
}

function festeSpanne(kind: Exclude<ReportingPeriodKind, 'zeitraum'>, today: string): Spanne {
  switch (kind) {
    case 'heute':
      return { start: today, naturalEnd: plusDays(today, 1) };
    case 'woche': {
      // weekStart() ist die einzige Stelle im System, an der steht, dass eine
      // Woche montags beginnt.
      const montag = weekStart(today);
      return { start: montag, naturalEnd: plusDays(montag, 7) };
    }
    case 'monat': {
      const anfang = monatsAnfang(today);
      return { start: anfang, naturalEnd: monatVersetzt(anfang, 1) };
    }
    case 'jahr': {
      const anfang = `${today.slice(0, 4)}-01-01`;
      return { start: anfang, naturalEnd: `${Number(today.slice(0, 4)) + 1}-01-01` };
    }
  }
}

function freieSpanne(from: string | null, to: string | null): Spanne {
  if (from === null || from === '' || to === null || to === '') {
    throw ValidationError.field('zeitraum', 'Bitte gib einen Von- und einen Bis-Tag an.');
  }
  if (!isCalendarDay(from)) {
    throw ValidationError.field('from', 'Bitte gib einen gültigen Von-Tag an.');
  }
  if (!isCalendarDay(to)) {
    throw ValidationError.field('to', 'Bitte gib einen gültigen Bis-Tag an.');
  }
  if (to < from) {
    throw ValidationError.field('to', 'Der Bis-Tag darf nicht vor dem Von-Tag liegen.');
  }
  // „bis 14.08." heißt einschließlich des 14. — die halboffene Form entsteht
  // an genau dieser einen Stelle und nirgends sonst.
  return { start: from, naturalEnd: plusDays(to, 1) };
}

/**
 * Der Vergleichszeitraum.
 *
 * DIE REGEL HAT ZWEI FÄLLE UND NICHT FÜNF:
 *
 *   Zeitraum vollständig  → der ganze vorherige Zeitraum derselben Art.
 *                           Ein abgeschlossener August wird mit dem ganzen
 *                           Juli verglichen, nicht mit dessen ersten 31
 *                           Tagen (die es nicht gibt).
 *   Zeitraum angeschnitten → die GLEICH LANGE Anfangsspanne des vorherigen
 *                           Zeitraums. Der 1.–15. September gegen den
 *                           1.–15. August; alles andere meldete jeden
 *                           Monatsanfang einen Einbruch.
 *
 * Die freie Spanne kennt nur einen Fall: die gleich lange Spanne unmittelbar
 * davor. Es gibt bei ihr keinen „vorherigen Zeitraum derselben Art", den der
 * Kalender vorgäbe.
 */
function vergleichszeitraum(
  kind: ReportingPeriodKind,
  spanne: Spanne,
  end: string,
  isPartial: boolean,
): { start: string; end: string } {
  const laenge = tageZwischen(spanne.start, end);

  switch (kind) {
    case 'heute':
      return { start: plusDays(spanne.start, -1), end: spanne.start };

    case 'woche': {
      const vormontag = plusDays(spanne.start, -7);
      return { start: vormontag, end: plusDays(vormontag, isPartial ? laenge : 7) };
    }

    case 'monat': {
      const vormonat = monatVersetzt(spanne.start, -1);
      if (!isPartial) {
        return { start: vormonat, end: spanne.start };
      }
      // Der 31. Januar hat im Februar keine Entsprechung. Geklemmt wird auf
      // die Länge des Vormonats — lieber ein etwas kürzerer Vergleich als
      // einer, der in den März hineinragt.
      const tageImVormonat = tageZwischen(vormonat, spanne.start);
      return { start: vormonat, end: plusDays(vormonat, Math.min(laenge, tageImVormonat)) };
    }

    case 'jahr': {
      const vorjahr = `${Number(spanne.start.slice(0, 4)) - 1}-01-01`;
      if (!isPartial) {
        return { start: vorjahr, end: spanne.start };
      }
      // Der letzte gemeinte Tag, um ein Jahr zurückversetzt. Der 29. Februar
      // rutscht dabei auf den 28. — ein Vergleich, der einen Tag kürzer ist,
      // ist besser als einer, der auf den 1. März springt.
      const letzterTag = plusDays(end, -1);
      return { start: vorjahr, end: plusDays(jahrVersetzt(letzterTag, -1), 1) };
    }

    case 'zeitraum':
      return { start: plusDays(spanne.start, -laenge), end: spanne.start };
  }
}

/**
 * Der Bereich der Kurve.
 *
 * ER IST NUR BEI „HEUTE" EIN ANDERER als der Zeitraum selbst. Ein einzelner
 * Tag ergibt einen einzelnen Balken, und ein Diagramm mit einem Balken ist
 * kein Diagramm, sondern eine Zahl mit Achsen daneben. Die Kurve zeigt
 * deshalb die letzten sieben Tage einschließlich heute und sagt das auch —
 * die Kennzahlen darüber bleiben davon unberührt und meinen weiterhin genau
 * heute.
 */
function kurvenbereich(
  kind: ReportingPeriodKind,
  start: string,
  end: string,
  today: string,
  morgen: string,
): { start: string; end: string } {
  if (kind !== 'heute') {
    return { start, end };
  }
  return { start: plusDays(today, -(TREND_TAGE_BEI_HEUTE - 1)), end: morgen };
}

function koernung(kind: ReportingPeriodKind, start: string, end: string): TrendGranularity {
  if (kind === 'jahr') return 'month';
  if (kind !== 'zeitraum') return 'day';

  const tage = tageZwischen(start, end);
  if (tage <= FREIE_SPANNE_TAGE_MAX) return 'day';
  if (tage <= FREIE_SPANNE_WOCHEN_MAX) return 'week';
  return 'month';
}

/* -------------------------------------------------------------------------
   Kalenderrechnen — bewusst hier und nicht in clock.ts.

   clock.ts beantwortet „welcher Tag ist in Düsseldorf gerade?" und rechnet
   in TAGEN. Monats- und Jahresgrenzen braucht bisher nichts außer dieser
   Datei; sie dort abzulegen hieße, das Zeitzonenmodul um eine Rolle zu
   erweitern, die es nirgends sonst hat.
   ------------------------------------------------------------------------- */

function monatsAnfang(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Der Monatserste, `months` Monate versetzt. Trägt über den Jahreswechsel. */
function monatVersetzt(monatsErster: string, months: number): string {
  const jahr = Number(monatsErster.slice(0, 4));
  const monat = Number(monatsErster.slice(5, 7));
  // Nullbasiert rechnen, damit Date.UTC den Überlauf in beide Richtungen
  // selbst auf das Jahr verteilt — Dezember + 1 wird Januar des Folgejahres.
  const verschoben = new Date(Date.UTC(jahr, monat - 1 + months, 1));
  return verschoben.toISOString().slice(0, 10);
}

/**
 * Derselbe Tag, `years` Jahre versetzt — mit dem 29. Februar als einzigem
 * Sonderfall. Er wird auf den 28. geklemmt und nicht auf den 1. März
 * weitergerollt, wie es die Datumsarithmetik von JavaScript täte.
 */
function jahrVersetzt(day: string, years: number): string {
  const jahr = Number(day.slice(0, 4)) + years;
  const kandidat = `${String(jahr).padStart(4, '0')}${day.slice(4)}`;
  if (isCalendarDay(kandidat)) {
    return kandidat;
  }
  return `${String(jahr).padStart(4, '0')}-02-28`;
}

/** Die Zahl der Tage in [von, bis) — nie negativ. */
export function tageZwischen(von: string, bis: string): number {
  const a = Date.parse(`${von}T00:00:00Z`);
  const b = Date.parse(`${bis}T00:00:00Z`);
  const tage = Math.round((b - a) / 86_400_000);
  return tage > 0 ? tage : 0;
}

function kleinster(tage: readonly string[]): string {
  return tage.reduce((a, b) => (a <= b ? a : b));
}

function groesster(tage: readonly string[]): string {
  return tage.reduce((a, b) => (a >= b ? a : b));
}
