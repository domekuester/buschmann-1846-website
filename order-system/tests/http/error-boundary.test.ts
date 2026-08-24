import { describe, expect, it } from 'vitest';
import { toSafeResponse } from '../../src/http/error-boundary';
import { AccessDeniedError, InvalidArgumentError, ValidationError } from '../../src/domain/errors';
import { ForbiddenError, UnauthenticatedError } from '../../src/http/guard';
import { privateHeaders } from '../../src/http/security';

async function body(response: Response): Promise<string> {
  return response.text();
}

/**
 * Die Fehlergrenze ist die Stelle, an der entschieden wird, was ein Café zu
 * sehen bekommt — und vor allem, was nicht. Ein Stacktrace, ein SQL-Fragment
 * oder auch nur der Name einer Fehlerklasse ist eine Auskunft über das
 * Innere des Systems.
 */
describe('toSafeResponse', () => {
  it('macht aus einem Eingabefehler eine 422 mit Feldmeldungen', async () => {
    const response = toSafeResponse(
      new ValidationError({
        fulfillment_date: 'Der Liefertag darf nicht in der Vergangenheit liegen.',
        items: 'Bitte mindestens ein Produkt bestellen.',
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'validation_failed',
      errors: {
        fulfillment_date: 'Der Liefertag darf nicht in der Vergangenheit liegen.',
        items: 'Bitte mindestens ein Produkt bestellen.',
      },
    });
  });

  it('macht aus einem abgelehnten Zugang eine 401 ohne Begründung', async () => {
    const response = toSafeResponse(new AccessDeniedError());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  /**
   * Der wichtigste Fall. Die Nachricht ist bewusst so gewählt, dass jedes
   * einzelne Fragment darin ein Leak wäre.
   */
  it('macht aus einem Datenbankfehler eine 500 ohne jede Einzelheit', async () => {
    const response = toSafeResponse(
      new Error('D1_ERROR: near "SELECT": syntax error at offset 42 in customer_access_tokens'),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });

    const text = await body(toSafeResponse(new Error('D1_ERROR: near "SELECT": syntax error')));
    for (const leak of ['D1_ERROR', 'near', 'syntax', 'SELECT', 'Error']) {
      expect(text).not.toContain(leak);
    }
  });

  it('gibt auch bei einer verletzten Invariante nichts preis', async () => {
    const response = toSafeResponse(new InvalidArgumentError('Die Kunden-ID der Bestellung ist ungültig.'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });

  it('kommt mit allem zurecht, was geworfen werden kann', async () => {
    for (const thrown of ['ein String', null, undefined, 42, { message: 'geheim' }, ['a']]) {
      const response = toSafeResponse(thrown);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('{"error":"internal_error"}');
    }
  });

  it('leakt keinen Stacktrace', async () => {
    const error = new Error('kaputt');
    expect(error.stack).toBeTruthy();
    expect(await body(toSafeResponse(error))).not.toContain('at ');
  });

  it('trägt auf jeder Antwort die Schutzheader', () => {
    for (const thrown of [new ValidationError({ a: 'b' }), new AccessDeniedError(), new Error('x')]) {
      const response = toSafeResponse(thrown);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});

describe('privateHeaders', () => {
  it('verhindert jedes Zwischenspeichern', () => {
    expect(privateHeaders()['cache-control']).toBe('no-store');
  });

  it('verhindert, dass der Token als Referer abfließt', () => {
    expect(privateHeaders()['referrer-policy']).toBe('no-referrer');
  });

  it('verhindert MIME-Raten, Einbettung und Indexierung', () => {
    const headers = privateHeaders();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-robots-tag']).toContain('noindex');
  });

  it('lässt sich um weitere Header ergänzen', () => {
    expect(privateHeaders({ 'content-security-policy': "default-src 'none'" })).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
    });
  });
});

/**
 * Die beiden Fehlerarten, die mit der Sitzungsauthentifizierung dazugekommen
 * sind. Der Unterschied zwischen 401 und 403 ist die Aussage: „Melde dich an"
 * gegenüber „das darfst du nicht".
 */
describe('Auth-Fehler', () => {
  it('macht aus UnauthenticatedError eine 401', async () => {
    const response = toSafeResponse(new UnauthenticatedError());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('macht aus ForbiddenError eine 403', async () => {
    const response = toSafeResponse(new ForbiddenError());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  /**
   * Die Antwort sagt nicht, WELCHE Prüfung fehlgeschlagen ist. Origin, CSRF
   * und Rolle sehen von außen gleich aus — alles andere wäre eine Anleitung.
   */
  it('verrät nicht, welche Prüfung fehlgeschlagen ist', async () => {
    const körper = await Promise.all(
      [
        new ForbiddenError('Origin stimmt nicht'),
        new ForbiddenError('CSRF-Token fehlt'),
        new ForbiddenError('Rolle reicht nicht'),
      ].map((fehler) => toSafeResponse(fehler).text()),
    );

    expect(new Set(körper).size).toBe(1);
    expect(körper[0]).not.toContain('Origin');
    expect(körper[0]).not.toContain('CSRF');
    expect(körper[0]).not.toContain('Rolle');
  });

  it('trägt auch bei diesen Fehlern no-store', () => {
    expect(toSafeResponse(new ForbiddenError()).headers.get('cache-control')).toBe('no-store');
    expect(toSafeResponse(new UnauthenticatedError()).headers.get('cache-control')).toBe('no-store');
  });
});
