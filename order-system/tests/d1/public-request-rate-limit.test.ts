import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PUBLIC_REQUEST_LIMITS,
  consumePublicRequestLimit,
} from '../../src/application/public-request-rate-limit';

const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = new Date('2026-08-30T10:05:00.000Z');

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM public_request_rate_limits').run();
});

describe('consumePublicRequestLimit', () => {
  it('lässt normale Nutzung bis einschließlich der zentralen Schwelle zu', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.accountRequest;
    for (let attempt = 1; attempt <= policy.maxRequests; attempt += 1) {
      const result = await consumePublicRequestLimit(
        env.DB, PEPPER, '203.0.113.10', policy, NOW,
      );
      expect(result.allowed).toBe(true);
    }

    expect((await consumePublicRequestLimit(
      env.DB, PEPPER, '203.0.113.10', policy, NOW,
    )).allowed).toBe(false);
  });

  it('isoliert unterschiedliche Client-Identitäten', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.accountRequest;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      await consumePublicRequestLimit(env.DB, PEPPER, '203.0.113.10', policy, NOW);
    }

    expect((await consumePublicRequestLimit(
      env.DB, PEPPER, '203.0.113.11', policy, NOW,
    )).allowed).toBe(true);
  });

  it('speichert ausschließlich eine HMAC-Identität und niemals die rohe IP', async () => {
    await consumePublicRequestLimit(
      env.DB, PEPPER, '203.0.113.10', PUBLIC_REQUEST_LIMITS.login, NOW,
    );

    const row = await env.DB.prepare(
      'SELECT bucket_key, scope FROM public_request_rate_limits',
    ).first<{ bucket_key: string; scope: string }>();
    expect(row?.bucket_key).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.bucket_key).not.toContain('203.0.113.10');
    expect(row?.scope).toBe('login');
  });

  it('zählt parallele Zugriffe mit einem atomaren D1-Upsert genau einmal je Request', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.login;
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      consumePublicRequestLimit(env.DB, PEPPER, '2001:db8::1', policy, NOW),
    ));

    expect(results.every((result) => result.allowed)).toBe(true);
    expect(await env.DB.prepare(
      'SELECT request_count FROM public_request_rate_limits',
    ).first()).toEqual({ request_count: 8 });
  });

  it('beginnt nach Ablauf des zentral konfigurierten Fensters wieder bei eins', async () => {
    const policy = PUBLIC_REQUEST_LIMITS.accountRequest;
    for (let attempt = 0; attempt <= policy.maxRequests; attempt += 1) {
      await consumePublicRequestLimit(env.DB, PEPPER, null, policy, NOW);
    }
    const later = new Date(NOW.getTime() + policy.windowSeconds * 1000);

    expect((await consumePublicRequestLimit(env.DB, PEPPER, null, policy, later)).allowed).toBe(true);
    expect(await env.DB.prepare(
      'SELECT request_count FROM public_request_rate_limits',
    ).first()).toEqual({ request_count: 1 });
  });
});
