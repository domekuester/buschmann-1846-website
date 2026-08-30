import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { PUBLIC_REQUEST_LIMITS } from '../../src/application/public-request-rate-limit';

const ORIGIN = 'http://127.0.0.1:8787';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const environment = (): Env => ({
  ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development',
});

const validFields = (overrides: Record<string, string> = {}): URLSearchParams => new URLSearchParams({
  name: '  Fiktive Konditorei  ',
  contact_person: '  Erika Beispiel ',
  email: ' ANFRAGE@EXAMPLE.TEST ',
  phone: ' 0211 123456 ',
  street: ' Teststraße 1 ',
  postal_code: ' 40213 ',
  city: ' Düsseldorf ',
  message: ' Bitte melden Sie sich. ',
  website: '',
  ...overrides,
});

async function call(
  method: 'GET' | 'POST',
  body?: string,
  origin: string | null = ORIGIN,
  contentType = 'application/x-www-form-urlencoded',
  connectingIp: string | null = '203.0.113.40',
): Promise<Response> {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', contentType);
  if (connectingIp !== null) headers.set('cf-connecting-ip', connectingIp);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return worker.fetch(new Request(`${ORIGIN}/konto-anfragen`, init), environment());
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM public_request_rate_limits').run();
  await env.DB.prepare('DELETE FROM customer_account_requests').run();
});

describe('öffentliche Kundenkonto-Anfrage', () => {
  it('rendert das öffentliche Formular ohne Anmeldung', async () => {
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Kundenkonto anfragen');
  });

  it('persistiert normalisierte Angaben und keine öffentliche Preisautorität', async () => {
    const body = validFields({ price_group: 'gastro', fulfillment: 'delivery', price_cents: '1' });
    const response = await call('POST', body.toString());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/konto-anfragen?status=eingegangen');
    expect(await env.DB.prepare(
      `SELECT name, contact_person, email, email_normalized, phone, street,
              postal_code, city, message, status
         FROM customer_account_requests`,
    ).first()).toEqual({
      name: 'Fiktive Konditorei', contact_person: 'Erika Beispiel',
      email: 'anfrage@example.test', email_normalized: 'anfrage@example.test',
      phone: '0211 123456', street: 'Teststraße 1', postal_code: '40213',
      city: 'Düsseldorf', message: 'Bitte melden Sie sich.', status: 'pending',
    });
  });

  it('zeigt Pflicht-, E-Mail- und Längenfehler ohne Write', async () => {
    for (const fields of [
      validFields({ name: '' }),
      validFields({ email: 'keine-adresse' }),
      validFields({ message: 'x'.repeat(1001) }),
    ]) {
      const response = await call('POST', fields.toString());
      expect(response.status).toBe(422);
      expect(await response.text()).toContain('Die Anfrage wurde noch nicht gesendet');
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_account_requests').first()).toEqual({ n: 0 });
  });

  it('behandelt eine doppelte offene normalisierte E-Mail neutral wie Erfolg', async () => {
    const first = await call('POST', validFields().toString());
    const duplicate = await call('POST', validFields({ name: 'Anderer Name' }).toString());
    expect(duplicate.status).toBe(first.status);
    expect(duplicate.headers.get('location')).toBe(first.headers.get('location'));
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_account_requests').first()).toEqual({ n: 1 });
  });

  it('nimmt Honeypot-Treffer neutral an, schreibt sie aber nicht', async () => {
    const response = await call('POST', validFields({ website: 'https://spam.test' }).toString());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/konto-anfragen?status=eingegangen');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_account_requests').first()).toEqual({ n: 0 });
  });

  it('verlangt First-Party-Origin und Form-Content-Type', async () => {
    expect((await call('POST', validFields().toString(), 'https://angreifer.test')).status).toBe(403);
    expect((await call('POST', '{}', ORIGIN, 'application/json')).status).toBe(415);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_account_requests').first()).toEqual({ n: 0 });
  });

  it('weist einen übergroßen Request-Körper ab', async () => {
    const response = await call('POST', `name=${'x'.repeat(13 * 1024)}`);
    expect(response.status).toBe(413);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customer_account_requests').first()).toEqual({ n: 0 });
  });

  it('begrenzt Anfragen nach der zentralen Schwelle mit neutraler Antwort', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.accountRequest;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      const response = await call('POST', validFields({
        email: `anfrage-${attempt}@example.test`,
      }).toString());
      expect(response.status).toBe(303);
    }

    const limited = await call('POST', validFields({ email: 'noch-eine@example.test' }).toString());
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain('Bitte versuche es später erneut.');
    expect(await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM customer_account_requests',
    ).first()).toEqual({ n: policy.maxRequests });
  });

  it('isoliert normale Anfragen unterschiedlicher Clients', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.accountRequest;
    for (let attempt = 0; attempt <= policy.maxRequests; attempt += 1) {
      await call('POST', validFields({ email: `client-a-${attempt}@example.test` }).toString(), ORIGIN,
        'application/x-www-form-urlencoded', '203.0.113.50');
    }

    const other = await call('POST', validFields({ email: 'client-b@example.test' }).toString(), ORIGIN,
      'application/x-www-form-urlencoded', '203.0.113.51');
    expect(other.status).toBe(303);
  });

  it('liefert den neutralen Erfolgszustand nur für den festen Statuscode', async () => {
    const success = await worker.fetch(new Request(`${ORIGIN}/konto-anfragen?status=eingegangen`), environment());
    const invented = await worker.fetch(new Request(`${ORIGIN}/konto-anfragen?status=<script>`), environment());
    const successHtml = await success.text();
    const inventedHtml = await invented.text();
    expect(successHtml).toContain('<h1>Vielen Dank.</h1>');
    expect(successHtml).toContain('Ihre Kundenanfrage ist bei Buschmann eingegangen.');
    expect(inventedHtml).not.toContain('<script>');
    expect(inventedHtml).not.toContain('Vielen Dank.');
  });
});
