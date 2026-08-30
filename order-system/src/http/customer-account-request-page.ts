import type { AppConfig } from '../config/app-config';
import {
  hasFilledAccountRequestHoneypot,
  parseCustomerAccountRequest,
  type CustomerAccountRequestRawInput,
} from '../domain/customer-account-request';
import { toUtcTimestamp } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import { createCustomerAccountRequest } from '../infrastructure/d1/customer-account-request-repository';
import { renderCustomerAccountRequestPage } from '../ui/customer-account-request-html';
import { assertSameOrigin } from './guard';
import { RequestError, assertAnnouncedSizeOk, readBody } from './json-body';
import { pageHeaders, privateHeaders } from './security';

const MAX_BODY_BYTES = 12 * 1024;
const FIELD_NAMES = [
  'name', 'contact_person', 'email', 'phone', 'street', 'postal_code', 'city', 'message', 'website',
] as const;

export async function customerAccountRequestPage(request: Request): Promise<Response> {
  const statuses = new URL(request.url).searchParams.getAll('status');
  const success = statuses.length === 1 && statuses[0] === 'eingegangen';
  return html({ values: {}, errors: {}, success });
}

export async function submitCustomerAccountRequest(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  assertSameOrigin(request, config);

  let fields: URLSearchParams;
  try {
    assertForm(request);
    assertAnnouncedSizeOk(request, MAX_BODY_BYTES);
    fields = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestError) {
      return new Response(null, { status: error.status, headers: privateHeaders() });
    }
    throw error;
  }

  const values = readValues(fields);
  if (hasFilledAccountRequestHoneypot(single(fields, 'website'))) return successRedirect();

  try {
    const input = parseCustomerAccountRequest(readInput(fields));
    await createCustomerAccountRequest(db, input, toUtcTimestamp(now));
    return successRedirect();
  } catch (error) {
    if (error instanceof ValidationError) {
      return html({ values, errors: error.errors, success: false }, 422);
    }
    throw error;
  }
}

function readInput(fields: URLSearchParams): CustomerAccountRequestRawInput {
  return {
    name: single(fields, 'name'),
    contactPerson: single(fields, 'contact_person'),
    email: single(fields, 'email'),
    phone: single(fields, 'phone'),
    street: single(fields, 'street'),
    postalCode: single(fields, 'postal_code'),
    city: single(fields, 'city'),
    message: single(fields, 'message'),
  };
}

function readValues(fields: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of FIELD_NAMES) {
    if (name === 'website') continue;
    const value = single(fields, name);
    if (typeof value === 'string') values[name] = value;
  }
  return values;
}

function single(fields: URLSearchParams, name: string): string | null {
  const values = fields.getAll(name);
  return values.length === 1 ? values[0] ?? '' : null;
}

function assertForm(request: Request): void {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    throw new RequestError(415, 'unsupported_media_type');
  }
}

function successRedirect(): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: '/konto-anfragen?status=eingegangen' }),
  });
}

function html(
  view: Parameters<typeof renderCustomerAccountRequestPage>[0],
  status = 200,
): Response {
  return new Response(renderCustomerAccountRequestPage(view), { status, headers: pageHeaders() });
}
