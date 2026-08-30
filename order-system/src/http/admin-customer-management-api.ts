import type { AppConfig } from '../config/app-config';
import {
  parseAdminCustomerInput,
  parseCustomerPin,
  type AdminCustomerRawInput,
} from '../domain/admin-customer';
import { toUtcTimestamp } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import { normalizeLoginIdentifier } from '../domain/login-identifier';
import { deriveCredential } from '../infrastructure/auth/credential';
import {
  createAdminCustomer,
  resetAdminCustomerPin,
  updateAdminCustomer,
} from '../infrastructure/d1/admin-customer-repository';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { parseIdSegment } from './id-param';
import { RequestError, readBody } from './json-body';
import { privateHeaders } from './security';

const MAX_BODY_BYTES = 12 * 1024;
const CUSTOMER_PATH = /^\/api\/admin\/customers\/([^/]+)$/;
const CUSTOMER_PIN_PATH = /^\/api\/admin\/customers\/([^/]+)\/pin$/;

type ListNotice =
  | 'customer_created'
  | 'customer_duplicate_code'
  | 'customer_invalid'
  | 'customer_unknown'
  | 'customer_internal';

type DetailNotice =
  | 'customer_saved'
  | 'customer_conflict'
  | 'customer_duplicate_code'
  | 'customer_invalid'
  | 'pin_saved'
  | 'pin_invalid'
  | 'customer_unknown'
  | 'customer_internal';

export function matchAdminCustomerPath(pathname: string): string | null {
  return decodedMatch(CUSTOMER_PATH, pathname);
}

export function matchAdminCustomerPinPath(pathname: string): string | null {
  return decodedMatch(CUSTOMER_PIN_PATH, pathname);
}

export async function createAdminCustomerEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  try {
    const context = await guardedAdminCustomerForm(db, config, request, now);
    if (context instanceof Response) return context;
    const { fields } = context;
    const input = parseAdminCustomerInput(readAdminCustomerFields(fields));
    const pin = parseCustomerPin(readSingleAdminCustomerField(fields, 'pin'));
    const credential = await deriveCredential(pin, config.pepper);
    const result = await createAdminCustomer(db, input, credential, toUtcTimestamp(now));
    if (result === 'duplicate_code') return toList('customer_duplicate_code');
    if (result === 'invalid_price_group') return toList('customer_invalid');
    return toList('customer_created');
  } catch (error) {
    return handleListError(error);
  }
}

export async function updateAdminCustomerEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  customerIdSegment: string,
): Promise<Response> {
  let customerId: number | null = null;
  try {
    const context = await guardedAdminCustomerForm(db, config, request, now);
    if (context instanceof Response) return context;
    const { fields } = context;
    customerId = parseIdSegment(customerIdSegment);
    if (customerId === null) return toList('customer_unknown');
    const expectedUpdatedAt = readSingleAdminCustomerField(fields, 'expected_updated_at');
    if (!isTimestamp(expectedUpdatedAt)) return toDetail(customerId, 'customer_invalid');
    const input = parseAdminCustomerInput(readAdminCustomerFields(fields));
    const result = await updateAdminCustomer(
      db,
      customerId,
      expectedUpdatedAt,
      input,
      toUtcTimestamp(now),
    );
    if (result === 'duplicate_code') return toDetail(customerId, 'customer_duplicate_code');
    return toDetail(customerId, result === 'updated' ? 'customer_saved' : 'customer_conflict');
  } catch (error) {
    return handleDetailError(error, customerId);
  }
}

export async function resetAdminCustomerPinEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  customerIdSegment: string,
): Promise<Response> {
  let customerId: number | null = null;
  try {
    const context = await guardedAdminCustomerForm(db, config, request, now);
    if (context instanceof Response) return context;
    const { fields } = context;
    customerId = parseIdSegment(customerIdSegment);
    if (customerId === null) return toList('customer_unknown');
    if (readSingleAdminCustomerField(fields, 'confirm_pin') !== '1') return toDetail(customerId, 'pin_invalid');
    const customerCode = normalizeLoginIdentifier(readSingleAdminCustomerField(fields, 'customer_code'));
    if (customerCode === null) return toDetail(customerId, 'pin_invalid');
    const pin = parseCustomerPin(readSingleAdminCustomerField(fields, 'pin'));
    const credential = await deriveCredential(pin, config.pepper);
    const result = await resetAdminCustomerPin(
      db,
      customerId,
      customerCode,
      credential,
      toUtcTimestamp(now),
    );
    if (result === 'duplicate_code') return toDetail(customerId, 'customer_duplicate_code');
    if (result === 'unknown_customer') return toDetail(customerId, 'customer_unknown');
    return toDetail(customerId, 'pin_saved');
  } catch (error) {
    if (error instanceof ValidationError) {
      return customerId === null ? toList('customer_unknown') : toDetail(customerId, 'pin_invalid');
    }
    return handleDetailError(error, customerId);
  }
}

export async function guardedAdminCustomerForm(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<{ fields: URLSearchParams } | Response> {
  assertSameOrigin(request, config);
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;
  assertForm(request);
  const fields = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
  assertCsrf(request, guard.context, fields);
  return { fields };
}

export function readAdminCustomerFields(fields: URLSearchParams): AdminCustomerRawInput {
  return {
    name: readSingleAdminCustomerField(fields, 'name'),
    customerCode: readSingleAdminCustomerField(fields, 'customer_code'),
    contactPerson: readSingleAdminCustomerField(fields, 'contact_person'),
    email: readSingleAdminCustomerField(fields, 'email'),
    phone: readSingleAdminCustomerField(fields, 'phone'),
    deliveryStreet: readSingleAdminCustomerField(fields, 'delivery_street'),
    deliveryPostalCode: readSingleAdminCustomerField(fields, 'delivery_postal_code'),
    deliveryCity: readSingleAdminCustomerField(fields, 'delivery_city'),
    priceGroup: readSingleAdminCustomerField(fields, 'price_group'),
    fulfillment: readSingleAdminCustomerField(fields, 'fulfillment'),
    isActive: optionalCheckbox(fields, 'is_active'),
    internalNote: readSingleAdminCustomerField(fields, 'internal_note'),
  };
}

export function readSingleAdminCustomerField(fields: URLSearchParams, name: string): string {
  const values = fields.getAll(name);
  if (values.length !== 1) throw new RequestError(400, 'invalid_customer');
  return values[0] ?? '';
}

function optionalCheckbox(fields: URLSearchParams, name: string): string {
  const values = fields.getAll(name);
  if (values.length === 0) return '';
  if (values.length !== 1) throw new RequestError(400, 'invalid_customer');
  return values[0] ?? '';
}

function assertForm(request: Request): void {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    throw new RequestError(415, 'unsupported_media_type');
  }
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function decodedMatch(pattern: RegExp, pathname: string): string | null {
  const match = pattern.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

function handleListError(error: unknown): Response {
  if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) throw error;
  if (error instanceof ValidationError) return toList('customer_invalid');
  if (error instanceof RequestError) {
    if (error.status === 415) return new Response(null, { status: 415, headers: privateHeaders() });
    return toList(error.code === 'invalid_customer' ? 'customer_invalid' : 'customer_internal');
  }
  return toList('customer_internal');
}

function handleDetailError(error: unknown, customerId: number | null): Response {
  if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) throw error;
  if (customerId === null) return handleListError(error);
  if (error instanceof ValidationError) return toDetail(customerId, 'customer_invalid');
  if (error instanceof RequestError) {
    if (error.status === 415) return new Response(null, { status: 415, headers: privateHeaders() });
    return toDetail(
      customerId,
      error.code === 'invalid_customer' ? 'customer_invalid' : 'customer_internal',
    );
  }
  return toDetail(customerId, 'customer_internal');
}

function toList(notice: ListNotice): Response {
  return redirect(`/admin/customers?notice=${notice}`);
}

function toDetail(customerId: number, notice: DetailNotice): Response {
  return redirect(`/admin/customers/${customerId}?notice=${notice}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: privateHeaders({ location }) });
}
