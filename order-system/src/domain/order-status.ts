/**
 * Lebenszyklus einer Bestellung.
 *
 *   new ──▶ confirmed ──▶ in_production ──▶ completed
 *    │           │              │
 *    └───────────┴──────────────┴────────▶ cancelled
 *
 * Bewusst KEINE ausgebaute State Machine: keine Guards, keine Ereignisse, kein
 * Framework. Nur eine Zuordnungstabelle. Sie existiert trotzdem, weil
 * „abgeschlossen zurück auf neu" oder „storniert wieder in Produktion" echte
 * Datenkorruption wären — und die Absicherung ein paar Zeilen kostet.
 */
export const ORDER_STATUSES = [
  'new',
  'confirmed',
  'in_production',
  'completed',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Erlaubte Folgezustände. Ein leeres Feld bedeutet: Endzustand. */
const ALLOWED_TARGETS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['in_production', 'cancelled'],
  in_production: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * Die Status, deren Bestellungen noch produziert werden müssen.
 *
 * DIESE LISTE IST DIE EINZIGE STELLE, an der steht, was ein Produktionstag
 * summiert. Nicht in einem SQL-String, nicht doppelt in Repository und
 * Anwendungsfall: Die Abfrage erzeugt ihre Platzhalter aus der LÄNGE dieser
 * Liste und bindet ihre WERTE — es gibt keinen Weg, sie zu ändern, ohne dass
 * die Abfrage folgt.
 *
 * Sie steht neben ORDER_STATUSES und nicht in einem eigenen Modul. Der Grund
 * ist die Wartung: Wer einen sechsten Status hinzufügt, bearbeitet die Liste
 * oben und steht dabei unvermeidlich vor dieser hier. Läge sie woanders, wäre
 * die Frage „erzeugt der neue Status Produktion?" übersehbar — und das
 * Übersehen fiele erst auf, wenn etwas fehlt oder zu viel gebacken wurde.
 *
 * WARUM DIESE BEIDEN:
 *
 *   confirmed      vom Betrieb angenommen. Muss gebacken werden.
 *   in_production  wird gerade gebacken — und bleibt bis zum Abschluss Teil
 *                  der Tagesmenge. Sie herauszunehmen hieße, dass die
 *                  Tagesliste schrumpft, während gearbeitet wird, und die
 *                  Backstube nicht mehr sähe, was sie gerade tut.
 *
 * WARUM DIE ANDEREN NICHT:
 *
 *   new            eingegangen, aber noch nicht vom Betrieb angenommen. Sie
 *                  bleibt als Eingang und Handlungsbedarf sichtbar, erzeugt
 *                  bis zur Bestätigung jedoch keinen Produktionsbedarf.
 *   completed      erledigt. Gehört nicht mehr zur OFFENEN Menge.
 *   cancelled      storniert. Darf niemals Produktion erzeugen. Das ist die
 *                  Regel, deren Verletzung echten Schaden anrichtet.
 *
 * Die Reihenfolge ist die des Lebenszyklus — sie hat keine fachliche
 * Bedeutung, macht die Liste aber gegen ORDER_STATUSES lesbar.
 */
export const OPEN_PRODUCTION_STATUSES = ['confirmed', 'in_production'] as const;

/**
 * Zählt eine Bestellung in diesem Status kaufmännisch mit?
 *
 * DIE FRAGE DES BETRIEBS, NICHT DIE DER BACKSTUBE. Für die Produktion zählt,
 * was noch zu backen ist (OPEN_PRODUCTION_STATUSES). Für Umsatz, Kundenzahl
 * und offene Beträge zählt etwas anderes: alles, was bestellt wurde und nicht
 * storniert ist — eine abgeschlossene Bestellung von gestern hat Umsatz
 * gemacht, obwohl sie nichts mehr zu backen gibt.
 *
 * DIESE REGEL STEHT GENAU HIER, weil sie eine Regel über Status ist. Ein
 * `status !== 'cancelled'` in einer Aggregation, ein zweites in einer
 * Oberfläche und ein drittes in einer Abfrage wären drei Fassungen davon —
 * und die Fassung, die eines Tages den falschen Vergleich enthält, wäre
 * diejenige, die zu hohe Umsätze meldet. Das ist der Fehler, der als Erstes
 * geglaubt und als Letztes bemerkt wird.
 *
 * SIE IST BEWUSST NICHT ALS LISTE FORMULIERT. Eine Liste ['new', 'confirmed',
 * 'in_production', 'completed'] müsste bei jedem neuen Status ergänzt werden
 * und wäre still falsch, wenn jemand es vergisst: Ein sechster Status zählte
 * dann nicht mit, ohne dass jemand das entschieden hätte. Die
 * Ausschlussfassung ist die vorsichtigere — ein neuer Status zählt mit, bis
 * jemand ausdrücklich etwas anderes bestimmt.
 */
export function countsTowardsRevenue(status: OrderStatus): boolean {
  return status !== 'cancelled';
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransitionTo(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TARGETS[from].includes(to);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return ALLOWED_TARGETS[status].length === 0;
}

export function orderStatusLabel(status: OrderStatus): string {
  const labels: Readonly<Record<OrderStatus, string>> = {
    new: 'Neu',
    confirmed: 'Bestätigt',
    in_production: 'In Produktion',
    completed: 'Abgeschlossen',
    cancelled: 'Storniert',
  };
  return labels[status];
}

/**
 * Muss eine Bestellung in diesem Status noch produziert werden?
 *
 * Die Frage einer Backstube am Morgen. Sie wird hier beantwortet und nirgends
 * sonst.
 */
export function isOpenProduction(status: OrderStatus): boolean {
  return (OPEN_PRODUCTION_STATUSES as readonly OrderStatus[]).includes(status);
}
