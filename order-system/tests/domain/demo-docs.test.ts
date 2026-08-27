import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_ADMIN,
  DEMO_CUSTOMER_LOGINS,
  DEMO_PEPPER,
  DEMO_PORT,
  DEMO_URL,
  PROJECT_ROOT,
} from '../../scripts/demo/demo-config.mjs';

/**
 * DIE DOKUMENTE, ALS TEST.
 *
 * Zwei Fragen, die eine Textdatei nicht selbst beantworten kann:
 *
 *   1. Stehen in DEMO.md dieselben Zugangsdaten wie im Skript? Eine Anleitung
 *      mit einem veralteten Passwort ist schlimmer als keine — sie kostet die
 *      ersten fünf Minuten der Vorführung, und zwar vor Publikum. Deshalb
 *      werden Port, Adresse, Kennung und PIN hier gegen demo-config.mjs
 *      geprüft und nicht gegen ein Gedächtnis.
 *
 *   2. Ist aus den Betreiberdokumenten die Technik herausgehalten? Ein
 *      Handbuch für einen Bäckereiinhaber, in dem „D1", „Wrangler" oder ein
 *      Dateipfad steht, ist an dieser Stelle zu Ende gelesen.
 *
 * Was diese Datei NICHT prüfen kann, ist die Richtigkeit der Anleitungen.
 * Die hängt daran, dass sie gegen den laufenden Browser geschrieben wurden.
 */

const DOKUMENTE = {
  demo: 'docs/DEMO.md',
  walkthrough: 'docs/DEMO-WALKTHROUGH.md',
  handbuch: 'docs/BETREIBER-HANDBUCH.md',
  ersteSchritte: 'docs/ERSTE-SCHRITTE.md',
  checkliste: 'docs/UEBERGABE-CHECKLISTE.md',
} as const;

/** Die Dokumente, die einem Bäckereiinhaber in die Hand gegeben werden. */
const BETREIBERDOKUMENTE = [
  DOKUMENTE.handbuch,
  DOKUMENTE.ersteSchritte,
  DOKUMENTE.checkliste,
] as const;

function lies(pfad: string): string {
  return readFileSync(join(PROJECT_ROOT, pfad), 'utf8');
}

describe('Die Dokumente sind da', () => {
  it('legt alle fünf unter docs/ ab', () => {
    for (const pfad of Object.values(DOKUMENTE)) {
      expect(existsSync(join(PROJECT_ROOT, pfad)), pfad).toBe(true);
    }
  });
});

describe('DEMO.md nennt genau die Werte, mit denen die Demo startet', () => {
  it('nennt Port und Adresse', () => {
    const text = lies(DOKUMENTE.demo);

    expect(text).toContain(DEMO_URL);
    expect(text).toContain(String(DEMO_PORT));
  });

  it('nennt die Admin-Zugangsdaten wortgleich', () => {
    const text = lies(DOKUMENTE.demo);

    expect(text).toContain(DEMO_ADMIN.identifier);
    expect(text).toContain(DEMO_ADMIN.secret);
  });

  it('nennt jede Kundenkennung mit ihrer PIN', () => {
    const text = lies(DOKUMENTE.demo);

    for (const login of DEMO_CUSTOMER_LOGINS) {
      expect(text, `Kennung ${login.identifier}`).toContain(login.identifier);
      expect(text, `PIN zu ${login.identifier}`).toContain(login.pin);
    }
  });

  it('nennt beide Befehle', () => {
    const text = lies(DOKUMENTE.demo);

    expect(text).toContain('npm run demo');
    expect(text).toContain('npm run demo:reset');
  });

  /**
   * Der Pepper ist zwar kein Geheimnis, aber er gehört in kein Dokument, das
   * jemandem gezeigt wird: Er beantwortet keine Frage, die sich in einer
   * Vorführung stellt.
   */
  it('nennt den Pepper nicht', () => {
    expect(lies(DOKUMENTE.demo)).not.toContain(DEMO_PEPPER);
  });
});

describe('Die Betreiberdokumente bleiben frei von Technik', () => {
  /**
   * Die Liste ist absichtlich hart. Jeder Eintrag hier ist ein Wort, bei dem
   * ein Bäckereiinhaber aufhört zu lesen — oder eines, das in einem Dokument,
   * das aus dem Haus geht, gar nichts verloren hat.
   */
  const VERBOTEN = [
    'D1',
    'Worker',
    'Wrangler',
    'wrangler',
    'Cloudflare',
    'CSRF',
    'Repository',
    'Migration',
    'SELECT ',
    'INSERT ',
    'UPDATE ',
    '.dev.vars',
    'AUTH_PEPPER',
    'Pepper',
    'database_id',
    'npm run',
    'localhost',
    '127.0.0.1',
    '/Users/',
    '~/Desktop',
  ];

  for (const pfad of BETREIBERDOKUMENTE) {
    it(`hält ${pfad.split('/').pop()} frei von technischen Begriffen`, () => {
      const text = lies(pfad);

      for (const wort of VERBOTEN) {
        expect(text, `„${wort}" steht in ${pfad}`).not.toContain(wort);
      }
    });
  }

  it('nennt in keinem Betreiberdokument einen Port', () => {
    for (const pfad of BETREIBERDOKUMENTE) {
      const text = lies(pfad);

      expect(text, pfad).not.toContain(String(DEMO_PORT));
      expect(text, `${pfad} (Entwicklungsport)`).not.toContain('8787');
    }
  });

  /**
   * §22: Demo-Passwörter stehen in DEMO.md — und sonst nirgends. Ein
   * Handbuch, das mit Demo-Zugangsdaten übergeben wird, lädt dazu ein, sie
   * im Echtbetrieb auszuprobieren.
   */
  it('trägt die Demo-Zugangsdaten in kein Betreiberdokument', () => {
    for (const pfad of BETREIBERDOKUMENTE) {
      const text = lies(pfad);

      expect(text, pfad).not.toContain(DEMO_ADMIN.secret);
      expect(text, pfad).not.toContain(DEMO_ADMIN.identifier);
      for (const login of DEMO_CUSTOMER_LOGINS) {
        expect(text, `${pfad}: PIN ${login.identifier}`).not.toContain(login.pin);
      }
    }
  });
});

describe('Die Betreiberdokumente decken ab, was verlangt war', () => {
  it('führt das Handbuch alle zwölf Kapitel und den Arbeitstag', () => {
    const text = lies(DOKUMENTE.handbuch);

    for (const kapitel of [
      'Anmelden',
      'Dashboard',
      'Bestellungen bearbeiten',
      'Produktion',
      'Zahlung nachtragen',
      'Sortiment und Preise',
      'Kunden und Preisgruppen',
      'Bestellregeln',
      'Produktionsliste',
      'Abholliste',
      'Herstellkosten und Marge',
      'Was tun bei einem Fehler?',
      'Ein typischer Arbeitstag',
    ]) {
      expect(text, `Kapitel „${kapitel}"`).toContain(kapitel);
    }
  });

  it('erklärt das Handbuch, wem die Daten gehören', () => {
    const text = lies(DOKUMENTE.handbuch);

    expect(text).toContain('Die Preise gehören Ihrem Betrieb');
    expect(text).toContain('Bestellungen bleiben gespeichert');
    expect(text).toContain('Historische Preise bleiben historisch');
    expect(text).toContain('Kunden sehen Herstellkosten niemals');
  });

  it('bleibt die Checkliste zum Abhaken', () => {
    const text = lies(DOKUMENTE.checkliste);
    const kaestchen = text.match(/^- \[ \]/gm) ?? [];

    expect(kaestchen.length).toBeGreaterThanOrEqual(20);
    for (const punkt of [
      'Admin-Anmeldung funktioniert',
      'Preisgruppe',
      'Bestelltage',
      'Zahlungswege',
      'Produktionsliste',
      'Abholliste',
      'Datensicherung',
      'Ansprechpartner',
    ]) {
      expect(text, `Punkt „${punkt}"`).toContain(punkt);
    }
  });

  it('führt der Walkthrough alle neun Abschnitte in der verlangten Reihenfolge', () => {
    const text = lies(DOKUMENTE.walkthrough);
    const abschnitte = [
      'Dashboard',
      'Bestellung',
      'Produktion',
      'Bezahlung',
      'Preise',
      'Kunden',
      'Bestellregeln',
      'Drucklisten',
    ];

    let letzte = -1;
    for (const abschnitt of abschnitte) {
      const stelle = text.indexOf(`## `, letzte + 1);
      expect(stelle, `Abschnitt „${abschnitt}"`).toBeGreaterThan(-1);
      expect(text, `Abschnitt „${abschnitt}"`).toContain(abschnitt);
      letzte = stelle;
    }
  });

  /**
   * Der Walkthrough darf auf DEMO.md verweisen, aber die Zugangsdaten nicht
   * ein zweites Mal führen: Zwei Orte für dasselbe Passwort sind ein Ort zu
   * viel, sobald es sich ändert.
   */
  it('wiederholt der Walkthrough keine Zugangsdaten', () => {
    const text = lies(DOKUMENTE.walkthrough);

    expect(text).not.toContain(DEMO_ADMIN.secret);
    for (const login of DEMO_CUSTOMER_LOGINS) {
      expect(text, `PIN ${login.identifier}`).not.toContain(login.pin);
    }
    expect(text).toContain('DEMO.md');
  });
});
