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

  /**
   * Seit Phase 2 gibt es die Bestell-API. Sie bleibt ohne Zugangstoken
   * verschlossen — und der Aufrufer erfährt dabei nicht, ob es das Café gibt.
   * Der vollständige Endpunkt wird in tests/http/order-api.test.ts geprüft.
   */
  /**
   * Ohne Origin-Kopfzeile schlägt schon die erste Prüfung an — noch vor der
   * Sitzung. Das ist Absicht: Eine fremd ausgelöste Anfrage soll gar nicht
   * erst zu einem Datenbankzugriff führen.
   */
  it('lehnt die Bestell-API ohne Origin mit 403 ab', async () => {
    const response = await worker.fetch(
      new Request('https://bestellen.example/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('gibt die Bestell-API ohne Sitzung nicht frei', async () => {
    const response = await worker.fetch(
      new Request('http://127.0.0.1:8787/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:8787' },
        body: '{}',
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});
