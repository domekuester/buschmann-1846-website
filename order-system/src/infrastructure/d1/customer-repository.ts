import { Address } from '../../domain/address';
import { Customer } from '../../domain/customer';
import { InvalidArgumentError } from '../../domain/errors';
import { isFulfillmentType } from '../../domain/fulfillment-type';
import { toBoolean, type CustomerRow } from './rows';

export async function findCustomer(db: D1Database, id: number): Promise<Customer | null> {
  const row = await db
    .prepare(
      `SELECT id, name, contact_person, email, phone, delivery_street, delivery_postal_code,
              delivery_city, is_active, default_fulfillment, internal_note
         FROM customers
        WHERE id = ?`,
    )
    .bind(id)
    .first<CustomerRow>();

  return row === null ? null : toCustomer(row);
}

function toCustomer(row: CustomerRow): Customer {
  // Der Wert kommt aus einer Spalte mit CHECK-Bedingung. Trotzdem wird er
  // geprüft: Ein CHECK schützt gegen künftige Schreibvorgänge, nicht gegen
  // Daten, die vor einer Schemaänderung entstanden sind.
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

/** Eine Adresse gibt es nur, wenn alle drei Teile vorliegen. */
function toAddress(row: CustomerRow): Address | null {
  if (row.delivery_street === null || row.delivery_postal_code === null || row.delivery_city === null) {
    return null;
  }
  return new Address(row.delivery_street, row.delivery_postal_code, row.delivery_city);
}
