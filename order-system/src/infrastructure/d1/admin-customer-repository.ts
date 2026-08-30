import type { AdminCustomerInput, AdminCustomerView } from '../../domain/admin-customer';
import { Address } from '../../domain/address';
import type { StoredCredential } from '../auth/credential';

interface AdminCustomerRow {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  delivery_street: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  is_active: number;
  default_fulfillment: 'delivery' | 'pickup';
  internal_note: string | null;
  price_group_code: 'gastro' | 'private' | null;
  customer_code: string | null;
  updated_at: string;
}

export type AdminCustomerCreateResult =
  | 'created'
  | 'duplicate_code'
  | 'invalid_price_group'
  | 'request_unavailable';
export type AdminCustomerUpdateResult = 'updated' | 'conflict' | 'duplicate_code';
export type AdminCustomerPinResult = 'updated' | 'unknown_customer' | 'duplicate_code';

/** One query for the customer workspace, independent of customer count. */
export async function loadAdminCustomerWorkspace(
  db: D1Database,
  customerId: number | null = null,
): Promise<AdminCustomerView[]> {
  const where = customerId === null ? '' : 'WHERE c.id = ?';
  const statement = db.prepare(
    `SELECT c.id, c.name, c.contact_person, c.email, c.phone,
            c.delivery_street, c.delivery_postal_code, c.delivery_city,
            c.is_active, c.default_fulfillment, c.internal_note, c.updated_at,
            l.code AS price_group_code,
            a.login_identifier_normalized AS customer_code
       FROM customers c
       LEFT JOIN price_lists l ON l.id = c.price_list_id
       LEFT JOIN auth_accounts a
         ON a.id = (
           SELECT MIN(a2.id) FROM auth_accounts a2
            WHERE a2.customer_id = c.id AND a2.role = 'customer'
         )
       ${where}
      ORDER BY c.name, c.id`,
  );
  const { results } = customerId === null
    ? await statement.all<AdminCustomerRow>()
    : await statement.bind(customerId).all<AdminCustomerRow>();
  return results.map(toView);
}

export async function createAdminCustomer(
  db: D1Database,
  input: AdminCustomerInput,
  credential: StoredCredential,
  now: string,
  sourceRequest: { readonly id: number; readonly expectedUpdatedAt: string } | null = null,
): Promise<AdminCustomerCreateResult> {
  const customerId = randomId();
  const address = input.deliveryAddress;
  const requestId = sourceRequest?.id ?? null;
  const expectedRequestUpdatedAt = sourceRequest?.expectedUpdatedAt ?? null;
  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO customers
           (id, name, contact_person, email, phone, delivery_street,
            delivery_postal_code, delivery_city, is_active, default_fulfillment,
            internal_note, price_list_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, l.id, ?, ?
           FROM price_lists l
          WHERE l.code = ? AND l.is_active = 1
            AND (? IS NULL OR EXISTS (
              SELECT 1 FROM customer_account_requests r
               WHERE r.id = ? AND r.status = 'pending' AND r.updated_at = ?
            ))`,
      ).bind(
        customerId,
        input.name,
        input.contactPerson,
        input.email,
        input.phone,
        address?.street ?? null,
        address?.postalCode ?? null,
        address?.city ?? null,
        bool(input.isActive),
        input.defaultFulfillment,
        input.internalNote,
        now,
        now,
        input.priceGroupCode,
        requestId,
        requestId,
        expectedRequestUpdatedAt,
      ),
      db.prepare(
        `INSERT INTO auth_accounts
           (login_identifier_normalized, role, customer_id,
            credential_algorithm, credential_iterations, credential_salt,
            credential_verifier, is_active, failed_attempts, locked_until,
            created_at, updated_at)
         SELECT ?, 'customer', c.id, ?, ?, ?, ?, ?, 0, NULL, ?, ?
           FROM customers c WHERE c.id = ? AND c.updated_at = ?
            AND (? IS NULL OR EXISTS (
              SELECT 1 FROM customer_account_requests r
               WHERE r.id = ? AND r.status = 'pending' AND r.updated_at = ?
            ))`,
      ).bind(
        input.customerCode,
        credential.algorithm,
        credential.iterations,
        credential.saltHex,
        credential.verifierHex,
        bool(input.isActive),
        now,
        now,
        customerId,
        now,
        requestId,
        requestId,
        expectedRequestUpdatedAt,
      ),
      db.prepare(
        `UPDATE customer_account_requests
            SET status = 'converted', processed_at = ?, customer_id = ?, updated_at = ?
          WHERE id = ? AND ? IS NOT NULL AND status = 'pending' AND updated_at = ?
            AND EXISTS (
              SELECT 1 FROM customers c
              JOIN auth_accounts a ON a.customer_id = c.id AND a.role = 'customer'
              WHERE c.id = ?
            )`,
      ).bind(
        now,
        customerId,
        now,
        requestId,
        requestId,
        expectedRequestUpdatedAt,
        customerId,
      ),
    ]);
    if (sourceRequest !== null && (results[2]?.meta.changes ?? 0) !== 1) {
      const current = await db.prepare(
        'SELECT status, updated_at FROM customer_account_requests WHERE id = ?',
      ).bind(sourceRequest.id).first<{ status: string; updated_at: string }>();
      return current?.status === 'pending' && current.updated_at === sourceRequest.expectedUpdatedAt
        ? 'invalid_price_group'
        : 'request_unavailable';
    }
    return (results[0]?.meta.changes ?? 0) === 1 ? 'created' : 'invalid_price_group';
  } catch (error) {
    if (isDuplicateCode(error)) return 'duplicate_code';
    throw error;
  }
}

export async function updateAdminCustomer(
  db: D1Database,
  customerId: number,
  expectedUpdatedAt: string,
  input: AdminCustomerInput,
  now: string,
): Promise<AdminCustomerUpdateResult> {
  const address = input.deliveryAddress;
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE customers
            SET name = ?, contact_person = ?, email = ?, phone = ?,
                delivery_street = ?, delivery_postal_code = ?, delivery_city = ?,
                is_active = ?, default_fulfillment = ?, internal_note = ?,
                price_list_id = (
                  SELECT id FROM price_lists WHERE code = ? AND is_active = 1
                ),
                updated_at = ?
          WHERE id = ? AND updated_at = ?
            AND 1 = (
              SELECT COUNT(*) FROM auth_accounts a
               WHERE a.customer_id = customers.id AND a.role = 'customer'
            )`,
      ).bind(
        input.name,
        input.contactPerson,
        input.email,
        input.phone,
        address?.street ?? null,
        address?.postalCode ?? null,
        address?.city ?? null,
        bool(input.isActive),
        input.defaultFulfillment,
        input.internalNote,
        input.priceGroupCode,
        now,
        customerId,
        expectedUpdatedAt,
      ),
      db.prepare(
        `UPDATE auth_accounts
            SET login_identifier_normalized = ?, is_active = ?, updated_at = ?
          WHERE customer_id = ? AND role = 'customer'
            AND EXISTS (
              SELECT 1 FROM customers c WHERE c.id = ? AND c.updated_at = ?
            )`,
      ).bind(
        input.customerCode,
        bool(input.isActive),
        now,
        customerId,
        customerId,
        now,
      ),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
  } catch (error) {
    if (isDuplicateCode(error)) return 'duplicate_code';
    throw error;
  }
}

export async function resetAdminCustomerPin(
  db: D1Database,
  customerId: number,
  customerCode: string,
  credential: StoredCredential,
  now: string,
): Promise<AdminCustomerPinResult> {
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE auth_accounts
            SET login_identifier_normalized = ?, credential_algorithm = ?,
                credential_iterations = ?, credential_salt = ?, credential_verifier = ?,
                failed_attempts = 0, locked_until = NULL, updated_at = ?
          WHERE customer_id = ? AND role = 'customer'
            AND 1 = (
              SELECT COUNT(*) FROM auth_accounts a2
               WHERE a2.customer_id = ? AND a2.role = 'customer'
            )`,
      ).bind(
        customerCode,
        credential.algorithm,
        credential.iterations,
        credential.saltHex,
        credential.verifierHex,
        now,
        customerId,
        customerId,
      ),
      db.prepare(
        `INSERT INTO auth_accounts
           (login_identifier_normalized, role, customer_id,
            credential_algorithm, credential_iterations, credential_salt,
            credential_verifier, is_active, failed_attempts, locked_until,
            created_at, updated_at)
         SELECT ?, 'customer', c.id, ?, ?, ?, ?, c.is_active, 0, NULL, ?, ?
           FROM customers c
          WHERE c.id = ?
            AND NOT EXISTS (
              SELECT 1 FROM auth_accounts a WHERE a.customer_id = c.id AND a.role = 'customer'
            )`,
      ).bind(
        customerCode,
        credential.algorithm,
        credential.iterations,
        credential.saltHex,
        credential.verifierHex,
        now,
        now,
        customerId,
      ),
    ]);
    const changes = (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0);
    return changes === 1 ? 'updated' : 'unknown_customer';
  } catch (error) {
    if (isDuplicateCode(error)) return 'duplicate_code';
    throw error;
  }
}

function toView(row: AdminCustomerRow): AdminCustomerView {
  const address = row.delivery_street === null || row.delivery_postal_code === null || row.delivery_city === null
    ? null
    : new Address(row.delivery_street, row.delivery_postal_code, row.delivery_city);
  return {
    id: row.id,
    name: row.name,
    customerCode: row.customer_code ?? '',
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    deliveryAddress: address,
    priceGroupCode: row.price_group_code,
    defaultFulfillment: row.default_fulfillment,
    isActive: row.is_active === 1,
    internalNote: row.internal_note,
    updatedAt: row.updated_at,
  };
}

function randomId(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  const high = (words[0] ?? 0) & 0x1fffff;
  const low = words[1] ?? 0;
  const value = high * 0x1_0000_0000 + low;
  return value === 0 ? 1 : value;
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function isDuplicateCode(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: auth_accounts\.login_identifier_normalized/i.test(error.message);
}
