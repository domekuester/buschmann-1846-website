import { plusDays } from '../domain/clock';
import type {
  DashboardWeek,
  DashboardWeekDay,
  DashboardWeekSummary,
} from '../domain/dashboard-week';
import {
  formatEuro,
  formatGermanDayMonthYear,
  formatGermanShortDate,
  formatGermanWeekday,
  formatPercentFromTenths,
} from './format';
import { toQuickDaysView, type QuickDayView, type QuickDaysView } from './dashboard-view';

/**
 * Das Ansichtsmodell der Wochenübersicht.
 *
 * DIESELBE SCHICHTUNG WIE BEIM TAG: Das Lesemodell rechnet, diese Datei
 * schreibt auf. Sie hat keine Uhr, keine Datenbank und keinen Request;
 * dasselbe Modell ergibt immer dieselbe Ansicht.
 *
 * SIE IST BEWUSST KARG. Sieben Zeilen mit fünf Angaben, eine Summe und die
 * Wege hinaus. Kein Diagramm, kein Vergleich mit der Vorwoche, kein
 * Trendpfeil, keine Hervorhebung eines „besten Tages" — die Wochenansicht
 * sagt, WO etwas los ist, und übergibt die Frage nach dem WIE an die
 * Tagesansicht, die es ausführlich beantwortet. Jede Zeile ist deshalb ein
 * Link.
 *
 * DER EINE PROZENTSATZ SEIT PHASE 7B ist die Ausnahme, die die Regel
 * bestätigt: Er vergleicht keine Zeiträume, sondern setzt zwei Zahlen
 * DESSELBEN Tages ins Verhältnis. Genau deshalb ist er die einzige Angabe der
 * Tabelle, die sich zwischen zwei Tagen überhaupt vergleichen lässt.
 *
 * EIN STRICH IST KEINE NULL. Ein Tag ohne Bestellung bekommt „—" bei
 * Produktion und Zahlung und nicht „erledigt"/„bezahlt": Wo nichts bestellt
 * wurde, ist auch nichts erledigt worden. Der Unterschied klingt klein und
 * ist der zwischen „der Donnerstag war ruhig" und „am Donnerstag ist alles
 * geschafft".
 */

/** Eine Wochentagszeile — fertig beschriftet. */
export interface DashboardWeekDayView {
  readonly date: string;
  /** „Montag". */
  readonly weekdayLabel: string;
  /** „24.08." — ohne Jahr, das steht in der Überschrift. */
  readonly dateLabel: string;
  /** Die Tagesansicht dieses Tages. */
  readonly href: string;
  /** Die Anzahl der Bestellungen ohne stornierte. */
  readonly ordersLabel: string;
  readonly revenueLabel: string;
  /** „2 offen", „erledigt" oder „—". */
  readonly openLabel: string;
  /** „35,00 € offen", „bezahlt" oder „—". */
  readonly unpaidLabel: string;
  /** „zusätzlich 1 storniert" — oder leer. */
  readonly cancelledLabel: string;
  /**
   * „55,0 %", „Kosten fehlen" oder „—" — seit Phase 7B.
   *
   * EINE SPALTE UND NICHT VIER. Herstellkosten, Rohertrag und Marge
   * nebeneinander wären in einer Wochentabelle acht Spalten, und die Woche
   * beantwortet nicht die Frage „wie steht dieser Tag", sondern „wo ist etwas
   * los". Die Marge ist von den dreien die einzige, die sich zwischen Tagen
   * VERGLEICHEN lässt — Beträge tun das nicht, weil ein Samstag mehr Umsatz
   * hat als ein Dienstag, ohne besser kalkuliert zu sein.
   *
   * „KOSTEN FEHLEN" IST KEINE FEHLERMELDUNG, sondern die ehrliche Antwort auf
   * eine Frage, die für diesen Tag nicht beantwortbar ist. Sie steht dort, wo
   * sonst die Marge steht, und nimmt denselben Platz ein.
   */
  readonly marginLabel: string;
  /**
   * In `marginLabel` steht KEINE Zahl, sondern der Hinweis auf fehlende
   * Kosten.
   *
   * Der Renderer soll den Fall leiser setzen als eine Marge — und dafür nicht
   * am Text erkennen müssen, welcher Fall vorliegt. Ein `label.endsWith('%')`
   * im HTML wäre eine fachliche Unterscheidung, die an einer Schreibweise
   * hängt.
   */
  readonly marginIsMissing: boolean;
  /** An diesem Tag ist überhaupt nichts eingegangen, auch nichts Storniertes. */
  readonly isEmpty: boolean;
  readonly isToday: boolean;
}

/** Die Summenzeile — dieselben Angaben ohne Datum. */
export type DashboardWeekTotalView = Pick<
  DashboardWeekDayView,
  | 'ordersLabel'
  | 'revenueLabel'
  | 'openLabel'
  | 'unpaidLabel'
  | 'cancelledLabel'
  | 'marginLabel'
  | 'marginIsMissing'
>;

export interface DashboardWeekView {
  readonly monday: string;
  readonly sunday: string;
  /** „24. August 2026 – 30. August 2026" — für die Überschrift. */
  readonly rangeLabel: string;
  /**
   * „24.08. – 30.08.2026" — für die Steuerleiste.
   *
   * DERSELBE ZEITRAUM IN DER KURZFORM, und das ist kein Doppel: Die
   * Tagesansicht macht es genauso — dort steht „Mittwoch, 26. August 2026"
   * als Überschrift und „26.08.2026" im Datumsfeld darunter. Die Überschrift
   * sagt, WORÜBER die Seite spricht; die Leiste zeigt den EINGESTELLTEN WERT.
   * Zweimal wörtlich derselbe lange Satz wäre dagegen nur laut — ein Befund
   * aus dem Browser.
   */
  readonly compactRangeLabel: string;
  readonly previousWeek: QuickDayView;
  readonly nextWeek: QuickDayView;
  readonly quickDays: QuickDaysView;
  readonly days: readonly DashboardWeekDayView[];
  readonly total: DashboardWeekTotalView;
}

/**
 * DER ZEITRAUM STEHT ZWEIMAL VOLLSTÄNDIG DA — mit Monat und Jahr an beiden
 * Enden.
 *
 * „24. – 30. August 2026" wäre kürzer und verlangte eine Fallunterscheidung
 * für die Wochen, die über einen Monats- oder Jahreswechsel gehen. Genau die
 * Fallunterscheidung wäre die Stelle, an der einmal im Jahr „31. – 6.
 * September" stünde. Die lange Form ist an jedem Tag des Jahres richtig, und
 * sie steht in einer Überschrift, in der zwei Wörter mehr niemanden stören.
 */
export function toDashboardWeekView(week: DashboardWeek, today: string): DashboardWeekView {
  return {
    monday: week.monday,
    sunday: week.sunday,
    rangeLabel: `${formatGermanDayMonthYear(week.monday)} – ${formatGermanDayMonthYear(week.sunday)}`,
    /**
     * Das Jahr steht am ENDE und nur einmal — wie in jeder Zeitraumangabe,
     * die man in einem Betrieb aufschreibt. Über einen Jahreswechsel hinweg
     * ist es das Jahr des Sonntags; die vollständige Auskunft steht eine
     * Zeile darüber in der Überschrift.
     */
    compactRangeLabel: `${formatGermanShortDate(week.monday)} – ${formatGermanShortDate(
      week.sunday,
    )}${week.sunday.slice(0, 4)}`,

    previousWeek: wochensprung('Vorherige Woche', plusDays(week.monday, -7)),
    nextWeek: wochensprung('Nächste Woche', plusDays(week.monday, 7)),

    /**
     * DIE SCHNELLWAHL IST DIESELBE WIE AUF DER TAGESANSICHT — Funktion und
     * Adressen kommen aus dashboard-view.ts. Eine eigene Fassung für die
     * Woche wäre eine zweite Stelle, an der steht, was „morgen" ist.
     *
     * Der betrachtete Tag ist hier der MONTAG: Wer von der Woche aus „Woche"
     * drückt, bleibt in dieser Woche.
     */
    quickDays: toQuickDaysView(today, week.monday, 'week'),

    days: week.days.map((tag) => tageszeile(tag, today)),
    /**
     * DIE WOCHENMARGE STEHT NUR DA, WENN DIE GANZE WOCHE KALKULIERT IST — und
     * das entscheidet nicht diese Datei: `week.total.costs` entsteht aus den
     * Rohzählern aller sieben Tage, und ein einziger fehlender Kostenwert
     * irgendwo macht `complete` falsch. Eine Wochenmarge aus den vorhandenen
     * Tagen wäre eine Zahl über einen Zeitraum, den es nicht gibt.
     */
    total: summenzeile(week.total),
  };
}

function wochensprung(label: string, monday: string): QuickDayView {
  return {
    label,
    href: `/admin/dashboard?date=${monday}&view=week`,
    isCurrent: false,
  };
}

function tageszeile(tag: DashboardWeekDay, today: string): DashboardWeekDayView {
  /**
   * LEER HEISST: ES IST NICHTS EINGEGANGEN — auch nichts Storniertes. Ein
   * Tag, an dem eine Bestellung kam und wieder zurückgezogen wurde, hat eine
   * Geschichte; er sieht anders aus als einer, an dem niemand bestellt hat.
   * Dieselbe Unterscheidung trifft die Tagesansicht mit `isEmpty`.
   */
  const leer = tag.orderCount === 0 && tag.cancelledCount === 0;

  return {
    date: tag.date,
    weekdayLabel: formatGermanWeekday(tag.date),
    dateLabel: formatGermanShortDate(tag.date),
    href: `/admin/dashboard?date=${tag.date}`,
    isEmpty: leer,
    isToday: tag.date === today,
    ...zahlen(tag, leer),
  };
}

/**
 * Die Wochensumme trägt dieselben Beschriftungen wie ein Tag.
 *
 * SIE IST NIE „LEER". Eine Woche ohne Bestellung ist trotzdem eine Woche, in
 * der nichts offen und nichts unbezahlt ist — „erledigt" und „bezahlt" sind
 * dort die richtigen Wörter. Ein Strich in der Summenzeile läse sich wie eine
 * fehlende Angabe.
 */
function summenzeile(total: DashboardWeekSummary): DashboardWeekTotalView {
  return zahlen(total, false);
}

function zahlen(werte: DashboardWeekSummary, leer: boolean): DashboardWeekTotalView {
  return {
    ordersLabel: String(werte.orderCount),
    revenueLabel: formatEuro(werte.revenueCents),
    openLabel: leer ? '—' : werte.openCount === 0 ? 'erledigt' : `${werte.openCount} offen`,
    unpaidLabel: leer ? '—' : werte.unpaidCents === 0 ? 'bezahlt' : `${formatEuro(werte.unpaidCents)} offen`,
    cancelledLabel:
      werte.cancelledCount === 0
        ? ''
        : `zusätzlich ${werte.cancelledCount} storniert`,
    marginLabel: marge(werte, leer),
    marginIsMissing: !leer && !werte.costs.complete && werte.costs.revenueCents > 0,
  };
}

/**
 * Die Marge eines Tages — oder der Grund, warum keine dasteht.
 *
 * DREI FÄLLE, UND SIE SIND UNTERSCHEIDBAR:
 *
 *   „—"             An diesem Tag ist nichts eingegangen. Es gibt nichts zu
 *                   berechnen, und es fehlt auch nichts.
 *   „Kosten fehlen" Es gibt Umsatz, aber mindestens eine Position ohne
 *                   Kostenwert. Die Marge dieses Tages ist nicht berechenbar
 *                   — und wird deshalb auch nicht als Teilmarge gezeigt.
 *   „55,0 %"        Der Tag ist vollständig kalkuliert.
 *
 * Ein Tag mit Bestellungen, aber ohne Umsatz — alles storniert — bekommt
 * ebenfalls einen Strich: Eine Marge auf null Umsatz gibt es nicht, und
 * „Kosten fehlen" wäre dort die falsche Erklärung.
 *
 * ES WIRD NICHT ENTSCHIEDEN, OB EINE MARGE ERLAUBT IST. Das steht in
 * cost-summary.ts; hier wird `marginTenthsPercent === null` gelesen und der
 * Grund dafür aus `complete` abgelesen.
 */
function marge(werte: DashboardWeekSummary, leer: boolean): string {
  if (werte.costs.marginTenthsPercent !== null) {
    return formatPercentFromTenths(werte.costs.marginTenthsPercent);
  }
  if (leer || werte.costs.complete) {
    return '—';
  }
  return 'Kosten fehlen';
}
