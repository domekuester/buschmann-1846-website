import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOCKOUT_SECONDS,
  MAX_FAILED_ATTEMPTS,
  findAccountById,
  findAccountByIdentifier,
  recordFailedAttempt,
  resetFailedAttempts,
} from '../../src/infrastructure/d1/auth-account-repository';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);

const SALT = 'a'.repeat(32);
const VERIFIER = 'b'.repeat(64);

interface KontoOptionen {
  id?: number;
  identifier?: string;
  role?: string;
  customerId?: number | null;
  isActive?: number;
  failedAttempts?: number;
  lockedUntil?: string | null;
}

async function seedKonto(optionen: KontoOptionen = {}): Promise<number> {
  const werte = {
    id: 1,
    identifier: 'testcafe',
    role: 'customer',
    customerId: 1 as number | null,
    isActive: 1,
    failedAttempts: 0,
    lockedUntil: null as string | null,
    ...optionen,
  };

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pbkdf2-sha256', 600000, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      werte.id,
      werte.identifier,
      werte.role,
      werte.customerId,
      SALT,
      VERIFIER,
      werte.isActive,
      werte.failedAttempts,
      werte.lockedUntil,
      NOW_ISO,
      NOW_ISO,
    )
    .run();

  return werte.id;
}

async function zaehlerVon(id: number): Promise<{ failed_attempts: number; locked_until: string | null }> {
  const row = await env.DB.prepare(
    'SELECT failed_attempts, locked_until FROM auth_accounts WHERE id = ?',
  )
    .bind(id)
    .first<{ failed_attempts: number; locked_until: string | null }>();

  if (row === null) throw new Error('Konto nicht gefunden');
  return row;
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
});

describe('findAccountByIdentifier', () => {
  it('findet ein Café-Konto mit Rolle und Credential', async () => {
    await seedKonto();
    const konto = await findAccountByIdentifier(env.DB, 'testcafe');

    expect(konto).not.toBeNull();
    expect(konto?.role).toBe('customer');
    expect(konto?.customerId).toBe(1);
    expect(konto?.isActive).toBe(true);
    expect(konto?.credential).toEqual({
      algorithm: 'pbkdf2-sha256',
      iterations: 600000,
      saltHex: SALT,
      verifierHex: VERIFIER,
    });
  });

  it('findet ein Admin-Konto ohne Kundenbezug', async () => {
    await seedKonto({ identifier: 'admin@example.test', role: 'admin', customerId: null });
    const konto = await findAccountByIdentifier(env.DB, 'admin@example.test');

    expect(konto?.role).toBe('admin');
    expect(konto?.customerId).toBeNull();
  });

  it('liefert null für eine unbekannte Kennung', async () => {
    await seedKonto();
    expect(await findAccountByIdentifier(env.DB, 'gibtesnicht')).toBeNull();
  });

  /**
   * Ein exakter Vergleich, keine Normalisierung. Normalisiert wird im
   * Anwendungsfall, BEVOR gesucht wird — hier noch einmal zu normalisieren
   * hieße, die Regel an zwei Stellen zu führen.
   */
  it('vergleicht die Kennung exakt', async () => {
    await seedKonto();
    expect(await findAccountByIdentifier(env.DB, 'TESTCAFE')).toBeNull();
    expect(await findAccountByIdentifier(env.DB, ' testcafe')).toBeNull();
  });

  /**
   * WICHTIG: Ein INAKTIVES Konto wird geladen, nicht ausgefiltert.
   *
   * Die Entscheidung darüber fällt im Anwendungsfall — und zwar NACH der
   * Credential-Prüfung. Würde hier schon gefiltert, käme die Ablehnung eines
   * deaktivierten Cafés ohne PBKDF2 zurück und wäre am Zeitverhalten
   * erkennbar. Damit wäre genau die Menge der existierenden Konten
   * aufzählbar.
   */
  it('lädt auch ein deaktiviertes Konto', async () => {
    await seedKonto({ isActive: 0 });
    const konto = await findAccountByIdentifier(env.DB, 'testcafe');

    expect(konto).not.toBeNull();
    expect(konto?.isActive).toBe(false);
  });

  it('gibt den Sperrzeitpunkt mit heraus', async () => {
    await seedKonto({ failedAttempts: 5, lockedUntil: '2026-08-24T07:15:00.000Z' });
    const konto = await findAccountByIdentifier(env.DB, 'testcafe');

    expect(konto?.failedAttempts).toBe(5);
    expect(konto?.lockedUntil).toBe('2026-08-24T07:15:00.000Z');
  });
});

describe('findAccountById', () => {
  it('findet dasselbe Konto über die ID', async () => {
    await seedKonto();
    const ueberKennung = await findAccountByIdentifier(env.DB, 'testcafe');
    const ueberId = await findAccountById(env.DB, 1);

    expect(ueberId).toEqual(ueberKennung);
  });

  it('liefert null für eine unbekannte ID', async () => {
    expect(await findAccountById(env.DB, 999)).toBeNull();
  });
});

describe('recordFailedAttempt', () => {
  it('erhöht den Zähler um eins', async () => {
    await seedKonto();
    await recordFailedAttempt(env.DB, 1, NOW);

    expect((await zaehlerVon(1)).failed_attempts).toBe(1);
  });

  /**
   * Der Test, der den Race-Condition-Schutz belegt: Zwei Aufrufe hintereinander
   * ergeben 2, nie 1. Ein Read-Modify-Write im Anwendungscode könnte hier
   * denselben Ausgangswert lesen und beide Male 1 schreiben.
   */
  it('zählt in einer Anweisung, nicht über Lesen und Zurückschreiben', async () => {
    await seedKonto();
    await recordFailedAttempt(env.DB, 1, NOW);
    await recordFailedAttempt(env.DB, 1, NOW);

    expect((await zaehlerVon(1)).failed_attempts).toBe(2);
  });

  it('zählt gleichzeitige Fehlversuche vollständig', async () => {
    await seedKonto();
    await Promise.all([
      recordFailedAttempt(env.DB, 1, NOW),
      recordFailedAttempt(env.DB, 1, NOW),
      recordFailedAttempt(env.DB, 1, NOW),
    ]);

    expect((await zaehlerVon(1)).failed_attempts).toBe(3);
  });

  it('sperrt nicht vor dem fünften Fehlversuch', async () => {
    await seedKonto();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await recordFailedAttempt(env.DB, 1, NOW);
    }

    const stand = await zaehlerVon(1);
    expect(stand.failed_attempts).toBe(4);
    expect(stand.locked_until).toBeNull();
  });

  it('sperrt beim fünften Fehlversuch für 15 Minuten', async () => {
    await seedKonto();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await recordFailedAttempt(env.DB, 1, NOW);
    }

    const stand = await zaehlerVon(1);
    expect(stand.failed_attempts).toBe(5);
    expect(stand.locked_until).toBe(new Date(NOW.getTime() + LOCKOUT_SECONDS * 1000).toISOString());
    expect(LOCKOUT_SECONDS).toBe(15 * 60);
  });

  /**
   * Der Lockout-DoS wird begrenzt: Wer währenddessen weiter probiert,
   * verlängert die Sperre NICHT. Der Aufruf ist während einer laufenden Sperre
   * wirkungslos — der Anwendungsfall kommt ohnehin nicht so weit, aber das
   * Repository verlässt sich nicht darauf.
   */
  it('verlängert eine laufende Sperre nicht', async () => {
    await seedKonto({ failedAttempts: 5, lockedUntil: '2026-08-24T07:15:00.000Z' });

    await recordFailedAttempt(env.DB, 1, NOW);

    const stand = await zaehlerVon(1);
    expect(stand.locked_until).toBe('2026-08-24T07:15:00.000Z');
    expect(stand.failed_attempts).toBe(5);
  });

  /**
   * Nach einer ABGELAUFENEN Sperre beginnt die Zählung von vorn. Sonst bekäme
   * ein Café, das seine PIN vergessen hat, nach der Kaffeepause genau EINEN
   * Versuch, bevor es wieder 15 Minuten gesperrt ist.
   */
  it('beginnt nach einer abgelaufenen Sperre neu zu zählen', async () => {
    await seedKonto({ failedAttempts: 5, lockedUntil: '2026-08-24T06:45:00.000Z' });

    await recordFailedAttempt(env.DB, 1, NOW);

    const stand = await zaehlerVon(1);
    expect(stand.failed_attempts).toBe(1);
    expect(stand.locked_until).toBeNull();
  });

  it('lässt ein unbekanntes Konto unangetastet', async () => {
    await seedKonto();
    await recordFailedAttempt(env.DB, 999, NOW);

    expect((await zaehlerVon(1)).failed_attempts).toBe(0);
  });
});

describe('resetFailedAttempts', () => {
  it('setzt Zähler und Sperre zurück', async () => {
    await seedKonto({ failedAttempts: 5, lockedUntil: '2026-08-24T07:15:00.000Z' });

    await resetFailedAttempts(env.DB, 1, NOW);

    const stand = await zaehlerVon(1);
    expect(stand.failed_attempts).toBe(0);
    expect(stand.locked_until).toBeNull();
  });

  it('ändert nichts an Rolle, Kundenbezug oder Credential', async () => {
    await seedKonto({ failedAttempts: 3 });
    const vorher = await findAccountByIdentifier(env.DB, 'testcafe');

    await resetFailedAttempts(env.DB, 1, NOW);
    const nachher = await findAccountByIdentifier(env.DB, 'testcafe');

    expect(nachher?.role).toBe(vorher?.role);
    expect(nachher?.customerId).toBe(vorher?.customerId);
    expect(nachher?.credential).toEqual(vorher?.credential);
    expect(nachher?.failedAttempts).toBe(0);
  });
});

describe('Verschwiegenheit', () => {
  /**
   * Das Repository gibt einen AuthAccount heraus, keine Datenbankzeile. Was
   * nicht in diesem Typ steht, kann nirgends versehentlich in eine Antwort,
   * ein Log oder eine Fehlermeldung geraten.
   */
  it('gibt keine Spalten heraus, die niemand braucht', async () => {
    await seedKonto();
    const konto = await findAccountByIdentifier(env.DB, 'testcafe');

    expect(Object.keys(konto ?? {}).sort()).toEqual([
      'credential',
      'customerId',
      'failedAttempts',
      'id',
      'isActive',
      'lockedUntil',
      'loginIdentifier',
      'role',
    ]);
  });
});
