import type { AppConfig } from '../config/app-config';
import { parseAdminProductInput, type AdminProductRawInput } from '../domain/admin-product';
import { toUtcTimestamp } from '../domain/clock';
import { ValidationError } from '../domain/errors';
import {
  createAdminProduct,
  updateAdminProduct,
} from '../infrastructure/d1/admin-product-repository';
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

const MAX_BODY_BYTES = 8 * 1024;
const PRODUCT_PATH = /^\/api\/admin\/products\/([^/]+)$/;

type Notice =
  | 'product_created'
  | 'product_saved'
  | 'product_invalid'
  | 'product_unknown'
  | 'product_conflict'
  | 'product_internal';

export function matchAdminProductPath(pathname: string): string | null {
  const match = PRODUCT_PATH.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

export async function createAdminProductEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  return handle(db, config, request, now, null);
}

export async function updateAdminProductEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  productIdSegment: string,
): Promise<Response> {
  return handle(db, config, request, now, productIdSegment);
}

async function handle(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  productIdSegment: string | null,
): Promise<Response> {
  try {
    assertSameOrigin(request, config);
    const guard = await requireRole(db, config, request, now, 'admin', 'html');
    if (!guard.ok) return guard.response;

    assertForm(request);
    const fields = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
    assertCsrf(request, guard.context, fields);

    const input = parseAdminProductInput(readProductFields(fields));
    const timestamp = toUtcTimestamp(now);

    if (productIdSegment === null) {
      await createAdminProduct(db, input, timestamp);
      return back('product_created');
    }

    const productId = parseIdSegment(productIdSegment);
    if (productId === null) return back('product_unknown');
    const expectedUpdatedAt = single(fields, 'expected_updated_at');
    if (!isTimestamp(expectedUpdatedAt)) return back('product_invalid');

    const result = await updateAdminProduct(db, productId, expectedUpdatedAt, input, timestamp);
    return back(result === 'updated' ? 'product_saved' : 'product_conflict');
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) throw error;
    if (error instanceof ValidationError) return back('product_invalid');
    if (error instanceof RequestError) {
      if (error.status === 415) return new Response(null, { status: 415, headers: privateHeaders() });
      return back(error.code === 'invalid_product' ? 'product_invalid' : 'product_internal');
    }
    return back('product_internal');
  }
}

function readProductFields(fields: URLSearchParams): AdminProductRawInput {
  return {
    name: single(fields, 'name'),
    unit: single(fields, 'unit'),
    isActive: optionalCheckbox(fields, 'is_active'),
    gastroPriceType: single(fields, 'gastro_price_type'),
    gastroPrice: single(fields, 'gastro_price'),
    gastroMaxPrice: single(fields, 'gastro_max_price'),
    privatePriceType: single(fields, 'private_price_type'),
    privatePrice: single(fields, 'private_price'),
    privateMaxPrice: single(fields, 'private_max_price'),
    unitCost: single(fields, 'unit_cost'),
  };
}

function single(fields: URLSearchParams, name: string): string {
  const values = fields.getAll(name);
  if (values.length !== 1) throw new RequestError(400, 'invalid_product');
  return values[0] ?? '';
}

function optionalCheckbox(fields: URLSearchParams, name: string): string {
  const values = fields.getAll(name);
  if (values.length === 0) return '';
  if (values.length !== 1) throw new RequestError(400, 'invalid_product');
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

function back(notice: Notice): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/catalog?notice=${notice}#angebot` }),
  });
}
