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
 * WARUM DIESE DREI:
 *
 *   new            bestellt, noch nicht angefasst. Muss gebacken werden.
 *   confirmed      bestätigt. Muss gebacken werden.
 *   in_production  wird gerade gebacken — und bleibt bis zum Abschluss Teil
 *                  der Tagesmenge. Sie herauszunehmen hieße, dass die
 *                  Tagesliste schrumpft, während gearbeitet wird, und die
 *                  Backstube nicht mehr sähe, was sie gerade tut.
 *
 * WARUM DIE ANDEREN BEIDEN NICHT:
 *
 *   completed      erledigt. Gehört nicht mehr zur OFFENEN Menge.
 *   cancelled      storniert. Darf niemals Produktion erzeugen. Das ist die
 *                  Regel, deren Verletzung echten Schaden anrichtet.
 *
 * Die Reihenfolge ist die des Lebenszyklus — sie hat keine fachliche
 * Bedeutung, macht die Liste aber gegen ORDER_STATUSES lesbar.
 */
export const OPEN_PRODUCTION_STATUSES = ['new', 'confirmed', 'in_production'] as const;

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
