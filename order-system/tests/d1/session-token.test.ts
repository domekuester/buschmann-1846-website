import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_LENGTH,
  SESSION_TTL_SECONDS,
  generateCsrfToken,
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionExpiry,
} from '../../src/infrastructure/auth/session-token';

/**
 * Auch diese Datei liegt im Projekt "worker": crypto.getRandomValues und
 * crypto.subtle sollen die Implementierung der Workers-Runtime sein, nicht die
 * von Node.
 */
const NOW = new Date('2026-08-24T07:00:00.000Z');

describe('generateSessionToken', () => {
  it('liefert 43 Zeichen base64url', () => {
    const token = generateSessionToken();

    expect(token).toHaveLength(SESSION_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  /**
   * 32 Byte aus getRandomValues sind 256 Bit. Ein Test kann Entropie nicht
   * beweisen — er kann aber ausschließen, dass hier ein Zähler, ein
   * Zeitstempel oder eine feste Zeichenkette steht.
   */
  it('erzeugt tausend paarweise verschiedene Token', () => {
    const token = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      token.add(generateSessionToken());
    }
    expect(token.size).toBe(1000);
  });

  it('erzeugt CSRF-Token derselben Form und ebenfalls verschieden', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  /**
   * Sitzungs- und CSRF-Token sind zwei verschiedene Geheimnisse mit
   * verschiedenen Aufgaben: Das eine liegt HttpOnly im Cookie, das andere
   * steht lesbar im Dokument. Wären sie gleich, stünde der Sitzungstoken im
   * HTML.
   */
  it('erzeugt Sitzungs- und CSRF-Token unabhängig voneinander', () => {
    expect(generateSessionToken()).not.toBe(generateCsrfToken());
  });
});

describe('hashSessionToken', () => {
  it('liefert 64 Hex-Zeichen', async () => {
    expect(await hashSessionToken(generateSessionToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ist deterministisch', async () => {
    const token = generateSessionToken();
    expect(await hashSessionToken(token)).toBe(await hashSessionToken(token));
  });

  it('bildet verschiedene Token auf verschiedene Hashes ab', async () => {
    expect(await hashSessionToken(generateSessionToken())).not.toBe(
      await hashSessionToken(generateSessionToken()),
    );
  });

  /**
   * Die Kernaussage: In D1 steht der Hash, und aus dem Hash kommt niemand
   * zurück zum Token. Der Test kann das nicht beweisen — er hält aber fest,
   * dass der Token nicht schlicht mit im Ergebnis steht.
   */
  it('enthält den Rohtoken nicht', async () => {
    const token = generateSessionToken();
    const hash = await hashSessionToken(token);

    expect(hash).not.toContain(token);
    expect(hash).not.toContain(token.slice(0, 8));
  });

  /**
   * Die Formprüfung steht VOR der Hashberechnung: Was die Form verfehlt, kann
   * in der Tabelle nicht stehen. Ein Hash dafür wäre Rechenarbeit für ein
   * sicheres Nein.
   */
  it('wirft bei formal ungültigen Token', async () => {
    for (const kaputt of ['', 'zu-kurz', 'a'.repeat(43) + '!', 'a'.repeat(200)]) {
      await expect(hashSessionToken(kaputt)).rejects.toThrow();
    }
  });
});

describe('isWellFormedSessionToken', () => {
  it('nimmt einen echten Token an', () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
  });

  it('lehnt falsche Länge, falsche Zeichen und Nicht-Zeichenketten ab', () => {
    for (const kaputt of [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      'a'.repeat(42) + '+',
      'a'.repeat(42) + '/',
      'a'.repeat(42) + '=',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isWellFormedSessionToken(kaputt)).toBe(false);
    }
  });
});

describe('sessionExpiry', () => {
  it('gibt einer Kundensitzung 30 Tage', () => {
    expect(SESSION_TTL_SECONDS.customer).toBe(30 * 24 * 60 * 60);
    expect(sessionExpiry('customer', NOW)).toBe('2026-09-23T07:00:00.000Z');
  });

  it('gibt einer Adminsitzung 12 Stunden', () => {
    expect(SESSION_TTL_SECONDS.admin).toBe(12 * 60 * 60);
    expect(sessionExpiry('admin', NOW)).toBe('2026-08-24T19:00:00.000Z');
  });

  it('macht die Adminsitzung deutlich kürzer als die Kundensitzung', () => {
    expect(SESSION_TTL_SECONDS.admin).toBeLessThan(SESSION_TTL_SECONDS.customer);
  });

  /**
   * Feste Länge und Z-Suffix: Nur dann ist die lexikografische Ordnung die
   * chronologische, und nur dann ist `WHERE expires_at > ?` in SQLite ohne
   * Datumsfunktion korrekt.
   */
  it('liefert einen lexikografisch vergleichbaren Zeitpunkt', () => {
    const frueh = sessionExpiry('admin', NOW);
    const spaet = sessionExpiry('customer', NOW);

    expect(frueh).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(frueh < spaet).toBe(true);
  });

  it('rechnet in UTC und nicht in Ortszeit', () => {
    // Über die Sommerzeitumstellung hinweg: 30 Tage sind 30 * 86400 Sekunden,
    // auch wenn in Europe/Berlin dazwischen eine Stunde verschwindet.
    const vorUmstellung = new Date('2026-10-10T12:00:00.000Z');
    expect(sessionExpiry('customer', vorUmstellung)).toBe('2026-11-09T12:00:00.000Z');
  });
});
