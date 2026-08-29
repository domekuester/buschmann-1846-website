import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config/app-config';
import {
  DEVELOPMENT_COOKIE_NAME,
  PRODUCTION_COOKIE_NAME,
  clearSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  sessionCookieName,
} from '../../src/infrastructure/auth/cookie';

const PRODUKTION: AppConfig = {
  environment: 'production',
  appOrigin: 'https://buschmann1846.de',
  pepper: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
};

const ENTWICKLUNG: AppConfig = {
  environment: 'development',
  appOrigin: 'http://127.0.0.1:8787',
  pepper: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
};

const TOKEN = 'a'.repeat(43);
const EINE_WOCHE = 7 * 24 * 60 * 60;

describe('sessionCookieName', () => {
  it('benutzt in Produktion den __Host--Präfix', () => {
    expect(sessionCookieName(PRODUKTION)).toBe('__Host-buschmann_session');
    expect(PRODUCTION_COOKIE_NAME).toBe('__Host-buschmann_session');
  });

  /**
   * Zwei NAMEN statt eines Namens mit zwei Flag-Sätzen.
   *
   * Der __Host--Präfix ist für den Browser eine Zusage: Secure, Path=/, kein
   * Domain. Ein __Host--Cookie ohne Secure wird schlicht verworfen — es gibt
   * also keine Fassung dieses Namens, die über HTTP funktioniert. Statt die
   * Zusage umgebungsabhängig an- und abzuschalten, tragen die Umgebungen
   * verschiedene Namen. Ein Entwicklungs-Cookie kann dann gar nicht erst in
   * Produktion gelten.
   */
  it('benutzt in der Entwicklung einen anderen Namen', () => {
    expect(sessionCookieName(ENTWICKLUNG)).toBe('buschmann_session_dev');
    expect(DEVELOPMENT_COOKIE_NAME).not.toBe(PRODUCTION_COOKIE_NAME);
    expect(DEVELOPMENT_COOKIE_NAME.startsWith('__Host-')).toBe(false);
  });
});

describe('serializeSessionCookie — Produktion', () => {
  const cookie = serializeSessionCookie(PRODUKTION, TOKEN, EINE_WOCHE);

  it('trägt den Token unter dem Produktionsnamen', () => {
    expect(cookie.startsWith(`__Host-buschmann_session=${TOKEN};`)).toBe(true);
  });

  it('ist HttpOnly', () => {
    expect(cookie).toContain('HttpOnly');
  });

  it('ist Secure', () => {
    expect(cookie).toContain('Secure');
  });

  it('ist SameSite=Lax', () => {
    expect(cookie).toContain('SameSite=Lax');
  });

  it('gilt für den gesamten Pfad', () => {
    expect(cookie).toContain('Path=/');
  });

  /**
   * Kein Domain-Attribut: Mit Domain gälte das Cookie auch für jede
   * Subdomain. Ohne gilt es exakt für den Host, der es gesetzt hat — und der
   * __Host--Präfix macht daraus eine Zusage, die der Browser durchsetzt.
   */
  it('trägt kein Domain-Attribut', () => {
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });

  it('trägt die übergebene Lebensdauer', () => {
    expect(cookie).toContain(`Max-Age=${EINE_WOCHE}`);
  });
});

describe('serializeSessionCookie — Entwicklung', () => {
  const cookie = serializeSessionCookie(ENTWICKLUNG, TOKEN, EINE_WOCHE);

  it('lässt Secure weg, weil lokal über HTTP gearbeitet wird', () => {
    expect(cookie).not.toContain('Secure');
  });

  /**
   * Die Entwicklungspolicy ist KEIN Freibrief. Sie lässt genau das eine
   * Attribut weg, das über HTTP nicht funktioniert — alles andere bleibt.
   */
  it('behält alle übrigen Schutzattribute', () => {
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });
});

describe('clearSessionCookie', () => {
  it('setzt einen leeren Wert mit Max-Age=0', () => {
    const cookie = clearSessionCookie(PRODUKTION);

    expect(cookie.startsWith('__Host-buschmann_session=;')).toBe(true);
    expect(cookie).toContain('Max-Age=0');
  });

  /**
   * Ein Löschcookie muss dieselben Attribute tragen wie das gesetzte, sonst
   * betrachtet der Browser es als anderes Cookie und löscht gar nichts.
   */
  it('trägt dieselben Attribute wie das gesetzte Cookie', () => {
    const cookie = clearSessionCookie(PRODUKTION);

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('benutzt in der Entwicklung den Entwicklungsnamen ohne Secure', () => {
    const cookie = clearSessionCookie(ENTWICKLUNG);

    expect(cookie.startsWith('buschmann_session_dev=;')).toBe(true);
    expect(cookie).not.toContain('Secure');
  });
});

describe('readSessionCookie', () => {
  it('findet das Cookie allein', () => {
    expect(readSessionCookie(PRODUKTION, `__Host-buschmann_session=${TOKEN}`)).toBe(TOKEN);
  });

  it('findet es zwischen anderen Cookies', () => {
    const header = `theme=dark; __Host-buschmann_session=${TOKEN}; sprache=de`;
    expect(readSessionCookie(PRODUKTION, header)).toBe(TOKEN);
  });

  it('findet es auch ohne Leerzeichen nach dem Semikolon', () => {
    expect(readSessionCookie(PRODUKTION, `a=1;__Host-buschmann_session=${TOKEN};b=2`)).toBe(TOKEN);
  });

  it('liefert null ohne Header', () => {
    expect(readSessionCookie(PRODUKTION, null)).toBeNull();
    expect(readSessionCookie(PRODUKTION, '')).toBeNull();
  });

  it('liefert null, wenn das Cookie fehlt', () => {
    expect(readSessionCookie(PRODUKTION, 'theme=dark; sprache=de')).toBeNull();
  });

  /**
   * Exakter Namensvergleich, kein Präfixvergleich. Ein Cookie namens
   * '__Host-buschmann_session_alt' ist ein anderes Cookie — und wer es setzen
   * kann, soll damit keine Sitzung übernehmen.
   */
  it('verwechselt kein Cookie mit ähnlichem Namen', () => {
    for (const header of [
      `__Host-buschmann_session_alt=${TOKEN}`,
      `xx__Host-buschmann_session=${TOKEN}`,
      `buschmann_session=${TOKEN}`,
    ]) {
      expect(readSessionCookie(PRODUKTION, header)).toBeNull();
    }
  });

  /**
   * Die Umgebungen lesen einander nicht. Ein Cookie, das lokal ohne Secure
   * entstanden ist, gilt in Produktion nicht — und umgekehrt.
   */
  it('liest das Cookie der jeweils anderen Umgebung nicht', () => {
    expect(readSessionCookie(PRODUKTION, `buschmann_session_dev=${TOKEN}`)).toBeNull();
    expect(readSessionCookie(ENTWICKLUNG, `__Host-buschmann_session=${TOKEN}`)).toBeNull();
  });

  it('liefert null bei einem leeren Wert', () => {
    expect(readSessionCookie(PRODUKTION, '__Host-buschmann_session=')).toBeNull();
  });

  /**
   * Die inhaltliche Prüfung des Tokens passiert später beim Nachschlagen in
   * D1. Hier geht es nur darum, den Wert unverändert herauszureichen — ohne
   * eine eigene Meinung über sein Format.
   */
  it('reicht den Wert unverändert heraus', () => {
    expect(readSessionCookie(PRODUKTION, '__Host-buschmann_session=nicht-wohlgeformt')).toBe(
      'nicht-wohlgeformt',
    );
  });
});
