#!/usr/bin/env node
/**
 * SETZT DIE VORFÜHRUNG ZURÜCK — und nur sie.
 *
 * Gelöscht wird genau ein Verzeichnis: demo/.state. Darin liegt die
 * Wegwerf-D1 der Demo, sonst nichts. Danach wird der Bestand frisch
 * eingespielt, sodass unmittelbar wieder vorgeführt werden kann.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  WAS DIESES SKRIPT NICHT ANFASST:                                    ║
 * ║                                                                      ║
 * ║    order-system/.wrangler/state  — die persönliche Entwicklungs-D1   ║
 * ║    order-system/source-data/     — die echten Preislisten            ║
 * ║    order-system/.dev.vars        — die Werte der Entwicklung         ║
 * ║    jede entfernte Datenbank      — es gibt keinen Netzzugriff        ║
 * ║                                                                      ║
 * ║  Der Pfad ist fest verdrahtet und kommt aus demo-config.mjs. Es gibt ║
 * ║  kein Argument, mit dem sich ein anderes Verzeichnis löschen ließe.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_DIR, DEMO_STATE_DIR } from './demo/demo-config.mjs';
import { seedDemo } from './demo-seed.mjs';
import { meldeFehler } from './demo/demo-terminal.mjs';

export async function resetDemo({ leise = false } = {}) {
  const melden = (text) => {
    if (!leise) process.stdout.write(text);
  };

  if (existsSync(DEMO_STATE_DIR)) {
    melden('  Alte Demo-Datenbank entfernen …\n');
    rmSync(DEMO_STATE_DIR, { recursive: true, force: true });
  }

  // Ein liegengebliebenes Zwischenergebnis eines abgebrochenen Laufs.
  rmSync(join(DEMO_DIR, 'seed.generated.sql'), { force: true });

  return await seedDemo({ leise });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write('\nDemo zurücksetzen …\n\n');
    const ergebnis = await resetDemo();
    process.stdout.write(
      `\n✅ Die Demo steht wieder auf dem Ausgangsstand.\n` +
        `   Leittag ${ergebnis.leittag} · ${ergebnis.zaehler.bestellungen} Bestellungen · ` +
        `${ergebnis.zaehler.kunden} Kunden\n\n` +
        '   Starten mit:  npm run demo\n\n',
    );
  } catch (fehler) {
    meldeFehler('Die Demo konnte nicht zurückgesetzt werden.', fehler);
    process.exitCode = 1;
  }
}
