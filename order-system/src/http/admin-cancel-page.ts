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
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;

  const orderNumber = OrderNumber.parse(orderNumberSegment);
  if (orderNumber === null) return notFoundPage();

  const order = await findOrderByNumber(db, orderNumber.value);
  if (order === null) return notFoundPage();

  if (!canTransitionTo(order.status, 'cancelled')) {
    return redirectToDay(order.fulfillmentDate.value, 'invalid_transition');
  }

  return new Response(
    renderCancelOrderPage({
      csrfToken: guard.context.csrfToken,
      orderNumber: order.orderNumber.value,
      customerName: order.customerNameSnapshot,
      fulfillmentDate: order.fulfillmentDate.value,
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

function redirectToDay(day: string, error: 'invalid_transition'): Response {
  const target = isCalendarDay(day)
    ? `/admin?date=${day}&status_error=${error}`
    : `/admin?status_error=${error}`;
  return new Response(null, { status: 303, headers: privateHeaders({ location: target }) });
}
