import type {
  AdminCustomerRow,
  PriceGroupOption,
} from '../../domain/customer-price-group';
import { toBoolean } from './rows';

/**
 * Die Datenbankzugriffe der Kundenliste — lesend, und ein einziger
 * schreibender, der genau eine Spalte anfasst.
 *
 * Jede Abfrage hier liest AUSDRÜCKLICH aufgezählte Spalten. Kein `SELECT *`:
 * Eine Spalte, die nicht in der Abfrage steht, kann nicht versehentlich in
 * einer Seite landen — dieselbe Bauart wie bei den Produktionsabfragen.
 */

interface AdminCustomerQueryRow {
  id: number;
  name: string;
  is_active: number;
  price_group_code: string | null;
  price_group_label: string | null;
  price_group_is_active: number | null;
}

/**
 * Die Kundenliste des Adminbereichs.
 *
 * LEFT JOIN und nicht INNER JOIN: Ein Kunde ohne Preisgruppe ist der
 * Normalfall nach der Migration und muss in der Liste stehen — er ist sogar
 * genau der Kunde, dessentwegen es diese Seite gibt.
 *
 * OHNE FILTER AUF l.is_active. Eine bestehende Zuordnung auf eine inzwischen
 * deaktivierte Preisliste soll sichtbar bleiben; sie hier wegzujoinen ließe
 * den Kunden fälschlich als „nicht zugeordnet" erscheinen. Ob eine Gruppe
 * NEU wählbar ist, beantwortet loadAssignablePriceGroups().
 */
export async function loadAdminCustomers(db: D1Database): Promise<AdminCustomerRow[]> {
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.is_active,
            l.code       AS price_group_code,
            l.label      AS price_group_label,
            l.is_active  AS price_group_is_active
       FROM customers c
       LEFT JOIN price_lists l ON l.id = c.price_list_id
      ORDER BY c.name, c.id`,
  ).all<AdminCustomerQueryRow>();

  return results.map(toAdminCustomerRow);
}

/**
 * Eine Datenbankzeile als Kundenzeile — an EINER Stelle.
 *
 * Die Liste und die Detailansicht lesen dieselben Spalten und müssen sie
 * deshalb auch gleich deuten. Vor allem eine Regel: Eine Zuordnung gilt nur
 * dann als vorhanden, wenn Code UND Bezeichnung dastehen — der LEFT JOIN
 * liefert bei fehlender Preisliste beide als NULL, und ein halb gefülltes
 * Paar wäre eine Zeile, die niemand erklären kann.
 */
function toAdminCustomerRow(row: AdminCustomerQueryRow): AdminCustomerRow {
  return {
    id: row.id,
    name: row.name,
    isActive: toBoolean(row.is_active),
    priceGroup:
      row.price_group_code === null || row.price_group_label === null
        ? null
        : {
            code: row.price_group_code,
            label: row.price_group_label,
            isActive: toBoolean(row.price_group_is_active ?? 0),
          },
  };
}

/**
 * EIN Kunde mit seiner Preisgruppe — die Kopfzeile der Detailansicht.
 *
 * DIESELBEN SPALTEN UND DERSELBE JOIN WIE IN loadAdminCustomers(), nur mit
 * einer WHERE-Bedingung statt einer Sortierung. Das ist Absicht: „Kunde plus
 * Preisgruppe" wird an zwei Stellen gebraucht, und zwei verschiedene
 * Abfragen dafür wären zwei Gelegenheiten, die Regel `ohne Filter auf
 * l.is_active` bei einer davon zu vergessen — die Liste zeigte dann eine
 * bestehende Zuordnung an und die Detailseite „nicht zugeordnet".
 *
 * EINE ABFRAGE UND NICHT ZWEI. Preisliste und Kunde kommen in derselben
 * Zeile zurück; ein zweites SELECT auf price_lists wäre eine zweite
 * Datenbankrunde für eine Frage, die der LEFT JOIN schon beantwortet.
 *
 * `null` heißt: diesen Kunden gibt es nicht. Es heißt niemals „er hat keine
 * Preisgruppe" — dafür steht `priceGroup: null` INNERHALB einer Zeile.
 */
export async function loadAdminCustomer(
  db: D1Database,
  customerId: number,
): Promise<AdminCustomerRow | null> {
  const row = await db.prepare(
    `SELECT c.id, c.name, c.is_active,
            l.code       AS price_group_code,
            l.label      AS price_group_label,
            l.is_active  AS price_group_is_active
       FROM customers c
       LEFT JOIN price_lists l ON l.id = c.price_list_id
      WHERE c.id = ?`,
  ).bind(customerId).first<AdminCustomerQueryRow>();

  return row === null ? null : toAdminCustomerRow(row);
}

/**
 * Die Preisgruppen, die NEU zugeordnet werden dürfen.
 *
 * Nur aktive, in der fachlichen Reihenfolge aus Phase 5A. Diese Liste ist
 * zugleich die Auswahl im Formular und die Grundlage der serverseitigen
 * Prüfung — beide fragen dieselbe Tabelle mit derselben Bedingung, damit die
 * Oberfläche nichts anbieten kann, was der Server dann ablehnt.
 */
export async function loadAssignablePriceGroups(db: D1Database): Promise<PriceGroupOption[]> {
  const { results } = await db.prepare(
    `SELECT code, label FROM price_lists WHERE is_active = 1 ORDER BY sort_order, id`,
  ).all<{ code: string; label: string }>();

  return results.map((row) => ({ code: row.code, label: row.label }));
}

export interface PriceGroupRow {
  readonly id: number;
  readonly isActive: boolean;
}

/** Eine Preisgruppe anhand ihres Codes — mitsamt der Frage, ob sie aktiv ist. */
export async function findPriceGroupByCode(
  db: D1Database,
  code: string,
): Promise<PriceGroupRow | null> {
  const row = await db
    .prepare('SELECT id, is_active FROM price_lists WHERE code = ?')
    .bind(code)
    .first<{ id: number; is_active: number }>();

  return row === null ? null : { id: row.id, isActive: toBoolean(row.is_active) };
}

/**
 * Die bestehende Zuordnung eines Kunden — und ob es ihn überhaupt gibt.
 *
 * `null` heißt „diesen Kunden gibt es nicht"; ein Verbund mit
 * `priceListId: null` heißt „es gibt ihn, er ist nur nicht zugeordnet". Die
 * beiden Lagen zu vermischen hieße, einen gelöschten Kunden wie einen
 * unzugeordneten zu behandeln.
 *
 * Gebraucht wird das an genau einer Stelle: um zu unterscheiden, ob eine
 * inaktive Preisgruppe NEU vergeben oder nur unverändert fortgeschrieben
 * werden soll.
 */
export async function findCustomerAssignment(
  db: D1Database,
  customerId: number,
): Promise<{ readonly priceListId: number | null } | null> {
  const row = await db
    .prepare('SELECT price_list_id FROM customers WHERE id = ?')
    .bind(customerId)
    .first<{ price_list_id: number | null }>();

  return row === null ? null : { priceListId: row.price_list_id };
}

/**
 * Der einzige Schreibvorgang dieser Phase.
 *
 * EINE SPALTE UND EIN ZEITSTEMPEL. Name, Adresse, E-Mail, Notiz, Aktivität
 * und die Zugangsdaten des Kunden kommen in diesem UPDATE nicht vor — es gibt
 * keine Zeile, die sie setzte, und damit auch keine, die sie versehentlich
 * überschriebe.
 *
 * Der Rückgabewert sagt, ob es den Kunden überhaupt gab: `changes === 0`
 * heißt, dass die WHERE-Bedingung auf keine Zeile gepasst hat. Ein
 * vorgeschaltetes SELECT wäre eine zweite Datenbankrunde für eine Frage, die
 * das UPDATE ohnehin beantwortet.
 */
export async function updateCustomerPriceList(
  db: D1Database,
  customerId: number,
  priceListId: number | null,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE customers SET price_list_id = ?, updated_at = ? WHERE id = ?')
    .bind(priceListId, now.toISOString(), customerId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
