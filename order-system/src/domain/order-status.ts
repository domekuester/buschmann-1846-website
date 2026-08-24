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
