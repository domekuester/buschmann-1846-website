import type { AppConfig } from '../config/app-config';
import { parseAdminCustomerInput, parseCustomerPin } from '../domain/admin-customer';
import { toUtcTimestamp } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import { deriveCredential } from '../infrastructure/auth/credential';
import { createAdminCustomer } from '../infrastructure/d1/admin-customer-repository';
import { rejectCustomerAccountRequest } from '../infrastructure/d1/customer-account-request-repository';
import {
  guardedAdminCustomerForm,
  readAdminCustomerFields,
  readSingleAdminCustomerField,
} from './admin-customer-management-api';
import { ForbiddenError, UnauthenticatedError } from './guard';
import { parseIdSegment } from './id-param';
import { RequestError } from './json-body';
import { privateHeaders } from './security';

const CONVERT_PATH = /^\/api\/admin\/customer-account-requests\/([^/]+)\/convert$/;
const REJECT_PATH = /^\/api\/admin\/customer-account-requests\/([^/]+)\/reject$/;

export function matchCustomerAccountRequestConvertPath(pathname: string): string | null {
  return decoded(CONVERT_PATH, pathname);
}

export function matchCustomerAccountRequestRejectPath(pathname: string): string | null {
  return decoded(REJECT_PATH, pathname);
}

export async function convertCustomerAccountRequestEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  requestIdSegment: string,
): Promise<Response> {
  let requestId: number | null = null;
  try {
    const context = await guardedAdminCustomerForm(db, config, request, now);
    if (context instanceof Response) return context;
    requestId = parseIdSegment(requestIdSegment);
    if (requestId === null) return redirectToList('request_unavailable');
    const expectedUpdatedAt = readSingleAdminCustomerField(context.fields, 'expected_updated_at');
    if (!isTimestamp(expectedUpdatedAt)) return redirectToDetail(requestId, 'request_invalid');
    const input = parseAdminCustomerInput(readAdminCustomerFields(context.fields));
    const pin = parseCustomerPin(readSingleAdminCustomerField(context.fields, 'pin'));
    const credential = await deriveCredential(pin, config.pepper);
    const result = await createAdminCustomer(db, input, credential, toUtcTimestamp(now), {
      id: requestId,
      expectedUpdatedAt,
    });
    if (result === 'created') return redirectToDetail(requestId, 'request_converted');
    if (result === 'duplicate_code') return redirectToDetail(requestId, 'request_duplicate_code');
    if (result === 'request_unavailable') return redirectToDetail(requestId, 'request_unavailable');
    return redirectToDetail(requestId, 'request_invalid');
  } catch (error) {
    return handle(error, requestId);
  }
}

export async function rejectCustomerAccountRequestEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  requestIdSegment: string,
): Promise<Response> {
  let requestId: number | null = null;
  try {
    const context = await guardedAdminCustomerForm(db, config, request, now);
    if (context instanceof Response) return context;
    requestId = parseIdSegment(requestIdSegment);
    if (requestId === null) return redirectToList('request_unavailable');
    const expectedUpdatedAt = readSingleAdminCustomerField(context.fields, 'expected_updated_at');
    if (!isTimestamp(expectedUpdatedAt)) return redirectToDetail(requestId, 'request_invalid');
    const rejectionNote = optionalNote(readSingleAdminCustomerField(context.fields, 'rejection_note'));
    const changed = await rejectCustomerAccountRequest(
      db,
      requestId,
      expectedUpdatedAt,
      rejectionNote,
      toUtcTimestamp(now),
    );
    return redirectToDetail(requestId, changed ? 'request_rejected' : 'request_unavailable');
  } catch (error) {
    return handle(error, requestId);
  }
}

function optionalNote(value: string): string | null {
  const trimmed = value.trim();
  if ([...trimmed].length > 500) {
    throw ValidationError.field('rejection_note', 'Die interne Notiz darf höchstens 500 Zeichen lang sein.');
  }
  return trimmed === '' ? null : trimmed;
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function handle(error: unknown, requestId: number | null): Response {
  if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) throw error;
  if (error instanceof ValidationError) {
    return requestId === null ? redirectToList('request_invalid') : redirectToDetail(requestId, 'request_invalid');
  }
  if (error instanceof RequestError && error.status === 415) {
    return new Response(null, { status: 415, headers: privateHeaders() });
  }
  return requestId === null ? redirectToList('request_internal') : redirectToDetail(requestId, 'request_internal');
}

function redirectToList(notice: string): Response {
  return redirect(`/admin/customers/requests?notice=${notice}`);
}

function redirectToDetail(requestId: number, notice: string): Response {
  return redirect(`/admin/customers/requests/${requestId}?notice=${notice}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: privateHeaders({ location }) });
}

function decoded(pattern: RegExp, pathname: string): string | null {
  const match = pattern.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}
