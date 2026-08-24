import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config/app-config';
import type { AuthContext } from '../../src/application/authenticate-request';
import { ForbiddenError, assertCsrf, assertSameOrigin } from '../../src/http/guard';

const CONFIG: AppConfig = {
  environment: 'production',
  appOrigin: 'https://buschmann1846.de',
  pepper: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
};

const CSRF = 'c'.repeat(43);

const ADMIN_KONTEXT: AuthContext = {
  role: 'admin',
  accountId: 2,
  sessionId: 7,
  csrfToken: CSRF,
};

function post(headers: Record<string, string> = {}): Request {
  return new Request('https://buschmann1846.de/api/orders', { method: 'POST', headers });
}

describe('assertSameOrigin', () => {
  it('lässt den eigenen Origin durch', () => {
    expect(() => assertSameOrigin(post({ origin: 'https://buschmann1846.de' }), CONFIG)).not.toThrow();
  });

  it('lehnt einen fremden Origin ab', () => {
    expect(() => assertSameOrigin(post({ origin: 'https://angreifer.test' }), CONFIG)).toThrow(
      ForbiddenError,
    );
  });

  /**
   * Ein fehlender Origin bei einem POST aus einem modernen Browser kommt nicht
   * vor. Er wird deshalb abgelehnt und nicht durchgewunken — „vielleicht ist
   * es ein alter Browser" wäre die Lücke, durch die jedes Skript passt.
   */
  it('lehnt einen fehlenden Origin ab', () => {
    expect(() => assertSameOrigin(post(), CONFIG)).toThrow(ForbiddenError);
  });

  it('lehnt den leeren und den Null-Origin ab', () => {
    expect(() => assertSameOrigin(post({ origin: '' }), CONFIG)).toThrow(ForbiddenError);
    expect(() => assertSameOrigin(post({ origin: 'null' }), CONFIG)).toThrow(ForbiddenError);
  });

  /**
   * Der Vergleich ist exakt und kein startsWith. Sonst passierte
   * 'https://buschmann1846.de.angreifer.test' die Prüfung — eine Domain, die
   * einem Angreifer gehört und mit dem erwarteten Origin nur anfängt.
   */
  it('lehnt einen Origin ab, der mit dem erwarteten nur beginnt', () => {
    for (const origin of [
      'https://buschmann1846.de.angreifer.test',
      'https://buschmann1846.de:8443',
      'https://buschmann1846.de/',
      'http://buschmann1846.de',
      'https://www.buschmann1846.de',
    ]) {
      expect(() => assertSameOrigin(post({ origin }), CONFIG), origin).toThrow(ForbiddenError);
    }
  });

  it('vergleicht ohne Nachsicht bei Groß- und Kleinschreibung des Hosts', () => {
    expect(() => assertSameOrigin(post({ origin: 'https://BUSCHMANN1846.de' }), CONFIG)).toThrow(
      ForbiddenError,
    );
  });

  it('lässt in der Entwicklung den lokalen Origin durch', () => {
    const lokal: AppConfig = { ...CONFIG, environment: 'development', appOrigin: 'http://127.0.0.1:8787' };
    const anfrage = new Request('http://127.0.0.1:8787/api/orders', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:8787' },
    });

    expect(() => assertSameOrigin(anfrage, lokal)).not.toThrow();
  });

  /**
   * Fail closed: Ohne konfigurierten Origin gibt es nichts zu vergleichen —
   * und dann wird abgelehnt, nicht durchgelassen. Eine Ableitung aus
   * request.url wäre keine Prüfung, sondern eine Zeremonie: Der Wert käme vom
   * Aufrufer.
   */
  it('lehnt ab, wenn kein Origin konfiguriert ist', () => {
    const ohne = { ...CONFIG, appOrigin: '' } as AppConfig;
    expect(() => assertSameOrigin(post({ origin: 'https://buschmann1846.de' }), ohne)).toThrow(
      ForbiddenError,
    );
  });
});

describe('assertCsrf — Kopfzeile', () => {
  it('nimmt den richtigen Token an', () => {
    expect(() => assertCsrf(post({ 'x-csrf-token': CSRF }), ADMIN_KONTEXT)).not.toThrow();
  });

  it('lehnt einen fehlenden Token ab', () => {
    expect(() => assertCsrf(post(), ADMIN_KONTEXT)).toThrow(ForbiddenError);
  });

  it('lehnt einen leeren Token ab', () => {
    expect(() => assertCsrf(post({ 'x-csrf-token': '' }), ADMIN_KONTEXT)).toThrow(ForbiddenError);
  });

  it('lehnt einen falschen Token gleicher Länge ab', () => {
    expect(() => assertCsrf(post({ 'x-csrf-token': 'd'.repeat(43) }), ADMIN_KONTEXT)).toThrow(
      ForbiddenError,
    );
  });

  /**
   * Der Vergleich läuft über alle Zeichen und hört beim ersten Unterschied
   * nicht auf. Ein Token, der 42 von 43 Zeichen trifft, wird genauso
   * abgelehnt wie einer, der beim ersten danebenliegt — und die Laufzeit
   * verrät nicht, welcher von beiden es war.
   */
  it('lehnt einen Token mit richtigem Präfix ab', () => {
    const fast = CSRF.slice(0, 42) + (CSRF.slice(-1) === 'c' ? 'd' : 'c');
    expect(fast).not.toBe(CSRF);
    expect(() => assertCsrf(post({ 'x-csrf-token': fast }), ADMIN_KONTEXT)).toThrow(ForbiddenError);
  });

  it('lehnt einen zu kurzen und einen zu langen Token ab', () => {
    expect(() => assertCsrf(post({ 'x-csrf-token': CSRF.slice(0, 42) }), ADMIN_KONTEXT)).toThrow(
      ForbiddenError,
    );
    expect(() => assertCsrf(post({ 'x-csrf-token': CSRF + 'c' }), ADMIN_KONTEXT)).toThrow(
      ForbiddenError,
    );
  });
});

describe('assertCsrf — Formularfeld', () => {
  it('nimmt den richtigen Token aus dem Formular an', () => {
    const body = new URLSearchParams({ csrf_token: CSRF });
    expect(() => assertCsrf(post(), ADMIN_KONTEXT, body)).not.toThrow();
  });

  it('lehnt ein Formular ohne Token ab', () => {
    const body = new URLSearchParams({ etwas: 'anderes' });
    expect(() => assertCsrf(post(), ADMIN_KONTEXT, body)).toThrow(ForbiddenError);
  });

  it('lehnt ein Formular mit falschem Token ab', () => {
    const body = new URLSearchParams({ csrf_token: 'd'.repeat(43) });
    expect(() => assertCsrf(post(), ADMIN_KONTEXT, body)).toThrow(ForbiddenError);
  });

  /**
   * Die Kopfzeile hat Vorrang, das Formular ist der Rückfallweg. Beides
   * gleichzeitig kommt nicht vor — aber wenn doch, gewinnt der Wert, der
   * nicht aus dem Formularkörper stammt.
   */
  it('nimmt die Kopfzeile, wenn beides vorhanden ist', () => {
    const body = new URLSearchParams({ csrf_token: 'd'.repeat(43) });
    expect(() => assertCsrf(post({ 'x-csrf-token': CSRF }), ADMIN_KONTEXT, body)).not.toThrow();
  });

  it('lehnt ab, wenn die Kopfzeile falsch ist und das Formular richtig', () => {
    const body = new URLSearchParams({ csrf_token: CSRF });
    expect(() => assertCsrf(post({ 'x-csrf-token': 'd'.repeat(43) }), ADMIN_KONTEXT, body)).toThrow(
      ForbiddenError,
    );
  });
});

describe('assertCsrf — Bindung an die Sitzung', () => {
  /**
   * Der Token gilt für GENAU EINE Sitzung. Ein Token aus einer anderen
   * Sitzung — etwa der eigenen aus einem anderen Tab nach erneuter Anmeldung
   * — wird abgelehnt.
   */
  it('lehnt den CSRF-Token einer anderen Sitzung ab', () => {
    const andere: AuthContext = { ...ADMIN_KONTEXT, sessionId: 8, csrfToken: 'e'.repeat(43) };
    expect(() => assertCsrf(post({ 'x-csrf-token': CSRF }), andere)).toThrow(ForbiddenError);
  });

  it('sagt nicht, was falsch war', () => {
    try {
      assertCsrf(post({ 'x-csrf-token': 'd'.repeat(43) }), ADMIN_KONTEXT);
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain(CSRF);
      expect(text).not.toContain('d'.repeat(43));
    }
  });
});
