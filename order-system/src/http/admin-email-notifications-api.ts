import type { AppConfig } from '../config/app-config';
import { normalizeOperatorRecipients } from '../domain/email-notification-settings';
import { ValidationError } from '../domain/errors';
import { saveEmailNotificationSettings } from '../infrastructure/d1/email-notification-settings-repository';
import {
  ForbiddenError,
  UnauthenticatedError,
  assertCsrf,
  assertSameOrigin,
  requireRole,
} from './guard';
import { RequestError, readBody } from './json-body';
import { privateHeaders } from './security';

const MAX_BODY_BYTES = 4 * 1024;

type Notice =
  | 'email_saved'
  | 'email_invalid'
  | 'email_too_many'
  | 'email_recipient_required'
  | 'email_internal';

export async function saveEmailNotificationsEndpoint(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  try {
    assertSameOrigin(request, config);
    const guard = await requireRole(db, config, request, now, 'admin', 'html');
    if (!guard.ok) return guard.response;

    if (!isForm(request)) throw new RequestError(415, 'unsupported_media_type');
    const fields = new URLSearchParams(await readBody(request, MAX_BODY_BYTES));
    assertCsrf(request, guard.context, fields);

    const operatorEnabled = readSwitch(fields, 'operator_notifications_enabled');
    const customerEnabled = readSwitch(fields, 'customer_confirmations_enabled');
    const rawRecipients = fields.getAll('operator_recipient');
    const recipients = normalizeOperatorRecipients(rawRecipients);
    if (operatorEnabled && recipients.length === 0) {
      return redirect('email_recipient_required');
    }

    await saveEmailNotificationSettings(db, {
      operatorNotificationsEnabled: operatorEnabled,
      customerConfirmationsEnabled: customerEnabled,
      operatorRecipients: recipients,
    }, now);
    return redirect('email_saved');
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 415) {
        return new Response(null, { status: 415, headers: privateHeaders() });
      }
      return redirect('email_invalid');
    }
    if (error instanceof ValidationError) {
      return redirect(error.hasError('operator_recipients') ? 'email_too_many' : 'email_invalid');
    }
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) throw error;
    return redirect('email_internal');
  }
}

function readSwitch(fields: URLSearchParams, name: string): boolean {
  const values = fields.getAll(name);
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== '1') throw new RequestError(400, 'invalid');
  return true;
}

function isForm(request: Request): boolean {
  return request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    === 'application/x-www-form-urlencoded';
}

function redirect(notice: Notice): Response {
  return new Response(null, {
    status: 303,
    headers: privateHeaders({ location: `/admin/settings?notice=${notice}` }),
  });
}
