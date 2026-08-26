import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { loadOrderPolicy } from '../../src/infrastructure/d1/order-policy-repository';

/**
 * Die Bestellregeln an der HTTP-Grenze — Seite und Schreibvorgang.
 *
 * DER SCHREIBVORGANG IST DER FÜNFTE SEINER ART und wird deshalb gegen
 * dieselben vier Prüfungen gehalten wie die vier davor: Origin, Rolle,
 * CSRF-Token, Anfrageform. Eine Regel, die jeder ändern kann, ist keine.
 *
 * UND ER DARF KEINE BESTELLUNG ANFASSEN. Der letzte Block dieser Datei hält
 * fest, dass eine geänderte Regel bestehende Bestellungen nicht verschiebt,
 * nicht storniert und nicht ausblendet.
 */

const ORIGIN = 'http://127.0.0.1:8787';
const FREMD = 'https://buschmann1846.de.angreifer.test';
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const NOW = '2026-08-25T12:00:00.000Z';
const CONFIG: AppConfig = { environment: 'development', appOrigin: ORIGIN, pepper: PEPPER };
const SEITE = '/admin/bestellregeln';
const PFAD = '/api/admin/order-policy';

function environment(): Env {
  return { ...env, AUTH_PEPPER: PEPPER, APP_ORIGIN: ORIGIN, ENVIRONMENT: 'development' };
}

async function seedAccount(
  id: number,
  identifier: string,
  role: 'admin' | 'customer',
  secret: string,
): Promise<void> {
  const credential = await deriveCredential(secret, PEPPER, { iterations: MIN_ITERATIONS });
  await env.DB.prepare(
    `INSERT INTO auth_accounts
       (id, login_identifier_normalized, role, customer_id, credential_algorithm,
        credential_iterations, credential_salt, credential_verifier, is_active,
        failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  ).bind(
    id, identifier, role, role === 'customer' ? 1 : null,
    credential.algorithm, credential.iterations, credential.saltHex,
    credential.verifierHex, NOW, NOW,
  ).run();
}

interface Sitzung {
  readonly cookie: string;
  readonly csrf: string;
}

async function anmelden(identifier: string, secret: string): Promise<Sitzung> {
  const result = await logIn(env.DB, CONFIG, {
    identifier, secret, now: new Date(), existingSessionToken: null,
  });
  if (!result) throw new Error('Testlogin fehlgeschlagen');
  const row = await env.DB.prepare(
    'SELECT csrf_token FROM auth_sessions ORDER BY id DESC LIMIT 1',
  ).first<{ csrf_token: string }>();
  if (!row) throw new Error('Sitzung fehlt');
  return { cookie: `buschmann_session_dev=${result.token}`, csrf: row.csrf_token };
}

const admin = () => anmelden('admin@example.test', 'fiktives-admin-passwort-123');
const kunde = () => anmelden('testcafe', 'fiktive-kunden-pin-123');

async function get(path: string, cookie: string | null = null): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie) headers.set('cookie', cookie);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), environment());
}

interface PostOptions {
  readonly cookie?: string | null;
  readonly origin?: string | null;
  readonly body?: string;
  readonly contentType?: string | null;
  readonly method?: string;
}

async function post(options: PostOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/x-www-form-urlencoded');
  }

  const method = options.method ?? 'POST';
  return worker.fetch(new Request(`${ORIGIN}${PFAD}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.body ?? '' }),
  }), environment());
}

/** Ein vollständiges, gültiges Formular. */
function formular(csrf: string, overrides: Record<string, string | string[]> = {}): string {
  const felder = new URLSearchParams();
  felder.set('csrf_token', csrf);

  const tage = overrides['weekday'] ?? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  for (const tag of Array.isArray(tage) ? tage : [tage]) {
    felder.append('weekday', tag);
  }

  for (const [name, wert] of Object.entries(overrides)) {
    if (name === 'weekday') continue;
    for (const einzeln of Array.isArray(wert) ? wert : [wert]) {
      felder.append(name, einzeln);
    }
  }

  if (!('lead_days' in overrides)) felder.set('lead_days', '1');
  if (!('cutoff_time' in overrides)) felder.set('cutoff_time', '12:00');

  return felder.toString();
}

async function gespeichert() {
  return (await loadOrderPolicy(env.DB)).policy;
}

beforeEach(async () => {
  for (const table of ['order_items', 'orders', 'auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare('DELETE FROM order_policy').run();
  await env.DB.prepare('INSERT INTO order_policy (id) VALUES (1)').run();

  await env.DB.prepare(
    `INSERT INTO customers (id, name, is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Fiktives Café Nord', 1, 'pickup', ?, ?)`,
  ).bind(NOW, NOW).run();

  await seedAccount(1, 'admin@example.test', 'admin', 'fiktives-admin-passwort-123');
  await seedAccount(2, 'testcafe', 'customer', 'fiktive-kunden-pin-123');
});

describe('GET /admin/bestellregeln', () => {
  /** §19.15 */
  it('zeigt einem Admin die geltende Regel', async () => {
    const response = await get(SEITE, (await admin()).cookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Bestellregeln');
    expect(html).toContain('Bestelltage');
    expect(html).toContain('Bestellschluss');
    for (const tag of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']) {
      expect(html).toContain(tag);
    }
  });

  it('hakt nach der Migration alle sieben Tage an und den Bestellschluss nicht', async () => {
    const html = await (await get(SEITE, (await admin()).cookie)).text();

    for (const key of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      expect(html).toContain(`value="${key}" checked`);
    }
    expect(html).toContain('name="cutoff_enabled" value="1">');
    expect(html).toContain('Es gibt zurzeit keinen Bestellschluss.');
    expect(html).toContain('Noch nie geändert.');
  });

  /** §7 — kein Fachjargon auf der Seite. */
  it('spricht keine Fachsprache', async () => {
    const html = await (await get(SEITE, (await admin()).cookie)).text();
    const sichtbar = html.replace(/<[^>]*>/g, ' ');

    for (const wort of ['lead_days', 'Policy', 'policy', 'Cutoff', 'cutoff', 'enforcement', '422']) {
      expect(sichtbar).not.toContain(wort);
    }
  });

  it('erklärt eine aktive Regel an einem echten Datum', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: formular(csrf, { cutoff_enabled: '1', lead_days: '1', cutoff_time: '12:00' }) });

    const html = await (await get(SEITE, cookie)).text();
    expect(html).toContain('Beispiel:');
    expect(html).toMatch(/Für \w+, \d+\. \w+ endet die Bestellung am \w+, \d+\. \w+ um 12:00 Uhr\./);
  });

  /** §19.16 */
  it('verweigert einem Customer den Zugriff', async () => {
    const response = await get(SEITE, (await kunde()).cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Bestelltage');
  });

  /** §19.17 */
  it('schickt unauthenticated über den First-Party-Loginflow', async () => {
    const response = await get(SEITE);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  /** §19.24 */
  it('behält no-store und die bestehenden Security Header', async () => {
    const response = await get(SEITE, (await admin()).cookie);

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('spiegelt einen erfundenen Rückmeldungscode nicht in die Seite', async () => {
    const html = await (await get(
      `${SEITE}?notice=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
      (await admin()).cookie,
    )).text();

    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('role="status"');
  });

  it('existiert nur als GET', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}${SEITE}`, {
      method: 'POST', headers: { origin: ORIGIN, cookie: (await admin()).cookie },
    }), environment());

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('steht in der Navigation jeder Adminseite', async () => {
    const cookie = (await admin()).cookie;
    for (const pfad of [SEITE, '/admin', '/admin/customers', '/admin/catalog']) {
      expect(await (await get(pfad, cookie)).text()).toContain('href="/admin/bestellregeln"');
    }
  });
});

describe('POST /api/admin/order-policy', () => {
  /** §19.18 */
  it('speichert eine vollständige Regel und leitet zurück', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: formular(csrf, {
        weekday: ['tuesday', 'friday'],
        cutoff_enabled: '1',
        lead_days: '2',
        cutoff_time: '09:30',
      }),
    });

    /** §19.23 — PRG: 303 und ein Ziel aus dem Quelltext. */
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=saved');
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(await gespeichert()).toEqual({
      weekdays: [false, true, false, false, true, false, false],
      cutoffEnabled: true,
      leadDays: 2,
      cutoffTime: '09:30',
    });
  });

  it('schaltet den Bestellschluss ohne Haken wieder ab', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: formular(csrf, { cutoff_enabled: '1' }) });
    expect((await gespeichert()).cutoffEnabled).toBe(true);

    await post({ cookie, body: formular(csrf) });
    expect((await gespeichert()).cutoffEnabled).toBe(false);
  });

  it('schaltet einen zuvor erlaubten Wochentag ab', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: formular(csrf, { weekday: ['monday'] }) });

    expect((await gespeichert()).weekdays).toEqual([true, false, false, false, false, false, false]);
  });

  it('merkt sich, wann zuletzt gespeichert wurde', async () => {
    const { cookie, csrf } = await admin();
    await post({ cookie, body: formular(csrf) });

    const { updatedAt } = await loadOrderPolicy(env.DB);
    expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  /** §8 — mindestens ein Produktionstag. */
  it('lehnt ein Formular ohne jeden Bestelltag ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      body: new URLSearchParams({ csrf_token: csrf, lead_days: '1', cutoff_time: '12:00' }).toString(),
    });

    expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=no_day');
    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  /** §19.19 */
  it('lehnt einen unmöglichen Vorlauf ab und speichert nichts', async () => {
    const { cookie, csrf } = await admin();

    for (const wert of ['31', '-1', '1.5', '1e1', ' 1', 'zwei', '', '999']) {
      const response = await post({ cookie, body: formular(csrf, { lead_days: wert }) });
      expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid_lead_days');
    }

    expect((await gespeichert()).leadDays).toBe(1);
  });

  it('nimmt die Grenzen des Vorlaufs an', async () => {
    const { cookie, csrf } = await admin();

    for (const wert of ['0', '30']) {
      await post({ cookie, body: formular(csrf, { lead_days: wert }) });
      expect((await gespeichert()).leadDays).toBe(Number(wert));
    }
  });

  /** §19.20 */
  it('lehnt eine unmögliche Uhrzeit ab und speichert nichts', async () => {
    const { cookie, csrf } = await admin();

    for (const wert of ['24:00', '12:60', '29:71', '9:00', '12:0', '12:00:00', 'mittags', '']) {
      const response = await post({ cookie, body: formular(csrf, { cutoff_time: wert }) });
      expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid_cutoff_time');
    }

    expect((await gespeichert()).cutoffTime).toBe('12:00');
  });

  it('lehnt einen erfundenen Wochentag ab, statt ihn zu übergehen', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: formular(csrf, { weekday: ['monday', 'Montag'] }) });

    expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid');
    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  it('lehnt einen doppelten Wochentag ab', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({ cookie, body: formular(csrf, { weekday: ['monday', 'monday'] }) });

    expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid');
  });

  it('lehnt mehrfache Felder ab, statt still das erste zu nehmen', async () => {
    const { cookie, csrf } = await admin();

    for (const overrides of [
      { lead_days: ['1', '5'] },
      { cutoff_time: ['12:00', '06:00'] },
      { cutoff_enabled: ['1', '1'] },
    ]) {
      const response = await post({ cookie, body: formular(csrf, overrides) });
      expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid');
    }
  });

  it('nimmt für den Schalter nur den einen vorgesehenen Wert', async () => {
    const { cookie, csrf } = await admin();

    for (const wert of ['on', 'true', '0', 'ja']) {
      const response = await post({ cookie, body: formular(csrf, { cutoff_enabled: wert }) });
      expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=invalid');
    }
    expect((await gespeichert()).cutoffEnabled).toBe(false);
  });

  it('übernimmt keine unbekannten Felder', async () => {
    const { cookie, csrf } = await admin();
    const felder = new URLSearchParams(formular(csrf));
    felder.set('id', '2');
    felder.set('updated_at', '1999-01-01T00:00:00.000Z');
    felder.set('role', 'admin');

    await post({ cookie, body: felder.toString() });

    const anzahl = await env.DB.prepare('SELECT COUNT(*) AS anzahl FROM order_policy')
      .first<{ anzahl: number }>();
    expect(anzahl?.anzahl).toBe(1);
    expect((await loadOrderPolicy(env.DB)).updatedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  /** §19.21 — CSRF. */
  it('lehnt ohne und mit falschem CSRF-Token ab', async () => {
    const { cookie, csrf } = await admin();

    const ohne = await post({
      cookie,
      body: new URLSearchParams({ weekday: 'monday', lead_days: '1', cutoff_time: '12:00' }).toString(),
    });
    expect(ohne.status).toBe(403);

    const falsch = await post({
      cookie,
      body: formular(`${csrf}x`, { weekday: ['monday'] }),
    });
    expect(falsch.status).toBe(403);

    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  /** §19.22 — Origin. */
  it('lehnt einen fremden und einen fehlenden Origin ab', async () => {
    const { cookie, csrf } = await admin();

    for (const origin of [FREMD, null]) {
      const response = await post({ cookie, origin, body: formular(csrf, { weekday: ['monday'] }) });
      expect(response.status).toBe(403);
    }

    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  it('verweigert einem Customer den Schreibvorgang', async () => {
    const { cookie, csrf } = await kunde();
    const response = await post({ cookie, body: formular(csrf, { weekday: ['monday'] }) });

    expect(response.status).toBe(403);
    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  it('schickt unauthenticated über den Loginflow und speichert nichts', async () => {
    const response = await post({ body: formular('egal', { weekday: ['monday'] }) });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect((await gespeichert()).weekdays).toEqual([true, true, true, true, true, true, true]);
  });

  it('nimmt nur ein Formular an', async () => {
    const { cookie, csrf } = await admin();
    const response = await post({
      cookie,
      contentType: 'application/json',
      body: JSON.stringify({ csrf_token: csrf, weekday: ['monday'] }),
    });

    expect(response.status).toBe(415);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('existiert nur als POST', async () => {
    const response = await post({ cookie: (await admin()).cookie, method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  /**
   * KEIN USER-CONTROLLED REDIRECT. Es gibt in diesem Endpunkt kein Feld für
   * ein Rückkehrziel — und deshalb auch nichts, das eine Allowlist prüfen
   * müsste.
   */
  it('leitet ausschließlich auf die eigene Regelseite', async () => {
    const { cookie, csrf } = await admin();
    const felder = new URLSearchParams(formular(csrf));
    felder.set('next', 'https://angreifer.test/');
    felder.set('redirect', 'https://angreifer.test/');

    const response = await post({ cookie, body: felder.toString() });
    expect(response.headers.get('location')).toBe('/admin/bestellregeln?notice=saved');
  });
});

/**
 * §12 — BESTEHENDE BESTELLUNGEN BLEIBEN UNBERÜHRT.
 *
 * Das ist die Zusage, die 6F gegenüber dem Betrieb macht: Eine Regel ändern
 * heißt, ab jetzt anders anzunehmen — und nicht, rückwirkend aufzuräumen.
 */
describe('Bestehende Bestellungen', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO orders (id, order_number, customer_id, customer_name_snapshot, fulfillment_type,
                           fulfillment_date, status, total_amount_cents, created_at, updated_at)
       VALUES (1, 'BUS-2026-000001', 1, 'Fiktives Café Nord', 'pickup',
               '2026-08-30', 'new', 4350, ?, ?)`,
    ).bind(NOW, NOW).run();
  });

  it('lässt eine Bestellung für einen später gesperrten Sonntag unverändert stehen', async () => {
    const { cookie, csrf } = await admin();

    // Sonntag abschalten und einen strengen Bestellschluss setzen.
    await post({
      cookie,
      body: formular(csrf, {
        weekday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        cutoff_enabled: '1',
        lead_days: '30',
        cutoff_time: '06:00',
      }),
    });

    const row = await env.DB.prepare(
      'SELECT order_number, fulfillment_date, status, total_amount_cents FROM orders WHERE id = 1',
    ).first<Record<string, unknown>>();

    expect(row).toEqual({
      order_number: 'BUS-2026-000001',
      fulfillment_date: '2026-08-30',
      status: 'new',
      total_amount_cents: 4350,
    });
  });

  it('zeigt sie in der Produktionsansicht weiterhin an', async () => {
    const { cookie, csrf } = await admin();
    await post({
      cookie,
      body: formular(csrf, { weekday: ['monday'], cutoff_enabled: '1', lead_days: '30', cutoff_time: '06:00' }),
    });

    const html = await (await get('/admin?date=2026-08-30', cookie)).text();
    expect(html).toContain('BUS-2026-000001');
  });
});
