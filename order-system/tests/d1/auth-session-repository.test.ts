import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateSessionToken } from '../../src/infrastructure/auth/session-token';
import {
  createSession,
  findValidSession,
  revokeAllSessionsOfAccount,
  revokeSession,
} from '../../src/infrastructure/d1/auth-session-repository';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);

async function seedKonto(id: number, role: 'customer' | 'admin'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pbkdf2-sha256', 600000, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      `konto${id}`,
      role,
      role === 'customer' ? 1 : null,
      'a'.repeat(32),
      'b'.repeat(64),
      NOW_ISO,
      NOW_ISO,
    )
    .run();
}

beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                            is_active, default_fulfillment, created_at, updated_at)
     VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
  )
    .bind(NOW_ISO)
    .run();

  await seedKonto(1, 'customer');
  await seedKonto(2, 'admin');
});

describe('createSession', () => {
  it('liefert einen Sitzungstoken und einen CSRF-Token', async () => {
    const { token, csrfToken } = await createSession(env.DB, 1, 'customer', NOW);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(csrfToken);
  });

  /**
   * DER TEST DIESER DATEI.
   *
   * Gelesen wird die gesamte Tabelle, alle Spalten, als eine Zeichenkette —
   * und darin darf der Rohtoken nirgends vorkommen. Ein Test, der nur
   * `token_hash` prüft, übersähe eine versehentlich hinzugefügte Spalte.
   */
  it('speichert den Rohtoken nirgends in D1', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);

    const { results } = await env.DB.prepare('SELECT * FROM auth_sessions').all();
    const alles = JSON.stringify(results);

    expect(alles).not.toContain(token);
    expect(alles).not.toContain(token.slice(0, 16));
  });

  it('speichert stattdessen den SHA-256-Hash', async () => {
    await createSession(env.DB, 1, 'customer', NOW);

    const row = await env.DB.prepare('SELECT token_hash FROM auth_sessions').first<{
      token_hash: string;
    }>();

    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gibt einer Kundensitzung 30 Tage', async () => {
    await createSession(env.DB, 1, 'customer', NOW);

    const row = await env.DB.prepare('SELECT expires_at FROM auth_sessions').first<{
      expires_at: string;
    }>();

    expect(row?.expires_at).toBe('2026-09-23T07:00:00.000Z');
  });

  it('gibt einer Adminsitzung 12 Stunden', async () => {
    await createSession(env.DB, 2, 'admin', NOW);

    const row = await env.DB.prepare('SELECT expires_at FROM auth_sessions').first<{
      expires_at: string;
    }>();

    expect(row?.expires_at).toBe('2026-08-24T19:00:00.000Z');
  });

  it('erzeugt für jede Anmeldung eine neue Sitzung', async () => {
    const a = await createSession(env.DB, 1, 'customer', NOW);
    const b = await createSession(env.DB, 1, 'customer', NOW);

    expect(a.token).not.toBe(b.token);
    expect(a.csrfToken).not.toBe(b.csrfToken);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>();
    expect(row?.n).toBe(2);
  });
});

describe('findValidSession', () => {
  it('findet die eben erzeugte Sitzung', async () => {
    const { token, csrfToken } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    expect(sitzung).not.toBeNull();
    expect(sitzung?.accountId).toBe(1);
    expect(sitzung?.csrfToken).toBe(csrfToken);
    expect(sitzung?.expiresAt).toBe('2026-09-23T07:00:00.000Z');
  });

  it('liefert null für einen unbekannten Token', async () => {
    await createSession(env.DB, 1, 'customer', NOW);
    expect(await findValidSession(env.DB, generateSessionToken(), NOW)).toBeNull();
  });

  it('liefert null für null', async () => {
    expect(await findValidSession(env.DB, null, NOW)).toBeNull();
  });

  /**
   * Was die Form verfehlt, kann in der Tabelle nicht stehen. Die Anfrage zu
   * stellen wäre Arbeit für ein sicheres Nein — und hashSessionToken würde
   * für einen kaputten Wert ohnehin werfen.
   */
  it('liefert null für einen formal ungültigen Token, ohne zu werfen', async () => {
    for (const kaputt of ['', 'zu-kurz', 'a'.repeat(43) + '!', 'a'.repeat(200)]) {
      expect(await findValidSession(env.DB, kaputt, NOW)).toBeNull();
    }
  });

  it('lehnt eine abgelaufene Sitzung ab', async () => {
    const { token } = await createSession(env.DB, 2, 'admin', NOW);

    // Eine Minute nach Ablauf der 12 Stunden.
    const spaeter = new Date('2026-08-24T19:01:00.000Z');
    expect(await findValidSession(env.DB, token, spaeter)).toBeNull();
  });

  it('nimmt eine Sitzung eine Sekunde vor Ablauf noch an', async () => {
    const { token } = await createSession(env.DB, 2, 'admin', NOW);

    const knapp = new Date('2026-08-24T18:59:59.000Z');
    expect(await findValidSession(env.DB, token, knapp)).not.toBeNull();
  });

  it('lehnt eine widerrufene Sitzung ab', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    await revokeSession(env.DB, sitzung?.id ?? 0, NOW);

    expect(await findValidSession(env.DB, token, NOW)).toBeNull();
  });
});

describe('revokeSession', () => {
  it('macht genau diese Sitzung ungültig', async () => {
    const a = await createSession(env.DB, 1, 'customer', NOW);
    const b = await createSession(env.DB, 1, 'customer', NOW);
    const sitzungA = await findValidSession(env.DB, a.token, NOW);

    await revokeSession(env.DB, sitzungA?.id ?? 0, NOW);

    expect(await findValidSession(env.DB, a.token, NOW)).toBeNull();
    expect(await findValidSession(env.DB, b.token, NOW)).not.toBeNull();
  });

  /**
   * Der Widerruf ist der wirksame Teil des Abmeldens. Die Zeile bleibt stehen
   * und trägt den Zeitpunkt — ein Widerruf ohne Beleg wäre eine Behauptung,
   * und dieselbe Regel gilt schon für customer_access_tokens.
   */
  it('hält den Widerrufszeitpunkt fest', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    await revokeSession(env.DB, sitzung?.id ?? 0, NOW);

    const row = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE id = ?')
      .bind(sitzung?.id ?? 0)
      .first<{ revoked_at: string | null }>();

    expect(row?.revoked_at).toBe(NOW_ISO);
  });

  it('widerruft eine bereits widerrufene Sitzung nicht ein zweites Mal', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    await revokeSession(env.DB, sitzung?.id ?? 0, NOW);
    await revokeSession(env.DB, sitzung?.id ?? 0, new Date('2026-08-24T08:00:00.000Z'));

    const row = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE id = ?')
      .bind(sitzung?.id ?? 0)
      .first<{ revoked_at: string | null }>();

    expect(row?.revoked_at).toBe(NOW_ISO);
  });
});

describe('revokeAllSessionsOfAccount', () => {
  /**
   * Der Schutz gegen Session Fixation: Beim Anmelden werden alle vorhandenen
   * Sitzungen des Kontos widerrufen, bevor eine neue entsteht. Eine
   * mitgeschickte Sitzung wird damit nie übernommen.
   */
  it('widerruft alle Sitzungen eines Kontos', async () => {
    const a = await createSession(env.DB, 1, 'customer', NOW);
    const b = await createSession(env.DB, 1, 'customer', NOW);
    const fremd = await createSession(env.DB, 2, 'admin', NOW);

    await revokeAllSessionsOfAccount(env.DB, 1, NOW);

    expect(await findValidSession(env.DB, a.token, NOW)).toBeNull();
    expect(await findValidSession(env.DB, b.token, NOW)).toBeNull();
    expect(await findValidSession(env.DB, fremd.token, NOW)).not.toBeNull();
  });

  it('ist bei einem Konto ohne Sitzungen wirkungslos', async () => {
    await expect(revokeAllSessionsOfAccount(env.DB, 2, NOW)).resolves.toBeUndefined();
  });
});

describe('Verschwiegenheit', () => {
  it('gibt keine Felder heraus, die niemand braucht', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    expect(Object.keys(sitzung ?? {}).sort()).toEqual([
      'accountId',
      'csrfToken',
      'expiresAt',
      'id',
    ]);
  });

  it('gibt den Tokenhash nicht heraus', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);

    expect(JSON.stringify(sitzung)).not.toContain('token_hash');
    expect(JSON.stringify(sitzung)).not.toContain(token);
  });
});
