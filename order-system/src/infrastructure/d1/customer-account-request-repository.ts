import type {
  CustomerAccountRequestInput,
  CustomerAccountRequestStatus,
  CustomerAccountRequestView,
} from '../../domain/customer-account-request';

interface CustomerAccountRequestRow {
  id: number;
  name: string;
  contact_person: string | null;
  email: string;
  phone: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  message: string | null;
  status: CustomerAccountRequestStatus;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  linked_customer_name: string | null;
  rejection_note: string | null;
}

export type CustomerAccountRequestCreateResult = 'created' | 'duplicate_pending';

export async function createCustomerAccountRequest(
  db: D1Database,
  input: CustomerAccountRequestInput,
  now: string,
): Promise<CustomerAccountRequestCreateResult> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO customer_account_requests
       (name, contact_person, email, email_normalized, phone, street,
        postal_code, city, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    input.name,
    input.contactPerson,
    input.email,
    input.email,
    input.phone,
    input.street,
    input.postalCode,
    input.city,
    input.message,
    now,
    now,
  ).run();
  return (result.meta.changes ?? 0) === 1 ? 'created' : 'duplicate_pending';
}

export async function loadCustomerAccountRequests(
  db: D1Database,
  requestId: number | null = null,
): Promise<CustomerAccountRequestView[]> {
  const where = requestId === null ? '' : 'WHERE r.id = ?';
  const statement = db.prepare(
    `SELECT r.id, r.name, r.contact_person, r.email, r.phone, r.street,
            r.postal_code, r.city, r.message, r.status, r.created_at,
            r.updated_at, r.processed_at, r.rejection_note,
            c.name AS linked_customer_name
       FROM customer_account_requests r
       LEFT JOIN customers c ON c.id = r.customer_id
       ${where}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
               r.created_at DESC, r.id DESC`,
  );
  const { results } = requestId === null
    ? await statement.all<CustomerAccountRequestRow>()
    : await statement.bind(requestId).all<CustomerAccountRequestRow>();
  return results.map(toView);
}

export async function countPendingCustomerAccountRequests(db: D1Database): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM customer_account_requests WHERE status = 'pending'",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function rejectCustomerAccountRequest(
  db: D1Database,
  requestId: number,
  expectedUpdatedAt: string,
  rejectionNote: string | null,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE customer_account_requests
        SET status = 'rejected', processed_at = ?, rejection_note = ?, updated_at = ?
      WHERE id = ? AND status = 'pending' AND updated_at = ?`,
  ).bind(now, rejectionNote, now, requestId, expectedUpdatedAt).run();
  return (result.meta.changes ?? 0) === 1;
}

function toView(row: CustomerAccountRequestRow): CustomerAccountRequestView {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processedAt: row.processed_at,
    linkedCustomerName: row.linked_customer_name,
    rejectionNote: row.rejection_note,
  };
}
