import { describe, expect, it, vi } from 'vitest';
import {
  CREDENTIAL_ALGORITHM,
  MIN_ITERATIONS,
  PBKDF2_ITERATIONS,
  deriveCredential,
  verifyCredential,
  verifyDummyCredential,
} from '../../src/infrastructure/auth/credential';

/**
 * Diese Datei liegt im Vitest-Projekt "worker" und nicht in "domain", obwohl
 * sie keine Datenbank anfasst: Sie braucht die Web-Crypto-Implementierung von
 * workerd. Node hat eine eigene, und ein Verifier, der in Node stimmt, aber in
 * der Workers-Runtime nicht, wäre genau der Fehler, den kein Test finden darf.
 *
 * TESTWERTE, KEINE GEHEIMNISSE. Alles hier steht im Klartext in Git. Der echte
 * Pepper kommt aus einem Cloudflare Secret und existiert nirgendwo in diesem
 * Repository.
 */
const PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';
const ANDERER_PEPPER = 'TEST-PEPPER-zweiter-Testwert-kein-Echtwert-9876543210';

/** Führende Null ausdrücklich — sie ist der Nachweis aus Abschnitt 59. */
const DEMO_PIN = '01234567';
const DEMO_PASSWORT = 'demo-passwort-nur-fuer-tests-16plus';

/**
 * Für Tests, die den Work Factor nicht selbst prüfen: der Schema-Mindestwert.
 * Das ist die Untergrenze, die auch die D1-CHECK-Bedingung verlangt, und
 * kostet rund 8 ms statt 45 ms je Ableitung.
 */
const SCHNELL = { iterations: MIN_ITERATIONS };

/**
 * Das erste Argument von deriveBits ist in den Worker-Typen
 * `string | SubtleCryptoDeriveKeyAlgorithm`. Hier interessiert nur der zweite
 * Fall — ein blanker Algorithmusname hätte weder Salt noch Iterationen und
 * wäre genau das, was dieser Test ausschließt.
 */
function deriveAlgorithm(call: readonly unknown[] | undefined): SubtleCryptoDeriveKeyAlgorithm {
  const algorithmus = call?.[0] as SubtleCryptoDeriveKeyAlgorithm | string | undefined;
  if (typeof algorithmus !== 'object' || algorithmus === null) {
    throw new Error('deriveBits wurde nicht mit einem Algorithmusobjekt aufgerufen.');
  }
  return algorithmus;
}

describe('deriveCredential — Form', () => {
  it('liefert Salt und Verifier in fester Hexform', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    expect(stored.saltHex).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.verifierHex).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.algorithm).toBe(CREDENTIAL_ALGORITHM);
    expect(stored.iterations).toBe(MIN_ITERATIONS);
  });

  it('verwendet ohne Vorgabe den zentralen Work Factor', async () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(MIN_ITERATIONS).toBe(100_000);
  });

  /**
   * Die Kernaussage der Speicherung: Was in D1 landet, enthält das Geheimnis
   * nicht. Nicht verschlüsselt, nicht kodiert, nicht als Teilzeichenkette.
   */
  it('enthält das Klartextgeheimnis nirgends', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);
    const serialisiert = JSON.stringify(stored);

    expect(serialisiert).not.toContain(DEMO_PIN);
    expect(serialisiert).not.toContain(PEPPER);
    expect(serialisiert).not.toContain(Buffer.from(DEMO_PIN).toString('hex'));
    expect(serialisiert).not.toContain(btoa(DEMO_PIN));
  });

  /**
   * Ohne individuellen Salt hätten zwei Cafés mit derselben PIN denselben
   * Verifier — und ein Blick in die Tabelle verriete, welche das sind.
   */
  it('erzeugt für dasselbe Geheimnis verschiedene Salts und Verifier', async () => {
    const a = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);
    const b = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    expect(a.saltHex).not.toBe(b.saltHex);
    expect(a.verifierHex).not.toBe(b.verifierHex);
  });

  it('erzeugt bei gleichem Salt denselben Verifier', async () => {
    const a = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);
    const b = await deriveCredential(DEMO_PIN, PEPPER, {
      ...SCHNELL,
      saltHex: a.saltHex,
    });

    expect(b.verifierHex).toBe(a.verifierHex);
  });
});

describe('verifyCredential', () => {
  it('nimmt das richtige Geheimnis an', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);
    expect(await verifyCredential(DEMO_PIN, PEPPER, stored)).toBe(true);
  });

  it('lehnt ein falsches Geheimnis ab', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    for (const falsch of ['01234568', '1234567', '', '0123456', '012345678']) {
      expect(await verifyCredential(falsch, PEPPER, stored)).toBe(false);
    }
  });

  /**
   * Der Pepper ist die eigentliche Verteidigung gegen einen D1-Dump: Wer die
   * Tabelle hat, aber nicht den Pepper, kann nicht einmal anfangen zu raten.
   * Dieser Test hält fest, dass er tatsächlich in die Rechnung eingeht — und
   * nicht bloß irgendwo herumliegt.
   */
  it('lehnt ab, wenn der Pepper nicht stimmt', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    expect(await verifyCredential(DEMO_PIN, ANDERER_PEPPER, stored)).toBe(false);
  });

  /**
   * Ein FEHLENDER Pepper ist etwas anderes als ein falscher: Er ist ein
   * Betriebsfehler. Käme dafür `false` zurück, meldete ein Worker ohne Secret
   * allen Cafés und allen Admins gleichzeitig falsche Zugangsdaten — und
   * niemand käme auf die Ursache. Die Ausnahme wird zu einer 500 und sagt
   * damit das Richtige: Hier stimmt der Server nicht, nicht der Benutzer.
   */
  it('wirft bei fehlendem Pepper, statt ihn wie ein falsches Geheimnis zu behandeln', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    await expect(verifyCredential(DEMO_PIN, '', stored)).rejects.toThrow(/AUTH_PEPPER/);
    await expect(deriveCredential(DEMO_PIN, '', SCHNELL)).rejects.toThrow(/AUTH_PEPPER/);
    await expect(verifyDummyCredential('')).rejects.toThrow(/AUTH_PEPPER/);
  });

  /**
   * Abschnitt 59: Die PIN ist eine ZEICHENKETTE. Als Zahl wäre '01234567'
   * gleich 1234567 — und damit ein anderes Geheimnis.
   */
  it('behält die führende Null einer PIN', async () => {
    const stored = await deriveCredential('01234567', PEPPER, SCHNELL);

    expect(await verifyCredential('01234567', PEPPER, stored)).toBe(true);
    expect(await verifyCredential('1234567', PEPPER, stored)).toBe(false);
    expect(await verifyCredential(String(Number('01234567')), PEPPER, stored)).toBe(false);
  });

  it('verifiziert auch ein langes Admin-Passwort', async () => {
    const stored = await deriveCredential(DEMO_PASSWORT, PEPPER, SCHNELL);

    expect(await verifyCredential(DEMO_PASSWORT, PEPPER, stored)).toBe(true);
    expect(await verifyCredential(DEMO_PASSWORT + ' ', PEPPER, stored)).toBe(false);
  });

  it('benutzt die gespeicherte Iterationszahl, nicht die Konstante', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, { iterations: MIN_ITERATIONS });

    // Mit der richtigen Zahl gilt es, mit einer anderen nicht.
    expect(await verifyCredential(DEMO_PIN, PEPPER, stored)).toBe(true);
    expect(
      await verifyCredential(DEMO_PIN, PEPPER, { ...stored, iterations: MIN_ITERATIONS + 1 }),
    ).toBe(false);
  });

  it('lehnt einen manipulierten Verifier gleicher Länge ab', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);
    const letztes = stored.verifierHex.slice(-1) === '0' ? '1' : '0';
    const manipuliert = { ...stored, verifierHex: stored.verifierHex.slice(0, -1) + letztes };

    expect(await verifyCredential(DEMO_PIN, PEPPER, manipuliert)).toBe(false);
  });

  /**
   * Fail closed: Ein gespeicherter Datensatz, den diese Fassung nicht
   * verifizieren KANN, wird abgelehnt — nicht angenommen und nicht
   * durchgewunken.
   */
  it('lehnt einen unbekannten Algorithmus ab', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    expect(await verifyCredential(DEMO_PIN, PEPPER, { ...stored, algorithm: 'md5' })).toBe(false);
    expect(await verifyCredential(DEMO_PIN, PEPPER, { ...stored, algorithm: '' })).toBe(false);
  });

  it('lehnt einen formal kaputten Datensatz ab', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, SCHNELL);

    expect(await verifyCredential(DEMO_PIN, PEPPER, { ...stored, saltHex: 'xyz' })).toBe(false);
    expect(await verifyCredential(DEMO_PIN, PEPPER, { ...stored, verifierHex: 'abc' })).toBe(false);
    expect(await verifyCredential(DEMO_PIN, PEPPER, { ...stored, iterations: 0 })).toBe(false);
  });
});

describe('verifyDummyCredential', () => {
  it('liefert immer false', async () => {
    expect(await verifyDummyCredential(PEPPER)).toBe(false);
    expect(await verifyDummyCredential(ANDERER_PEPPER)).toBe(false);
  });

  /**
   * Der Punkt der Dummy-Verifikation ist nicht ihr Ergebnis — das steht fest
   * —, sondern ihr AUFWAND. Eine unbekannte Kennung darf nicht daran
   * erkennbar sein, dass die Ablehnung sofort kommt.
   *
   * Geprüft wird deshalb nicht die Dauer (die Uhr steht in der
   * Workers-Runtime zwischen zwei E/A-Vorgängen still), sondern die
   * tatsächlich angeforderte Arbeit: dieselbe Ableitung mit demselben Work
   * Factor.
   */
  it('verbrennt denselben Work Factor wie eine echte Verifikation', async () => {
    const spion = vi.spyOn(crypto.subtle, 'deriveBits');

    try {
      await verifyDummyCredential(PEPPER);

      expect(spion).toHaveBeenCalledTimes(1);
      const algorithmus = deriveAlgorithm(spion.mock.calls[0]);
      expect(algorithmus.name).toBe('PBKDF2');
      expect(algorithmus.iterations).toBe(PBKDF2_ITERATIONS);
      expect(algorithmus.hash).toBe('SHA-256');
    } finally {
      spion.mockRestore();
    }
  });

  it('fordert dieselbe Ableitung an wie verifyCredential', async () => {
    const stored = await deriveCredential(DEMO_PIN, PEPPER, { iterations: PBKDF2_ITERATIONS });
    const spion = vi.spyOn(crypto.subtle, 'deriveBits');

    try {
      await verifyCredential(DEMO_PIN, PEPPER, stored);
      const echt = deriveAlgorithm(spion.mock.calls[0]);

      spion.mockClear();
      await verifyDummyCredential(PEPPER);
      const dummy = deriveAlgorithm(spion.mock.calls[0]);

      expect(dummy.name).toBe(echt.name);
      expect(dummy.iterations).toBe(echt.iterations);
      expect(dummy.hash).toBe(echt.hash);
    } finally {
      spion.mockRestore();
    }
  });
});
