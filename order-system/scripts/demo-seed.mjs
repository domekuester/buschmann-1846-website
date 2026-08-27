#!/usr/bin/env node
/**
 * BEREITET DIE DEMO-DATENBANK VOR — und ausschließlich sie.
 *
 * Migrationen anwenden, Bestand einspielen, Ergebnis prüfen. Danach ist die
 * Vorführung startbereit.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DIE PERSÖNLICHE ENTWICKLUNGSDATENBANK WIRD NICHT ANGEFASST.         ║
 * ║                                                                      ║
 * ║  Jeder Wrangler-Aufruf bekommt --config demo/wrangler.demo.jsonc UND ║
 * ║  --persist-to demo/.state. Ohne das zweite Flag benutzte Wrangler    ║
 * ║  das Verzeichnis neben der Konfiguration; ausdrücklich genannt ist   ║
 * ║  es nachlesbar und kann nicht versehentlich auf                      ║
 * ║  order-system/.wrangler/state zeigen, wo die Datenbank der           ║
 * ║  Entwicklung liegt.                                                  ║
 * ║                                                                      ║
 * ║  KEIN --remote. Nirgends. Dieses Skript kennt das Flag nicht und     ║
 * ║  kann eine Produktionsdatenbank deshalb nicht erreichen.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Aufruf: node scripts/demo-seed.mjs   (bzw. mittelbar über `npm run demo`)
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveCredential } from './create-local-auth-account.mjs';
import {
  DEMO_ADMIN,
  DEMO_CONFIG_FILE,
  DEMO_CUSTOMER_LOGINS,
  DEMO_DIR,
  DEMO_PEPPER,
  DEMO_STATE_DIR,
  PROJECT_ROOT,
} from './demo/demo-config.mjs';
import { buildDemoDataset, demoSeedStatements } from './demo/demo-dataset.mjs';

/** Der heutige Tag in Europe/Berlin — dieselbe Zone wie businessDay(). */
export function heuteInBerlin(jetzt = new Date()) {
  /**
   * 'en-CA' liefert 'JJJJ-MM-TT'. Dasselbe Vorgehen wie businessDay() in
   * src/domain/clock.ts, und aus demselben Grund: Der Tag, der in Düsseldorf
   * gilt, ist nicht der Tag der UTC-Uhr.
   */
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(jetzt);
}

function wrangler(args, options = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    stdio: options.durchreichen === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
}

/** Ein Wrangler-Aufruf gegen die Demo-D1 — immer mit beiden Flags. */
function demoWrangler(args, options) {
  return wrangler(
    [...args, '--config', DEMO_CONFIG_FILE, '--persist-to', DEMO_STATE_DIR],
    options,
  );
}

/** Eine Abfrage gegen die Demo-D1. */
export function demoQuery(sql) {
  const roh = demoWrangler(['d1', 'execute', 'DB', '--local', '--command', sql, '--json']);
  const start = roh.search(/[[{]/);
  if (start === -1) {
    throw new Error(`Unerwartete Wrangler-Ausgabe für: ${sql}`);
  }
  const ergebnis = JSON.parse(roh.slice(start));
  const erstes = Array.isArray(ergebnis) ? ergebnis[0] : ergebnis;
  return erstes?.results ?? [];
}

/**
 * Die Prüfung NACH dem Seed.
 *
 * Sie fragt genau das ab, woran eine Vorführung scheitern würde: Gibt es das
 * Admin-Konto? Stehen die Bestellungen da? Ist der Leittag gefüllt? Ein Seed,
 * der stillschweigend nichts getan hat, fiele sonst erst im Browser auf — vor
 * dem Kunden.
 */
export function pruefeBestand(zaehler, erwartet) {
  const befunde = [];

  if (zaehler.adminKonten !== 1) {
    befunde.push(`Es gibt ${zaehler.adminKonten} Admin-Konten statt genau einem.`);
  }
  if (zaehler.kundenkonten !== erwartet.kundenkonten) {
    befunde.push(
      `Es gibt ${zaehler.kundenkonten} Kundenzugänge statt ${erwartet.kundenkonten}.`,
    );
  }
  if (zaehler.kunden !== erwartet.kunden) {
    befunde.push(`Es gibt ${zaehler.kunden} Kunden statt ${erwartet.kunden}.`);
  }
  if (zaehler.produkte !== erwartet.produkte) {
    befunde.push(`Es gibt ${zaehler.produkte} Produkte statt ${erwartet.produkte}.`);
  }
  if (zaehler.bestellungen !== erwartet.bestellungen) {
    befunde.push(
      `Es gibt ${zaehler.bestellungen} Bestellungen statt ${erwartet.bestellungen}.`,
    );
  }
  if (zaehler.leittagBestellungen !== erwartet.leittagBestellungen) {
    befunde.push(
      `Der Leittag trägt ${zaehler.leittagBestellungen} Bestellungen statt ${erwartet.leittagBestellungen}.`,
    );
  }
  if (zaehler.leittagOhneKosten !== 0) {
    befunde.push(
      `${zaehler.leittagOhneKosten} Positionen des Leittags haben keine Herstellkosten — ` +
        'der Haupt-Demo-Tag muss vollständig kalkuliert sein.',
    );
  }

  return befunde;
}

export async function seedDemo({ leise = false } = {}) {
  const melden = (text) => {
    if (!leise) process.stdout.write(text);
  };

  const heute = heuteInBerlin();
  const bestand = buildDemoDataset(heute);

  mkdirSync(DEMO_STATE_DIR, { recursive: true });

  melden('  Migrationen …\n');
  demoWrangler(['d1', 'migrations', 'apply', 'DB', '--local']);

  melden('  Demo-Daten …\n');
  const anweisungen = await demoSeedStatements({
    heute,
    pepper: DEMO_PEPPER,
    iterations: undefined,
    deriveCredential,
    admin: DEMO_ADMIN,
    customerLogins: DEMO_CUSTOMER_LOGINS,
  });

  /**
   * Über eine DATEI und nicht über --command: Der Bestand ist einige
   * Kilobyte SQL, und eine Kommandozeile dieser Länge ist plattformabhängig
   * eine Wette. Die Datei liegt im Demo-Verzeichnis, ist dort ignoriert und
   * wird nach dem Anwenden gelöscht — sie ist ein Zwischenergebnis, kein
   * Artefakt.
   */
  const sqlDatei = join(DEMO_DIR, 'seed.generated.sql');
  writeFileSync(sqlDatei, `${anweisungen.join('\n\n')}\n`, 'utf8');
  try {
    demoWrangler(['d1', 'execute', 'DB', '--local', '--file', sqlDatei]);
  } finally {
    rmSync(sqlDatei, { force: true });
  }

  melden('  Prüfung …\n');
  const eine = (sql) => Number(demoQuery(sql)[0]?.anzahl ?? -1);
  const zaehler = {
    adminKonten: eine("SELECT COUNT(*) AS anzahl FROM auth_accounts WHERE role = 'admin';"),
    kundenkonten: eine("SELECT COUNT(*) AS anzahl FROM auth_accounts WHERE role = 'customer';"),
    kunden: eine('SELECT COUNT(*) AS anzahl FROM customers;'),
    produkte: eine('SELECT COUNT(*) AS anzahl FROM products;'),
    bestellungen: eine('SELECT COUNT(*) AS anzahl FROM orders;'),
    leittagBestellungen: eine(
      `SELECT COUNT(*) AS anzahl FROM orders WHERE fulfillment_date = '${bestand.leittag}';`,
    ),
    leittagOhneKosten: eine(
      'SELECT COUNT(*) AS anzahl FROM order_items i JOIN orders o ON o.id = i.order_id ' +
        `WHERE o.fulfillment_date = '${bestand.leittag}' AND o.status <> 'cancelled' ` +
        'AND i.unit_cost_cents_snapshot IS NULL;',
    ),
  };

  const erwartet = {
    kundenkonten: DEMO_CUSTOMER_LOGINS.length,
    kunden: bestand.customers.length,
    produkte: bestand.catalogProducts.length,
    bestellungen: bestand.orders.length,
    leittagBestellungen: bestand.orders.filter((b) => b.fulfillmentDate === bestand.leittag).length,
  };

  const befunde = pruefeBestand(zaehler, erwartet);
  if (befunde.length > 0) {
    throw new Error(
      `Der Demo-Bestand ist unvollständig:\n${befunde.map((b) => `  ✗ ${b}`).join('\n')}`,
    );
  }

  return { heute, leittag: bestand.leittag, zaehler };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write('Demo-Datenbank vorbereiten …\n\n');
    const ergebnis = await seedDemo();
    process.stdout.write(
      `\n✅ Demo-Bestand steht. Leittag ${ergebnis.leittag} mit ` +
        `${ergebnis.zaehler.leittagBestellungen} Bestellungen.\n`,
    );
  } catch (fehler) {
    process.stderr.write(`\n${fehler instanceof Error ? fehler.message : String(fehler)}\n`);
    process.exitCode = 1;
  }
}
