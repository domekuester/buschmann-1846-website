/**
 * Die Zeilenformen, die D1 zurückgibt — und die einzige Stelle, an der die
 * Eigenheiten von SQLite in Typen auftauchen:
 *
 *   - Es gibt kein BOOLEAN. is_active ist 0 oder 1.
 *   - Es gibt kein NULL-freies TEXT. Optionale Spalten kommen als null.
 *   - Geld ist immer ein INTEGER in Cent, nie eine Zeichenkette.
 *
 * Diese Typen bleiben in infrastructure/. Die Domäne kennt sie nicht.
 */
export interface CustomerRow {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  delivery_street: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  is_active: number;
  default_fulfillment: string;
  internal_note: string | null;
}

export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  unit: string;
  is_active: number;
  sort_order: number;
}

export interface OrderRow {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name_snapshot: string;
  fulfillment_type: string;
  fulfillment_date: string;
  delivery_address_snapshot: string | null;
  note: string | null;
  status: string;
  total_amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  product_id: number;
  product_name_snapshot: string;
  product_unit_snapshot: string;
  unit_price_cents: number;
  quantity: number;
}

/** SQLite kennt kein BOOLEAN; gespeichert wird 0 oder 1. */
export function toBoolean(value: number): boolean {
  return value === 1;
}

export function fromBoolean(value: boolean): number {
  return value ? 1 : 0;
}
