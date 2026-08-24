import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateRequest } from '../../src/application/authenticate-request';
import { createSession, revokeSession } from '../../src/infrastructure/d1/auth-session-repository';
import { findValidSession } from '../../src/infrastructure/d1/auth-session-repository';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);

async function seedKonto(id: number, role: 'customer' | 'admin', customerId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pbkdf2-sha256', 600000, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(id, `konto${id}`, role, customerId, 'a'.repeat(32), 'b'.repeat(64), NOW_ISO, NOW_ISO)
    .run();
}

beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, contact_person, email, phone, delivery_street,
                              delivery_postal_code, delivery_city, is_active, default_fulfillment,
                              internal_note, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'Beispielperson', 'geheim@example.org', '0211 1234567',
               'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
               'Interner Hinweis — darf nirgends auftauchen', ?1, ?1)`,
    ).bind(NOW_ISO),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Zweites Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(NOW_ISO),
  ]);

  await seedKonto(1, 'customer', 1);
  await seedKonto(2, 'admin', null);
  await seedKonto(3, 'customer', 2);
});

describe('authenticateRequest — gültige Sitzung', () => {
  it('liefert für ein Café den Kontext mit dem eigenen Kunden', async () => {
    const { token, csrfToken } = await createSession(env.DB, 1, 'customer', NOW);
    const kontext = await authenticateRequest(env.DB, token, NOW);

    expect(kontext?.role).toBe('customer');
    expect(kontext?.accountId).toBe(1);
    expect(kontext?.csrfToken).toBe(csrfToken);
    expect(kontext?.role === 'customer' ? kontext.customer.id : null).toBe(1);
    expect(kontext?.role === 'customer' ? kontext.customer.name : null).toBe('Testcafé Nord');
  });

  it('liefert für einen Admin einen Kontext ohne Kunden', async () => {
    const { token } = await createSession(env.DB, 2, 'admin', NOW);
    const kontext = await authenticateRequest(env.DB, token, NOW);

    expect(kontext?.role).toBe('admin');
    expect(kontext).not.toHaveProperty('customer');
  });

  /**
   * Der Kunde kommt aus der SITZUNG, nicht aus einer Anfrage. Zwei Cafés mit
   * je eigener Sitzung bekommen je ihren eigenen Kontext — es gibt keinen
   * Parameter, über den sich das beeinflussen ließe.
   */
  it('gibt jedem Café seinen eigenen Kunden', async () => {
    const eins = await createSession(env.DB, 1, 'customer', NOW);
    const zwei = await createSession(env.DB, 3, 'customer', NOW);

    const kontextEins = await authenticateRequest(env.DB, eins.token, NOW);
    const kontextZwei = await authenticateRequest(env.DB, zwei.token, NOW);

    expect(kontextEins?.role === 'customer' ? kontextEins.customer.id : null).toBe(1);
    expect(kontextZwei?.role === 'customer' ? kontextZwei.customer.id : null).toBe(2);
  });
});

describe('authenticateRequest — Ablehnung', () => {
  it('lehnt eine fehlende Sitzung ab', async () => {
    expect(await authenticateRequest(env.DB, null, NOW)).toBeNull();
    expect(await authenticateRequest(env.DB, '', NOW)).toBeNull();
  });

  it('lehnt einen unbekannten Token ab', async () => {
    expect(await authenticateRequest(env.DB, 'x'.repeat(43), NOW)).toBeNull();
  });

  it('lehnt einen formal ungültigen Token ab, ohne zu werfen', async () => {
    for (const kaputt of ['zu-kurz', 'a'.repeat(43) + '!', 'a'.repeat(500)]) {
      expect(await authenticateRequest(env.DB, kaputt, NOW)).toBeNull();
    }
  });

  it('lehnt eine abgelaufene Sitzung ab', async () => {
    const { token } = await createSession(env.DB, 2, 'admin', NOW);
    expect(await authenticateRequest(env.DB, token, new Date('2026-08-24T19:01:00.000Z'))).toBeNull();
  });

  it('lehnt eine widerrufene Sitzung ab', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const sitzung = await findValidSession(env.DB, token, NOW);
    await revokeSession(env.DB, sitzung?.id ?? 0, NOW);

    expect(await authenticateRequest(env.DB, token, NOW)).toBeNull();
  });

  /**
   * DER KERNTEST DIESER DATEI: Ein Sitzungstoken ist KEIN Dauerausweis.
   *
   * Wird ein Konto deaktiviert, endet der Zugriff beim nächsten Request — und
   * nicht erst in 30 Tagen, wenn die Sitzung von selbst abläuft.
   */
  it('lehnt ab, sobald das Konto deaktiviert wird', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    expect(await authenticateRequest(env.DB, token, NOW)).not.toBeNull();

    await env.DB.prepare('UPDATE auth_accounts SET is_active = 0 WHERE id = 1').run();

    expect(await authenticateRequest(env.DB, token, NOW)).toBeNull();
  });

  it('lehnt ab, sobald das Café deaktiviert wird', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    expect(await authenticateRequest(env.DB, token, NOW)).not.toBeNull();

    await env.DB.prepare('UPDATE customers SET is_active = 0 WHERE id = 1').run();

    expect(await authenticateRequest(env.DB, token, NOW)).toBeNull();
  });

  it('lehnt ab, wenn das Konto gelöscht wurde', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    await env.DB.prepare('DELETE FROM auth_accounts WHERE id = 1').run();

    expect(await authenticateRequest(env.DB, token, NOW)).toBeNull();
  });
});

describe('authenticateRequest — Verschwiegenheit', () => {
  it('enthält weder Hash noch Salt noch Rohtoken', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const kontext = await authenticateRequest(env.DB, token, NOW);

    const serialisiert = JSON.stringify(kontext);
    expect(serialisiert).not.toContain(token);
    expect(serialisiert).not.toContain('a'.repeat(32));
    expect(serialisiert).not.toContain('b'.repeat(64));
    expect(serialisiert).not.toContain('credential');
    expect(serialisiert).not.toContain('failedAttempts');
  });

  it('trägt für ein Café genau die vier erwarteten Felder', async () => {
    const { token } = await createSession(env.DB, 1, 'customer', NOW);
    const kontext = await authenticateRequest(env.DB, token, NOW);

    expect(Object.keys(kontext ?? {}).sort()).toEqual([
      'accountId',
      'csrfToken',
      'customer',
      'role',
      'sessionId',
    ]);
  });

  it('trägt für einen Admin genau die vier erwarteten Felder', async () => {
    const { token } = await createSession(env.DB, 2, 'admin', NOW);
    const kontext = await authenticateRequest(env.DB, token, NOW);

    expect(Object.keys(kontext ?? {}).sort()).toEqual([
      'accountId',
      'csrfToken',
      'role',
      'sessionId',
    ]);
  });
});
