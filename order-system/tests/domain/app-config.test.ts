import { describe, expect, it } from 'vitest';
import { ConfigurationError, readAppConfig } from '../../src/config/app-config';

/**
 * Die Konfiguration ist die erste Stelle, an der Phase 3A fail closed sein
 * muss. Ein fehlender Pepper darf nicht zu „dann eben ohne" führen, und ein
 * versehentlicher Produktionsstart mit Entwicklungseinstellungen darf gar
 * nicht erst möglich sein.
 *
 * Der Testpepper ist ausdrücklich ein Testwert und kein Geheimnis: Er steht
 * hier im Klartext, in Git und in jedem Klon. Der echte Wert kommt aus einem
 * Cloudflare Secret und existiert nirgendwo in diesem Repository.
 */
const TEST_PEPPER = 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789';

describe('readAppConfig — Pepper', () => {
  it('lehnt einen fehlenden Pepper ab', () => {
    expect(() => readAppConfig({ APP_ORIGIN: 'https://buschmann1846.de' })).toThrow(
      ConfigurationError,
    );
  });

  it('lehnt einen leeren Pepper ab', () => {
    expect(() =>
      readAppConfig({ AUTH_PEPPER: '   ', APP_ORIGIN: 'https://buschmann1846.de' }),
    ).toThrow(ConfigurationError);
  });

  it('lehnt einen zu kurzen Pepper ab', () => {
    expect(() =>
      readAppConfig({ AUTH_PEPPER: 'zu-kurz', APP_ORIGIN: 'https://buschmann1846.de' }),
    ).toThrow(ConfigurationError);
  });

  it('nimmt einen ausreichend langen Pepper an', () => {
    const config = readAppConfig({
      AUTH_PEPPER: TEST_PEPPER,
      APP_ORIGIN: 'https://buschmann1846.de',
    });
    expect(config.pepper).toBe(TEST_PEPPER);
  });
});

describe('readAppConfig — Origin', () => {
  it('lehnt einen fehlenden Origin ab', () => {
    expect(() => readAppConfig({ AUTH_PEPPER: TEST_PEPPER })).toThrow(ConfigurationError);
  });

  it('lehnt einen Origin ohne Schema ab', () => {
    expect(() =>
      readAppConfig({ AUTH_PEPPER: TEST_PEPPER, APP_ORIGIN: 'buschmann1846.de' }),
    ).toThrow(ConfigurationError);
  });

  it('lehnt einen Origin mit Pfad ab', () => {
    expect(() =>
      readAppConfig({ AUTH_PEPPER: TEST_PEPPER, APP_ORIGIN: 'https://buschmann1846.de/login' }),
    ).toThrow(ConfigurationError);
  });

  it('lehnt einen Origin mit abschließendem Schrägstrich ab', () => {
    expect(() =>
      readAppConfig({ AUTH_PEPPER: TEST_PEPPER, APP_ORIGIN: 'https://buschmann1846.de/' }),
    ).toThrow(ConfigurationError);
  });

  it('nimmt den Produktions-Origin an', () => {
    const config = readAppConfig({
      AUTH_PEPPER: TEST_PEPPER,
      APP_ORIGIN: 'https://buschmann1846.de',
    });
    expect(config.appOrigin).toBe('https://buschmann1846.de');
  });
});

describe('readAppConfig — Umgebung', () => {
  it('ist ohne ENVIRONMENT Produktion', () => {
    const config = readAppConfig({
      AUTH_PEPPER: TEST_PEPPER,
      APP_ORIGIN: 'https://buschmann1846.de',
    });
    expect(config.environment).toBe('production');
  });

  /**
   * Der wichtigste Test dieser Datei. Ein Tippfehler in einer
   * Umgebungsvariablen darf nicht dazu führen, dass ein Produktionssystem
   * unsichere Cookies ausstellt. Alles außer dem exakten Wort 'development'
   * ist Produktion.
   */
  it('behandelt einen Tippfehler als Produktion', () => {
    for (const value of ['producton', 'Development', 'dev', 'DEVELOPMENT', '']) {
      const config = readAppConfig({
        AUTH_PEPPER: TEST_PEPPER,
        APP_ORIGIN: 'https://buschmann1846.de',
        ENVIRONMENT: value,
      });
      expect(config.environment).toBe('production');
    }
  });

  it('erkennt genau das Wort development', () => {
    const config = readAppConfig({
      AUTH_PEPPER: TEST_PEPPER,
      APP_ORIGIN: 'http://127.0.0.1:8787',
      ENVIRONMENT: 'development',
    });
    expect(config.environment).toBe('development');
  });

  /**
   * Der versehentliche Produktionsstart aus Abschnitt 24 der Vorgabe: Wer
   * ENVIRONMENT=development stehen lässt und gegen eine https-Adresse fährt,
   * bekäme Cookies ohne Secure. Das ist keine Warnung wert, sondern ein
   * Abbruch.
   */
  it('lehnt development zusammen mit einem https-Origin ab', () => {
    expect(() =>
      readAppConfig({
        AUTH_PEPPER: TEST_PEPPER,
        APP_ORIGIN: 'https://buschmann1846.de',
        ENVIRONMENT: 'development',
      }),
    ).toThrow(ConfigurationError);
  });

  it('lehnt Produktion mit einem http-Origin ab', () => {
    expect(() =>
      readAppConfig({
        AUTH_PEPPER: TEST_PEPPER,
        APP_ORIGIN: 'http://127.0.0.1:8787',
      }),
    ).toThrow(ConfigurationError);
  });
});

describe('readAppConfig — Verschwiegenheit', () => {
  /**
   * Ein ConfigurationError landet über die Fehlergrenze als 500 ohne Details
   * beim Aufrufer. Trotzdem darf seine Nachricht den Pepper nicht enthalten:
   * Sie kann in einem Stacktrace stehen, und ein Stacktrace kann in einem Log
   * landen.
   */
  it('nennt den Pepper in keiner Fehlermeldung', () => {
    try {
      readAppConfig({ AUTH_PEPPER: 'zu-kurz', APP_ORIGIN: 'https://buschmann1846.de' });
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      expect(String(error)).not.toContain('zu-kurz');
    }
  });
});
