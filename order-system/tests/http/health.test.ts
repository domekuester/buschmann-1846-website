import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/worker';

/**
 * Der Health-Endpunkt hat genau einen Zweck: nachzuweisen, dass der Worker
 * startet UND sein D1-Binding tatsächlich benutzbar ist. Er ist deshalb kein
 * Demo-Endpunkt — er ist die Prüfung, die ein späteres Deployment bestehen
 * muss, bevor irgendetwas anderes darauf aufsetzt.
 */
async function call(path: string, method = 'GET'): Promise<Response> {
  return worker.fetch(new Request(`https://bestellen.example/${path.replace(/^\//, '')}`, { method }), env);
}

describe('GET /api/health', () => {
  it('antwortet mit 200 und meldet die erreichbare Datenbank', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok', database: 'reachable' });
  });

  it('fragt die Datenbank wirklich ab', async () => {
    // Ohne echten Zugriff könnte der Endpunkt 'reachable' auch dann melden,
    // wenn das Binding fehlt. Eine Abfrage auf eine Tabelle, die es nur nach
    // erfolgreicher Migration gibt, schließt das aus.
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'`,
    ).all<{ name: string }>();
    expect(results).toHaveLength(1);

    expect((await call('/api/health')).status).toBe(200);
  });
});

describe('Routing', () => {
  it('antwortet auf unbekannte Pfade mit 404', async () => {
    const response = await call('/gibt-es-nicht');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('antwortet auf ein falsches Verfahren mit 405', async () => {
    const response = await call('/api/health', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  /** In Phase 1 gibt es bewusst noch keine Bestell-API. */
  it('kennt noch keine Bestell-Endpunkte', async () => {
    expect((await call('/api/orders', 'POST')).status).toBe(404);
  });
});
