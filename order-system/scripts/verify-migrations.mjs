#!/usr/bin/env node
/**
 * Führt die vollständige Migrationskette gegen eine WEGWERF-D1 aus und prüft
 * das Ergebnis.
 *
 * DIE PERSÖNLICHE ENTWICKLUNGSDATENBANK WIRD NICHT ANGEFASST.
 *
 * Das ist die wichtigste Eigenschaft dieses Skripts, und sie hängt an einem
 * einzigen Detail: Jeder Wrangler-Aufruf bekommt `--persist-to` auf ein
 * frisches Verzeichnis unter os.tmpdir(). Ohne dieses Flag benutzt Wrangler
 * `.wrangler/state` — also genau die Datenbank, an der lokal gearbeitet wird.
 * Das Verzeichnis wird am Ende wieder gelöscht.
 *
 * KEIN --remote. Nirgends. Dieses Skript kann eine Produktionsdatenbank nicht
 * erreichen, weil es das Flag nicht kennt.
 *
 * Geprüft wird:
 *
 *   1. Die Kette läuft auf einer LEEREN Datenbank vollständig durch.
 *   2. Ein zweiter Lauf ändert nichts (Idempotenz).
 *   3. Alle erwarteten Tabellen stehen da.
 *   4. Datei und Buchung in d1_migrations decken sich.
 *   5. PRAGMA foreign_key_check ist leer.
 *   6. order_policy trägt genau die Voreinstellung aus 0016.
 *
 * NICHT geprüft: PRAGMA integrity_check — D1 lässt ihn nicht zu
 * (SQLITE_AUTH). Lokal auf der Datei ist er möglich, gegen D1 nicht; ein
 * Prüfskript soll nicht so tun, als könnte es etwas, das die Plattform
 * verweigert.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkForeignKeys,
  checkMigrationLedger,
  checkOrderPolicyDefaults,
  checkTables,
  migrationFileNames,
} from './migration-expectations.mjs';

const MIGRATIONS_DIR = 'migrations';

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
}

/**
 * Eine Abfrage gegen die Wegwerf-D1.
 *
 * `--json` liefert eine Liste von Ergebnissen; interessant ist immer das
 * erste. Wrangler schreibt vor das JSON gelegentlich Hinweiszeilen — deshalb
 * wird ab der ersten eckigen oder geschweiften Klammer gelesen und nicht die
 * ganze Ausgabe geparst.
 */
function query(persistTo, sql) {
  const roh = wrangler([
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    persistTo,
    '--command',
    sql,
    '--json',
  ]);

  const start = roh.search(/[[{]/);
  if (start === -1) {
    throw new Error(`Unerwartete Wrangler-Ausgabe für: ${sql}`);
  }

  const ergebnis = JSON.parse(roh.slice(start));
  const erstes = Array.isArray(ergebnis) ? ergebnis[0] : ergebnis;
  return erstes?.results ?? [];
}

function main() {
  const persistTo = mkdtempSync(join(tmpdir(), 'buschmann-d1-verify-'));
  const befunde = [];
  let schritt = 0;

  const melde = (text) => process.stdout.write(`  ${++schritt}. ${text}\n`);

  try {
    process.stdout.write('db:verify:migrations — Wegwerf-D1, kein Zugriff auf die lokale Entwicklungsdatenbank\n\n');

    melde('Migrationskette auf leerer Datenbank …');
    wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistTo]);

    melde('Zweiter Lauf muss ein No-Op sein …');
    const zweiter = wrangler([
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--persist-to',
      persistTo,
    ]);
    if (!/No migrations to apply/i.test(zweiter)) {
      befunde.push(
        'Ein zweiter Migrationslauf war kein No-Op — die Kette ist nicht idempotent.',
      );
    }

    melde('Tabellen …');
    const tabellen = query(
      persistTo,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",
    ).map((z) => z.name);
    befunde.push(...checkTables(tabellen));

    melde('Migrationsbuch …');
    const dateien = migrationFileNames(readdirSync(MIGRATIONS_DIR));
    const angewandt = query(persistTo, 'SELECT name FROM d1_migrations ORDER BY id;').map(
      (z) => z.name,
    );
    befunde.push(...checkMigrationLedger(dateien, angewandt));

    melde('Fremdschlüssel …');
    befunde.push(...checkForeignKeys(query(persistTo, 'PRAGMA foreign_key_check;')));

    melde('Voreinstellung der Bestellregeln …');
    befunde.push(...checkOrderPolicyDefaults(query(persistTo, 'SELECT * FROM order_policy;')));

    process.stdout.write('\n');
    if (befunde.length > 0) {
      process.stderr.write('MIGRATIONSPRÜFUNG FEHLGESCHLAGEN\n');
      for (const befund of befunde) {
        process.stderr.write(`  ✗ ${befund}\n`);
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `✅ ${dateien.length} Migrationen: frisch angewandt, idempotent, Schema vollständig, Fremdschlüssel sauber.\n`,
    );
  } finally {
    rmSync(persistTo, { recursive: true, force: true });
  }
}

main();
