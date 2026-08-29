import { getProductionDay } from '../application/get-production-day';
import type { AppConfig } from '../config/app-config';
import { businessDay, plusDays } from '../domain/clock';
import { renderInvalidDatePage } from '../ui/admin-page-html';
import { renderProductionListPage } from '../ui/production-list-html';
import { readDayParam } from './day-param';
import { requireRole } from './guard';
import { pageHeaders } from './security';

export async function adminProductionListPage(db: D1Database, config: AppConfig, request: Request, now: Date): Promise<Response> {
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;
  const requested = readDayParam(request);
  if (requested === 'invalid') {
    return new Response(renderInvalidDatePage({ href: '/admin', label: 'Zurück zur Produktion' }), { status: 400, headers: pageHeaders() });
  }
  const day = requested ?? plusDays(businessDay(now), 1);
  const productionDay = await getProductionDay(db, day);
  return new Response(renderProductionListPage({ day: productionDay }), { status: 200, headers: pageHeaders() });
}
