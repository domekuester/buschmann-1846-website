import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_CONFIG_FILE,
  DEMO_DEV_VARS_FILE,
  DEMO_DIR,
  DEMO_HOST,
  DEMO_PORT,
  DEMO_STATE_DIR,
  DEMO_URL,
  PROJECT_ROOT,
} from '../../scripts/demo/demo-config.mjs';
import { devVarsInhalt } from '../../scripts/demo-start.mjs';

/**
 * DIE ZUSAGE DER PHASE 8B, ALS TEST.
 *
 * „Die Demo fasst die persönliche Entwicklungsdatenbank nicht an" ist eine
 * Behauptung über Dateipfade und Kommandozeilen — also über etwas, das sich
 * lesen lässt. Diese Datei liest es.
 *
 * Sie prüft nicht, ob die Demo funktioniert (das tun demo-dataset.test.ts und
 * demo-seed.test.ts), sondern ob sie es AUF DIE SICHERE ART tut: kein
 * --remote, jeder Wrangler-Aufruf mit eigener Konfiguration und eigenem
 * Zustandsverzeichnis, und ein Zurücksetzen, das nur ein einziges Verzeichnis
 * kennt.
 *
 * Ein Test wie dieser ist billig und fängt genau den Fehler ab, der in der
 * Vorführung nicht auffiele, sondern hinterher: ein vergessenes Flag, das die
 * Demo still gegen die Arbeitsdatenbank laufen ließe.
 */

const DATEIEN = {
  seed: 'scripts/demo-seed.mjs',
  start: 'scripts/demo-start.mjs',
  reset: 'scripts/demo-reset.mjs',
  config: 'scripts/demo/demo-config.mjs',
  dataset: 'scripts/demo/demo-dataset.mjs',
  terminal: 'scripts/demo/demo-terminal.mjs',
} as const;

function lies(pfad: string): string {
  return readFileSync(join(PROJECT_ROOT, pfad), 'utf8');
}

/**
 * Quelltext OHNE Kommentare.
 *
 * Diese Datei prüft, was die Skripte TUN — nicht, worüber sie schreiben. Die
 * Demo-Skripte erklären in ihren Kommentaren ausführlich, warum es kein
 * --remote gibt und warum sie die wrangler.jsonc der Entwicklung nicht
 * anfassen; ohne diesen Schnitt schlüge jede Prüfung genau an der Erklärung
 * an, die sie belegen soll.
 */
function code(pfad: string): string {
  return lies(pfad)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Der Zustand der Entwicklung — das Verzeichnis, das unberührt bleiben MUSS. */
const PERSOENLICHER_ZUSTAND = join(PROJECT_ROOT, '.wrangler');

describe('Die Demo kann keine entfernte Datenbank erreichen', () => {
  it('nennt --remote in keinem Demo-Skript', () => {
    for (const [name, pfad] of Object.entries(DATEIEN)) {
      expect(code(pfad), `${name} (${pfad})`).not.toContain('--remote');
    }
  });

  it('nennt --remote nicht in der Demo-Konfiguration', () => {
    expect(readFileSync(DEMO_CONFIG_FILE, 'utf8')).not.toContain('--remote');
  });

  it('setzt in jedem d1-Aufruf ausdrücklich --local', () => {
    const quelle = code(DATEIEN.seed);
    const aufrufe = [...quelle.matchAll(/demoWrangler\(\[([^\]]*)\]/g)].map((t) => t[1] ?? '');

    expect(aufrufe.length).toBeGreaterThan(0);
    for (const aufruf of aufrufe) {
      if (aufruf.includes("'d1'")) {
        expect(aufruf).toContain("'--local'");
      }
    }
  });
});

describe('Die Demo schreibt ausschließlich in ihr eigenes Verzeichnis', () => {
  it('legt das Zustandsverzeichnis unter demo/ an — und nicht unter .wrangler/', () => {
    expect(DEMO_STATE_DIR.startsWith(`${DEMO_DIR}/`)).toBe(true);
    expect(DEMO_STATE_DIR.startsWith(PERSOENLICHER_ZUSTAND)).toBe(false);
    expect(DEMO_DIR.startsWith(PERSOENLICHER_ZUSTAND)).toBe(false);
  });

  /**
   * DER WICHTIGSTE TEST DIESER DATEI. Ein Wrangler-Aufruf ohne --persist-to
   * benutzt das Verzeichnis neben der Konfigurationsdatei; steht dort einmal
   * die falsche Konfiguration, liefe der Seed gegen die Arbeitsdatenbank.
   * Beide Flags stehen deshalb an genau einer Stelle — und die wird hier
   * festgehalten.
   */
  it('reicht jedem Wrangler-Aufruf --config UND --persist-to mit', () => {
    const seed = code(DATEIEN.seed);
    expect(seed).toMatch(/'--config',\s*DEMO_CONFIG_FILE/);
    expect(seed).toMatch(/'--persist-to',\s*DEMO_STATE_DIR/);

    const start = code(DATEIEN.start);
    expect(start).toContain('DEMO_CONFIG_FILE');
    expect(start).toContain('DEMO_STATE_DIR');
  });

  it('löscht beim Zurücksetzen nur das Zustandsverzeichnis der Demo', () => {
    const reset = code(DATEIEN.reset);
    const loeschungen = [...reset.matchAll(/rmSync\(\s*([^,)]+)/g)].map((t) => (t[1] ?? '').trim());

    expect(loeschungen.length).toBeGreaterThan(0);
    for (const ziel of loeschungen) {
      // Erlaubt sind genau zwei Ziele: das Zustandsverzeichnis und das
      // Zwischenergebnis des Seeds — beide innerhalb von demo/.
      expect(
        ziel === 'DEMO_STATE_DIR' || ziel.startsWith('join(DEMO_DIR'),
        `rmSync-Ziel: ${ziel}`,
      ).toBe(true);
    }
  });

  it('nimmt kein Verzeichnis von der Kommandozeile entgegen', () => {
    const reset = code(DATEIEN.reset);

    // process.argv[1] im Ausführungswächter am Dateiende ist der einzige
    // erlaubte Zugriff — er entscheidet, OB gelaufen wird, nicht WORAUF.
    const zugriffe = [...reset.matchAll(/process\.argv\[(\d+)\]/g)].map((t) => t[1]);
    expect(zugriffe.every((index) => index === '1')).toBe(true);
    expect(reset).not.toMatch(/rmSync\([^)]*argv/);
  });
});

describe('Die Umgebungswerte der Demo passen zum Demo-Port', () => {
  /**
   * Ein APP_ORIGIN mit dem falschen Port ist der teuerste denkbare Fehler
   * dieser Phase: Anmelden geht, Lesen geht — und beim ersten Klick, der
   * etwas speichert, kommt eine Fehlermeldung. Vor Publikum.
   */
  it('schreibt genau den Origin, unter dem die Demo auch läuft', () => {
    const inhalt = devVarsInhalt();

    expect(inhalt).toContain(`APP_ORIGIN="${DEMO_URL}"`);
    expect(DEMO_URL).toBe(`http://${DEMO_HOST}:${DEMO_PORT}`);
  });

  it('schaltet die Entwicklungs-Cookie-Policy frei — die Demo läuft ohne TLS', () => {
    expect(devVarsInhalt()).toContain('ENVIRONMENT="development"');
  });

  it('legt die Datei neben die Demo-Konfiguration, wo Wrangler sie sucht', () => {
    expect(DEMO_DEV_VARS_FILE).toBe(join(DEMO_DIR, '.dev.vars'));
    expect(DEMO_CONFIG_FILE.startsWith(`${DEMO_DIR}/`)).toBe(true);
  });

  it('hält die erzeugte Datei und den Demo-Zustand aus Git heraus', () => {
    const ignoriert = readFileSync(join(DEMO_DIR, '.gitignore'), 'utf8');

    expect(ignoriert).toMatch(/^\.dev\.vars$/m);
    expect(ignoriert).toMatch(/^\.state\/$/m);

    // Wranglers Bauverzeichnis entsteht neben der Konfigurationsdatei und
    // damit ebenfalls in demo/ — die Regel in der obersten .gitignore trifft
    // nur order-system/.wrangler/.
    expect(ignoriert).toMatch(/^\.wrangler\/$/m);
  });

  it('lässt aus demo/ nur die beiden Quelldateien in Git', () => {
    const beabsichtigt = ['.gitignore', 'wrangler.demo.jsonc'];
    const vorhanden = readdirSync(DEMO_DIR).filter(
      (name) => !['.state', '.wrangler', '.dev.vars'].includes(name) && !name.endsWith('.generated.sql'),
    );

    expect(vorhanden.sort()).toEqual(beabsichtigt.sort());
  });
});

describe('Die Demo-Skripte handeln nur, wenn sie aufgerufen werden', () => {
  /**
   * Ein Modul, das beim Importieren einen Server startet, startet ihn
   * irgendwann ungefragt — zum Beispiel aus einem Testlauf heraus. Genau das
   * ist beim Schreiben dieser Datei passiert: Der Import von demo-start.mjs
   * lief bis zur Portprüfung durch.
   */
  it('startet die Vorführung nicht beim bloßen Import', () => {
    for (const pfad of [DATEIEN.start, DATEIEN.reset, DATEIEN.seed]) {
      const quelle = code(pfad);
      const datei = pfad.split('/').pop();

      expect(quelle, datei).toMatch(
        new RegExp(`process\\.argv\\[1\\]\\?\\.endsWith\\('${datei}'\\)|import\\.meta\\.url`),
      );
    }
  });
});

describe('Die Demo hängt nicht an der Entwicklungsumgebung', () => {
  it('liest weder .dev.vars noch wrangler.jsonc der Entwicklung', () => {
    for (const pfad of Object.values(DATEIEN)) {
      const quelle = code(pfad);
      expect(quelle).not.toContain('wrangler.jsonc');
      // Erlaubt ist ausschließlich der Pfad der Demo (DEMO_DEV_VARS_FILE).
      expect(quelle).not.toMatch(/['"`][^'"`]*\.\.\/\.dev\.vars/);
    }
  });

  it('startet auf dem festen Demo-Port und nicht auf einem zufälligen', () => {
    const start = code(DATEIEN.start);

    expect(start).toContain("'--port'");
    expect(start).toContain('String(DEMO_PORT)');
    expect(start).not.toMatch(/Math\.random|DEMO_PORT\s*\+/);
  });

  it('bricht bei belegtem Port ab, statt auszuweichen', () => {
    const start = code(DATEIEN.start);

    expect(start).toContain('istPortFrei');
    expect(start).toContain('bereits belegt');
    expect(start).toContain('lsof');
  });
});

describe('Die npm-Befehle zeigen auf die Demo-Skripte', () => {
  it('bietet demo, demo:reset und demo:seed an', () => {
    const paket = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(paket.scripts['demo']).toBe('node scripts/demo-start.mjs');
    expect(paket.scripts['demo:reset']).toBe('node scripts/demo-reset.mjs');
    expect(paket.scripts['demo:seed']).toBe('node scripts/demo-seed.mjs');
  });

  it('lässt die Befehle der Entwicklung unverändert', () => {
    const paket = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(paket.scripts['dev']).toBe('wrangler dev');
    expect(paket.scripts['db:migrate:local']).toBe('wrangler d1 migrations apply DB --local');
    expect(paket.scripts['release:check']).toContain('npm run typecheck');
  });
});
