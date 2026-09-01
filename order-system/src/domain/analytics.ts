import { CostTally, type CostSummary } from './cost-summary';
import { plusDays, weekStart } from './clock';
import { fulfillmentLabel, type FulfillmentType } from './fulfillment-type';
import { countsTowardsRevenue, type OrderStatus } from './order-status';
import { isPaid, type PaymentStatus } from './payment-status';
import type { ReportingPeriod, TrendGranularity } from './reporting-period';

/**
 * Die Auswertung — die kaufmännischen Zahlen eines Zeitraums.
 *
 * DIESE DATEI IST DIE EINZIGE STELLE, AN DER STEHT, WAS DIE AUSWERTUNG ZÄHLT.
 * Nicht das Repository, nicht die Oberfläche, nicht die Abfrage. Die
 * Abfragen liefern VORAGGREGIERTE Zeilen, aber sie filtern keinen Status:
 * Sie gruppieren NACH ihm und überlassen die Frage „zählt das mit?" der
 * Domäne. Der Grund ist derselbe wie im Wochenrepository — ein
 * `WHERE status <> 'cancelled'` in SQL wäre eine zweite Fassung der
 * Umsatzregel, und zwar eine, die kein Test der Domäne je zu Gesicht bekommt.
 *
 * Die Regel selbst heißt countsTowardsRevenue() und steht in
 * order-status.ts. Sie wird hier BENUTZT und nicht nachgebaut.
 *
 * DIE PRODUKTIONSREGEL GILT HIER NICHT. isOpenProduction() beantwortet, was
 * noch zu backen ist; das ist eine andere Frage als „was hat der Betrieb
 * umgesetzt". Eine abgeschlossene Bestellung von vorletzter Woche hat Umsatz
 * gemacht und erzeugt keine Produktion; eine neue Bestellung für morgen ist
 * Umsatz und noch keine Produktion. Diese Datei importiert
 * isOpenProduction() deshalb nicht.
 *
 * DER AKTUELLE STAND IST DER MASSGEBLICHE. `orders.total_amount_cents` wird
 * bei jeder Positionsänderung aus den nicht stornierten Positionszeilen neu
 * gebildet (siehe application/edit-order-item.ts); die Mengen kommen aus
 * order_items mit `cancelled_at IS NULL`. Damit gilt: Aus 5 × 22 € werden
 * nach einer Änderung auf 3 Stück genau 3 × 22 €, und eine stornierte
 * Position trägt nichts mehr bei. Die Preise selbst bleiben die
 * Schnappschüsse der Bestellung — der heutige Katalogpreis kommt in dieser
 * Datei nicht vor und wird nirgends geladen.
 *
 * `order_item_changes` WIRD NICHT GELESEN. Die Änderungshistorie ist ein
 * Protokoll und kein Verkauf; sie zu summieren hieße, jede Mengenänderung
 * als zusätzlichen Umsatz zu melden. Es gibt in dieser Datei und im
 * zugehörigen Repository keinen einzigen Zugriff darauf.
 */

/* ---------------------------------------------------------------------------
   Eingabe: das, was die fünf Abfragen liefern.

   Alle fünf Zeilenarten tragen den STATUS mit. Das ist kein Zufall und keine
   Bequemlichkeit — es ist die Bauart, mit der die Aggregation in SQL
   stattfinden kann, ohne dass die Umsatzregel dorthin wandert.
   --------------------------------------------------------------------------- */

/** Bestellungen eines Tages in einem Status und einem Zahlungsstand. */
export interface AnalyticsOrderGroup {
  readonly day: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly orderCount: number;
  readonly revenueCents: number;
}

/** Die aktiven Positionen eines Tages in einem Status. */
export interface AnalyticsItemGroup {
  readonly day: string;
  readonly status: OrderStatus;
  /** Verkaufte Stück — die aktuellen, nicht stornierten Mengen. */
  readonly units: number;
  /** Summe der BEKANNTEN Herstellkosten: Kostenschnappschuss × Menge. */
  readonly knownCostCents: number;
  readonly itemCount: number;
  /** Positionen ohne Kostenschnappschuss. Sie machen den Zeitraum unvollständig. */
  readonly missingItemCount: number;
  readonly orderCount: number;
  readonly missingOrderCount: number;
}

/** Ein Produkt in einem Status — aus den Positionsschnappschüssen. */
export interface AnalyticsProductGroup {
  readonly productId: number;
  readonly name: string;
  readonly unit: string;
  readonly status: OrderStatus;
  /** Die höchste Positions-ID dieser Gruppe — sie entscheidet, welcher Name gilt. */
  readonly latestItemId: number;
  readonly units: number;
  readonly revenueCents: number;
}

/** Ein Kunde in einem Status — aus den Bestellschnappschüssen. */
export interface AnalyticsCustomerGroup {
  readonly customerId: number;
  readonly name: string;
  readonly status: OrderStatus;
  readonly latestOrderId: number;
  readonly orderCount: number;
  readonly revenueCents: number;
}

/** Bestellungen nach Zustellart und Preisgruppe. */
export interface AnalyticsSegmentGroup {
  readonly fulfillmentType: FulfillmentType;
  /** Der Code der Preisliste — oder null, wenn dem Kunden keine zugeordnet ist. */
  readonly priceGroupCode: string | null;
  readonly status: OrderStatus;
  readonly orderCount: number;
  readonly revenueCents: number;
}

export interface AnalyticsInput {
  readonly orders: readonly AnalyticsOrderGroup[];
  readonly items: readonly AnalyticsItemGroup[];
  readonly products: readonly AnalyticsProductGroup[];
  readonly customers: readonly AnalyticsCustomerGroup[];
  readonly segments: readonly AnalyticsSegmentGroup[];
}

/* ---------------------------------------------------------------------------
   Ausgabe.
   --------------------------------------------------------------------------- */

export interface AnalyticsTotals {
  readonly revenueCents: number;
  readonly orderCount: number;
  readonly units: number;
  readonly unpaidCents: number;
  readonly unpaidCount: number;
  /**
   * Der Durchschnitt je Bestellung — oder null.
   *
   * NULL HEISST „KEINE BESTELLUNG" und nicht „0,00 €". Ein Zeitraum ohne
   * Bestellungen hat keinen Durchschnitt; ihn als 0 zu melden wäre die
   * Aussage, jede Bestellung habe nichts gekostet.
   */
  readonly averageOrderCents: number | null;
  readonly costs: CostSummary;
}

/**
 * Ein Unterschied zum Vergleichszeitraum.
 *
 * DREI FÄLLE, WEIL ES DREI LAGEN GIBT — und keine davon darf als Prozentwert
 * erscheinen, den es nicht gibt:
 *
 *   value  Es gab vorher etwas. Unterschied und Prozentwert sind echt.
 *   new    Vorher null, jetzt etwas. „Neu" — nicht „+∞ %", nicht „+100 %".
 *   none   Vorher null, jetzt null. Es gibt nichts zu vergleichen.
 */
export type AnalyticsDelta =
  | { readonly kind: 'value'; readonly absolute: number; readonly tenthsPercent: number }
  | { readonly kind: 'new' }
  | { readonly kind: 'none' };

export interface AnalyticsComparison {
  /** Ob im Vergleichszeitraum überhaupt eine Bestellung liegt. */
  readonly previousHasData: boolean;
  readonly revenue: AnalyticsDelta;
  readonly orders: AnalyticsDelta;
  readonly units: AnalyticsDelta;
}

export interface AnalyticsTrendPoint {
  /** 'JJJJ-MM-TT' bei Tagen und Wochen (Montag), 'JJJJ-MM' bei Monaten. */
  readonly key: string;
  readonly start: string;
  /** Erster Tag NACH dem Punkt. */
  readonly end: string;
  readonly revenueCents: number;
  readonly orderCount: number;
}

export interface TopProduct {
  readonly name: string;
  readonly unit: string;
  readonly units: number;
  readonly revenueCents: number;
}

export interface TopCustomer {
  readonly name: string;
  readonly orderCount: number;
  readonly revenueCents: number;
}

export interface AnalyticsBreakdownEntry {
  readonly key: string;
  readonly label: string;
  readonly orderCount: number;
  readonly revenueCents: number;
  /** Anteil am Umsatz der Aufteilung, in Zehntel Prozent. 750 heißt 75,0 %. */
  readonly shareTenthsPercent: number;
}

export interface AnalyticsBreakdown {
  readonly totalCents: number;
  readonly entries: readonly AnalyticsBreakdownEntry[];
}

export interface Analytics {
  readonly period: ReportingPeriod;
  readonly current: AnalyticsTotals;
  readonly previous: AnalyticsTotals;
  readonly comparison: AnalyticsComparison;
  readonly trend: readonly AnalyticsTrendPoint[];
  readonly topProducts: readonly TopProduct[];
  readonly topCustomers: readonly TopCustomer[];
  readonly customerGroups: AnalyticsBreakdown;
  readonly fulfillment: AnalyticsBreakdown;
  /** Im gewählten Zeitraum liegt keine einzige zählende Bestellung. */
  readonly isEmpty: boolean;
}

/**
 * Sechs Einträge und nicht zehn.
 *
 * Eine Rangliste, die man überfliegt, hört dort auf, wo das Überfliegen
 * aufhört. Sechs passen neben die zweite Liste, ohne dass eine von beiden
 * scrollt — und die siebtbeste Torte beantwortet keine Frage, die jemand
 * einmal im Monat stellt.
 */
const TOPLISTE_LAENGE = 6;

/** Die Beschriftungen der Preisgruppen — dieselben Wörter wie im Katalog. */
const PREISGRUPPEN: Readonly<Record<string, string>> = {
  gastro: 'Gastronomie',
  private: 'Privatkunden',
};

/** Die Reihenfolge der Aufteilung. Gastro zuerst, „ohne" immer zuletzt. */
const PREISGRUPPEN_REIHENFOLGE = ['gastro', 'private', 'ohne'] as const;

export function aggregateAnalytics(period: ReportingPeriod, input: AnalyticsInput): Analytics {
  const current = summe(period.start, period.end, input);
  const previous = summe(period.previousStart, period.previousEnd, input);

  return {
    period,
    current,
    previous,
    comparison: {
      previousHasData: previous.orderCount > 0,
      revenue: unterschied(current.revenueCents, previous.revenueCents),
      orders: unterschied(current.orderCount, previous.orderCount),
      units: unterschied(current.units, previous.units),
    },
    trend: kurve(period, input.orders),
    topProducts: topProdukte(input.products),
    topCustomers: topKunden(input.customers),
    customerGroups: preisgruppen(input.segments),
    fulfillment: zustellarten(input.segments),
    isEmpty: current.orderCount === 0,
  };
}

/**
 * Die Zahlen eines Bereichs [von, bis).
 *
 * SIE ENTSTEHEN IN EINEM DURCHLAUF und hinter EINEM Stornofilter. Dieselbe
 * Bauart wie in dashboard-week.ts: Umsatz, Anzahl und offener Betrag hängen
 * an derselben Entscheidung, und zwei getrennte Schleifen wären zwei
 * Gelegenheiten, sie unterschiedlich zu treffen.
 */
function summe(von: string, bis: string, input: AnalyticsInput): AnalyticsTotals {
  let revenueCents = 0;
  let orderCount = 0;
  let unpaidCents = 0;
  let unpaidCount = 0;

  for (const gruppe of input.orders) {
    if (!imBereich(gruppe.day, von, bis)) continue;
    if (!countsTowardsRevenue(gruppe.status)) continue;

    orderCount += gruppe.orderCount;
    revenueCents += gruppe.revenueCents;

    /**
     * DER ZAHLUNGSSTAND ÄNDERT AM UMSATZ NICHTS. Er steht daneben und nicht
     * davor — dieselbe Regel wie im Tagesüberblick. Was der Betrieb
     * umgesetzt hat, entscheidet sich an der Bestellung; ob das Geld schon da
     * ist, ist eine zweite Frage mit einer zweiten Zahl.
     */
    if (!isPaid(gruppe.paymentStatus)) {
      unpaidCents += gruppe.revenueCents;
      unpaidCount += gruppe.orderCount;
    }
  }

  let units = 0;
  const kosten = new CostTally();
  for (const gruppe of input.items) {
    if (!imBereich(gruppe.day, von, bis)) continue;
    if (!countsTowardsRevenue(gruppe.status)) continue;

    units += gruppe.units;
    /**
     * DIE FERTIGEN ZÄHLER WERDEN ADDIERT — addSummary() und nicht addOrder().
     *
     * Die Positionszeilen liegen hier bereits je Tag und Status
     * zusammengefasst vor; eine Einzelposition gibt es an dieser Stelle
     * nicht mehr. addSummary() nimmt genau die Rohzähler auf und bildet
     * `complete`, Rohertrag und Marge danach für das GANZE neu — das ist
     * dieselbe Regel, mit der aus sieben Tagen eine Woche wird, und der
     * Grund, warum ein einziger fehlender Kostenwert den ganzen Zeitraum
     * unvollständig macht, ohne dass es hier als Bedingung stünde.
     */
    kosten.addSummary({
      revenueCents: 0,
      knownCostCents: gruppe.knownCostCents,
      itemCount: gruppe.itemCount,
      missingItemCount: gruppe.missingItemCount,
      orderCount: gruppe.orderCount,
      missingOrderCount: gruppe.missingOrderCount,
      complete: gruppe.missingItemCount === 0,
      grossProfitCents: null,
      marginTenthsPercent: null,
    });
  }

  return {
    revenueCents,
    orderCount,
    units,
    unpaidCents,
    unpaidCount,
    // Kein Teilen durch null: Ohne Bestellung gibt es keinen Durchschnitt.
    averageOrderCents: orderCount === 0 ? null : Math.round(revenueCents / orderCount),
    costs: kosten.summary(revenueCents),
  };
}

/**
 * Der Unterschied zweier Zahlen — und die drei Lagen, in denen es keinen
 * Prozentwert gibt.
 *
 * DIE NULL IM NENNER IST DER GRUND FÜR DIESE FUNKTION. „+∞ %", „NaN %" oder
 * ein aus dem Nichts erfundenes „+100 %" sind der Punkt, an dem ein Betrieb
 * der ganzen Seite nicht mehr glaubt — und der erste Monat eines Systems
 * hat IMMER eine Null im Nenner.
 */
function unterschied(current: number, previous: number): AnalyticsDelta {
  if (previous === 0) {
    return current === 0 ? { kind: 'none' } : { kind: 'new' };
  }
  const absolute = current - previous;
  return { kind: 'value', absolute, tenthsPercent: zehntelProzent(absolute, previous) };
}

/**
 * Zehntel Prozent — dieselbe Einheit und dieselbe Rundung wie bei der Marge
 * in cost-summary.ts. 84 heißt 8,4 %.
 *
 * Gerundet wird über den BETRAG und das Vorzeichen danach gesetzt: Math.round
 * rundet -0,5 auf -0 und 0,5 auf 1, und ein Vergleich, dessen Rundung von der
 * Richtung abhängt, meldete denselben Unterschied je nach Vorzeichen
 * unterschiedlich groß.
 */
function zehntelProzent(absolute: number, previous: number): number {
  const zehntel = (absolute * 1000) / previous;
  const gerundet = Math.round(Math.abs(zehntel));
  if (gerundet === 0) return 0;
  return zehntel < 0 ? -gerundet : gerundet;
}

/**
 * Die Kurve.
 *
 * JEDER PUNKT DES BEREICHS WIRD ANGELEGT, auch der leere. Eine Kurve, die
 * ihre Nullen auslässt, zeigt eine dichte Reihe guter Tage, wo in Wahrheit
 * zwischen zweien eine Woche Stille lag — das ist die Sorte Diagramm, die
 * lügt, ohne eine falsche Zahl zu enthalten.
 */
function kurve(
  period: ReportingPeriod,
  orders: readonly AnalyticsOrderGroup[],
): readonly AnalyticsTrendPoint[] {
  const punkte = eimer(period.trendStart, period.trendEnd, period.granularity);
  if (punkte.length === 0) return [];

  const nachSchluessel = new Map(punkte.map((punkt) => [punkt.key, punkt]));

  for (const gruppe of orders) {
    if (!imBereich(gruppe.day, period.trendStart, period.trendEnd)) continue;
    if (!countsTowardsRevenue(gruppe.status)) continue;

    const punkt = nachSchluessel.get(schluessel(gruppe.day, period.granularity, period.trendStart));
    // Ein Tag ohne Eimer wird still übergangen — dasselbe wie in
    // dashboard-week.ts: Ein Lesemodell soll an einer unerwarteten Zeile
    // nicht scheitern, sondern sie nicht mitzählen.
    if (punkt === undefined) continue;

    punkt.revenueCents += gruppe.revenueCents;
    punkt.orderCount += gruppe.orderCount;
  }

  return punkte;
}

type Eimer = { -readonly [K in keyof AnalyticsTrendPoint]: AnalyticsTrendPoint[K] };

function eimer(von: string, bis: string, granularity: TrendGranularity): Eimer[] {
  const punkte: Eimer[] = [];
  let lauf = granularity === 'week' ? weekStart(von) : von;

  while (lauf < bis) {
    const ende = naechsterEimer(lauf, granularity);
    punkte.push({
      key: schluessel(lauf, granularity, von),
      start: lauf,
      end: ende,
      revenueCents: 0,
      orderCount: 0,
    });
    lauf = ende;
  }
  return punkte;
}

function naechsterEimer(start: string, granularity: TrendGranularity): string {
  if (granularity === 'day') return plusDays(start, 1);
  if (granularity === 'week') return plusDays(start, 7);
  const jahr = Number(start.slice(0, 4));
  const monat = Number(start.slice(5, 7));
  return new Date(Date.UTC(jahr, monat, 1)).toISOString().slice(0, 10);
}

/**
 * Der Eimer, in den ein Tag fällt.
 *
 * Bei Monaten ist es der Monat, bei Wochen der MONTAG dieser Woche — und
 * zwar derselbe Montag, den weekStart() überall sonst im System bestimmt.
 * `von` wird nicht gebraucht, steht aber in der Signatur, damit die
 * Zuordnung nie versehentlich vom Bereichsanfang abhängt.
 */
function schluessel(day: string, granularity: TrendGranularity, _von: string): string {
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') return weekStart(day);
  return day;
}

/**
 * Die Toplisten.
 *
 * SIE WERDEN NACH BESTELLUMSATZ SORTIERT und nicht nach Menge. Die
 * Tagesübersicht führt bereits eine Liste „Meistbestellt" nach Stück — das
 * ist die Frage der Backstube. Hier steht die kaufmännische Frage, und auf
 * die antwortet ein Blech für 48 € anders als sechs Stück Kuchen für je 4 €.
 * Die Stückzahl steht trotzdem daneben; sie ist die Erklärung des Umsatzes.
 *
 * DERSELBE GEGENSTAND WIRD ÜBER DIE STATUS HINWEG ZUSAMMENGEFASST. Die
 * Abfrage gruppiert nach Status, weil die Domäne die Umsatzregel behalten
 * soll; für die Liste ist derselbe Kuchen in „neu" und in „abgeschlossen"
 * aber derselbe Kuchen.
 *
 * BEI EINER UMBENENNUNG GEWINNT DER NEUESTE SCHNAPPSCHUSS. Ein Produkt, das
 * im Juli anders hieß als im September, stünde sonst zweimal in derselben
 * Liste — und der Betrieb sucht den Namen, den er heute benutzt.
 */
function topProdukte(products: readonly AnalyticsProductGroup[]): readonly TopProduct[] {
  const zusammen = new Map<
    number,
    { name: string; unit: string; latestItemId: number; units: number; revenueCents: number }
  >();

  for (const gruppe of products) {
    if (!countsTowardsRevenue(gruppe.status)) continue;

    const bisher = zusammen.get(gruppe.productId);
    if (bisher === undefined) {
      zusammen.set(gruppe.productId, {
        name: gruppe.name,
        unit: gruppe.unit,
        latestItemId: gruppe.latestItemId,
        units: gruppe.units,
        revenueCents: gruppe.revenueCents,
      });
      continue;
    }
    bisher.units += gruppe.units;
    bisher.revenueCents += gruppe.revenueCents;
    if (gruppe.latestItemId > bisher.latestItemId) {
      bisher.latestItemId = gruppe.latestItemId;
      bisher.name = gruppe.name;
      bisher.unit = gruppe.unit;
    }
  }

  return [...zusammen.values()]
    .sort(nachUmsatz)
    .slice(0, TOPLISTE_LAENGE)
    .map(({ name, unit, units, revenueCents }) => ({ name, unit, units, revenueCents }));
}

function topKunden(customers: readonly AnalyticsCustomerGroup[]): readonly TopCustomer[] {
  const zusammen = new Map<
    number,
    { name: string; latestOrderId: number; orderCount: number; revenueCents: number }
  >();

  for (const gruppe of customers) {
    if (!countsTowardsRevenue(gruppe.status)) continue;

    const bisher = zusammen.get(gruppe.customerId);
    if (bisher === undefined) {
      zusammen.set(gruppe.customerId, {
        name: gruppe.name,
        latestOrderId: gruppe.latestOrderId,
        orderCount: gruppe.orderCount,
        revenueCents: gruppe.revenueCents,
      });
      continue;
    }
    bisher.orderCount += gruppe.orderCount;
    bisher.revenueCents += gruppe.revenueCents;
    if (gruppe.latestOrderId > bisher.latestOrderId) {
      bisher.latestOrderId = gruppe.latestOrderId;
      bisher.name = gruppe.name;
    }
  }

  /**
   * DIE KUNDENKENNUNG VERLÄSST DIESE FUNKTION NICHT. Sie ordnet hier zu und
   * hat in der Oberfläche nichts zu suchen — eine Auswertung, die „Kunde
   * #17" zeigt, verrät eine interne Zählung und beantwortet keine Frage.
   */
  return [...zusammen.values()]
    .sort(nachUmsatz)
    .slice(0, TOPLISTE_LAENGE)
    .map(({ name, orderCount, revenueCents }) => ({ name, orderCount, revenueCents }));
}

/**
 * Die Sortierung beider Toplisten.
 *
 * Der zweite und dritte Schlüssel sind kein Zierrat: Zwei Produkte mit
 * demselben Umsatz sollen in JEDER Ansicht in derselben Reihenfolge stehen.
 * Eine Liste, die bei gleichem Wert die Plätze tauscht, sieht bei jedem
 * Neuladen anders aus.
 */
function nachUmsatz(
  a: { revenueCents: number; name: string },
  b: { revenueCents: number; name: string },
): number {
  if (b.revenueCents !== a.revenueCents) return b.revenueCents - a.revenueCents;
  return a.name.localeCompare(b.name, 'de');
}

/**
 * Die beiden leisen Aufteilungen.
 *
 * SIE SIND KEINE KENNZAHLEN. Gastro gegen Privat und Lieferung gegen Abholung
 * beantworten die Frage nach dem WOHER eines Umsatzes, den man schon kennt —
 * sie stehen deshalb unten, klein und ohne eigene Farbe.
 *
 * Die Preisgruppe kommt aus der Zuordnung des Kunden (`price_list_id`) und
 * ist damit der HEUTIGE Stand und kein Schnappschuss. Das ist bewusst so:
 * Das System kennt keine Historie der Preisgruppen, und eine hier erfundene
 * wäre eine Behauptung. Ein Kunde ohne Zuordnung wird ausdrücklich als
 * „Ohne Preisgruppe" geführt und nicht stillschweigend zu einer der beiden
 * geschlagen.
 */
function preisgruppen(segments: readonly AnalyticsSegmentGroup[]): AnalyticsBreakdown {
  return aufteilung(segments, (gruppe) => {
    const code = gruppe.priceGroupCode ?? 'ohne';
    return {
      key: code in PREISGRUPPEN ? code : 'ohne',
      label: PREISGRUPPEN[code] ?? 'Ohne Preisgruppe',
    };
  }, PREISGRUPPEN_REIHENFOLGE);
}

function zustellarten(segments: readonly AnalyticsSegmentGroup[]): AnalyticsBreakdown {
  return aufteilung(
    segments,
    (gruppe) => ({ key: gruppe.fulfillmentType, label: fulfillmentLabel(gruppe.fulfillmentType) }),
    ['delivery', 'pickup'],
  );
}

function aufteilung(
  segments: readonly AnalyticsSegmentGroup[],
  zuordnen: (gruppe: AnalyticsSegmentGroup) => { key: string; label: string },
  reihenfolge: readonly string[],
): AnalyticsBreakdown {
  const teile = new Map<string, { label: string; orderCount: number; revenueCents: number }>();
  let totalCents = 0;

  for (const gruppe of segments) {
    if (!countsTowardsRevenue(gruppe.status)) continue;

    const { key, label } = zuordnen(gruppe);
    const bisher = teile.get(key) ?? { label, orderCount: 0, revenueCents: 0 };
    bisher.orderCount += gruppe.orderCount;
    bisher.revenueCents += gruppe.revenueCents;
    teile.set(key, bisher);
    totalCents += gruppe.revenueCents;
  }

  const entries = reihenfolge
    .filter((key) => teile.has(key))
    .map((key) => {
      const teil = teile.get(key) as { label: string; orderCount: number; revenueCents: number };
      return {
        key,
        label: teil.label,
        orderCount: teil.orderCount,
        revenueCents: teil.revenueCents,
        // Kein Teilen durch null: Ein Zeitraum ohne Umsatz hat keine Anteile.
        shareTenthsPercent:
          totalCents === 0 ? 0 : Math.round((teil.revenueCents * 1000) / totalCents),
      };
    });

  return { totalCents, entries };
}

/** Halboffen: `von` zählt mit, `bis` nicht mehr. */
function imBereich(day: string, von: string, bis: string): boolean {
  return day >= von && day < bis;
}
