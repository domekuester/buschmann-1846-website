import { describe, expect, it } from 'vitest';
import { GENERIC_LOGIN_ERROR, renderLoginPage } from '../../src/ui/login-page-html';

const OHNE_FEHLER = renderLoginPage({ errorMessage: null });
const MIT_FEHLER = renderLoginPage({ errorMessage: GENERIC_LOGIN_ERROR });

describe('renderLoginPage — Formular', () => {
  it('ordnet Marke und Anmeldung als zwei klar getrennte Bereiche an', () => {
    expect(OHNE_FEHLER).toContain('class="anmeldung__markenfeld"');
    expect(OHNE_FEHLER).toContain('class="anmeldung__zugang"');
    expect(OHNE_FEHLER).toContain('Düsseldorfer Pâtisserie. Seit 1846.');
  });

  it('erklärt Anmeldung und Kontopreise ohne eine Preiswahl anzubieten', () => {
    expect(OHNE_FEHLER).toContain('Mit Kundencode oder E-Mail anmelden.');
    expect(OHNE_FEHLER).toContain(
      'Nach der Anmeldung siehst du automatisch die Preise für dein Kundenkonto.',
    );
    expect(OHNE_FEHLER).not.toContain('name="price');
  });

  it('ist ein echtes Formular mit POST auf /login', () => {
    expect(OHNE_FEHLER).toContain('<form method="post" action="/login"');
  });

  /**
   * Progressive Enhancement: Der Login funktioniert OHNE JavaScript. Es gibt
   * kein Login-Skript, und deshalb darf die Seite auch keines laden — ein
   * fehlgeschlagener Skript-Download würde sonst die Anmeldung verhindern.
   */
  it('lädt kein Skript', () => {
    expect(OHNE_FEHLER).not.toContain('<script');
    expect(OHNE_FEHLER).not.toContain('app.js');
  });

  it('enthält genau ein Formular', () => {
    expect(OHNE_FEHLER.match(/<form/g)).toHaveLength(1);
  });

  it('hat genau zwei Eingabefelder', () => {
    expect(OHNE_FEHLER.match(/<input/g)).toHaveLength(2);
  });

  it('hat eine Absendeschaltfläche', () => {
    expect(OHNE_FEHLER).toContain('type="submit"');
    expect(OHNE_FEHLER).toContain('Anmelden');
  });
});

describe('renderLoginPage — Barrierefreiheit', () => {
  it('verbindet echte Labels mit den Feldern', () => {
    expect(OHNE_FEHLER).toContain('<label for="kennung"');
    expect(OHNE_FEHLER).toContain('id="kennung"');
    expect(OHNE_FEHLER).toContain('<label for="geheimnis"');
    expect(OHNE_FEHLER).toContain('id="geheimnis"');
  });

  it('benennt die Felder so, wie der Server sie liest', () => {
    expect(OHNE_FEHLER).toContain('name="identifier"');
    expect(OHNE_FEHLER).toContain('name="secret"');
  });

  it('erlaubt dem Passwortmanager, seine Arbeit zu tun', () => {
    expect(OHNE_FEHLER).toContain('autocomplete="username"');
    expect(OHNE_FEHLER).toContain('autocomplete="current-password"');
    expect(OHNE_FEHLER).not.toContain('autocomplete="off"');
  });

  it('verbirgt das Geheimnis bei der Eingabe', () => {
    expect(OHNE_FEHLER).toContain('type="password"');
  });

  /**
   * Kein inputmode="numeric": Dasselbe Feld nimmt eine 8-stellige PIN und ein
   * 16-Zeichen-Admin-Passwort auf. Eine erzwungene Zifferntastatur machte die
   * Passworteingabe auf dem Telefon unmöglich — und die Alternative wäre,
   * vorher nach der Rolle zu fragen. Genau das soll die Loginseite nicht tun.
   */
  it('erzwingt keine Zifferntastatur', () => {
    expect(OHNE_FEHLER).not.toContain('inputmode');
  });

  it('nennt die Seite in der Sprache der Benutzer', () => {
    expect(OHNE_FEHLER).toContain('<html lang="de">');
  });

  it('ist auf dem Telefon lesbar, ohne zu zoomen', () => {
    expect(OHNE_FEHLER).toContain('width=device-width, initial-scale=1');
  });
});

describe('renderLoginPage — Fehlermeldung', () => {
  it('zeigt ohne Fehler keinen Fehlerbereich', () => {
    expect(OHNE_FEHLER).not.toContain('id="login-fehler"');
    expect(OHNE_FEHLER).not.toContain('role="alert"');
    expect(OHNE_FEHLER).not.toContain(GENERIC_LOGIN_ERROR);
  });

  it('zeigt mit Fehler genau die generische Meldung', () => {
    expect(MIT_FEHLER).toContain(GENERIC_LOGIN_ERROR);
    expect(GENERIC_LOGIN_ERROR).toBe('Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.');
  });

  it('meldet den Fehler auch Screenreadern', () => {
    expect(MIT_FEHLER).toContain('role="alert"');
  });

  it('verbindet die Meldung mit dem Kennungsfeld', () => {
    expect(MIT_FEHLER).toContain('aria-describedby="login-fehler"');
    expect(MIT_FEHLER).toContain('id="login-fehler"');
  });

  it('nennt einen professionellen Weg zurück zum Zugang', () => {
    expect(OHNE_FEHLER).toContain('Zugang verloren? Bitte melde dich bei Buschmann 1846.');
  });

  /**
   * Die Kennung bleibt NICHT stehen. Das ist ungewöhnlich und Absicht: Ein
   * vorbelegtes Feld wäre bequemer, aber die Seite wird auf einem geteilten
   * Tresengerät angezeigt — und der letzte fehlgeschlagene Kundencode geht
   * niemanden etwas an, der als Nächstes davorsteht.
   */
  it('belegt die Felder nach einem Fehlversuch nicht vor', () => {
    expect(MIT_FEHLER).not.toContain('value="');
  });
});

describe('renderLoginPage — was NICHT darin steht', () => {
  /**
   * Keine Rollenauswahl. Das System kennt die Rolle anhand des Kontos; eine
   * Auswahl wäre nicht nur ein überflüssiger Tap, sondern eine Auskunft
   * darüber, welche Rollen es gibt — und die Versuchung, sie irgendwann zu
   * glauben.
   */
  it('fragt nicht nach der Rolle', () => {
    for (const wort of ['admin', 'Admin', 'customer', 'Café-Login', 'Ich bin']) {
      expect(OHNE_FEHLER).not.toContain(wort);
    }
    expect(OHNE_FEHLER).not.toContain('<select');
    expect(OHNE_FEHLER).not.toContain('type="radio"');
  });

  it('bietet keine Zusatzoptionen an', () => {
    for (const wort of ['Remember', 'Angemeldet bleiben', 'CAPTCHA', 'Google', 'Microsoft', 'Passwort vergessen']) {
      expect(OHNE_FEHLER).not.toContain(wort);
    }
    expect(OHNE_FEHLER).not.toContain('type="checkbox"');
  });

  it('lädt nichts von einem fremden Host', () => {
    expect(OHNE_FEHLER).not.toContain('http://');
    expect(OHNE_FEHLER).not.toMatch(/https:\/\/(?!schema)/);
    expect(OHNE_FEHLER).not.toContain('fonts.googleapis');
    expect(OHNE_FEHLER).not.toContain('//cdn');
  });

  it('hat keinen Inline-Stil und kein Inline-Skript', () => {
    expect(OHNE_FEHLER).not.toContain('<style');
    expect(OHNE_FEHLER).not.toContain(' style="');
    expect(OHNE_FEHLER).not.toContain('onclick');
    expect(OHNE_FEHLER).not.toContain('onsubmit');
  });

  it('will nicht indexiert werden', () => {
    expect(OHNE_FEHLER).toContain('noindex');
  });

  /**
   * KEIN `<meta name="referrer">` — und das ist kein Schönheitsfehler.
   *
   * Ein Meta-Tag gewinnt gegenüber der HTTP-Kopfzeile. Solange hier
   * `no-referrer` stand, serialisierte der Browser den Origin jeder
   * Formularabsendung als 'null' (so verlangt es der Fetch-Standard) — und
   * die Origin-Prüfung lehnte JEDE Anmeldung ab. Die Worker-Tests konnten das
   * nicht sehen, weil sie die Kopfzeile selbst setzen.
   *
   * Die Policy hat genau eine Quelle: src/http/security.ts.
   */
  it('trägt keine eigene Referrer-Policy im Markup', () => {
    expect(OHNE_FEHLER).not.toContain('name="referrer"');
  });
});

describe('renderLoginPage — Escaping', () => {
  /**
   * Die Fehlermeldung ist heute eine Konstante. Der Test besteht trotzdem
   * darauf, dass sie escaped wird: Die Regel „hier wird nie roher Text
   * eingesetzt" hält länger als die Kenntnis darüber, woher der Wert stammt.
   */
  it('escaped die Fehlermeldung', () => {
    const boshaft = renderLoginPage({ errorMessage: '<script>alert(1)</script>' });

    expect(boshaft).not.toContain('<script>alert(1)</script>');
    expect(boshaft).toContain('&lt;script&gt;');
  });
});
