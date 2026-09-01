import type {
  Analytics,
  AnalyticsBreakdown,
  AnalyticsDelta,
  AnalyticsTotals,
  AnalyticsTrendPoint,
} from '../domain/analytics';
import { plusDays, weekdayIndex } from '../domain/clock';
import type { ReportingPeriod, ReportingPeriodKind, TrendGranularity } from '../domain/reporting-period';
import { REPORTING_PERIOD_KINDS } from '../domain/reporting-period';
import {
  formatEuro,
  formatGermanDate,
  formatGermanMonthYear,
  formatGermanNumericDate,
  formatGermanShortDate,
  formatPercentFromTenths,
} from './format';

/**
 * Das Ansichtsmodell der Auswertung.
 *
 * HIER WIRD FORMATIERT UND NICHT GERECHNET. Jede Zahl dieser Datei kommt
 * fertig aus domain/analytics.ts; was hier entsteht, sind Zeichenketten,
 * Etiketten und die Geometrie der Balken. Eine zweite Summe an dieser Stelle
 * könnte der ersten widersprechen — und die Fassung, der jemand glaubt, wäre
 * die auf dem Bildschirm.
 *
 * DIE BALKENGEOMETRIE STEHT ALS ZAHL UND WIRD ALS ATTRIBUT GESETZT. Die CSP
 * dieser Anwendung kennt kein `'unsafe-inline'` für Stile; ein `style="height:
 * 42%"` am Balken würde stillschweigend verworfen, und das Diagramm wäre
 * leer, ohne dass irgendwo ein Fehler stünde. Dieselbe Entscheidung wie bei
 * den Ringen des Tagesüberblicks.
 *
 * DAS DIAGRAMM TRÄGT KEINE INFORMATION, DIE NICHT ALS TEXT DANEBENSTEHT.
 * Jeder Balken bringt seinen Zeitraum, seinen Umsatz und seine Zahl
 * Bestellungen als Zeichenkette mit; die Oberfläche setzt daraus eine
 * Tabelle, die ein Screenreader vollständig vorlesen kann. Nichts hängt an
 * einem Zeiger, der über eine Fläche fährt.
 */

/** Welche Reihe die Kurve zeigt. */
export const TREND_METRICS = ['umsatz', 'bestellungen'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export function isTrendMetric(value: unknown): value is TrendMetric {
  return typeof value === 'string' && (TREND_METRICS as readonly string[]).includes(value);
}

export const ANALYTICS_PATH = '/admin/auswertung';

/**
 * Bis hierher steht der Wert über dem Balken. Darüber wird es Konfetti.
 *
 * ZWÖLF, WEIL EIN JAHR ZWÖLF MONATE HAT. Genau dieser Fall — die
 * Jahresansicht — ist der, in dem die Zahlen über den Balken den größten
 * Nutzen haben: Zwölf Monatsumsätze auf einen Blick sind der Bericht, den
 * sonst niemand schreibt. Ein Monat mit 31 Tagen bekommt sie nicht; dort
 * stünden 31 Beträge in je 28px Breite übereinander.
 *
 * Auf schmalen Geräten blendet die CSS sie zusätzlich aus — auf 375px ist
 * selbst für sieben Beträge kein Platz. Die Zahl steht dann in der Tabelle,
 * die ein Screenreader vorliest.
 */
const WERTE_UEBER_BALKEN_MAX = 12;

/** Bis hierher trägt jede Marke ihre Beschriftung, darüber nur jede fünfte. */
const MARKEN_ALLE_MAX = 8;
const MARKEN_SCHRITT = 5;
const MONATSMARKEN_ALLE_MAX = 12;
const MONATSMARKEN_SCHRITT = 3;

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

/**
 * Die Monatskürzel stehen als Liste da und kommen nicht aus Intl.
 *
 * `Intl` liefert für de-DE „Jan.", „März", „Juni" — drei verschiedene Längen
 * mit und ohne Punkt. In einer Achse aus zwölf Marken ist das sichtbar
 * unruhig, und die Kürzel würden sich zudem zwischen Laufzeiten
 * unterscheiden. Drei Buchstaben, überall gleich.
 */
const MONATE_KURZ = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
] as const;

const ZEITRAUM_LABELS: Readonly<Record<ReportingPeriodKind, string>> = {
  heute: 'Heute',
  woche: 'Woche',
  monat: 'Monat',
  jahr: 'Jahr',
  zeitraum: 'Zeitraum',
};

/**
 * Das Wort, mit dem ein Unterschied benannt wird — „als im Vormonat".
 *
 * ES STEHT AN GENAU EINER STELLE. „mehr als im Vormonat" taucht auf dieser
 * Seite an sechs Orten auf; sechs Zeichenketten wären sechs Gelegenheiten,
 * bei der Jahresansicht „Vormonat" stehen zu lassen.
 */
const VERGLEICHSWORT: Readonly<Record<ReportingPeriodKind, string>> = {
  heute: 'gestern',
  woche: 'in der Vorwoche',
  monat: 'im Vormonat',
  jahr: 'im Vorjahr',
  zeitraum: 'davor',
};

/** Was fehlt, wenn es keinen Vergleichswert gibt. */
const OHNE_VERGLEICH: Readonly<Record<ReportingPeriodKind, string>> = {
  heute: 'kein Vergleich mit gestern',
  woche: 'keine Vorwoche zum Vergleich',
  monat: 'kein Vormonat zum Vergleich',
  jahr: 'noch keine Vorjahresdaten',
  zeitraum: 'kein Zeitraum davor zum Vergleich',
};

export interface AnalyticsTabView {
  readonly kind: ReportingPeriodKind;
  readonly label: string;
  readonly href: string;
  readonly isActive: boolean;
}

export interface AnalyticsCustomRangeView {
  readonly from: string;
  readonly to: string;
  readonly isActive: boolean;
}

/**
 * Ein Unterschied, wie ihn ein Mensch liest.
 *
 * `tone` IST KEINE FARBE, sondern die Rolle. Die Oberfläche entscheidet, wie
 * sie sie zeigt — und sie zeigt sie NIE nur farbig: Pfeil und Wort stehen
 * immer daneben. Auf einem verwaschenen Tresenbildschirm bleibt die Aussage
 * vollständig.
 */
export type AnalyticsDeltaTone = 'up' | 'down' | 'flat' | 'new' | 'none';

export interface AnalyticsDeltaView {
  /** '↑', '↓', '→' oder leer. Immer zusätzlich zum Wort, nie statt seiner. */
  readonly arrow: string;
  readonly label: string;
  readonly tone: AnalyticsDeltaTone;
}

export interface AnalyticsKpiView {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly delta: AnalyticsDeltaView | null;
  readonly isPrimary: boolean;
  readonly isEmphasised: boolean;
  /** Der Wert konnte nicht gebildet werden — er steht als Satz statt als Zahl. */
  readonly isMissing: boolean;
}

export interface AnalyticsTrendBarView {
  readonly key: string;
  /** Die Beschriftung an der Achse: 'Mo', '06.09.' oder 'Sep'. */
  readonly axisLabel: string;
  /** Diese Marke steht auf jeder Breite. Die übrigen weichen auf schmalen Geräten. */
  readonly axisEmphasis: boolean;
  readonly valueLabel: string;
  /** 0–100. Als Attribut gesetzt, nie als Stil. */
  readonly heightPercent: number;
  /** 100 − heightPercent — die y-Kante des Balkens im Kasten 0…100. */
  readonly barY: number;
  /** Der Zeitraum des Balkens, ausgeschrieben — für die vorlesbare Tabelle. */
  readonly rangeLabel: string;
  readonly revenueLabel: string;
  readonly ordersLabel: string;
}

export interface AnalyticsTrendMetricTabView {
  readonly key: TrendMetric;
  readonly label: string;
  readonly href: string;
  readonly isActive: boolean;
}

export interface AnalyticsTrendView {
  readonly metric: TrendMetric;
  readonly metricTabs: readonly AnalyticsTrendMetricTabView[];
  readonly bars: readonly AnalyticsTrendBarView[];
  readonly showValues: boolean;
  readonly caption: string;
  /** Der größte Wert der Kurve, ausgeschrieben — die Skala der Achse. */
  readonly maxLabel: string;
  readonly isEmpty: boolean;
}

export interface TopProductView {
  readonly rank: number;
  readonly name: string;
  readonly unit: string;
  readonly unitsLabel: string;
  readonly revenueLabel: string;
}

export interface TopCustomerView {
  readonly rank: number;
  readonly name: string;
  readonly ordersLabel: string;
  readonly revenueLabel: string;
}

export interface AnalyticsComparisonCardView {
  readonly key: string;
  readonly title: string;
  readonly currentLabel: string;
  readonly currentValue: string;
  readonly previousLabel: string;
  readonly previousValue: string;
  readonly deltaLabel: string;
  readonly percentLabel: string;
  readonly arrow: string;
  readonly tone: AnalyticsDeltaTone;
}

export interface AnalyticsBreakdownEntryView {
  readonly key: string;
  readonly label: string;
  readonly valueLabel: string;
  readonly shareLabel: string;
  readonly ordersLabel: string;
  /** 0–100. Als Attribut gesetzt, nie als Stil. */
  readonly widthPercent: number;
}

export interface AnalyticsBreakdownView {
  readonly entries: readonly AnalyticsBreakdownEntryView[];
  readonly isEmpty: boolean;
}

export interface AnalyticsView {
  readonly tabs: readonly AnalyticsTabView[];
  readonly custom: AnalyticsCustomRangeView;
  readonly rangeLabel: string;
  readonly previousLabel: string;
  readonly kpis: readonly AnalyticsKpiView[];
  readonly trend: AnalyticsTrendView;
  readonly topProducts: readonly TopProductView[];
  readonly topCustomers: readonly TopCustomerView[];
  readonly comparisonCards: readonly AnalyticsComparisonCardView[];
  readonly customerGroups: AnalyticsBreakdownView;
  readonly fulfillment: AnalyticsBreakdownView;
  readonly isEmpty: boolean;
  readonly hasStarted: boolean;
  readonly emptyText: string;
}

export function toAnalyticsView(analytics: Analytics, metric: TrendMetric): AnalyticsView {
  const { period, current, previous, comparison } = analytics;
  const rangeLabel = zeitraumEtikett(period);
  const previousLabel = vergleichsEtikett(period);

  return {
    tabs: REPORTING_PERIOD_KINDS.map((kind) => ({
      kind,
      label: ZEITRAUM_LABELS[kind],
      // Die gewählte Reihe wandert mit: Wer die Bestellzahl ansieht und den
      // Monat wechselt, will nicht wieder beim Umsatz landen.
      href: adresse(kind, period, metric, metric !== 'umsatz'),
      isActive: kind === period.kind,
    })),
    custom: {
      from: period.start,
      to: letzterTag(period.start, period.end),
      isActive: period.kind === 'zeitraum',
    },
    rangeLabel,
    previousLabel,
    kpis: kennzahlen(analytics),
    trend: kurve(analytics, metric),
    topProducts: analytics.topProducts.map((produkt, index) => ({
      rank: index + 1,
      name: produkt.name,
      unit: produkt.unit,
      unitsLabel: String(produkt.units),
      revenueLabel: formatEuro(produkt.revenueCents),
    })),
    topCustomers: analytics.topCustomers.map((kunde, index) => ({
      rank: index + 1,
      name: kunde.name,
      ordersLabel: anzahl(kunde.orderCount, 'Bestellung', 'Bestellungen'),
      revenueLabel: formatEuro(kunde.revenueCents),
    })),
    comparisonCards: [
      vergleichskarte('umsatz', 'Bestellumsatz', rangeLabel, previousLabel, comparison.revenue, formatEuro(current.revenueCents), formatEuro(previous.revenueCents), (wert) => vorzeichenEuro(wert)),
      vergleichskarte('bestellungen', 'Bestellungen', rangeLabel, previousLabel, comparison.orders, String(current.orderCount), String(previous.orderCount), (wert) => vorzeichenZahl(wert)),
      vergleichskarte('stueck', 'Verkaufte Stück', rangeLabel, previousLabel, comparison.units, String(current.units), String(previous.units), (wert) => vorzeichenZahl(wert)),
    ],
    customerGroups: aufteilung(analytics.customerGroups),
    fulfillment: aufteilung(analytics.fulfillment),
    isEmpty: analytics.isEmpty,
    hasStarted: period.hasStarted,
    emptyText: period.hasStarted
      ? 'In diesem Zeitraum gibt es noch keine Bestellungen.'
      : 'Dieser Zeitraum hat noch nicht begonnen.',
  };
}

/* -------------------------------------------------------------------------
   Adressen
   ------------------------------------------------------------------------- */

function adresse(
  kind: ReportingPeriodKind,
  period: ReportingPeriod,
  metric: TrendMetric,
  mitMetric: boolean,
): string {
  const teile = [`period=${kind}`];
  /**
   * DIE FREIE SPANNE NIMMT IHRE GRENZEN MIT und nur sie. Ein `from`/`to` an
   * einem Monatslink wäre eine Angabe, die die Seite nicht benutzt und die
   * beim nächsten Klick trotzdem wieder auftaucht.
   */
  if (kind === 'zeitraum') {
    teile.push(`from=${period.start}`);
    teile.push(`to=${letzterTag(period.start, period.end)}`);
  }
  if (mitMetric) {
    teile.push(`metric=${metric}`);
  }
  return `${ANALYTICS_PATH}?${teile.join('&')}`;
}

/* -------------------------------------------------------------------------
   Etiketten
   ------------------------------------------------------------------------- */

function zeitraumEtikett(period: ReportingPeriod): string {
  const letzter = letzterTag(period.start, period.end);

  switch (period.kind) {
    case 'heute':
      return `Heute, ${formatGermanDate(period.start)}`;
    case 'woche':
      return `${period.isPartial ? 'Diese Woche, ' : 'Woche '}${spanne(period.start, letzter)}`;
    case 'monat':
      return `${formatGermanMonthYear(period.start)}${period.isPartial ? ' (bis heute)' : ''}`;
    case 'jahr':
      return `${period.start.slice(0, 4)}${period.isPartial ? ' (bis heute)' : ''}`;
    case 'zeitraum':
      return `${formatGermanShortDate(period.start)}–${formatGermanNumericDate(letzter)}`;
  }
}

function vergleichsEtikett(period: ReportingPeriod): string {
  const letzter = letzterTag(period.previousStart, period.previousEnd);

  switch (period.kind) {
    case 'heute':
      return `Gestern, ${formatGermanDate(period.previousStart)}`;
    case 'woche':
      return period.isPartial
        ? `Vorwoche, gleicher Zeitraum (${spanne(period.previousStart, letzter)})`
        : `Vorwoche (${spanne(period.previousStart, letzter)})`;
    case 'monat':
      return period.isPartial
        ? `${formatGermanMonthYear(period.previousStart)}, gleicher Zeitraum (${tagZahl(period.previousStart)}.–${tagZahl(letzter)}.)`
        : formatGermanMonthYear(period.previousStart);
    case 'jahr':
      return period.isPartial
        ? `${period.previousStart.slice(0, 4)}, gleicher Zeitraum (bis ${formatGermanShortDate(letzter)})`
        : period.previousStart.slice(0, 4);
    case 'zeitraum':
      return `Davor: ${formatGermanShortDate(period.previousStart)}–${formatGermanNumericDate(letzter)}`;
  }
}

/**
 * „14.–15.09.2026" — der erste Tag ohne Monat, der letzte vollständig.
 *
 * ÜBER EINE MONATSGRENZE HINWEG STEHT DER MONAT AUCH VORN. „31.–01.09.2026"
 * war ein Befund aus dem Browser: Eine Woche, die am 31. August beginnt und
 * am 1. September endet, las sich als „31. September bis 1. September". Der
 * Monat wird deshalb genau dann genannt, wenn er sich unterscheidet — und
 * nur dann, weil „14.09.–15.09.2026" innerhalb eines Monats den Monat
 * zweimal nennt, ohne etwas zu klären.
 */
function spanne(von: string, bis: string): string {
  const gleicherMonat = von.slice(0, 7) === bis.slice(0, 7);
  const anfang = gleicherMonat ? `${von.slice(8, 10)}.` : formatGermanShortDate(von);
  return `${anfang}–${formatGermanNumericDate(bis)}`;
}

function tagZahl(day: string): string {
  return String(Number(day.slice(8, 10)));
}

/**
 * Der letzte gemeinte Tag eines halboffenen Bereichs.
 *
 * DIESE FUNKTION IST DER GRUND, WARUM DIE OBERFLÄCHE NICHT SELBST RECHNET.
 * Ein `plusDays(end, -1)` an sieben Stellen wäre sieben Gelegenheiten, es
 * einmal zu vergessen — und ein Zeitraum, dessen Etikett einen Tag weiter
 * reicht als seine Zahlen, ist der Fehler, den niemand bemerkt.
 *
 * Ein leerer Bereich (Zukunft) hat keinen letzten Tag; dann steht der erste
 * da, damit kein Datum vor dem Anfang erscheint.
 */
function letzterTag(start: string, end: string): string {
  return end > start ? plusDays(end, -1) : start;
}

/* -------------------------------------------------------------------------
   Kennzahlen
   ------------------------------------------------------------------------- */

function kennzahlen(analytics: Analytics): readonly AnalyticsKpiView[] {
  const { current, comparison, period } = analytics;
  const kosten = current.costs;

  return [
    {
      key: 'umsatz',
      label: 'Bestellumsatz',
      value: formatEuro(current.revenueCents),
      hint: 'Alles, was im Zeitraum bestellt wurde — ohne stornierte',
      delta: unterschied(comparison.revenue, period.kind, prozentwort),
      isPrimary: true,
      isEmphasised: false,
      isMissing: false,
    },
    {
      key: 'bestellungen',
      label: 'Bestellungen',
      value: String(current.orderCount),
      hint: 'Ohne stornierte Bestellungen',
      delta: unterschied(comparison.orders, period.kind, zaehlwort('Bestellung', 'Bestellungen')),
      isPrimary: false,
      isEmphasised: false,
      isMissing: false,
    },
    {
      key: 'stueck',
      label: 'Verkaufte Stück',
      value: String(current.units),
      hint: 'Die aktuellen Mengen — geänderte zählen, stornierte nicht',
      delta: unterschied(comparison.units, period.kind, zaehlwort('Stück', 'Stück')),
      isPrimary: false,
      isEmphasised: false,
      isMissing: false,
    },
    {
      key: 'schnitt',
      label: 'Ø pro Bestellung',
      // Kein „0,00 €" ohne Bestellung: Ein Durchschnitt aus nichts ist keiner.
      value: current.averageOrderCents === null ? '—' : formatEuro(current.averageOrderCents),
      hint: 'Bestellumsatz geteilt durch Bestellungen',
      delta: null,
      isPrimary: false,
      isEmphasised: false,
      isMissing: current.averageOrderCents === null,
    },
    {
      key: 'offen',
      label: 'Noch offen',
      value: formatEuro(current.unpaidCents),
      /**
       * „Nichts offen" gilt in BEIDEN Lagen — alles bezahlt, und gar nichts
       * bestellt. „Alles bezahlt" wäre in einem leeren Zeitraum eine
       * Feststellung über Bestellungen, die es nicht gibt.
       */
      hint:
        current.unpaidCount === 0
          ? 'Nichts offen'
          : `${anzahl(current.unpaidCount, 'Bestellung', 'Bestellungen')} ${current.unpaidCount === 1 ? 'ist' : 'sind'} noch nicht bezahlt`,
      delta: null,
      isPrimary: false,
      // Die einzige Zelle, die zu etwas auffordert — und sie tut es nur,
      // wenn es etwas zu tun gibt.
      isEmphasised: current.unpaidCents > 0,
      isMissing: false,
    },
    {
      key: 'deckungsbeitrag',
      label: 'Deckungsbeitrag',
      /**
       * KEINE ERFUNDENE ZAHL. Fehlt auch nur ein Kostenwert, steht hier ein
       * Satz statt eines Betrags — und der Satz sagt, wie viele Positionen
       * fehlen. Eine Marge, die eine Lücke als 0 € behandelt, ist zu hoch,
       * plausibel und falsch.
       */
      value: deckungsbeitrag(current),
      hint:
        current.orderCount === 0
          ? 'Bestellumsatz minus bekannte Herstellkosten'
          : kosten.grossProfitCents === null
            ? `Bei ${anzahl(kosten.missingItemCount, 'Position', 'Positionen')} fehlen die Herstellkosten`
            : kosten.marginTenthsPercent === null
              ? 'Was nach bekannten Herstellkosten übrig bleibt'
              : `Was nach bekannten Herstellkosten übrig bleibt · Marge ${formatPercentFromTenths(kosten.marginTenthsPercent)}`,
      delta: null,
      isPrimary: false,
      isEmphasised: false,
      isMissing: current.orderCount === 0 || kosten.grossProfitCents === null,
    },
  ];
}

/**
 * Der Deckungsbeitrag — oder der Grund, warum keiner dasteht.
 *
 * DREI LAGEN UND DREI ANTWORTEN:
 *
 *   keine Bestellung    „—". Rechnerisch wären es 0 € minus 0 € Kosten, und
 *                       das ist wahr; als ZAHL auf einer Karte gelesen heißt
 *                       es aber „wir haben nichts verdient", und das ist eine
 *                       Aussage über einen Betrieb, der in diesem Zeitraum
 *                       gar nicht gefragt war. Derselbe Strich wie beim
 *                       Durchschnitt, aus demselben Grund.
 *   Kosten unvollständig „Noch nicht vollständig". Niemals eine Zahl.
 *   sonst               der Betrag, negativ mit Minus.
 */
function deckungsbeitrag(current: AnalyticsTotals): string {
  if (current.orderCount === 0) return '—';
  if (current.costs.grossProfitCents === null) return 'Noch nicht vollständig';
  return betragMitMinus(current.costs.grossProfitCents);
}

/** Wie ein Unterschied in Worte gefasst wird — Prozent oder Stückzahl. */
type Unterschiedswort = (absolute: number, tenthsPercent: number) => string;

const prozentwort: Unterschiedswort = (_absolute, tenthsPercent) =>
  formatPercentFromTenths(Math.abs(tenthsPercent));

function zaehlwort(einzahl: string, mehrzahl: string): Unterschiedswort {
  return (absolute) => anzahl(Math.abs(absolute), einzahl, mehrzahl);
}

function unterschied(
  delta: AnalyticsDelta,
  kind: ReportingPeriodKind,
  wort: Unterschiedswort,
): AnalyticsDeltaView {
  if (delta.kind === 'none') {
    return { arrow: '', label: 'Kein Vergleich möglich', tone: 'none' };
  }
  if (delta.kind === 'new') {
    return { arrow: '', label: `Neu — ${OHNE_VERGLEICH[kind]}`, tone: 'new' };
  }
  if (delta.absolute === 0) {
    return { arrow: '→', label: `Gleich wie ${VERGLEICHSWORT[kind]}`, tone: 'flat' };
  }
  const hoch = delta.absolute > 0;
  return {
    arrow: hoch ? '↑' : '↓',
    label: `${wort(delta.absolute, delta.tenthsPercent)} ${hoch ? 'mehr' : 'weniger'} als ${VERGLEICHSWORT[kind]}`,
    tone: hoch ? 'up' : 'down',
  };
}

/* -------------------------------------------------------------------------
   Kurve
   ------------------------------------------------------------------------- */

function kurve(analytics: Analytics, metric: TrendMetric): AnalyticsTrendView {
  const { period, trend } = analytics;
  const werte = trend.map((punkt) => (metric === 'umsatz' ? punkt.revenueCents : punkt.orderCount));
  const groesster = werte.reduce((a, b) => (b > a ? b : a), 0);

  return {
    metric,
    metricTabs: TREND_METRICS.map((key) => ({
      key,
      label: key === 'umsatz' ? 'Bestellumsatz' : 'Bestellungen',
      href: adresse(period.kind, period, key, true),
      isActive: key === metric,
    })),
    bars: trend.map((punkt, index) => ({
      key: punkt.key,
      axisLabel: markeEtikett(punkt, period.granularity, trend.length),
      axisEmphasis: markeHervorgehoben(index, trend.length, period.granularity),
      valueLabel: metric === 'umsatz' ? formatEuro(punkt.revenueCents) : String(punkt.orderCount),
      heightPercent: hoehe(werte[index] ?? 0, groesster),
      barY: 100 - hoehe(werte[index] ?? 0, groesster),
      rangeLabel: punktEtikett(punkt, period.granularity),
      revenueLabel: formatEuro(punkt.revenueCents),
      ordersLabel: String(punkt.orderCount),
    })),
    showValues: trend.length <= WERTE_UEBER_BALKEN_MAX,
    caption: `${metric === 'umsatz' ? 'Bestellumsatz' : 'Bestellungen'} je ${koernungswort(period.granularity)}`,
    /**
     * Die Skala steht als Zahl da und nicht als Achse mit Strichen. Eine
     * Kurve, deren höchster Balken beziffert ist, lässt sich ablesen; eine
     * y-Achse mit fünf Zwischenwerten wäre in einer 220px hohen Fläche auf
     * dem Telefon nur Rauschen.
     */
    maxLabel: metric === 'umsatz' ? formatEuro(groesster) : String(groesster),
    isEmpty: groesster === 0,
  };
}

/**
 * Die Höhe eines Balkens in ganzen Prozent des größten Werts.
 *
 * EIN WERT ÜBER NULL BEKOMMT MINDESTENS EINEN PROZENTPUNKT. Ein Tag mit
 * 1,20 € neben einem mit 900 € hätte sonst gar keinen Balken und sähe aus wie
 * ein Tag ohne Bestellung — das ist ein Unterschied, den die Kurve nicht
 * verschlucken darf. Null bleibt null: Ein leerer Tag ist leer.
 */
function hoehe(wert: number, groesster: number): number {
  if (wert <= 0 || groesster <= 0) return 0;
  return Math.max(1, Math.round((wert * 100) / groesster));
}

function markeEtikett(punkt: AnalyticsTrendPoint, granularity: TrendGranularity, anzahlPunkte: number): string {
  if (granularity === 'month') {
    return MONATE_KURZ[Number(punkt.key.slice(5, 7)) - 1] ?? punkt.key;
  }
  // Wenige Tage: der Wochentag. Er beantwortet die Frage, die ein Betrieb an
  // eine Wochenkurve stellt — „läuft der Samstag besser als der Dienstag?".
  if (granularity === 'day' && anzahlPunkte <= MARKEN_ALLE_MAX) {
    return WOCHENTAGE_KURZ[weekdayIndex(punkt.start)] ?? punkt.start;
  }
  return formatGermanShortDate(punkt.start);
}

function markeHervorgehoben(index: number, anzahlPunkte: number, granularity: TrendGranularity): boolean {
  const alle = granularity === 'month' ? MONATSMARKEN_ALLE_MAX : MARKEN_ALLE_MAX;
  const schritt = granularity === 'month' ? MONATSMARKEN_SCHRITT : MARKEN_SCHRITT;
  if (anzahlPunkte <= alle) return true;
  // Die letzte Marke immer: Eine Achse, deren rechtes Ende unbeschriftet
  // bleibt, lässt offen, bis wohin die Kurve reicht.
  return index % schritt === 0 || index === anzahlPunkte - 1;
}

function punktEtikett(punkt: AnalyticsTrendPoint, granularity: TrendGranularity): string {
  if (granularity === 'month') return formatGermanMonthYear(punkt.start);
  if (granularity === 'week') {
    return `Woche ${formatGermanShortDate(punkt.start)}–${formatGermanNumericDate(plusDays(punkt.end, -1))}`;
  }
  return formatGermanDate(punkt.start);
}

function koernungswort(granularity: TrendGranularity): string {
  if (granularity === 'month') return 'Monat';
  if (granularity === 'week') return 'Woche';
  return 'Tag';
}

/* -------------------------------------------------------------------------
   Vergleich und Aufteilungen
   ------------------------------------------------------------------------- */

function vergleichskarte(
  key: string,
  title: string,
  currentLabel: string,
  previousLabel: string,
  delta: AnalyticsDelta,
  currentValue: string,
  previousValue: string,
  formatiere: (wert: number) => string,
): AnalyticsComparisonCardView {
  const gemeinsam = { key, title, currentLabel, currentValue, previousLabel, previousValue };

  if (delta.kind === 'none') {
    return { ...gemeinsam, deltaLabel: 'Kein Vergleich möglich', percentLabel: '', arrow: '', tone: 'none' };
  }
  if (delta.kind === 'new') {
    return { ...gemeinsam, deltaLabel: 'Neu', percentLabel: '', arrow: '', tone: 'new' };
  }
  const tone: AnalyticsDeltaTone = delta.absolute === 0 ? 'flat' : delta.absolute > 0 ? 'up' : 'down';
  return {
    ...gemeinsam,
    deltaLabel: formatiere(delta.absolute),
    percentLabel: mitVorzeichen(delta.tenthsPercent, formatPercentFromTenths(Math.abs(delta.tenthsPercent))),
    arrow: tone === 'flat' ? '→' : tone === 'up' ? '↑' : '↓',
    tone,
  };
}

function aufteilung(breakdown: AnalyticsBreakdown): AnalyticsBreakdownView {
  return {
    entries: breakdown.entries.map((eintrag) => ({
      key: eintrag.key,
      label: eintrag.label,
      valueLabel: formatEuro(eintrag.revenueCents),
      shareLabel: formatPercentFromTenths(eintrag.shareTenthsPercent),
      ordersLabel: anzahl(eintrag.orderCount, 'Bestellung', 'Bestellungen'),
      // Wie beim Balken: Ein Anteil über null bekommt eine sichtbare Breite.
      widthPercent:
        eintrag.revenueCents > 0 ? Math.max(1, Math.round(eintrag.shareTenthsPercent / 10)) : 0,
    })),
    isEmpty: breakdown.entries.length === 0,
  };
}

/* -------------------------------------------------------------------------
   Kleinkram
   ------------------------------------------------------------------------- */

/** „1 Bestellung", nicht „1 Bestellungen". */
function anzahl(count: number, einzahl: string, mehrzahl: string): string {
  return `${count} ${count === 1 ? einzahl : mehrzahl}`;
}

function vorzeichenEuro(cents: number): string {
  return mitVorzeichen(cents, formatEuro(Math.abs(cents)));
}

/**
 * Ein Betrag, der KEIN Unterschied ist.
 *
 * Ein Deckungsbeitrag von 5.220 € ist eine Zahl und keine Verbesserung; ein
 * „+" davor läse sich wie ein Vergleich mit etwas, das es hier nicht gibt.
 * Das Minus bleibt trotzdem — ein negativer Deckungsbeitrag ist genau die
 * Zahl, für die jemand diese Seite aufschlägt.
 */
function betragMitMinus(cents: number): string {
  return cents < 0 ? `−${formatEuro(-cents)}` : formatEuro(cents);
}

function vorzeichenZahl(wert: number): string {
  return mitVorzeichen(wert, String(Math.abs(wert)));
}

/**
 * Das Vorzeichen steht VOR dem Betrag und ist Text.
 *
 * „+970,00 €" und „−970,00 €" unterscheiden sich auch dann, wenn niemand die
 * Farbe sieht — und das ist die Anforderung: Keine Aussage dieser Seite hängt
 * allein an einer Farbe. Das Minus ist ein echtes Minuszeichen (U+2212) und
 * kein Bindestrich; in der Serife der Marke ist der Unterschied deutlich.
 */
function mitVorzeichen(wert: number, betrag: string): string {
  if (wert > 0) return `+${betrag}`;
  if (wert < 0) return `−${betrag}`;
  return betrag;
}
