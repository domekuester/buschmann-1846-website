import { toUtcTimestamp } from '../domain/clock';

export interface PublicRequestLimitPolicy {
  readonly scope: 'login' | 'account_request';
  readonly maxRequests: number;
  readonly windowSeconds: number;
}

/**
 * Die einzigen Abuse-Schwellen des Systems. Sie stehen bewusst gemeinsam:
 * Ein späterer Betreiber sieht ohne Suche, was normale Nutzung begrenzt.
 * Login erlaubt im 15-Minuten-Fenster deutlich mehr als ein Mensch braucht;
 * Kontoanfragen sind mit fünf pro Stunde ebenfalls weit oberhalb des
 * normalen einzelnen Formularversands.
 */
export const PUBLIC_REQUEST_LIMITS = Object.freeze({
  login: Object.freeze({
    scope: 'login',
    maxRequests: 20,
    windowSeconds: 15 * 60,
  }),
  accountRequest: Object.freeze({
    scope: 'account_request',
    maxRequests: 5,
    windowSeconds: 60 * 60,
  }),
}) satisfies Readonly<Record<string, PublicRequestLimitPolicy>>;

export interface PublicRequestLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface CountRow {
  readonly request_count: number;
}

/**
 * Zählt einen öffentlichen Request atomar in D1.
 *
 * Die Identität stammt ausschließlich aus CF-Connecting-IP. Cloudflare setzt
 * diese Kopfzeile am äußeren Request; X-Forwarded-For wird absichtlich nie
 * gelesen. Lokal oder bei einer fehlenden/ungültigen Kopfzeile teilen sich
 * Requests einen fail-safe Ersatz-Bucket. Vor D1 wird die Identität mit dem
 * serverseitigen AUTH_PEPPER per HMAC pseudonymisiert. Weder IP noch Login-
 * Kennung oder E-Mail werden gespeichert.
 *
 * Grenzen: IP-basierter Schutz teilt ein Budget bei NAT und kann von
 * verteilten Angreifern über viele Adressen umgangen werden. Er ist hier eine
 * kleine zusätzliche Schranke, kein Ersatz für Cloudflare-WAF/Bot-Schutz.
 */
export async function consumePublicRequestLimit(
  db: D1Database,
  pepper: string,
  connectingIp: string | null,
  policy: PublicRequestLimitPolicy,
  now: Date,
): Promise<PublicRequestLimitResult> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const windowStartedAt = Math.floor(nowSeconds / policy.windowSeconds) * policy.windowSeconds;
  const bucketKey = await hmacBucketKey(pepper, policy.scope, normalizeConnectingIp(connectingIp));

  const row = await db.prepare(
    `INSERT INTO public_request_rate_limits
       (bucket_key, scope, window_started_at, request_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       scope = excluded.scope,
       window_started_at = excluded.window_started_at,
       request_count = CASE
         WHEN public_request_rate_limits.window_started_at = excluded.window_started_at
         THEN public_request_rate_limits.request_count + 1
         ELSE 1
       END,
       updated_at = excluded.updated_at
     RETURNING request_count`,
  ).bind(bucketKey, policy.scope, windowStartedAt, toUtcTimestamp(now)).first<CountRow>();

  if (row === null) {
    throw new Error('Der öffentliche Request-Zähler lieferte kein Ergebnis.');
  }

  return {
    allowed: row.request_count <= policy.maxRequests,
    retryAfterSeconds: Math.max(1, windowStartedAt + policy.windowSeconds - nowSeconds),
  };
}

async function hmacBucketKey(
  pepper: string,
  scope: PublicRequestLimitPolicy['scope'],
  identity: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${scope}\u0000${identity}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeConnectingIp(value: string | null): string {
  if (value === null) return 'unavailable';
  const candidate = value.trim().toLowerCase();
  if (isIpv4(candidate)) return candidate;
  if (isIpv6(candidate)) return candidate;
  return 'unavailable';
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) =>
    /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
  );
}

function isIpv6(value: string): boolean {
  if (!value.includes(':') || value.length > 45 || !/^[0-9a-f:.]+$/.test(value)) return false;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']');
  } catch {
    return false;
  }
}
