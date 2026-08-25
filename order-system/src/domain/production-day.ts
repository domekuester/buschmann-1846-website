import type { FulfillmentType } from './fulfillment-type';
import type { OrderStatus } from './order-status';

/**
 * Ein Produktionstag — die Antwort auf die Frage, für die dieses System
 * gebaut wurde:
 *
 *   „Was muss Buschmann am 26. August produzieren?"
 *
 * Dieses Modul ist ein LESEMODELL und kein Aggregat. Es hat keine
 * Invarianten, keine Zustandsübergänge und keine Identität; man kann darüber
 * nichts bestellen und nichts ändern. Es ist die Form, in der eine Frage
 * beantwortet wird — mehr nicht, und mehr soll es auch nicht werden.
 *
 * Es ist ausdrücklich NICHT das Order-Aggregat aus order.ts. Das wäre der
 * naheliegende Weg gewesen und wäre in zwei Punkten falsch:
 *
 *   Order verlangt mindestens eine Position und einen Gesamtbetrag, der zur
 *   Summe der Positionen passt. Für eine Produktionsansicht ist beides
 *   unerheblich — und eine Bestellung, deren gespeicherter Betrag beschädigt
 *   ist, soll die Tagesliste nicht zum Absturz bringen, sondern in ihr
 *   auftauchen, damit jemand es merkt.
 *
 *   Order trägt Preise. Diese Antwort soll keine tragen. Ein Lesemodell ohne
 *   Preisfelder kann keinen Preis preisgeben — das ist Datenminimierung durch
 *   Bauart und nicht durch Sorgfalt beim Serialisieren.
 *
 * ES GIBT KEINE ZEIT IN DIESER DATEI. Kein Date, kein Date.now(), keine
 * Zeitzone. Der Tag kommt als Zeichenkette herein und geht als Zeichenkette
 * hinaus. Genau deshalb kann eine Zeitzonenverschiebung aus dem 25. nicht den
 * 24. machen: Es gibt nichts, was verschoben werden könnte.
 */

/**
 * Eine Position, wie die Produktion sie sieht.
 *
 * Name und Einheit sind SNAPSHOTS aus der Bestellung, nicht die heutigen
 * Stammdaten. Eine Umbenennung darf eine Bestellung von letzter Woche nicht
 * rückwirkend anders aussehen lassen.
 *
 * `sortOrder` ist die Ausnahme: Er stammt aus dem AKTUELLEN Produktdatensatz
 * und ist auch dort richtig aufgehoben. „So ist unser Sortiment geordnet" ist
 * eine Eigenschaft der Gegenwart und keine der historischen Bestellung. Er
 * dient ausschließlich der Sortierung und verlässt das System nicht — die
 * HTTP-Antwort enthält ihn nicht.
 *
 * Kein Preis. Keine Positions-ID. Keine Bestell-ID.
 */
export interface ProductionOrderItem {
  readonly productId: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly sortOrder: number;
  readonly quantity: number;
}

/**
 * Eine Bestellung, wie die Produktion sie sieht.
 *
 * `customerName` ist der Snapshot aus der Bestellung — es wird NICHT auf
 * `customers` verbunden. Das ist zugleich der Grund, warum in dieser Ansicht
 * keine E-Mail, kein Telefon und keine interne Kundennotiz auftauchen können:
 * Die Abfrage berührt die Tabelle nicht.
 *
 * `note` ist KUNDENEINGABE. Sie wird unverändert durchgereicht und nirgends
 * als Markup verstanden. Wer sie später in HTML rendert, escapet sie.
 *
 * `status` ist mit dabei, obwohl die Abfrage bereits filtert: Eine spätere
 * Oberfläche soll „neu" von „in Produktion" unterscheiden können, ohne dass
 * dafür ein zweiter Endpunkt entsteht.
 *
 * Keine Adresse, keine Zeitstempel, keine Beträge, keine internen Kennungen.
 */
export interface ProductionOrder {
  readonly orderNumber: string;
  readonly customerName: string;
  readonly status: OrderStatus;
  readonly fulfillmentType: FulfillmentType;
  readonly note: string | null;
  readonly lastStatusChange: {
    readonly changedAt: string;
    readonly changedBy: string | null;
  } | null;
  readonly items: readonly ProductionOrderItem[];
}

/**
 * Eine Zeile der Backliste: so viel von diesem Produkt, an diesem Tag,
 * insgesamt.
 */
export interface ProductionLine {
  readonly productId: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly quantity: number;
}

/**
 * Der vollständige Produktionstag, in zwei Ebenen.
 *
 * `products` ist die Backliste — was insgesamt zu produzieren ist.
 * `orders` ist die Aufteilung — woraus diese Menge entsteht.
 *
 * Beide entstehen aus DENSELBEN Daten in DERSELBEN Abfrage. Sie können sich
 * deshalb nicht widersprechen; die Summe ist aus den Bestellungen gerechnet
 * und nicht getrennt ermittelt.
 */
export interface ProductionDay {
  readonly date: string;
  readonly orderCount: number;
  readonly totalUnits: number;
  readonly products: readonly ProductionLine[];
  readonly orders: readonly ProductionOrder[];
}

/**
 * Fasst die Bestellungen eines Tages zur Backliste zusammen.
 *
 * DIESE FUNKTION FILTERT NICHT. Was sie bekommt, summiert sie. Welche
 * Bestellungen produktionsrelevant sind, entscheidet
 * OPEN_PRODUCTION_STATUSES in order-status.ts und die Abfrage, die sie
 * benutzt. Hier ein zweites Mal zu filtern wäre eine zweite Stelle mit
 * derselben Regel — und irgendwann eine, die von der ersten abweicht.
 *
 * Der leere Tag braucht keinen eigenen Zweig: Eine Summe über nichts ist
 * null, und eine leere Map ergibt eine leere Liste. Ein `if (orders.length
 * === 0)` wäre ein Sonderfall für etwas, das gar keiner ist.
 */
export function aggregateProductionDay(
  day: string,
  orders: readonly ProductionOrder[],
): ProductionDay {
  const mengen = new Map<string, ProductionLine & { readonly sortOrder: number }>();
  let totalUnits = 0;

  for (const order of orders) {
    for (const item of order.items) {
      totalUnits += item.quantity;

      /**
       * DER SCHLÜSSEL IST EIN TRIPEL und nicht die Produkt-ID allein.
       *
       * Name und Einheit gehören dazu, weil beide Snapshots sind. Über die ID
       * allein zu aggregieren und dann irgendeinen der vorkommenden Namen
       * anzuzeigen, benennte eine historische Bestellung stillschweigend um —
       * und eine Summe über „8 Blech" und „3 Stück" wäre eine Zahl ohne
       * Bedeutung.
       *
       * Der Preis dafür sind im seltenen Fall zwei Zeilen statt einer. Das
       * ist die richtige Wahl: Korrektheit vor kosmetischer Zusammenführung.
       *
       * Das Trennzeichen \u0000 kann in keinem Namen und in keiner Einheit
       * vorkommen — anders als ein Bindestrich oder ein Doppelpunkt, mit denen sich
       * „1|A-B|C" und „1|A|B-C" zum selben Schlüssel verkleben ließen.
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

  const products = [...mengen.values()].sort(vergleiche).map(
    ({ productId, productName, productUnit, quantity }): ProductionLine => ({
      productId,
      productName,
      productUnit,
      quantity,
    }),
  );

  return {
    date: day,
    // Bestellungen, nicht Positionen. Der Unterschied ist der zwischen „drei
    // Cafés haben bestellt" und „es gibt sechs Positionen".
    orderCount: orders.length,
    totalUnits,
    products,
    orders,
  };
}

/**
 * Die Reihenfolge der Backliste — vollständig bestimmt, ohne Rest.
 *
 *   1. sortOrder   die Reihenfolge, in der Buschmann sein Sortiment ordnet.
 *                  Dieselbe wie auf der Bestellseite; eine Backliste in
 *                  fremder Reihenfolge wäre beim Abhaken unbrauchbar.
 *   2. Name        Gleichstandsbrecher.
 *   3. productId   Gleichstandsbrecher.
 *   4. Einheit     der letzte Fall: gleiche ID, gleicher Name, andere
 *                  Einheit. Danach können sich zwei Zeilen nicht mehr
 *                  unterscheiden — der Schlüssel besteht aus genau diesen
 *                  drei Merkmalen.
 *
 * VERGLICHEN WIRD NACH CODEPUNKTEN, nicht mit localeCompare. Dessen Ergebnis
 * hängt an den ICU-Daten der Laufzeit und könnte zwischen lokalem Test und
 * Cloudflare-Edge abweichen — das wäre ein Test, der irgendwo rot wird und
 * nirgends reproduzierbar ist. Die fachliche Reihenfolge trägt ohnehin
 * sortOrder; der Namensvergleich ist nur der Gleichstandsbrecher.
 */
function vergleiche(
  a: ProductionLine & { readonly sortOrder: number },
  b: ProductionLine & { readonly sortOrder: number },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.productName !== b.productName) return a.productName < b.productName ? -1 : 1;
  if (a.productId !== b.productId) return a.productId - b.productId;
  if (a.productUnit !== b.productUnit) return a.productUnit < b.productUnit ? -1 : 1;
  return 0;
}
