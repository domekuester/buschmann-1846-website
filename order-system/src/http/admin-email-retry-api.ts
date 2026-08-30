import { retryOrderEmailNotifications } from '../application/retry-order-email-notifications';
import type { AppConfig } from '../config/app-config';
import type { EmailSender } from '../infrastructure/email/email-sender';
import { assertCsrf, assertSameOrigin, requireRole } from './guard';
import { RequestError, assertAnnouncedSizeOk, readBody } from './json-body';
import { privateHeaders } from './security';

const PATH = /^\/api\/admin\/orders\/([^/]+)\/email-retry$/;
const MAX_BODY_BYTES = 1024;

export function matchOrderEmailRetryPath(pathname: string): string | null {
  const match = PATH.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

export async function retryOrderEmailEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
  orderNumber: string,
  sender: EmailSender,
): Promise<Response> {
  assertSameOrigin(request, config);
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    throw new RequestError(415, 'unsupported_media_type');
  }
  assertAnnouncedSizeOk(request, MAX_BODY_BYTES);
  const fields = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
  assertCsrf(request, guard.context, fields);

  const result = await retryOrderEmailNotifications(
    db, orderNumber, sender, now, config.appOrigin,
  );
  const notice = retryNotice(result);
  const day = result.fulfillmentDate === null ? '' : `date=${encodeURIComponent(result.fulfillmentDate)}&`;
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/orders?${day}notice=${notice}` }),
  });
}

function retryNotice(result: Awaited<ReturnType<typeof retryOrderEmailNotifications>>): string {
  if (result.outcome === 'order_not_found' || result.outcome === 'nothing_to_retry') {
    return 'email_retry_not_available';
  }
  if (result.unreconciledCount > 0) return 'email_retry_reconciliation_required';
  if (result.failedCount > 0) return 'email_retry_failed';
  if (result.unavailableCount > 0) return 'email_retry_unavailable';
  return 'email_retry_sent';
}
