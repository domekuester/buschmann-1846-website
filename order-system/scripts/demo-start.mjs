#!/usr/bin/env node
/**
 * STARTET DIE VORFÜHRUNG — ein Befehl, vier Schritte.
 *
 *   1. Ist der Demo-Port frei?
 *   2. Umgebungswerte der Demo schreiben (demo/.dev.vars)
 *   3. Migrationen anwenden und den Demo-Bestand einspielen
 *   4. Worker auf dem festen Demo-Port starten
 *
 * DER BESTAND WIRD BEI JEDEM START NEU GESÄT. Das ist Absicht: Jede
 * Vorführung beginnt damit an derselben Stelle, mit denselben Bestellungen,
 * denselben Zahlungsständen und denselben Zugangsdaten. Was in der letzten
 * Vorführung geklickt wurde, ist weg — und genau das ist gemeint, wenn eine
 * Demo „reproduzierbar" heißt.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALLES LÄUFT LOKAL. Kein --remote, keine Produktionsdomain, keine    ║
 * ║  entfernte D1, kein Mailversand, keine Webhooks. Die persönliche     ║
 * ║  Entwicklungsdatenbank in order-system/.wrangler/state wird nicht    ║
 * ║  angefasst — siehe scripts/demo-seed.mjs.                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import {
  DEMO_ADMIN,
  DEMO_CONFIG_FILE,
  DEMO_CUSTOMER_LOGINS,
  DEMO_DEV_VARS_FILE,
  DEMO_HOST,
  DEMO_PEPPER,
  DEMO_PORT,
  DEMO_STATE_DIR,
  DEMO_URL,
  PROJECT_ROOT,
} from './demo/demo-config.mjs';
import { meldeFehler } from './demo/demo-terminal.mjs';
import { seedDemo } from './demo-seed.mjs';

/**
 * Ist der Port frei?
 *
 * Gefragt wird durch VERSUCHTES BELEGEN und nicht durch eine Verbindung:
 * „Da antwortet niemand" heißt nicht „da hört niemand zu". Der Socket wird
 * sofort wieder geschlossen; zwischen dieser Prüfung und dem Start von
 * Wrangler bleibt ein winziges Zeitfenster, in dem sich jemand anderes den
 * Port nehmen könnte — dann meldet es Wrangler selbst.
 */
export function istPortFrei(port, host) {
  return new Promise((aufloesen) => {
    const server = createServer();
    server.once('error', () => aufloesen(false));
    server.once('listening', () => server.close(() => aufloesen(true)));
    server.listen(port, host);
  });
}

/**
 * Die Umgebungswerte des Demo-Workers.
 *
 * Sie werden bei JEDEM Start geschrieben und nicht nur, wenn die Datei fehlt:
 * Eine von Hand verstellte Zeile — ein anderer Port im APP_ORIGIN etwa —
 * führte sonst zu einer Demo, in der man sich anmelden, aber nichts speichern
 * kann. Die Datei ist ein Ergebnis, keine Einstellung.
 */
export function devVarsInhalt() {
  return [
    '# ERZEUGT VON scripts/demo-start.mjs — HANDÄNDERUNGEN WERDEN ÜBERSCHRIEBEN.',
    '#',
    '# Diese Werte gelten ausschließlich für die lokale Vorführung. Sie sind',
    '# öffentlich bekannt (siehe scripts/demo/demo-config.mjs) und dürfen',
    '# niemals in einer echten Umgebung gesetzt werden.',
    '',
    `AUTH_PEPPER="${DEMO_PEPPER}"`,
    `APP_ORIGIN="${DEMO_URL}"`,
    'ENVIRONMENT="development"',
    '',
  ].join('\n');
}

function banner(leittag) {
  const kunden = DEMO_CUSTOMER_LOGINS.map(
    (k) => `      ${k.identifier.padEnd(12)} PIN ${k.pin}    (${k.fall})`,
  ).join('\n');

  return `
──────────────────────────────────────────────────────────────────────────
  BUSCHMANN 1846 — VORFÜHRUNG

  Adresse       ${DEMO_URL}
  Leittag       ${leittag}   (Dashboard und Produktion öffnen diesen Tag)

  Anmeldung Betrieb
      ${DEMO_ADMIN.identifier}
      ${DEMO_ADMIN.secret}

  Anmeldung Kunden
${kunden}

  Beenden       Strg + C
  Zurücksetzen  npm run demo:reset
──────────────────────────────────────────────────────────────────────────
`;
}

async function main() {
  process.stdout.write('\nVorführung vorbereiten …\n\n');

  process.stdout.write('  Port prüfen …\n');
  if (!(await istPortFrei(DEMO_PORT, DEMO_HOST))) {
    /**
     * KEIN HEIMLICHES AUSWEICHEN AUF EINEN ANDEREN PORT. Eine Demo, deren
     * Adresse sich von selbst ändert, ist eine Demo, deren Adresse niemand
     * kennt — und DEMO.md stünde ab sofort daneben. Lieber ein Abbruch mit
     * zwei Befehlen zum Kopieren.
     */
    meldeFehler(`Demo-Port ${DEMO_PORT} ist bereits belegt.`, null, [
      'Vermutlich läuft die Demo schon in einem anderen Terminal-Fenster.',
      '',
      'Wer den Port belegt:',
      `    lsof -nP -iTCP:${DEMO_PORT} -sTCP:LISTEN`,
      '',
      'Den Vorgang beenden (die PID aus der Ausgabe oben einsetzen):',
      '    kill <PID>',
      '',
      `Danach noch einmal:  npm run demo`,
    ]);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('  Umgebungswerte schreiben …\n');
  writeFileSync(DEMO_DEV_VARS_FILE, devVarsInhalt(), 'utf8');

  let ergebnis;
  try {
    ergebnis = await seedDemo();
  } catch (fehler) {
    meldeFehler('Die Demo-Daten konnten nicht eingespielt werden.', fehler, [
      'Ein vollständiger Neuaufbau behebt das in aller Regel:',
      '    npm run demo:reset',
    ]);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(banner(ergebnis.leittag));
  process.stdout.write('  Der Server startet. Bitte einen Moment …\n');

  /**
   * Wrangler übernimmt das Terminal. `stdio: 'inherit'` heißt: Strg+C geht an
   * Wrangler, und der Server hört auf, wenn der Betrachter aufhört — kein
   * Prozess, der nach der Vorführung weiterläuft und beim nächsten Start den
   * Port belegt.
   */
  const kind = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--config',
      DEMO_CONFIG_FILE,
      '--persist-to',
      DEMO_STATE_DIR,
      '--ip',
      DEMO_HOST,
      '--port',
      String(DEMO_PORT),
    ],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  );

  kind.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

/**
 * NUR BEIM DIREKTEN AUFRUF STARTEN.
 *
 * Ohne diesen Wächter genügte ein `import` aus einem Test, um Port zu prüfen,
 * zu seeden und einen Server zu starten — dieselbe Vorkehrung wie in
 * scripts/create-local-auth-account.mjs und aus demselben Grund: Ein Modul,
 * das beim Importieren handelt, handelt irgendwann ungefragt.
 */
if (process.argv[1]?.endsWith('demo-start.mjs')) {
  await main();
}
