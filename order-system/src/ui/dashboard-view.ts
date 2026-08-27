import { plusDays, weekStart } from '../domain/clock';
import {
  dashboardActions,
  type DashboardAction,
  type DashboardActionKey,
} from '../domain/dashboard-actions';
import type { CostSummary } from '../domain/cost-summary';
import type { DashboardDay } from '../domain/dashboard-day';
import { fulfillmentLabel } from '../domain/fulfillment-type';
import { ORDER_STATUSES, countsTowardsRevenue, orderStatusLabel } from '../domain/order-status';
import {
  PAYMENT_STATUSES,
  isPaid,
  paymentStatusLabel,
  type PaymentStatus,
} from '../domain/payment-status';
import {
  formatEuro,
  formatGermanDate,
  formatGermanTimestamp,
  formatPercentFromTenths,
  formatSignedEuro,
} from './format';

/**
 * Das Ansichtsmodell des Tagesüberblicks — alles, was die Seite anzeigt, und
 * nichts, was sie nicht anzeigt.
 *
 * WARUM ES DIESE SCHICHT GIBT — dieselbe Begründung wie bei
 * production-day-view.ts: Das Lesemodell ist die fachliche Antwort und kennt
 * keine Sprache. Zwischen ihm und dem HTML muss dreierlei passieren: Status
 * und Zahlungsstand werden deutsch, Cent werden Eurobeträge, und der Tag
 * bekommt eine lesbare Form samt Nachbartagen. Stünde das im Renderer, stünde
 * Logik in Zeichenkettenverkettung — und wäre nur über HTML prüfbar.
 *
 * DIESE DATEI IST REIN. Keine Datenbank, keine Uhr, kein Zufall, kein
 * Request. Derselbe Eingabewert ergibt immer dieselbe Ausgabe; deshalb laufen
 * ihre Tests im Projekt „domain" ohne Worker-Runtime.
 *
 * ES WIRD NICHT GERECHNET. orderCount, revenueCents, unpaidCents und die
 * übrigen Zahlen kommen aus der Aggregation und werden hier ausschließlich
 * FORMATIERT. Eine zweite Summe in dieser Datei könnte der ersten
 * widersprechen — und die auf dem Bildschirm sichtbare wäre die falsche.
 *
 * ES WIRD NICHT GEFILTERT UND NICHT SORTIERT. Welche Bestellung storniert
 * ist, entscheidet die Domäne; die Reihenfolge bestimmt die Abfrage.
 */

/** Die Auswahl im Zahlungsformular — aus der Domänenliste, nicht daneben. */
export interface PaymentOptionView {
  readonly value: PaymentStatus;
  readonly label: string;
}

/**
 * Die fünf Zahlungsstände als Auswahl.
 *
 * SIE ENTSTEHT AUS PAYMENT_STATUSES und ist keine eigene Liste. Eine
 * handgeschriebene Aufzählung im Formular wäre eine zweite Fassung der
 * Domänenliste — und die stille Sorte Fehler, bei der ein Zustand existiert,
 * aber niemand ihn auswählen kann.
 */
export const PAYMENT_OPTIONS: readonly PaymentOptionView[] = PAYMENT_STATUSES.map((value) => ({
  value,
  label: paymentStatusLabel(value),
}));

export interface DashboardOrderRowView {
  readonly orderNumber: string;
  readonly customerName: string;
  /** „Neu", „In Produktion", „Storniert" — aus orderStatusLabel(). */
  readonly statusLabel: string;
  /**
   * Diese Bestellung zählt in keiner Summe mit.
   *
   * Eine Frage der DARSTELLUNG, aber mit derselben Quelle wie die Summen:
   * countsTowardsRevenue(). Eine Zeile, die als storniert gezeigt wird,
   * während sie im Umsatz steht, wäre schlimmer als gar keine Kennzeichnung.
   */
  readonly isCancelled: boolean;
  /** Der gespeicherte Stand — er bestimmt die Vorauswahl im Formular. */
  readonly paymentStatus: PaymentStatus;
  /** „Offen", „Bar bezahlt" — aus paymentStatusLabel(). */
  readonly paymentStatusLabel: string;
  readonly isPaid: boolean;
  /** „43,50 €" — aus dem gespeicherten Gesamtbetrag. */
  readonly amountLabel: string;
  /** „25.08.2026, 09:12" — wann bestellt wurde, nicht der Liefertag. */
  readonly orderedAtLabel: string;
  /** „Lieferung" oder „Abholung". */
  readonly fulfillmentLabel: string;
}

export interface DashboardProductLineView {
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
}

/**
 * EIN STÜCK EINES RINGDIAGRAMMS.
 *
 * `dashArray` und `dashOffset` sind GEOMETRIE und keine Kennzahl. Sie stehen
 * hier und nicht im Renderer, weil sie sonst als Rechnung in einer
 * Zeichenkettenverkettung stünden und nur über HTML prüfbar wären — dieselbe
 * Begründung, aus der diese Datei überhaupt existiert.
 *
 * ES WIRD DABEI NICHTS SUMMIERT. Jeder `count` kommt fertig aus der
 * Aggregation; hier wird er ausschließlich ins Verhältnis zum ebenfalls
 * fertigen Gesamtwert gesetzt. Eine zweite Summe entstünde erst, wenn diese
 * Datei anfinge, Bestellungen zu zählen — und das tut sie nicht.
 */
export interface DonutSegmentView {
  /** 'bezahlt', 'offen' oder ein OrderStatus — er wählt die Farbe im CSS. */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** „3 Bestellungen" — mit Einzahl, wo es eine ist. */
  readonly countLabel: string;
  /** „60,90 €" beim Zahlungsring, leer beim Statusring. */
  readonly detailLabel: string;
  readonly dashArray: string;
  readonly dashOffset: string;
}

export interface DonutView {
  readonly total: number;
  readonly totalLabel: string;
  /**
   * Das Wort unter der Zahl in der Mitte — „gesamt" und nicht
   * „Bestellungen".
   *
   * Ein Befund aus dem Browser: „BESTELLUNGEN" stand breiter als das Loch des
   * Rings und lief über die Ringspur hinaus. Das Wort steht ohnehin schon im
   * Tafelkopf („7 Bestellungen"); in der Mitte muss nur stehen, dass diese
   * Zahl die Summe ist.
   */
  readonly totalCaption: string;
  /** „7 Bestellungen" — die Angabe im Tafelkopf. */
  readonly totalCountLabel: string;
  readonly segments: readonly DonutSegmentView[];
  readonly isEmpty: boolean;
  /** „zusätzlich 1 storniert" — oder leer. */
  readonly footnote: string;
}

/**
 * EINE ZEILE IM HANDLUNGSBEDARF — fertig beschriftet und fertig verlinkt.
 *
 * Die Domäne liefert Schlüssel, Anzahl und Betrag; hier wird daraus Sprache
 * und ein Ziel. Beides gehört zusammen an EINE Stelle: Ein Renderer, der zu
 * jedem Schlüssel selbst den Text und die URL zusammensetzte, hätte die
 * Zuordnung „welche Aktion führt wohin" in einer Zeichenkettenverkettung
 * stehen — prüfbar nur über HTML.
 *
 * DIE ZIELE SIND KONSTANTEN AUS DIESER DATEI, in die genau ein Wert eingesetzt
 * wird: der bereits geprüfte Kalendertag. Es gibt keinen Weg, über eine dieser
 * Adressen irgendwohin zu gelangen, was nicht hier steht — kein Rückkehrziel
 * aus einem Parameter, keine Weiterleitung nach draußen.
 */
export interface DashboardActionView {
  /** 'new_orders', 'open_production', 'unpaid' — er wählt die Marke im CSS. */
  readonly key: string;
  readonly count: number;
  /** Die Ziffer, die vorn steht. */
  readonly countLabel: string;
  /** „Neue Bestellungen", „Zahlungen offen". */
  readonly title: string;
  /** „69,60 €" bei den Zahlungen, sonst leer. */
  readonly amountLabel: string;
  /** Die zweite Zeile: „warten auf Bestätigung". */
  readonly detail: string;
  /** „Zur Produktion" — was der Klick tut. */
  readonly linkLabel: string;
  readonly href: string;
}

/** Ein Ziel der Schnellwahl über der Tagesansicht. */
export interface QuickDayView {
  readonly label: string;
  readonly href: string;
  /** Der betrachtete Tag IST dieser Tag — die Schaltfläche ist die aktive. */
  readonly isCurrent: boolean;
}

export interface QuickDaysView {
  readonly today: QuickDayView;
  readonly tomorrow: QuickDayView;
  readonly week: QuickDayView;
}

/**
 * Welche Bestellungen die Liste zeigt.
 *
 * ZWEI WERTE UND KEIN DRITTER. Ein 'open' für die offene Produktion wäre
 * naheliegend und wäre falsch: Was zu produzieren ist, steht in der
 * Produktionsansicht, und die ist dafür die einzige Quelle. Ein zweiter Ort
 * mit derselben Liste wäre ein zweiter Ort, an dem die Statusregel steht.
 */
export type OrderFilter = 'all' | 'unpaid';

/**
 * Die Bestellliste, wie sie angezeigt wird.
 *
 * DER FILTER IST REINE ANZEIGE. Er wählt Zeilen aus einer bereits fertigen
 * Liste und rechnet nichts nach — die Kennzahlen darüber, die Ringe und die
 * Wochensumme bleiben unberührt. Ein Filter, der die Kennzahlen mitfilterte,
 * wäre eine zweite Tagesansicht mit anderen Zahlen unter derselben Adresse.
 */
export interface DashboardOrderListView {
  readonly filter: OrderFilter;
  readonly isFiltered: boolean;
  /** „Bestellungen" oder „Offene Zahlungen". */
  readonly title: string;
  /** „3 Einträge" — die Angabe im Tafelkopf. */
  readonly meta: string;
  readonly rows: readonly DashboardOrderRowView[];
  /** Der Weg zurück zur ungefilterten Liste. */
  readonly allHref: string;
  /** Was dasteht, wenn keine Zeile bleibt. */
  readonly emptyText: string;
}

/**
 * WOHIN „HERSTELLKOSTEN ERGÄNZEN" FÜHRT — eine Konstante und kein Parameter.
 *
 * Es ist der bestehende Bereich auf der Seite „Sortiment & Preise", der die
 * Kostenwerte ohnehin schon pflegt (seit Phase 7A). Es gibt bewusst KEINE
 * zweite Kostenpflegeseite: Zwei Orte, an denen derselbe Wert eingetragen
 * wird, sind zwei Formulare, zwei Rückmeldungen und irgendwann zwei
 * Meinungen darüber, was gespeichert wurde.
 */
const KOSTENPFLEGE_HREF = '/admin/catalog#herstellkosten';

/**
 * DER FINANZBEREICH — vier Zeilen und die Frage, ob man sie zeigen darf.
 *
 * ALLE VIER WERTE SIND FERTIGE ZEICHENKETTEN. Es steht kein `number` und kein
 * `null` in diesem Modell, aus dem der Renderer noch etwas entscheiden
 * müsste: Ob eine Marge erscheint, ist eine FACHLICHE Frage, sie ist in
 * cost-summary.ts beantwortet, und sie darf nicht ein zweites Mal in einer
 * Zeichenkettenverkettung beantwortet werden. Der Renderer setzt hin, was
 * hier steht.
 *
 * BEI UNVOLLSTÄNDIGER KOSTENBASIS STEHT ÜBERALL EIN STRICH — auch bei den
 * Herstellkosten, obwohl die bekannte Teilsumme vorläge. Eine Zeile
 * „Herstellkosten 380,00 €" neben „Umsatz 1.240,00 €" liest sich als
 * vollständig, ganz gleich, was zwei Zeilen tiefer steht; sie wäre dieselbe
 * Halbwahrheit wie eine Teilmarge, nur unauffälliger. Der Umsatz bleibt
 * davon unberührt und steht immer richtig da.
 */
export interface DashboardFinanceView {
  /** „1.240,00 €" — immer, und identisch mit der Kennzahl darüber. */
  readonly revenueLabel: string;
  /** „510,30 €" oder „—". */
  readonly costLabel: string;
  /** „729,70 €", „-20,00 €" oder „—". */
  readonly grossProfitLabel: string;
  /** „58,8 %", „-20,0 %" oder „—". */
  readonly marginLabel: string;
  /** Jede relevante Position trägt einen Kostenwert. */
  readonly isComplete: boolean;
  /** Der Rohertrag steht unter null — für die Darstellung, nicht für die Rechnung. */
  readonly isNegative: boolean;
  /**
   * Auch die MARGE steht unter null.
   *
   * Sie ist nicht dasselbe wie `isNegative`, und der Unterschied ist ein
   * echter Fall: Ein Tag mit Kosten und ohne Umsatz hat einen negativen
   * Rohertrag, aber gar keine Marge — dort steht ein Strich, und ein roter
   * Strich wäre eine Farbe ohne Aussage.
   */
  readonly isMarginNegative: boolean;
  /** „Kostenbasis vollständig" oder „Kostenbasis unvollständig". */
  readonly statusLabel: string;
  /**
   * Der erklärende Satz darunter.
   *
   * Er nennt BESTELLUNGEN und nicht Positionen, obwohl der fehlende Wert an
   * der Position hängt: Ein Betrieb denkt in Bestellungen, die Seite zählt
   * überall sonst Bestellungen, und „bei 2 von 14 Positionen" schickt
   * jemanden auf die Suche nach einer Zahl, die auf dieser Seite sonst nicht
   * vorkommt. Der Weg zur Abhilfe führt ohnehin über das Produkt.
   */
  readonly note: string;
  /** Der Weg zur Kostenpflege — nur, wenn etwas fehlt. */
  readonly href: string | null;
  readonly linkLabel: string;
}

export interface DashboardDayView {
  /** 'JJJJ-MM-TT' — für URLs und das Datumsfeld. */
  readonly day: string;
  /** „Freitag, 28. August 2026" — für Menschen. */
  readonly dayLabel: string;
  readonly previousDay: string;
  readonly previousDayLabel: string;
  readonly nextDay: string;
  readonly nextDayLabel: string;

  readonly orderCount: number;
  readonly cancelledCount: number;
  readonly revenueLabel: string;
  readonly openCount: number;
  readonly customerCount: number;
  readonly totalUnits: number;
  readonly unpaidLabel: string;
  readonly unpaidCount: number;

  /**
   * An diesem Tag ist ÜBERHAUPT nichts bestellt worden.
   *
   * Der Unterschied zu „orderCount === 0" ist der Storno: Ein Tag, an dem
   * eine Bestellung eingegangen und wieder storniert wurde, ist nicht leer —
   * er hat eine Geschichte, und die Seite soll sie zeigen statt „nichts los"
   * zu behaupten.
   */
  readonly isEmpty: boolean;

  readonly orders: readonly DashboardOrderRowView[];
  readonly topProducts: readonly DashboardProductLineView[];

  /** Bezahlt gegen offen — über die Bestellungen, die zählen. */
  readonly paymentDonut: DonutView;
  /** Wo die Bestellungen des Tages stehen — stornierte eingeschlossen. */
  readonly statusDonut: DonutView;

  /**
   * Was an diesem Tag zu tun ist — leer, wenn nichts offen ist.
   *
   * Sie steht IM Tagesmodell und nicht daneben, weil sie ausschließlich aus
   * ihm entsteht: derselbe Tag, dieselben Zahlen, kein zweiter Ladevorgang.
   */
  readonly actions: readonly DashboardActionView[];

  /**
   * Umsatz, Herstellkosten, Rohertrag, Marge — seit Phase 7B.
   *
   * Sie stehen NICHT in der Kennzahlenwand darüber, und das ist eine
   * Entscheidung: Vier weitere Karten hätten aus einer Tafel mit sechs
   * Zahlen eine mit zehn gemacht, und die Wand hätte aufgehört, auf einen
   * Blick lesbar zu sein. Die kaufmännische Auskunft ist außerdem eine
   * andere Art von Auskunft — sie treibt nichts an, sie ordnet ein.
   */
  readonly finance: DashboardFinanceView;
}

export function toDashboardView(day: DashboardDay): DashboardDayView {
  const previousDay = plusDays(day.date, -1);
  const nextDay = plusDays(day.date, 1);

  return {
    day: day.date,
    dayLabel: formatGermanDate(day.date),
    previousDay,
    previousDayLabel: formatGermanDate(previousDay),
    nextDay,
    nextDayLabel: formatGermanDate(nextDay),

    orderCount: day.orderCount,
    cancelledCount: day.cancelledCount,
    revenueLabel: formatEuro(day.revenueCents),
    openCount: day.openCount,
    customerCount: day.customerCount,
    totalUnits: day.totalUnits,
    unpaidLabel: formatEuro(day.unpaidCents),
    unpaidCount: day.unpaidCount,

    isEmpty: day.orders.length === 0,

    orders: day.orders.map((order) => ({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      statusLabel: orderStatusLabel(order.status),
      isCancelled: !countsTowardsRevenue(order.status),
      paymentStatus: order.paymentStatus,
      paymentStatusLabel: paymentStatusLabel(order.paymentStatus),
      isPaid: isPaid(order.paymentStatus),
      amountLabel: formatEuro(order.totalCents),
      orderedAtLabel: formatGermanTimestamp(order.createdAt),
      fulfillmentLabel: fulfillmentLabel(order.fulfillmentType),
    })),

    topProducts: day.topProducts.map((line) => ({
      name: line.productName,
      unit: line.productUnit,
      quantity: line.quantity,
    })),

    paymentDonut: zahlungsring(day),
    statusDonut: statusring(day),
    finance: finanzen(day.costs),
    actions: dashboardActions(day).map((aktion) => aktionsansicht(aktion, day.date)),
  };
}

/**
 * Aus einer Kostenzusammenfassung werden vier Zeilen und ein Satz.
 *
 * ES WIRD HIER NICHTS ENTSCHIEDEN UND NICHTS GERECHNET. `complete`,
 * `grossProfitCents` und `marginTenthsPercent` kommen fertig aus der Domäne;
 * diese Funktion liest sie und schreibt sie auf. Ein `revenueCents -
 * knownCostCents` an dieser Stelle wäre eine zweite Fassung des Rohertrags —
 * und zwar die, die den Vollständigkeitsvorbehalt nicht kennt.
 *
 * DER STRICH IST EIN EIGENES ZEICHEN UND KEINE LEERE ZELLE. „—" sagt „hier
 * steht bewusst nichts"; eine leere Zelle sagt „hier ist etwas kaputt" — und
 * auf einem Bildschirm, den jemand morgens um fünf ansieht, ist das ein
 * Unterschied.
 *
 * DER NULLUMSATZ BEKOMMT EINEN EIGENEN SATZ. Ein Tag ohne Umsatz hat eine
 * vollständige Kostenbasis (es fehlt nichts) und trotzdem keine Marge. Ohne
 * eigenen Text stünde dort „Kostenbasis vollständig" und daneben ein Strich
 * — was wie ein Fehler aussieht und keiner ist.
 */
function finanzen(costs: CostSummary): DashboardFinanceView {
  const strich = '—';
  const kennt = costs.complete;

  return {
    revenueLabel: formatEuro(costs.revenueCents),
    costLabel: kennt ? formatEuro(costs.knownCostCents) : strich,
    grossProfitLabel:
      costs.grossProfitCents === null ? strich : formatSignedEuro(costs.grossProfitCents),
    marginLabel:
      costs.marginTenthsPercent === null
        ? strich
        : formatPercentFromTenths(costs.marginTenthsPercent),
    isComplete: kennt,
    isNegative: costs.grossProfitCents !== null && costs.grossProfitCents < 0,
    isMarginNegative: costs.marginTenthsPercent !== null && costs.marginTenthsPercent < 0,
    statusLabel: kennt ? 'Kostenbasis vollständig' : 'Kostenbasis unvollständig',
    note: kostenhinweis(costs),
    href: kennt ? null : KOSTENPFLEGE_HREF,
    linkLabel: 'Herstellkosten ergänzen',
  };
}

/**
 * Der Satz unter den vier Zahlen.
 *
 * DREI FÄLLE, DREI SÄTZE, und keiner davon ist alarmistisch: Eine fehlende
 * Kostenangabe ist kein Fehler, sondern etwas, das noch nicht gepflegt ist —
 * bei jeder Bestellung aus der Zeit vor Phase 7A ist es sogar der
 * Normalzustand. Ein rotes Warnfeld an dieser Stelle sagte einem Betrieb
 * jeden Morgen, er habe etwas falsch gemacht.
 *
 * DIE EINZAHL IST KEIN SCHÖNHEITSFEHLER — dieselbe Regel wie im
 * Handlungsbedarf.
 */
function kostenhinweis(costs: CostSummary): string {
  if (!costs.complete) {
    return `Bei ${costs.missingOrderCount} von ${costs.orderCount} ${
      costs.orderCount === 1 ? 'Bestellung' : 'Bestellungen'
    } fehlen noch die Herstellkosten.`;
  }

  if (costs.revenueCents === 0) {
    return 'Keine Umsätze an diesem Tag.';
  }

  return `Alle ${costs.orderCount} ${
    costs.orderCount === 1 ? 'Bestellung ist' : 'Bestellungen sind'
  } vollständig kalkuliert.`;
}

/**
 * DIE DREI AKTIONSTEXTE — an einer Stelle, samt ihrem Ziel.
 *
 * DIE ERSTEN BEIDEN FÜHREN AN DENSELBEN ORT, und das ist kein Versehen: Für
 * eine neue Bestellung wie für eine halbfertige ist die Produktionsansicht
 * dieses Tages der Platz, an dem etwas getan wird. Sie sagen nur
 * Verschiedenes darüber, WARUM man hingeht — und deshalb sind es zwei Zeilen
 * und nicht eine mit zwei Zahlen.
 *
 * DIE ZAHLUNG FÜHRT AUF DIESELBE SEITE ZURÜCK, nur gefiltert. Eine eigene
 * Seite „offene Zahlungen" wäre eine zweite Bestellliste mit einer zweiten
 * Fassung des Zahlungsformulars; der Filter ist ein Parameter und kein
 * Bereich.
 *
 * DIE EINZAHL IST KEIN SCHÖNHEITSFEHLER. „1 Neue Bestellungen warten" liest
 * sich wie ein Platzhalter, und ein Betrieb glaubt einer Seite weniger, die
 * ihre eigene Zahl nicht lesen kann.
 */
function aktionsansicht(aktion: DashboardAction, day: string): DashboardActionView {
  const eine = aktion.count === 1;

  type Text = Pick<DashboardActionView, 'title' | 'detail' | 'linkLabel' | 'href'>;

  const texte: Readonly<Record<DashboardActionKey, Text>> = {
    new_orders: {
      title: eine ? 'Neue Bestellung' : 'Neue Bestellungen',
      detail: eine ? 'wartet auf Bestätigung' : 'warten auf Bestätigung',
      linkLabel: 'Zur Produktion',
      href: `/admin?date=${day}`,
    },
    open_production: {
      title: 'Offen in der Produktion',
      detail: 'noch nicht abgeschlossen',
      linkLabel: 'Produktion öffnen',
      href: `/admin?date=${day}`,
    },
    unpaid: {
      title: eine ? 'Zahlung offen' : 'Zahlungen offen',
      detail: 'noch nicht eingegangen',
      linkLabel: 'Offene Zahlungen anzeigen',
      href: `/admin/dashboard?date=${day}&orders=unpaid#bestellungen`,
    },
  };

  return {
    key: aktion.key,
    count: aktion.count,
    countLabel: String(aktion.count),
    amountLabel: aktion.amountCents === null ? '' : formatEuro(aktion.amountCents),
    ...texte[aktion.key],
  };
}

/**
 * HEUTE · MORGEN · WOCHE — die drei Sprünge, die morgens gebraucht werden.
 *
 * DAS GESCHÄFTSDATUM KOMMT VON AUSSEN. Diese Datei hat keine Uhr — kein
 * Date.now(), und ausdrücklich auch kein Datum aus dem Browser. Ein „heute",
 * das der Browser des Betrachters bestimmt, wäre auf einem Tresengerät mit
 * falsch gestellter Uhr ein anderer Tag als der, für den die Backstube
 * gebacken hat. Der Server kennt das Berliner Geschäftsdatum über
 * businessDay(); es wird hier hereingereicht.
 *
 * „MORGEN" IST DER TAG NACH HEUTE und nicht der Tag nach dem betrachteten.
 * Sonst wanderte die Schaltfläche mit jedem Klick weiter, und aus einer
 * Schnellwahl würde ein zweiter Vorwärtspfeil — den es daneben schon gibt.
 *
 * „WOCHE" IST DIE WOCHE DES BETRACHTETEN TAGES und nicht die von heute. Wer
 * den 28. ansieht und „Woche" drückt, will die Woche, in der der 28. liegt;
 * eine Schaltfläche, die von einem künftigen Tag zurück in die laufende Woche
 * spränge, verlöre den Zusammenhang, den der Betrachter gerade aufgebaut hat.
 */
export function toQuickDaysView(
  today: string,
  viewedDay: string,
  active: 'day' | 'week',
): QuickDaysView {
  const morgen = plusDays(today, 1);
  const montag = weekStart(viewedDay);

  return {
    today: {
      label: 'Heute',
      href: `/admin/dashboard?date=${today}`,
      isCurrent: active === 'day' && viewedDay === today,
    },
    tomorrow: {
      label: 'Morgen',
      href: `/admin/dashboard?date=${morgen}`,
      isCurrent: active === 'day' && viewedDay === morgen,
    },
    week: {
      label: 'Woche',
      href: `/admin/dashboard?date=${montag}&view=week`,
      /**
       * DER AKTIVE ZUSTAND WIRD ÜBERGEBEN und nicht aus dem Datum geraten:
       * Tages- und Wochenansicht zeigen denselben Tag, und welche von beiden
       * gerade offen ist, steht nirgends im Datum.
       */
      isCurrent: active === 'week',
    },
  };
}

/**
 * Die Bestellliste in der Fassung, die angezeigt wird.
 *
 * ES WIRD NICHT NEU ENTSCHIEDEN, WAS „UNBEZAHLT" ODER „STORNIERT" HEISST. Der
 * Filter liest `isPaid` und `isCancelled` von den fertigen Zeilen; beide
 * stammen aus isPaid() und countsTowardsRevenue() in der Domäne. Ein
 * `paymentStatus === 'unpaid'` an dieser Stelle wäre eine zweite Fassung
 * derselben Regel — und die Liste könnte einen Betrag zeigen, den die
 * Kennzahl darüber nicht mitzählt.
 *
 * STORNIERTE BLEIBEN AUSSEN VOR. Eine stornierte Bestellung hat keinen
 * Zahlungsanspruch; sie steht in keiner offenen Summe des Tages und darf
 * deshalb auch nicht in der Liste stehen, die diese Summe erklärt. In der
 * UNGEFILTERTEN Liste bleibt sie sichtbar — dort erklärt sie den Tag.
 */
export function toOrderListView(
  day: DashboardDayView,
  filter: OrderFilter,
): DashboardOrderListView {
  const rows =
    filter === 'unpaid'
      ? day.orders.filter((zeile) => !zeile.isCancelled && !zeile.isPaid)
      : day.orders;

  return {
    filter,
    isFiltered: filter !== 'all',
    title: filter === 'unpaid' ? 'Offene Zahlungen' : 'Bestellungen',
    meta:
      filter === 'unpaid'
        ? bestellungen(rows.length)
        : `${rows.length} ${rows.length === 1 ? 'Eintrag' : 'Einträge'}`,
    rows,
    allHref: `/admin/dashboard?date=${day.day}#bestellungen`,
    emptyText:
      filter === 'unpaid'
        ? 'Für diesen Tag ist keine Zahlung offen. Alles, was nicht storniert wurde, ist bezahlt.'
        : 'Für diesen Tag liegt noch keine Bestellung vor. Sobald eine Bestellung für diesen Produktionstag eingeht, erscheint sie hier.',
  };
}

/** „1 Bestellung", „3 Bestellungen" — die Einzahl ist kein Schönheitsfehler. */
function bestellungen(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Bestellung' : 'Bestellungen'}`;
}

/**
 * Aus fertigen Anteilen wird ein Ring.
 *
 * DER TRICK MIT DEM RADIUS 15.9155: Der Umfang eines Kreises mit diesem
 * Radius ist 2πr = 100,000… — also genau 100. Damit IST eine
 * `stroke-dasharray`-Länge unmittelbar ein Prozentsatz, und es muss nirgends
 * mit π gerechnet werden.
 *
 * WARUM ATTRIBUTE UND KEINE STILE: Die CSP dieser Anwendung erlaubt
 * `style-src 'self'` und kein `'unsafe-inline'`. Ein `style="stroke-dasharray:…"`
 * am Segment würde vom Browser verworfen, und der Ring wäre leer. `dasharray`
 * und `dashoffset` sind in SVG aber PRÄSENTATIONSATTRIBUTE — sie gehen durch,
 * ohne dass die CSP aufgeweicht werden muss. Die Farben kommen deshalb
 * umgekehrt aus Klassen und nicht aus Attributen.
 */
function ring(
  eintraege: readonly { key: string; label: string; count: number; detailLabel: string }[],
  totalCaption: string,
  footnote = '',
): DonutView {
  const total = eintraege.reduce((summe, eintrag) => summe + eintrag.count, 0);

  /**
   * DIE LÜCKE ZWISCHEN ZWEI STÜCKEN — ein Befund aus dem Browser.
   *
   * Ohne sie stoßen die Stücke stumpf aneinander, und der Ring liest sich nur
   * so gut, wie sich seine beiden Farben unterscheiden. Bei fünf Stücken in
   * einer Helligkeitsreihe ist das zu wenig: Zwei benachbarte Blautöne wurden
   * zu einem Bogen. Eine Lücke von einer Einheit auf hundert trennt sie
   * unabhängig von der Farbe — und damit auch für ein Auge, das die Töne gar
   * nicht auseinanderhält.
   *
   * Sie wächst nicht mit: Bei einem sehr kleinen Stück nimmt sie höchstens ein
   * Drittel davon, damit ein einzelnes Achtel nicht zum Strich schrumpft. Bei
   * einem einzigen Stück gibt es keine Lücke — ein Ring aus einem Stück ist
   * ein geschlossener Ring.
   */
  const stuecke = eintraege.filter((eintrag) => eintrag.count > 0).length;

  let gelaufen = 0;
  const segments = eintraege.map((eintrag) => {
    const laenge = total === 0 ? 0 : (eintrag.count / total) * 100;
    const luecke = stuecke < 2 ? 0 : Math.min(1, laenge / 3);
    const gezeichnet = Math.max(laenge - luecke, 0);
    const segment: DonutSegmentView = {
      key: eintrag.key,
      label: eintrag.label,
      count: eintrag.count,
      countLabel: bestellungen(eintrag.count),
      detailLabel: eintrag.detailLabel,
      dashArray: `${runde(gezeichnet)} ${runde(100 - gezeichnet)}`,
      dashOffset: `${runde(-gelaufen)}`,
    };
    gelaufen += laenge;
    return segment;
  });

  return {
    total,
    totalLabel: String(total),
    totalCaption,
    totalCountLabel: bestellungen(total),
    segments,
    isEmpty: total === 0,
    footnote,
  };
}

/** Drei Nachkommastellen reichen für einen Ring von 100 Einheiten Umfang. */
function runde(wert: number): string {
  return String(Math.round(wert * 1000) / 1000);
}

/**
 * BEZAHLT GEGEN OFFEN — über die Bestellungen, die zählen.
 *
 * Der Ring umfasst genau `orderCount`: Was hier steht, lässt sich gegen die
 * Kennzahl „Bestellungen" darüber nachzählen. Stornierte sind NICHT als
 * drittes Stück dabei — sie haben keinen Zahlungsanspruch, stehen in keiner
 * Summe des Tages, und als Stück im Zahlungsring machten sie die Gesamtzahl
 * des Rings zu einer Zahl, die auf der Seite sonst nirgends vorkommt. Sie
 * stehen stattdessen als Fußnote darunter — mit demselben Wort wie auf der
 * Kennzahlenkarte.
 *
 * BEIDE STÜCKE STEHEN AUCH BEI NULL IN DER LEGENDE. „Offen: 0 Bestellungen"
 * ist eine gute Nachricht und soll lesbar sein — dieselbe Regel, aus der die
 * Kennzahlenkarte „0,00 €" zeigt, statt zu verschwinden.
 */
function zahlungsring(day: DashboardDay): DonutView {
  return ring(
    [
      {
        key: 'bezahlt',
        label: 'Bezahlt',
        count: day.paidCount,
        detailLabel: formatEuro(day.paidCents),
      },
      {
        key: 'offen',
        label: 'Noch offen',
        count: day.unpaidCount,
        detailLabel: formatEuro(day.unpaidCents),
      },
    ],
    'gesamt',
    day.cancelledCount === 0 ? '' : `zusätzlich ${bestellungen(day.cancelledCount)} storniert`,
  );
}

/**
 * WO DIE BESTELLUNGEN DES TAGES STEHEN — stornierte eingeschlossen.
 *
 * Die Reihenfolge ist die des Lebenslaufs einer Bestellung (ORDER_STATUSES)
 * und nicht die der Häufigkeit: Ein Ring, dessen Stücke je nach Tag die
 * Plätze tauschen, ist von Tag zu Tag nicht wiederzuerkennen.
 *
 * STATUS OHNE BESTELLUNG STEHEN NICHT IN DER LEGENDE. Anders als beim
 * Zahlungsring: Dort sind es zwei feste Hälften, hier bis zu fünf Zeilen, und
 * „Bestätigt: 0 Bestellungen" beantwortet keine Frage, die jemand stellt.
 */
function statusring(day: DashboardDay): DonutView {
  return ring(
    ORDER_STATUSES.filter((status) => day.statusCounts[status] > 0).map((status) => ({
      key: status,
      label: orderStatusLabel(status),
      count: day.statusCounts[status],
      detailLabel: '',
    })),
    'gesamt',
  );
}
