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
  /** Seit 0013: die zugeordnete Preisgruppe — NULL heißt „nicht zugeordnet". */
  price_list_id: number | null;
}

/**
 * Eine Produktzeile, WIE SIE GELADEN WIRD — und price_cents steht nicht mehr
 * darin. Die Spalte existiert in der Tabelle weiter (siehe 0002), wird vom
 * Bestellfluss seit Phase 5C aber nicht mehr ausgewählt. Ein Typ, der sie
 * noch führte, wäre eine Einladung, sie wieder zu selektieren.
 */
export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
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

/**
 * Eine Bestellung, wie die Produktionsabfrage sie sieht — und ausdrücklich
 * WENIGER als OrderRow.
 *
 * Was hier fehlt, wird nicht gelesen: kein customer_id, kein
 * total_amount_cents, keine Adresse, keine Zeitstempel, keine
 * submission_id. Eine Spalte, die nicht in der Abfrage steht, kann nicht
 * versehentlich in einer Antwort landen — das ist Datenminimierung durch
 * Bauart und nicht durch Sorgfalt beim Serialisieren.
 *
 * `id` ist die Ausnahme und verlässt die Infrastrukturschicht nicht: Sie
 * dient allein dazu, Positionen ihrer Bestellung zuzuordnen.
 */
export interface ProductionOrderRow {
  id: number;
  order_number: string;
  customer_name_snapshot: string;
  fulfillment_type: string;
  note: string | null;
  status: string;
  status_changed_at: string | null;
  status_changed_by_login_identifier: string | null;
}

/**
 * Eine Position, wie die Produktionsabfrage sie sieht.
 *
 * OHNE unit_price_cents und OHNE line_total_cents. Die Produktionsansicht
 * beantwortet Mengenfragen; Geld gehört in eine Controlling-Domäne, die es
 * noch nicht gibt.
 *
 * `sort_order` ist die einzige Spalte, die aus `products` stammt — sie
 * sortiert und ist keine Eigenschaft der historischen Bestellung. Name und
 * Einheit kommen aus den Snapshot-Spalten der Position.
 */
export interface ProductionItemRow {
  order_id: number;
  product_id: number;
  product_name_snapshot: string;
  product_unit_snapshot: string;
  sort_order: number;
  quantity: number;
}

/** SQLite kennt kein BOOLEAN; gespeichert wird 0 oder 1. */
export function toBoolean(value: number): boolean {
  return value === 1;
}

export function fromBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Ein Anmeldekonto, wie D1 es zurückgibt.
 *
 * `credential_salt` und `credential_verifier` stehen hier als das, was sie
 * sind: Hexzeichenketten. Der Klartext, aus dem sie entstanden sind, taucht in
 * keinem Typ dieser Datei auf — weil er in keiner Spalte steht.
 */
export interface AuthAccountRow {
  id: number;
  login_identifier_normalized: string;
  role: string;
  customer_id: number | null;
  credential_algorithm: string;
  credential_iterations: number;
  credential_salt: string;
  credential_verifier: string;
  is_active: number;
  failed_attempts: number;
  locked_until: string | null;
}

/**
 * Eine Sitzung, wie D1 sie zurückgibt.
 *
 * `token_hash` und nicht `token`: Der Rohtoken existiert ausschließlich im
 * Cookie des Browsers. Es gibt in dieser Datei keinen Typ, der ihn aufnähme.
 */
export interface AuthSessionRow {
  id: number;
  account_id: number;
  token_hash: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}
