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
  /**
   * Seit 0017 — die internen Herstellkosten zum Bestellzeitpunkt, oder NULL.
   *
   * NULL heißt „für dieses Produkt waren damals keine Herstellkosten
   * gepflegt" und schließt jede Bestellung ein, die vor 0017 entstanden ist.
   * Es heißt nie 0.
   *
   * Diese Spalte steht in genau DREI Zeilenformen dieser Datei: hier, in
   * DashboardItemRow und in DashboardWeekItemRow — also im Bestelldokument
   * und in den beiden Auswertungen des Adminbereichs. In ProductionItemRow
   * steht sie NICHT: Was nicht geladen wird, kann nicht auf einer Backliste
   * landen.
   */
  unit_cost_cents_snapshot: number | null;
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

/**
 * Eine Bestellung, wie der Tagesüberblick sie sieht — MEHR als
 * ProductionOrderRow und weniger als OrderRow.
 *
 * Mehr, weil der Überblick Beträge und den Zahlungsstatus braucht: Die Frage
 * „was hat der Tag umgesetzt und was steht noch aus" ist ohne sie nicht zu
 * beantworten.
 *
 * Weniger, weil Lieferadresse, Kundennotiz, submission_id und updated_at
 * darin nicht vorkommen. Sie werden nicht gelesen und können deshalb nicht
 * versehentlich auf einer Seite landen.
 *
 * `id` verlässt die Infrastrukturschicht nicht: Sie dient allein dazu,
 * Positionen ihrer Bestellung zuzuordnen.
 */
export interface DashboardOrderRow {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name_snapshot: string;
  fulfillment_type: string;
  status: string;
  /** Seit 0015 — 'unpaid' oder eine der vier bezahlten Zahlarten. */
  payment_status: string;
  total_amount_cents: number;
  created_at: string;
}

/**
 * Eine Position, wie der Tagesüberblick sie sieht.
 *
 * Ohne Preise: unit_price_cents und line_total_cents stehen nicht in der
 * Abfrage, weil der Betrag einer Bestellung aus ihrem eigenen Snapshot kommt
 * und nicht aus einer zweiten Summe.
 */
export interface DashboardItemRow {
  order_id: number;
  product_id: number;
  product_name_snapshot: string;
  product_unit_snapshot: string;
  sort_order: number;
  quantity: number;
  /**
   * Seit Phase 7B — der Kostenschnappschuss aus 0017, oder NULL.
   *
   * ER STEHT AUSDRÜCKLICH NUR HIER UND IN OrderItemRow. Die Produktionsliste
   * und die Abholliste lesen ihn nicht: Eine Backliste beantwortet
   * Mengenfragen, und ein Wert, der nicht geladen wird, kann nicht auf einem
   * Ausdruck landen, der in der Backstube liegt.
   *
   * NULL heißt „damals nicht gepflegt" und niemals 0.
   */
  unit_cost_cents_snapshot: number | null;
}

/**
 * Eine Bestellung, wie die WOCHENÜBERSICHT sie sieht — vier Angaben und eine
 * Kennung.
 *
 * Der Gegensatz zu DashboardOrderRow ist die Aussage dieser Zeile: Die Woche
 * zeigt je Tag Zahlen und deshalb keinen Kunden, keine Bestellnummer und
 * keinen Zeitpunkt. Was nicht in der Abfrage steht, kann nicht versehentlich
 * in einer Seite landen.
 *
 * `id` verlässt die Infrastrukturschicht nicht — sie ordnet seit Phase 7B die
 * Kostenzeilen ihrer Bestellung zu, damit „in wie vielen Bestellungen fehlt
 * etwas" überhaupt beantwortbar ist.
 */
export interface DashboardWeekOrderRow {
  id: number;
  fulfillment_date: string;
  status: string;
  /** Seit 0015 — 'unpaid' oder eine der vier bezahlten Zahlarten. */
  payment_status: string;
  total_amount_cents: number;
}

/**
 * Eine Position, wie die WOCHENÜBERSICHT sie sieht — zwei Zahlen und eine
 * Zuordnung.
 *
 * SIE IST DIE SCHLANKSTE POSITIONSZEILE DES SYSTEMS, und das ist der Punkt:
 * kein Name, keine Einheit, keine Produkt-ID, kein Preis, keine
 * Sortierreihenfolge. Die Woche zeigt von einer Position nichts; sie braucht
 * ausschließlich, was für die Kostensumme nötig ist. `order_id` ordnet die
 * Zeile ihrer Bestellung zu — nur so lässt sich sagen, in WIE VIELEN
 * Bestellungen etwas fehlt.
 */
export interface DashboardWeekItemRow {
  order_id: number;
  quantity: number;
  unit_cost_cents_snapshot: number | null;
}
