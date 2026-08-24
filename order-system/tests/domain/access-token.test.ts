import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_LENGTH,
  generateAccessToken,
  hashAccessToken,
  isWellFormedToken,
} from '../../src/domain/access-token';
import { InvalidArgumentError } from '../../src/domain/errors';

/**
 * Der Zugangstoken ist das einzige Geheimnis dieses Systems. Er ersetzt
 * Registrierung, Passwort und Sitzung — und trägt deshalb allein, was sonst
 * drei Mechanismen tragen.
 */
describe('generateAccessToken', () => {
  it('liefert 43 base64url-Zeichen — 32 Byte, 256 Bit', () => {
    const token = generateAccessToken();
    expect(token).toHaveLength(ACCESS_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('enthält kein Padding und keine URL-kritischen Zeichen', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateAccessToken()).not.toMatch(/[+/=]/);
    }
  });

  /**
   * Kein Beweis für Zufälligkeit — das kann ein Unittest nicht leisten. Aber
   * ein Zähler, ein Zeitstempel oder ein konstanter Wert fiele hier auf, und
   * genau das sind die Fehler, die in der Praxis passieren.
   */
  it('liefert bei 500 Aufrufen 500 verschiedene Werte', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      tokens.add(generateAccessToken());
    }
    expect(tokens.size).toBe(500);
  });

  it('erzeugt Token, die die eigene Formprüfung bestehen', () => {
    expect(isWellFormedToken(generateAccessToken())).toBe(true);
  });
});

describe('isWellFormedToken', () => {
  it('akzeptiert die vorgesehene Länge und Spannweite', () => {
    expect(isWellFormedToken('a'.repeat(32))).toBe(true);
    expect(isWellFormedToken('a'.repeat(43))).toBe(true);
    expect(isWellFormedToken('a'.repeat(64))).toBe(true);
  });

  it('lehnt zu kurze und zu lange Werte ab', () => {
    expect(isWellFormedToken('a'.repeat(31))).toBe(false);
    expect(isWellFormedToken('a'.repeat(65))).toBe(false);
  });

  it('lehnt fremde Zeichen ab', () => {
    expect(isWellFormedToken(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}.`)).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}%`)).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)} `)).toBe(false);
  });

  it('lehnt alles ab, was kein String ist', () => {
    expect(isWellFormedToken(null)).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken(42)).toBe(false);
    expect(isWellFormedToken({})).toBe(false);
    expect(isWellFormedToken([])).toBe(false);
    expect(isWellFormedToken('')).toBe(false);
  });
});

describe('hashAccessToken', () => {
  it('liefert 64 Hex-Zeichen', async () => {
    const hash = await hashAccessToken(generateAccessToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ist deterministisch', async () => {
    const token = generateAccessToken();
    expect(await hashAccessToken(token)).toBe(await hashAccessToken(token));
  });

  it('bildet verschiedene Token auf verschiedene Hashes ab', async () => {
    expect(await hashAccessToken(generateAccessToken())).not.toBe(
      await hashAccessToken(generateAccessToken()),
    );
  });

  /**
   * Die eigentliche Zusage von Abschnitt 5.2: In der Datenbank landet der
   * Hash. Enthielte er den Klartext, wäre die ganze Übung sinnlos.
   */
  it('enthält den Klartext nicht', async () => {
    const token = generateAccessToken();
    const hash = await hashAccessToken(token);
    expect(hash).not.toContain(token);
    expect(hash).not.toContain(token.slice(0, 8));
  });

  it('stimmt mit dem bekannten SHA-256-Wert überein', async () => {
    // Referenzwert: sha256("abcdefghijklmnopqrstuvwxyz0123456789")
    expect(await hashAccessToken('abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      '011fc2994e39d251141540f87a69092b3f22a86767f7283de7eeedb3897bedf6',
    );
  });

  it('weist formal ungültige Token zurück, statt sie zu hashen', async () => {
    await expect(hashAccessToken('zu-kurz')).rejects.toThrow(InvalidArgumentError);
    await expect(hashAccessToken('a'.repeat(65))).rejects.toThrow(InvalidArgumentError);
  });
});
