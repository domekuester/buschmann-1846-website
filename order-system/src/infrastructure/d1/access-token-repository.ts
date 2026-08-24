import { hashAccessToken, isWellFormedToken } from '../../domain/access-token';
import { Address } from '../../domain/address';
import { Customer } from '../../domain/customer';
import { InvalidArgumentError } from '../../domain/errors';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { toBoolean, type CustomerRow } from './rows';

/**
 * Löst einen Zugangstoken zu genau einem Café auf — oder zu null.
 *
 * Es gibt bewusst NUR diese eine Funktion und keine, die einen Token-Datensatz
 * zurückgibt. Aufrufer sollen mit einem Customer arbeiten, nicht mit einer
 * Zugangszeile; damit gibt es keine Stelle, an der ein Token-Hash
 * versehentlich in eine Antwort, ein Log oder eine Fehlermeldung gerät.
 *
 * DIE VIER ABLEHNUNGSFÄLLE SIND EIN EINZIGES null:
 *
 *   Token formal ungültig · Token unbekannt · Token widerrufen ·
 *   Café deaktiviert
 *
 * Der Aufrufer kann sie nicht unterscheiden, weil er es nicht soll. Jede
 * Unterscheidung wäre eine Auskunft darüber, ob ein bestimmter Zugang
 * existiert.
 *
 * Der letzte Fall — gültiger Token, deaktiviertes Café — steht ausdrücklich
 * hier und nicht erst im Bestellvorgang. Sonst bekäme ein ehemaliges Café eine
 * vollständige Bestellseite und liefe erst beim Absenden in eine Ablehnung.
 */
export async function findCustomerByAccessToken(
  db: D1Database,
  token: string,
): Promise<Customer | null> {
  // Vor jedem Datenbankzugriff: Was die Form verfehlt, kann in der Tabelle
  // nicht stehen. Die Anfrage zu stellen wäre Arbeit für ein sicheres Nein.
  if (!isWellFormedToken(token)) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT c.id, c.name, c.contact_person, c.email, c.phone, c.delivery_street,
              c.delivery_postal_code, c.delivery_city, c.is_active, c.default_fulfillment,
              c.internal_note
         FROM customer_access_tokens t
         JOIN customers c ON c.id = t.customer_id
        WHERE t.token_hash = ?
          AND t.is_active = 1
          AND c.is_active = 1`,
    )
    .bind(await hashAccessToken(token))
    .first<CustomerRow>();

  return row === null ? null : toCustomer(row);
}

/**
 * Wortgleich zur Umwandlung in customer-repository.ts, und das mit Absicht
 * nicht geteilt: Beide lesen dieselben Spalten, aber aus verschiedenen
 * Abfragen. Eine gemeinsame Hilfsfunktion würde die beiden SELECT-Listen
 * aneinander binden, ohne dass ein Test das prüfen könnte.
 */
function toCustomer(row: CustomerRow): Customer {
  if (!isFulfillmentType(row.default_fulfillment)) {
    throw new InvalidArgumentError('Der gespeicherte Fulfillment-Typ des Kunden ist unbekannt.');
  }

  return new Customer({
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    deliveryAddress: toAddress(row),
    isActive: toBoolean(row.is_active),
    defaultFulfillment: row.default_fulfillment,
    internalNote: row.internal_note,
  });
}

function toAddress(row: CustomerRow): Address | null {
  if (row.delivery_street === null || row.delivery_postal_code === null || row.delivery_city === null) {
    return null;
  }
  return new Address(row.delivery_street, row.delivery_postal_code, row.delivery_city);
}
