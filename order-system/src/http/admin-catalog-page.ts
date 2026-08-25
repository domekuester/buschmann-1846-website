import type { AppConfig } from '../config/app-config';
import { loadAdminCatalog } from '../infrastructure/d1/catalog-pricing-repository';
import { renderAdminCatalogPage } from '../ui/admin-catalog-html';
import { requireRole } from './guard';
import { pageHeaders } from './security';

/** GET /admin/catalog — ausschließlich lesende Katalogansicht. */
export async function adminCatalogPage(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response> {
  const guard = await requireRole(db, config, request, now, 'admin', 'html');
  if (!guard.ok) return guard.response;

  const products = await loadAdminCatalog(db);
  return new Response(renderAdminCatalogPage({
    loginIdentifier: guard.context.loginIdentifier,
    csrfToken: guard.context.csrfToken,
    products,
  }), { status: 200, headers: pageHeaders() });
}
