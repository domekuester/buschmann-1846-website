import { describe, expect, it } from 'vitest';
import { renderAdminShell, type AdminArea } from '../../src/ui/admin-page-html';

const AREAS: readonly AdminArea[] = ['overview', 'orders', 'production', 'catalog', 'customers', 'settings'];

describe('genehmigte Admin-Navigation', () => {
  it('führt genau die sechs Operatorbereiche in der freigegebenen Reihenfolge', () => {
    const html = renderAdminShell('Test', { loginIdentifier: 'admin@example.test', csrfToken: 'csrf' }, 'overview', '<h1>Test</h1>');
    const nav = /<nav class="adminnav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    expect([...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1]?.replace('&amp;', '&'))).toEqual([
      'Übersicht', 'Bestellungen', 'Produktion', 'Angebot', 'Kunden', 'Einstellungen',
    ]);
    for (const href of ['/admin', '/admin/orders', '/admin/production', '/admin/catalog', '/admin/customers', '/admin/settings']) {
      expect(nav).toContain(`href="${href}"`);
    }
    expect(nav).not.toContain('verknüpfen');
  });

  it.each(AREAS)('markiert in %s genau einen Bereich als aktiv', (area) => {
    const html = renderAdminShell('Test', { loginIdentifier: 'admin@example.test', csrfToken: 'csrf' }, area, '');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(`adminseite--${area}`);
  });

  it('gibt dem Operator-Shell eine getrennte Identitätszone', () => {
    const html = renderAdminShell('Test', { loginIdentifier: 'admin@example.test', csrfToken: 'csrf' }, 'overview', '');
    expect(html).toContain('admin-shell');
    expect(html).toContain('class="adminkopf__meta"');
  });
});
