import type { FulfillmentType } from './fulfillment-type';
import {
  ORDER_STATUSES,
  countsTowardsRevenue,
  isOpenProduction,
  type OrderStatus,
} from './order-status';
import { isPaid, type PaymentStatus } from './payment-status';

/**
 * Der Tagesüberblick — die Antwort auf die Frage, mit der ein Betrieb morgens
 * auf den Bildschirm sieht:
 *
 *   „Wie steht dieser Tag?"
 *
 * WOZU EIN ZWEITES LESEMODELL NEBEN production-day.ts. Die beiden beantworten
 * verschiedene Fragen und dürfen sich deshalb nicht teilen:
 *
 *   Der Produktionstag ist FINANZFREI durch Bauart — er führt keine Preise,
 *   weil eine Backliste keine braucht, und was nicht geladen wird, kann nicht
 *   abfließen. Er zeigt außerdem NUR offene Bestellungen; eine abgeschlossene
 *   gehört nicht mehr auf die Liste dessen, was zu backen ist.
 *
 *   Der Tagesüberblick ist das Gegenteil: Er führt Beträge, und er zeigt den
 *   GANZEN Tag — abgeschlossene Bestellungen inklusive, stornierte sichtbar
 *   und ausdrücklich gekennzeichnet. Ein Umsatz, der die abgeschlossenen
 *   Bestellungen wegließe, wäre kein Umsatz.
 *
 * Das eine Modell um Preise und Status zu erweitern hätte beide Ansichten
 * beschädigt: Die Backliste hätte Beträge bekommen, die niemand dort braucht,
 * und der Überblick hätte den Filter der Produktion geerbt.
 *
 * DIESES MODUL IST EIN LESEMODELL UND KEIN AGGREGAT — dieselbe Entscheidung
 * wie in production-day.ts. Keine Invarianten, keine Übergänge, keine
 * Identität. Eine Bestellung, deren gespeicherter Betrag beschädigt ist, soll
 * hier auftauchen, damit jemand es merkt, und nicht die ganze Seite zum
 * Absturz bringen.
 *
 * ES GIBT KEINE ZEIT IN DIESER DATEI. Kein Date, kein Date.now(), keine
 * Zeitzone. Der Tag kommt als Zeichenkette herein und geht als Zeichenkette
 * hinaus.
 *
 * ES WIRD NICHT GERECHNET, WAS SCHON GERECHNET IST. Der Betrag einer
 * Bestellung ist der SNAPSHOT aus total_amount_cents und wird hier nicht aus
 * den Positionen neu gebildet: Ein zweiter Rechenweg wäre eine zweite
 * Meinung darüber, was eine Bestellung gekostet hat, und die spätere
 * Preisänderung eines Produkts dürfte eine Bestellung von letzter Woche nicht
 * teurer machen.
 */

/** Höchstens so viele Zeilen zeigt „Meistbestellt". */
export const TOP_PRODUCTS_LIMIT = 5;

/**
 * Eine Position, wie der Überblick sie sieht.
 *
 * OHNE PREIS — und das ist kein Versehen. Was eine Bestellung gekostet hat,
 * steht in ihrem Gesamtbetrag; ein Positionspreis würde hier ausschließlich
 * dazu dienen, eine zweite Summe daraus zu bilden. `sortOrder` stammt wie in
 * der Produktionsansicht aus dem AKTUELLEN Produktdatensatz und dient allein
 * der Reihenfolge.
 */
export interface DashboardOrderItem {
  readonly productId: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly sortOrder: number;
  readonly quantity: number;
}

/**
 * Eine Bestellung, wie der Überblick sie sieht.
 *
 * `customerName` ist der SNAPSHOT aus der Bestellung — es wird nicht auf
 * customers verbunden. `customerId` ist dagegen die heutige Kennung und dient
 * genau einem Zweck: Kunden zu zählen, ohne sie über ihren Namen zu zählen.
 * Zwei Cafés mit demselben Namen wären sonst eines, und ein umbenanntes Café
 * wären zwei.
 */
export interface DashboardOrder {
  readonly orderNumber: string;
  readonly customerId: number;
  readonly customerName: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly fulfillmentType: FulfillmentType;
  /** Der gespeicherte Gesamtbetrag in Cent — Snapshot, nicht neu gerechnet. */
  readonly totalCents: number;
  /** Wann bestellt wurde — ISO-8601-UTC. Nicht der Liefertag. */
  readonly createdAt: string;
  readonly items: readonly DashboardOrderItem[];
}

/** Eine Zeile aus „Meistbestellt". */
export interface DashboardProductLine {
  readonly productId: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly quantity: number;
}

/**
 * Der ganze Tag in Zahlen — sechs Kennzahlen und keine siebte.
 *
 * Jede beantwortet eine Frage, die jemand tatsächlich stellt. Was keine
 * Frage beantwortet, steht nicht da: kein Durchschnittsbon, keine
 * Vortagesveränderung, keine Prognose, keine Marge. Ein Betrieb, der morgens
 * drei Sekunden auf diesen Bildschirm sieht, soll etwas erfahren und nicht
 * etwas auswerten.
 */
export interface DashboardDay {
  readonly date: string;
  /** Bestellungen des Tages OHNE stornierte. */
  readonly orderCount: number;
  /** Die stornierten — getrennt ausgewiesen statt still weggelassen. */
  readonly cancelledCount: number;
  /** Umsatz in Cent, ohne stornierte. */
  readonly revenueCents: number;
  /** Was die Backstube noch vor sich hat. */
  readonly openCount: number;
  /** Verschiedene Kunden, ohne stornierte. */
  readonly customerCount: number;
  /** Summe aller bestellten Mengen, ohne stornierte. */
  readonly totalUnits: number;
  /** Was von diesem Tag noch aussteht — in Cent. */
  readonly unpaidCents: number;
  /** Wie viele Bestellungen das sind. */
  readonly unpaidCount: number;
  /**
   * Die GEGENSEITE von unpaid — und keine neue Kennzahl.
   *
   * `paidCents + unpaidCents === revenueCents` gilt hier per Bauart und nicht
   * per Absprache: Beide werden in DEMSELBEN Durchlauf und hinter DEMSELBEN
   * Stornofilter gezählt wie der Umsatz. Sie stehen nur deshalb hier und
   * nicht in der Ansicht: Eine Ansicht, die „bezahlt" aus `revenueCents -
   * unpaidCents` selbst ausrechnet, ist eine zweite Summe — und die auf dem
   * Bildschirm sichtbare wäre die falsche, sobald sich an dieser Datei etwas
   * ändert.
   */
  readonly paidCents: number;
  readonly paidCount: number;
  /**
   * Wie viele Bestellungen in welchem Produktionsstatus stehen — ALLE, die
   * stornierten eingeschlossen.
   *
   * KEINE NEUE FACHFRAGE, nur eine feinere Auflösung einer bereits
   * beantworteten: `openCount` sagt, wie viel die Backstube noch vor sich
   * hat; diese Aufteilung sagt, WO es steht. Die Summe über alle Einträge ist
   * `orderCount + cancelledCount`, und `statusCounts.cancelled` ist
   * `cancelledCount` — beides prüfbar und geprüft.
   *
   * Die Schlüssel kommen aus ORDER_STATUSES und sind keine eigene Liste: Ein
   * sechster Status wäre sonst ein Status, den diese Aufteilung stillschweigend
   * verschwiegen hätte.
   */
  readonly statusCounts: Readonly<Record<OrderStatus, number>>;
  /** ALLE Bestellungen des Tages, stornierte eingeschlossen. */
  readonly orders: readonly DashboardOrder[];
  readonly topProducts: readonly DashboardProductLine[];
}

/**
 * Fasst die Bestellungen eines Tages zum Überblick zusammen.
 *
 * EIN DURCHLAUF, SECHS ZAHLEN. Sechs getrennte filter().reduce()-Ketten wären
 * lesbarer geschrieben und sechsmal die Gelegenheit, den Stornofilter bei
 * einer davon zu vergessen — genau der Fehler, der zu hohe Umsätze meldet und
 * als Letztes bemerkt wird. Hier gibt es EIN `if`, und hinter ihm zählt
 * nichts mehr mit.
 *
 * DER STORNOFILTER IST EINE FRAGE AN DIE DOMÄNE und keine Zeichenkette in
 * dieser Datei: countsTowardsRevenue() steht in order-status.ts, neben den
 * Status selbst. In dieser Datei kommt das Wort 'cancelled' nicht vor.
 *
 * DIE STORNIERTEN BLEIBEN IN `orders`. Sie verschwinden aus jeder Summe und
 * aus keiner Liste: Wer wissen will, warum der Tag dünn aussieht, muss die
 * Stornierung sehen können. Eine Ansicht, die sie unterschlägt, wirkt
 * aufgeräumt und ist unehrlich.
 *
 * ES WIRD NICHT SORTIERT. Die Reihenfolge der Bestellungen bestimmt die
 * Abfrage; eine zweite Sortierung hier wäre eine zweite Meinung darüber, wie
 * ein Tag zu lesen ist.
 */
export function aggregateDashboardDay(
  day: string,
  orders: readonly DashboardOrder[],
): DashboardDay {
  const kunden = new Set<number>();
  const mengen = new Map<string, DashboardProductLine & { readonly sortOrder: number }>();

  let orderCount = 0;
  let cancelledCount = 0;
  let revenueCents = 0;
  let openCount = 0;
  let totalUnits = 0;
  let unpaidCents = 0;
  let unpaidCount = 0;
  let paidCents = 0;
  let paidCount = 0;

  /**
   * Aus ORDER_STATUSES aufgebaut und nicht aus den vorkommenden Status: Ein
   * Status, an dem heute keine Bestellung steht, ist eine 0 und keine Lücke.
   * Sonst hätte die Aufteilung an einem ruhigen Tag drei Einträge und an
   * einem vollen fünf — und wäre von Tag zu Tag nicht vergleichbar.
   */
  const statusCounts: Record<OrderStatus, number> = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;

  for (const order of orders) {
    /**
     * VOR dem Stornofilter. Die Aufteilung nach Produktionsstatus ist die
     * einzige Zahl dieser Datei, die den Storno MITZÄHLT — er ist dort ein
     * Status wie jeder andere und nicht das, was hinten herunterfällt.
     */
    statusCounts[order.status] += 1;

    if (!countsTowardsRevenue(order.status)) {
      cancelledCount += 1;
      continue;
    }

    orderCount += 1;
    revenueCents += order.totalCents;
    kunden.add(order.customerId);

    if (isOpenProduction(order.status)) {
      openCount += 1;
    }

    /**
     * DER ZAHLUNGSSTATUS ÄNDERT AM UMSATZ NICHTS — er wird hier gelesen,
     * NACHDEM revenueCents bereits gezählt hat. Die Reihenfolge ist Absicht:
     * Es gibt keinen Zweig, in dem eine unbezahlte Bestellung den Umsatz
     * verpasst.
     */
    if (isPaid(order.paymentStatus)) {
      paidCents += order.totalCents;
      paidCount += 1;
    } else {
      unpaidCents += order.totalCents;
      unpaidCount += 1;
    }

    for (const item of order.items) {
      totalUnits += item.quantity;

      /**
       * DER SCHLÜSSEL IST EIN TRIPEL — dieselbe Regel wie in
       * production-day.ts und aus demselben Grund: Name und Einheit sind
       * Snapshots. Über die ID allein zu aggregieren und dann irgendeinen der
       * vorkommenden Namen anzuzeigen, benennte eine historische Bestellung
       * stillschweigend um.
       *
       * Das Trennzeichen \u0000 kann in keinem Namen und in keiner Einheit
       * vorkommen — anders als ein Leerzeichen oder ein Bindestrich, mit
       * denen sich „Kuchen mit Guss"/„Stück" und „Kuchen"/„mit Guss Stück" zum
       * selben Schlüssel verkleben ließen. Es steht hier als ESCAPE-SEQUENZ
       * und nicht als echtes Byte in der Datei: Ein NUL im Quelltext macht
       * die Datei für grep und für manche Editoren zu einer Binärdatei.
       */
      const schluessel = `${item.productId}\u0000${item.productName}\u0000${item.productUnit}`;
      const bisher = mengen.get(schluessel);

      mengen.set(schluessel, {
        productId: item.productId,
        productName: item.productName,
        productUnit: item.productUnit,
        sortOrder: item.sortOrder,
        quantity: (bisher?.quantity ?? 0) + item.quantity,
      });
    }
  }

  return {
    date: day,
    orderCount,
    cancelledCount,
    revenueCents,
    openCount,
    customerCount: kunden.size,
    totalUnits,
    unpaidCents,
    unpaidCount,
    paidCents,
    paidCount,
    statusCounts,
    orders,
    topProducts: topProdukte(mengen),
  };
}

/**
 * Die meistbestellten Produkte des Tages — nach MENGE und nicht nach Umsatz.
 *
 * Die Wahl ist begründet und nicht beliebig: Diese Liste steht auf einer
 * Seite, die eine Backstube liest, und dort ist „wovon geht am meisten weg"
 * die brauchbare Aussage. Nach Umsatz sortiert stünde oben, was teuer ist —
 * eine einzelne große Torte schlüge vierzig Stück Kuchen, und die Liste
 * beantwortete eine Frage, die auf dieser Seite niemand stellt. Der Umsatz
 * des Tages steht ohnehin als eigene Kennzahl darüber.
 *
 * DIE REIHENFOLGE IST VOLLSTÄNDIG BESTIMMT, ohne Rest:
 *
 *   1. Menge, absteigend — der Zweck der Liste.
 *   2. sortOrder          die Ordnung des Sortiments, wie überall im System.
 *   3. Name               Gleichstandsbrecher.
 *   4. productId          danach können sich zwei Zeilen nicht mehr
 *                         unterscheiden, außer in der Einheit.
 *   5. Einheit            der letzte Fall.
 *
 * VERGLICHEN WIRD NACH CODEPUNKTEN, nicht mit localeCompare: Dessen Ergebnis
 * hängt an den ICU-Daten der Laufzeit und könnte zwischen lokalem Test und
 * Cloudflare-Edge abweichen — dieselbe Begründung wie in production-day.ts.
 */
function topProdukte(
  mengen: ReadonlyMap<string, DashboardProductLine & { readonly sortOrder: number }>,
): readonly DashboardProductLine[] {
  return [...mengen.values()]
    .sort((a, b) => {
      if (a.quantity !== b.quantity) return b.quantity - a.quantity;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.productName !== b.productName) return a.productName < b.productName ? -1 : 1;
      if (a.productId !== b.productId) return a.productId - b.productId;
      if (a.productUnit !== b.productUnit) return a.productUnit < b.productUnit ? -1 : 1;
      return 0;
    })
    .slice(0, TOP_PRODUCTS_LIMIT)
    .map(({ productId, productName, productUnit, quantity }) => ({
      productId,
      productName,
      productUnit,
      quantity,
    }));
}
