import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_ALGORITHM,
  PBKDF2_ITERATIONS,
  buildInsert,
  deriveCredential,
  normalizeLoginIdentifier,
  validateInput,
} from '../../scripts/create-local-auth-account.mjs';
import { normalizeLoginIdentifier as workerNormalize } from '../../src/domain/login-identifier';

/**
 * Das Provisionierungswerkzeug.
 *
 * Es läuft in Node und der Worker in workerd; einen gemeinsamen Modulbaum
 * gibt es ohne Build-Schritt nicht. Die Verfahren sind deshalb zweimal
 * geschrieben — und genau deshalb prüft diese Datei, dass sie dasselbe tun.
 * Liefen sie auseinander, entstünden Konten, an denen sich niemand anmelden
 * kann, und der Fehler zeigte sich erst im Betrieb.
 */
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

/** Führende Null ausdrücklich. */
const PIN = '01234567';
const PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

describe('validateInput — Rolle', () => {
  it('kennt nur customer und admin', () => {
    for (const role of ['manager', 'superadmin', '', null, undefined]) {
      expect(() =>
        validateInput({ role, identifier: 'testcafe', customerId: 1, secret: PIN }),
      ).toThrow(/role/i);
    }
  });
});

describe('validateInput — Café', () => {
  it('nimmt Kundencode, Kundenbezug und 8-stellige PIN an', () => {
    const eingabe = validateInput({
      role: 'customer',
      identifier: 'TESTCAFE',
      customerId: 1,
      secret: PIN,
    });

    expect(eingabe.identifier).toBe('testcafe');
    expect(eingabe.secret).toBe(PIN);
  });

  it('verlangt einen Kundenbezug', () => {
    expect(() =>
      validateInput({ role: 'customer', identifier: 'testcafe', customerId: null, secret: PIN }),
    ).toThrow(/customer/i);
  });

  it('lehnt eine Kunden-ID ab, die keine ist', () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        validateInput({ role: 'customer', identifier: 'testcafe', customerId: id, secret: PIN }),
      ).toThrow();
    }
  });

  it('verlangt genau acht Ziffern', () => {
    for (const secret of ['1234567', '123456789', '0123456a', 'abcdefgh', '', ' 1234567']) {
      expect(() =>
        validateInput({ role: 'customer', identifier: 'testcafe', customerId: 1, secret }),
      ).toThrow(/8 Ziffern/);
    }
  });

  /**
   * Die führende Null muss durchkommen. Ein Werkzeug, das die PIN durch
   * Number() schickte, machte aus '01234567' die Zahl 1234567 — ein anderes
   * Geheimnis, und der Fehler fiele erst beim ersten Anmeldeversuch auf.
   */
  it('behält die führende Null', () => {
    const eingabe = validateInput({
      role: 'customer',
      identifier: 'testcafe',
      customerId: 1,
      secret: '01234567',
    });

    expect(eingabe.secret).toBe('01234567');
    expect(typeof eingabe.secret).toBe('string');
  });
});

describe('validateInput — Admin', () => {
  it('nimmt E-Mail und langes Passwort an', () => {
    const eingabe = validateInput({
      role: 'admin',
      identifier: 'Admin@Example.test',
      customerId: null,
      secret: PASSWORT,
    });

    expect(eingabe.identifier).toBe('admin@example.test');
    expect(eingabe.customerId).toBeNull();
  });

  /** Ein Admin ist kein Café mit mehr Rechten. Das Schema sagt dasselbe. */
  it('verbietet einen Kundenbezug', () => {
    expect(() =>
      validateInput({ role: 'admin', identifier: 'admin@example.test', customerId: 1, secret: PASSWORT }),
    ).toThrow(/Admin ist kein Café/);
  });

  it('verlangt mindestens 16 Zeichen', () => {
    expect(() =>
      validateInput({ role: 'admin', identifier: 'a@b.test', customerId: null, secret: 'x'.repeat(15) }),
    ).toThrow(/16 Zeichen/);

    expect(() =>
      validateInput({ role: 'admin', identifier: 'a@b.test', customerId: null, secret: 'x'.repeat(16) }),
    ).not.toThrow();
  });

  /**
   * Keine Regel über Großbuchstaben, Ziffern oder Sonderzeichen. Solche
   * Regeln senken die tatsächliche Entropie und erhöhen die
   * Wahrscheinlichkeit, dass das Geheimnis auf einem Zettel landet.
   */
  it('verlangt keine Zeichenklassen', () => {
    expect(() =>
      validateInput({
        role: 'admin',
        identifier: 'a@b.test',
        customerId: null,
        secret: 'aaaaaaaaaaaaaaaaaaaa',
      }),
    ).not.toThrow();
  });
});

describe('validateInput — Kennung', () => {
  it('lehnt eine unbrauchbare Kennung ab', () => {
    for (const identifier of ['', '   ', 'café!27', 'саfe27', null, 42, 'a'.repeat(191)]) {
      expect(() =>
        validateInput({ role: 'customer', identifier, customerId: 1, secret: PIN }),
      ).toThrow(/identifier/);
    }
  });

  /**
   * DER TEST, DER DIE DOPPELUNG ABSICHERT: Skript und Worker normalisieren
   * gleich. Wichen sie ab, entstünde ein Konto unter einer Kennung, die beim
   * Anmelden anders berechnet würde — und niemand käme herein.
   */
  it('normalisiert genau wie der Worker', () => {
    const beispiele = [
      'CAFE27',
      '  Admin@Example.test  ',
      'ＣＡＦＥ２７',
      'CAFE\u200b27',
      'vor.nach+tag@example.test',
      'CAFE-27_NORD',
      'I',
      'café27',
      '',
      'a'.repeat(191),
    ];

    for (const beispiel of beispiele) {
      expect(normalizeLoginIdentifier(beispiel), beispiel).toBe(workerNormalize(beispiel));
    }
  });
});

describe('deriveCredential', () => {
  it('benutzt denselben Algorithmus und Work Factor wie der Worker', async () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(CREDENTIAL_ALGORITHM).toBe('pbkdf2-sha256');

    const credential = await deriveCredential(PIN, PEPPER, { iterations: 1000 });
    expect(credential.algorithm).toBe('pbkdf2-sha256');
    expect(credential.saltHex).toMatch(/^[0-9a-f]{32}$/);
    expect(credential.verifierHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verlangt einen Pepper', async () => {
    await expect(deriveCredential(PIN, '', { iterations: 1000 })).rejects.toThrow(/AUTH_PEPPER/);
    await expect(deriveCredential(PIN, undefined, { iterations: 1000 })).rejects.toThrow(
      /AUTH_PEPPER/,
    );
  });

  it('erzeugt für dasselbe Geheimnis verschiedene Salts', async () => {
    const a = await deriveCredential(PIN, PEPPER, { iterations: 1000 });
    const b = await deriveCredential(PIN, PEPPER, { iterations: 1000 });

    expect(a.saltHex).not.toBe(b.saltHex);
    expect(a.verifierHex).not.toBe(b.verifierHex);
  });
});

describe('buildInsert', () => {
  it('schreibt weder Klartext noch Pepper', async () => {
    const credential = await deriveCredential(PIN, PEPPER, { iterations: 1000 });
    const sql = buildInsert({
      identifier: 'testcafe',
      role: 'customer',
      customerId: 1,
      credential,
      now: '2026-08-24T07:00:00.000Z',
    });

    expect(sql).not.toContain(PIN);
    expect(sql).not.toContain(PEPPER);
    expect(sql).toContain(credential.saltHex);
    expect(sql).toContain(credential.verifierHex);
    expect(sql).toContain("'testcafe'");
    expect(sql).toContain('auth_accounts');
  });

  it('schreibt für einen Admin NULL statt einer Kunden-ID', async () => {
    const credential = await deriveCredential(PASSWORT, PEPPER, { iterations: 1000 });
    const sql = buildInsert({
      identifier: 'admin@example.test',
      role: 'admin',
      customerId: null,
      credential,
      now: '2026-08-24T07:00:00.000Z',
    });

    expect(sql).toContain('NULL');
    expect(sql).toContain("'admin'");
  });
});
