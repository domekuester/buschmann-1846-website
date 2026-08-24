import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logIn } from '../../src/application/log-in';
import type { AppConfig } from '../../src/config/app-config';
import { MIN_ITERATIONS, deriveCredential } from '../../src/infrastructure/auth/credential';
import { findValidSession } from '../../src/infrastructure/d1/auth-session-repository';

const NOW_ISO = '2026-08-24T07:00:00.000Z';
const NOW = new Date(NOW_ISO);

const CONFIG: AppConfig = {
  environment: 'development',
  appOrigin: 'http://127.0.0.1:8787',
  pepper: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
};

/** Führende Null ausdrücklich. */
const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

async function seedKonto(options: {
  id: number;
  identifier: string;
  role: 'customer' | 'admin';
  secret: string;
  customerId?: number | null;
  isActive?: number;
  failedAttempts?: number;
  lockedUntil?: string | null;
}): Promise<void> {
  const credential = await deriveCredential(options.secret, CONFIG.pepper, {
    iterations: MIN_ITERATIONS,
  });

  await env.DB.prepare(
    `INSERT INTO auth_accounts (id, login_identifier_normalized, role, customer_id,
                                credential_algorithm, credential_iterations,
                                credential_salt, credential_verifier, is_active,
                                failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      options.id,
      options.identifier,
      options.role,
      options.customerId ?? (options.role === 'customer' ? 1 : null),
      credential.algorithm,
      credential.iterations,
      credential.saltHex,
      credential.verifierHex,
      options.isActive ?? 1,
      options.failedAttempts ?? 0,
      options.lockedUntil ?? null,
      NOW_ISO,
      NOW_ISO,
    )
    .run();
}

async function kontostand(id: number) {
  return env.DB.prepare('SELECT failed_attempts, locked_until FROM auth_accounts WHERE id = ?')
    .bind(id)
    .first<{ failed_attempts: number; locked_until: string | null }>();
}

beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_accounts', 'customers']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (1, 'Testcafé Nord', 'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery', ?1, ?1)`,
    ).bind(NOW_ISO),
    env.DB.prepare(
      `INSERT INTO customers (id, name, delivery_street, delivery_postal_code, delivery_city,
                              is_active, default_fulfillment, created_at, updated_at)
       VALUES (2, 'Ehemaliges Testcafé', 'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', ?1, ?1)`,
    ).bind(NOW_ISO),
  ]);

  await seedKonto({ id: 1, identifier: 'testcafe', role: 'customer', secret: PIN });
  await seedKonto({ id: 2, identifier: 'admin@example.test', role: 'admin', secret: PASSWORT });
});

describe('logIn — Erfolg', () => {
  it('meldet ein Café mit Kundencode und PIN an', async () => {
    const ergebnis = await logIn(env.DB, CONFIG, {
      identifier: 'TESTCAFE',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    expect(ergebnis).not.toBeNull();
    expect(ergebnis?.role).toBe('customer');
    expect(ergebnis?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ergebnis?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('meldet einen Admin mit E-Mail und Passwort an', async () => {
    const ergebnis = await logIn(env.DB, CONFIG, {
      identifier: '  Admin@Example.test  ',
      secret: PASSWORT,
      now: NOW,
      existingSessionToken: null,
    });

    expect(ergebnis?.role).toBe('admin');
  });

  it('gibt der Kundensitzung 30 Tage und der Adminsitzung 12 Stunden', async () => {
    const cafe = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });
    const admin = await logIn(env.DB, CONFIG, {
      identifier: 'admin@example.test',
      secret: PASSWORT,
      now: NOW,
      existingSessionToken: null,
    });

    expect(cafe?.maxAgeSeconds).toBe(30 * 24 * 60 * 60);
    expect(admin?.maxAgeSeconds).toBe(12 * 60 * 60);
  });

  it('erzeugt eine Sitzung, die anschließend gültig ist', async () => {
    const ergebnis = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    const sitzung = await findValidSession(env.DB, ergebnis?.token ?? '', NOW);
    expect(sitzung?.accountId).toBe(1);
    expect(sitzung?.csrfToken).toBe(ergebnis?.csrfToken);
  });

  /** Die PIN ist eine Zeichenkette. '1234567' ist ein anderes Geheimnis. */
  it('nimmt die PIN mit führender Null und keine andere', async () => {
    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: '1234567',
        now: NOW,
        existingSessionToken: null,
      }),
    ).toBeNull();

    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: '01234567',
        now: NOW,
        existingSessionToken: null,
      }),
    ).not.toBeNull();
  });
});

describe('logIn — Ablehnung', () => {
  /**
   * Alle sechs Ablehnungsgründe liefern DASSELBE: null, ohne Angabe. Der
   * Aufrufer kann sie nicht unterscheiden, weil er es nicht soll — jede
   * Unterscheidung wäre eine Auskunft darüber, ob ein bestimmtes Konto
   * existiert.
   */
  const faelle: [string, { identifier: unknown; secret: unknown }][] = [
    ['falsches Geheimnis', { identifier: 'testcafe', secret: '99999999' }],
    ['unbekannte Kennung', { identifier: 'gibtesnicht', secret: PIN }],
    ['formal unmögliche Kennung', { identifier: 'café!27', secret: PIN }],
    ['leere Kennung', { identifier: '', secret: PIN }],
    ['Kennung ist kein Text', { identifier: 42, secret: PIN }],
    ['Geheimnis ist kein Text', { identifier: 'testcafe', secret: 42 }],
    ['leeres Geheimnis', { identifier: 'testcafe', secret: '' }],
  ];

  for (const [name, eingabe] of faelle) {
    it(`lehnt ab: ${name}`, async () => {
      const ergebnis = await logIn(env.DB, CONFIG, {
        ...eingabe,
        now: NOW,
        existingSessionToken: null,
      });

      expect(ergebnis).toBeNull();
    });
  }

  it('lehnt ein deaktiviertes Konto ab', async () => {
    await env.DB.prepare('UPDATE auth_accounts SET is_active = 0 WHERE id = 1').run();

    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: PIN,
        now: NOW,
        existingSessionToken: null,
      }),
    ).toBeNull();
  });

  /**
   * Das Konto ist aktiv, das Café ist es nicht. Ein ehemaliges Café soll sich
   * nicht anmelden können — und der Grund darf es nicht erfahren.
   */
  it('lehnt ein deaktiviertes Café ab', async () => {
    await seedKonto({
      id: 3,
      identifier: 'ehemalig',
      role: 'customer',
      secret: PIN,
      customerId: 2,
    });

    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'ehemalig',
        secret: PIN,
        now: NOW,
        existingSessionToken: null,
      }),
    ).toBeNull();
  });

  it('legt bei einer Ablehnung keine Sitzung an', async () => {
    await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: 'falsch99',
      now: NOW,
      existingSessionToken: null,
    });

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('logIn — Bruteforce-Schutz', () => {
  it('zählt jeden Fehlversuch', async () => {
    for (let i = 0; i < 3; i += 1) {
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: 'falsch99',
        now: NOW,
        existingSessionToken: null,
      });
    }

    expect((await kontostand(1))?.failed_attempts).toBe(3);
  });

  it('sperrt nach fünf Fehlversuchen', async () => {
    for (let i = 0; i < 5; i += 1) {
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: 'falsch99',
        now: NOW,
        existingSessionToken: null,
      });
    }

    expect((await kontostand(1))?.locked_until).toBe('2026-08-24T07:15:00.000Z');
  });

  /**
   * Der eigentliche Nachweis: Während der Sperre wird auch das RICHTIGE
   * Geheimnis abgelehnt. Sonst wäre der Zähler eine Zierde.
   */
  it('lehnt während der Sperre auch das richtige Geheimnis ab', async () => {
    for (let i = 0; i < 5; i += 1) {
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: 'falsch99',
        now: NOW,
        existingSessionToken: null,
      });
    }

    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: PIN,
        now: NOW,
        existingSessionToken: null,
      }),
    ).toBeNull();
  });

  it('lässt nach Ablauf der Sperre wieder zu', async () => {
    await seedKonto({
      id: 4,
      identifier: 'gesperrt',
      role: 'customer',
      secret: PIN,
      failedAttempts: 5,
      lockedUntil: '2026-08-24T07:15:00.000Z',
    });

    const nachAblauf = new Date('2026-08-24T07:16:00.000Z');
    expect(
      await logIn(env.DB, CONFIG, {
        identifier: 'gesperrt',
        secret: PIN,
        now: nachAblauf,
        existingSessionToken: null,
      }),
    ).not.toBeNull();
  });

  it('setzt den Zähler bei erfolgreicher Anmeldung zurück', async () => {
    for (let i = 0; i < 4; i += 1) {
      await logIn(env.DB, CONFIG, {
        identifier: 'testcafe',
        secret: 'falsch99',
        now: NOW,
        existingSessionToken: null,
      });
    }
    expect((await kontostand(1))?.failed_attempts).toBe(4);

    await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    const stand = await kontostand(1);
    expect(stand?.failed_attempts).toBe(0);
    expect(stand?.locked_until).toBeNull();
  });

  it('zählt bei einer unbekannten Kennung nichts hoch', async () => {
    await logIn(env.DB, CONFIG, {
      identifier: 'gibtesnicht',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    expect((await kontostand(1))?.failed_attempts).toBe(0);
  });
});

describe('logIn — Zeitverhalten', () => {
  /**
   * Jede Ablehnung kostet GENAU EINE PBKDF2-Ableitung — auch die eines
   * unbekannten Kontos und auch die eines gesperrten.
   *
   * Ohne die Ableitung beim gesperrten Konto entstünde ein
   * Aufzählungsverfahren: Wer fünfmal auf eine geratene Kennung tippt und
   * danach schnellere Antworten bekommt, hat bestätigt, dass es sie gibt. Der
   * Einwand „ein gesperrtes Konto soll keine CPU kosten" trägt nicht — eine
   * unbekannte Kennung kostet dieselbe Ableitung, ein Angreifer gewinnt
   * dadurch also nichts.
   */
  it('kostet bei jedem Ausgang genau eine Ableitung', async () => {
    const faelle: { name: string; identifier: unknown; secret: unknown; now: Date }[] = [
      { name: 'unbekannte Kennung', identifier: 'gibtesnicht', secret: PIN, now: NOW },
      { name: 'formal unmögliche Kennung', identifier: 'café!27', secret: PIN, now: NOW },
      { name: 'falsches Geheimnis', identifier: 'testcafe', secret: 'falsch99', now: NOW },
      { name: 'richtiges Geheimnis', identifier: 'testcafe', secret: PIN, now: NOW },
    ];

    for (const fall of faelle) {
      const spion = vi.spyOn(crypto.subtle, 'deriveBits');
      try {
        await logIn(env.DB, CONFIG, {
          identifier: fall.identifier,
          secret: fall.secret,
          now: fall.now,
          existingSessionToken: null,
        });
        expect(spion, fall.name).toHaveBeenCalledTimes(1);
      } finally {
        spion.mockRestore();
      }
    }
  });

  it('kostet auch bei einem gesperrten Konto eine Ableitung', async () => {
    await seedKonto({
      id: 5,
      identifier: 'gesperrt2',
      role: 'customer',
      secret: PIN,
      failedAttempts: 5,
      lockedUntil: '2026-08-24T07:15:00.000Z',
    });

    const spion = vi.spyOn(crypto.subtle, 'deriveBits');
    try {
      const ergebnis = await logIn(env.DB, CONFIG, {
        identifier: 'gesperrt2',
        secret: PIN,
        now: NOW,
        existingSessionToken: null,
      });

      expect(ergebnis).toBeNull();
      expect(spion).toHaveBeenCalledTimes(1);
    } finally {
      spion.mockRestore();
    }
  });
});

describe('logIn — Session Fixation', () => {
  /**
   * Nach jeder erfolgreichen Anmeldung entsteht eine NEUE Sitzung, und die
   * vorherige ist ungültig. Es gibt keinen Codepfad, der eine mitgeschickte
   * Sitzungs-ID weiterverwendet.
   */
  it('widerruft eine mitgeschickte gültige Sitzung', async () => {
    const erste = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    const zweite = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: erste?.token ?? null,
    });

    expect(zweite?.token).not.toBe(erste?.token);
    expect(await findValidSession(env.DB, erste?.token ?? '', NOW)).toBeNull();
    expect(await findValidSession(env.DB, zweite?.token ?? '', NOW)).not.toBeNull();
  });

  it('widerruft auch eine Sitzung, die zu einem anderen Konto gehört', async () => {
    const adminSitzung = await logIn(env.DB, CONFIG, {
      identifier: 'admin@example.test',
      secret: PASSWORT,
      now: NOW,
      existingSessionToken: null,
    });

    await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: adminSitzung?.token ?? null,
    });

    expect(await findValidSession(env.DB, adminSitzung?.token ?? '', NOW)).toBeNull();
  });

  it('widerruft alle früheren Sitzungen desselben Kontos', async () => {
    const a = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });
    const b = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    expect(await findValidSession(env.DB, a?.token ?? '', NOW)).toBeNull();
    expect(await findValidSession(env.DB, b?.token ?? '', NOW)).not.toBeNull();
  });

  it('lässt eine mitgeschickte Sitzung bei FEHLGESCHLAGENER Anmeldung bestehen', async () => {
    const gueltig = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: 'falsch99',
      now: NOW,
      existingSessionToken: gueltig?.token ?? null,
    });

    // Ein Tippfehler beim Anmelden darf niemanden abmelden.
    expect(await findValidSession(env.DB, gueltig?.token ?? '', NOW)).not.toBeNull();
  });
});

describe('logIn — Verschwiegenheit', () => {
  it('gibt weder Kontodaten noch Hashes heraus', async () => {
    const ergebnis = await logIn(env.DB, CONFIG, {
      identifier: 'testcafe',
      secret: PIN,
      now: NOW,
      existingSessionToken: null,
    });

    expect(Object.keys(ergebnis ?? {}).sort()).toEqual([
      'csrfToken',
      'maxAgeSeconds',
      'role',
      'token',
    ]);

    const serialisiert = JSON.stringify(ergebnis);
    expect(serialisiert).not.toContain(PIN);
    expect(serialisiert).not.toContain(CONFIG.pepper);
  });
});
