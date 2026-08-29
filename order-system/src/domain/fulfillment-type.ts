/**
 * Wie eine Bestellung zum Kunden kommt.
 *
 * Kein TypeScript-`enum`, sondern ein String-Union über eine `as const`-Liste.
 * Damit ist der Domänenwert exakt derselbe String, den D1 speichert: Es gibt
 * keine Übersetzungstabelle, an der Anwendung und Datenbank auseinanderlaufen
 * könnten, und `isFulfillmentType` ist zugleich die Prüfung beim Laden.
 *
 * Abholung ist kein Sonderfall der Lieferung. Geschäftskunden bestellen
 * überwiegend `delivery`, Privat- und Sonderkunden überwiegend `pickup`.
 */
export const FULFILLMENT_TYPES = ['delivery', 'pickup'] as const;

export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export function isFulfillmentType(value: unknown): value is FulfillmentType {
  return typeof value === 'string' && (FULFILLMENT_TYPES as readonly string[]).includes(value);
}

export function requiresAddress(type: FulfillmentType): boolean {
  return type === 'delivery';
}

export function fulfillmentLabel(type: FulfillmentType): string {
  return type === 'delivery' ? 'Lieferung' : 'Abholung';
}
