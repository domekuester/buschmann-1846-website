import { InvalidArgumentError } from './errors';
import { plusDays, weekStart } from './clock';
import { countsTowardsRevenue, isOpenProduction, type OrderStatus } from './order-status';
import { isPaid, type PaymentStatus } from './payment-status';

/**
 * DIE WOCHE — „wie voll ist diese Woche?"
 *
 * Sie ist die dritte Frage des Morgens, nach „was ist heute?" und „was ist
 * morgen?", und sie ist eine ANDERE Frage als der Tagesüberblick. Deshalb ein
 * eigenes Lesemodell und nicht siebenmal dashboard-day.ts:
 *
 *   Der Tagesüberblick beantwortet, WIE ein Tag steht — mit Bestellungen,
 *   Kunden, Einheiten, Ringen und Meistbestellt. Das siebenmal
 *   nebeneinanderzustellen wären sieben Seiten auf einer, und niemand liest
 *   sie.
 *
 *   Die Woche beantwortet, WO etwas los ist. Dafür genügen je Tag vier
 *   Zahlen, und mehr sollen es auch nicht werden: Wer einen Tag genauer
 *   ansehen will, klickt ihn an — die Tagesansicht gibt es bereits.
 *
 * ES GIBT KEINEN VERGLEICH, KEINEN TREND UND KEINE PROGNOSE. Keine
 * Vorwochenveränderung, kein Prozentpfeil, keine Kurve. Die Begründung ist
 * dieselbe wie im Tagesüberblick — bei drei bis vierzig Bestellungen am Tag
 * ist jede Kurve Rauschen — und hier kommt eine zweite dazu: Ein Vergleich
 * über die Zeit setzte Beträge aus verschiedenen Preisständen ins Verhältnis.
 * Seit Phase 5C kann derselbe Kuchen für zwei Kunden zwei Preise haben; ein
 * „+12 % gegenüber der Vorwoche" wäre eine Aussage über die Kundenmischung
 * und läse sich wie eine über den Geschäftsgang.
 *
 * DIE BETRÄGE SIND SNAPSHOTS — genau wie im Tagesüberblick. Diese Datei kennt
 * weder Produkte noch Positionen noch Einzelpreise; sie KANN einen Betrag gar
 * nicht aus dem heutigen Katalog nachrechnen. Eine Bestellung von Montag
 * bleibt am Sonntag so teuer, wie sie war.
 *
 * ES GIBT KEINE ZEIT IN DIESER DATEI. Kein Date.now(), keine Zeitzone. Der
 * Montag kommt als Zeichenkette herein.
 */

/**
 * Eine Bestellung, wie die Woche sie sieht — vier Felder und kein fünftes.
 *
 * Kein Kunde, keine Bestellnummer, keine Positionen, kein Zeitpunkt. Was die
 * Wochenansicht nicht anzeigt, lädt sie nicht: Sieben Tage Bestelldaten mit
 * allen Positionen wären ein Vielfaches der Datenmenge einer Tagesansicht,
 * für eine Ansicht, die davon nichts zeigt.
 */
export interface DashboardWeekOrder {
  /** Der Liefertag — 'JJJJ-MM-TT'. */
  readonly day: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  /** Der gespeicherte Gesamtbetrag in Cent. */
  readonly totalCents: number;
}

/** Die vier Zahlen eines Tages, plus die stornierten. */
export interface DashboardWeekTotals {
  /** Bestellungen OHNE stornierte. */
  readonly orderCount: number;
  readonly cancelledCount: number;
  /** Umsatz in Cent, ohne stornierte. */
  readonly revenueCents: number;
  /** Was an diesem Tag noch zu produzieren ist. */
  readonly openCount: number;
  readonly unpaidCents: number;
  readonly unpaidCount: number;
}

export interface DashboardWeekDay extends DashboardWeekTotals {
  readonly date: string;
}

export interface DashboardWeek {
  readonly monday: string;
  readonly sunday: string;
  /** Genau sieben — Montag bis Sonntag, auch die leeren. */
  readonly days: readonly DashboardWeekDay[];
  readonly total: DashboardWeekTotals;
}

/** Montag bis Sonntag. */
const TAGE_JE_WOCHE = 7;

/**
 * Der Tag, WÄHREND er gezählt wird.
 *
 * Nach außen ist ein Wochentag unveränderlich; im Durchlauf muss er wachsen.
 * Statt eine zweite Feldliste hinzuschreiben, wird hier die eine vorhandene
 * um ihre `readonly` erleichtert — eine Feldliste mehr wäre die Stelle, an
 * der eines Tages ein Feld fehlt.
 */
type Zaehler = { -readonly [K in keyof DashboardWeekDay]: DashboardWeekDay[K] };

/**
 * Fasst die Bestellungen einer Kalenderwoche zu sieben Tagen zusammen.
 *
 * DIE SIEBEN TAGE ENTSTEHEN AUS DEM KALENDER UND NICHT AUS DEN DATEN. Sie
 * werden zuerst angelegt und dann gefüllt; ein Tag ohne Bestellung ist eine
 * Reihe aus Nullen und keine Lücke. Umgekehrt gebaut — aus den vorkommenden
 * Liefertagen — hätte eine ruhige Woche vier Zeilen und eine volle sieben,
 * und man sähe der Ansicht nicht an, dass am Donnerstag nichts los war,
 * sondern nur, dass der Donnerstag fehlt.
 *
 * DER MONTAG WIRD GEPRÜFT UND NICHT ZURECHTGERÜCKT. Ein stillschweigendes
 * weekStart() an dieser Stelle hätte die Ansicht für einen falsch berechneten
 * Aufrufer trotzdem plausibel aussehen lassen — und der Fehler wäre dort
 * geblieben, wo er entstand. Wer diese Funktion aufruft, hat den Montag über
 * weekStart() zu bilden; das tut die HTTP-Schicht.
 *
 * DIE ZÄHLREGELN SIND DIESELBEN WIE IM TAGESÜBERBLICK und stammen aus
 * denselben Funktionen: countsTowardsRevenue() für den Storno,
 * isOpenProduction() für die Backstube, isPaid() für das Geld. In dieser Datei
 * kommt weder das Wort 'cancelled' noch 'unpaid' vor — sonst gäbe es eine
 * zweite Fassung der Umsatzregel, und die Wochenansicht könnte der
 * Tagesansicht desselben Tages widersprechen.
 *
 * EIN DURCHLAUF, und hinter dem Stornofilter zählt nichts mehr mit — dieselbe
 * Bauart wie aggregateDashboardDay().
 */
export function aggregateDashboardWeek(
  monday: string,
  orders: readonly DashboardWeekOrder[],
): DashboardWeek {
  if (weekStart(monday) !== monday) {
    throw new InvalidArgumentError('Eine Woche beginnt an einem Montag.');
  }

  const tage = new Map<string, Zaehler>();
  for (let versatz = 0; versatz < TAGE_JE_WOCHE; versatz += 1) {
    const datum = plusDays(monday, versatz);
    tage.set(datum, { date: datum, ...leer() });
  }

  for (const order of orders) {
    const tag = tage.get(order.day);
    /**
     * Eine Bestellung außerhalb der sieben Tage wird STILL übergangen und
     * legt keinen achten Tag an. Die Abfrage liefert sie nicht — aber diese
     * Datei ist ein Lesemodell und soll an einer unerwarteten Zeile nicht
     * scheitern, sondern sie nicht mitzählen.
     */
    if (tag === undefined) continue;

    if (!countsTowardsRevenue(order.status)) {
      tag.cancelledCount += 1;
      continue;
    }

    tag.orderCount += 1;
    tag.revenueCents += order.totalCents;

    if (isOpenProduction(order.status)) {
      tag.openCount += 1;
    }
    if (!isPaid(order.paymentStatus)) {
      tag.unpaidCents += order.totalCents;
      tag.unpaidCount += 1;
    }
  }

  const days = [...tage.values()];

  return {
    monday,
    sunday: plusDays(monday, TAGE_JE_WOCHE - 1),
    days,
    /**
     * DIE WOCHENSUMME WIRD AUS DEN TAGEN GEBILDET und nicht in einem zweiten
     * Durchlauf über die Bestellungen. Zwei getrennte Rechenwege wären zwei
     * Meinungen darüber, was die Woche umgesetzt hat — und die Summe unter
     * einer Tabelle, die nicht der Tabelle entspricht, ist der Fehler, dem
     * niemand mehr etwas glaubt.
     */
    total: days.reduce(
      (summe, tag) => ({
        orderCount: summe.orderCount + tag.orderCount,
        cancelledCount: summe.cancelledCount + tag.cancelledCount,
        revenueCents: summe.revenueCents + tag.revenueCents,
        openCount: summe.openCount + tag.openCount,
        unpaidCents: summe.unpaidCents + tag.unpaidCents,
        unpaidCount: summe.unpaidCount + tag.unpaidCount,
      }),
      leer(),
    ),
  };
}

function leer(): DashboardWeekTotals {
  return {
    orderCount: 0,
    cancelledCount: 0,
    revenueCents: 0,
    openCount: 0,
    unpaidCents: 0,
    unpaidCount: 0,
  };
}
