import type { AppConfig } from '../config/app-config';
import {
  countPendingCustomerAccountRequests,
  loadCustomerAccountRequests,
} from '../infrastructure/d1/customer-account-request-repository';
import { loadAssignablePriceGroups } from '../infrastructure/d1/customer-price-group-repository';
import {
  renderAdminCustomerAccountRequestDetailPage,
  renderAdminCustomerAccountRequestsPage,
} from '../ui/admin-customer-account-request-html';
import { renderNoticePage } from '../ui/notice-page-html';
import { requireRole } from './guard';
import { parseIdSegment } from './id-param';
import { pageHeaders } from './security';

const DETAIL_PATH = /^\/admin\/customers\/requests\/([^/]+)$/;

export function matchCustomerAccountRequestDetailPath(pathname: string): string | null {
  const match = DETAIL_PATH.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

export async function adminCustomerAccountRequestsPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;
  const [requests, pendingCount] = await Promise.all([
    loadCustomerAccountRequests(db),
    countPendingCustomerAccountRequests(db),
  ]);
  return new Response(renderAdminCustomerAccountRequestsPage({
    loginIdentifier: guard.context.loginIdentifier,
    csrfToken: guard.context.csrfToken,
    requests,
    pendingCount,
    noticeCode: readNotice(request),
  }), { status: 200, headers: pageHeaders() });
}

export async function adminCustomerAccountRequestDetailPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  requestIdSegment: string,
): Promise<Response> {
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;
  const requestId = parseIdSegment(requestIdSegment);
  if (requestId === null) return unknown();
  const [requests, priceGroups] = await Promise.all([
    loadCustomerAccountRequests(db, requestId),
    loadAssignablePriceGroups(db),
  ]);
  const accountRequest = requests[0] ?? null;
  if (accountRequest === null) return unknown();
  return new Response(renderAdminCustomerAccountRequestDetailPage({
    loginIdentifier: guard.context.loginIdentifier,
    csrfToken: guard.context.csrfToken,
    request: accountRequest,
    priceGroups,
    noticeCode: readNotice(request),
  }), { status: 200, headers: pageHeaders() });
}

function readNotice(request: Request): string | null {
  const values = new URL(request.url).searchParams.getAll('notice');
  return values.length === 1 ? values[0] ?? null : null;
}

function unknown(): Response {
  return new Response(renderNoticePage(
    'Nicht gefunden',
    'Diese Kundenanfrage gibt es nicht.',
    'Über „Anfragen" im Kundenbereich findest du alle eingegangenen Anfragen.',
  ), { status: 404, headers: pageHeaders() });
}
