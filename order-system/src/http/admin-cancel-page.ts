import type { AppConfig } from '../config/app-config';
import { isCalendarDay } from '../domain/clock';
import { OrderNumber } from '../domain/order-number';
import { canTransitionTo } from '../domain/order-status';
import { findOrderByNumber } from '../infrastructure/d1/order-repository';
import { renderCancelOrderPage } from '../ui/cancel-order-html';
import { requireRole } from './guard';
import { pageHeaders, privateHeaders } from './security';

const CANCEL_PATH = /^\/admin\/orders\/([^/]+)\/cancel$/;

export function matchCancelOrderPath(pathname: string): string | null {
  const match = CANCEL_PATH.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

export async function cancelOrderPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumberSegment: string,
): Promise<Response> {
  const workspace = cancelWorkspace(request);
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;

  const orderNumber = OrderNumber.parse(orderNumberSegment);
  if (orderNumber === null) return notFoundPage();

  const order = await findOrderByNumber(db, orderNumber.value);
  if (order === null) return notFoundPage();

  if (!canTransitionTo(order.status, 'cancelled')) {
    return redirectToDay(order.fulfillmentDate.value, 'invalid_transition', workspace);
  }

  return new Response(
    renderCancelOrderPage({
      csrfToken: guard.context.csrfToken,
      orderNumber: order.orderNumber.value,
      customerName: order.customerNameSnapshot,
      fulfillmentDate: order.fulfillmentDate.value,
      workspace,
    }),
    { status: 200, headers: pageHeaders() },
  );
}

function notFoundPage(): Response {
  return new Response('Bestellung nicht gefunden.', {
    status: 404,
    headers: pageHeaders(),
  });
}

function cancelWorkspace(request: Request): 'production' | 'orders' {
  const values = new URL(request.url).searchParams.getAll('workspace');
  return values.length === 1 && values[0] === 'orders' ? 'orders' : 'production';
}

function redirectToDay(
  day: string,
  error: 'invalid_transition',
  workspace: 'production' | 'orders',
): Response {
  if (workspace === 'orders') {
    const date = isCalendarDay(day) ? `date=${day}&` : '';
    return new Response(null, {
      status: 303,
      headers: privateHeaders({ location: `/admin/orders?${date}notice=status_${error}` }),
    });
  }
  const target = isCalendarDay(day)
    ? `/admin/production?date=${day}&status_error=${error}`
    : `/admin/production?status_error=${error}`;
  return new Response(null, { status: 303, headers: privateHeaders({ location: target }) });
}
