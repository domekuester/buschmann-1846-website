#!/usr/bin/env node
/**
 * Bringt eine D1-Sicherung in eine Reihenfolge, in der sie sich einspielen
 * lässt.
 *
 * DER BEFUND, DER DIESES SKRIPT NÖTIG MACHT (Phase 8A):
 *
 * `wrangler d1 export` schreibt die Tabellen in der Reihenfolge, in der sie
 * entstanden sind, und hängt die Zeilen jeder Tabelle unmittelbar hinter
 * deren CREATE TABLE. Für dieses Schema ergibt das eine Datei, die D1 nicht
 * annimmt:
 *
 *     0001  CREATE TABLE customers            ← steht ganz vorne
 *     0013  ALTER TABLE customers ADD price_list_id REFERENCES price_lists
 *     0012  CREATE TABLE price_lists          ← steht viel weiter hinten
 *
 * Die Zeilen von `customers` werden damit eingefügt, bevor es `price_lists`
 * überhaupt gibt, und D1 antwortet mit „no such table: main.price_lists".
 * Dasselbe gilt für `products` → `catalog_products` aus 0014.
 *
 * Das ist kein Fehler der Migrationen: Einen Fremdschlüssel später
 * nachzurüsten ist der normale Weg. Es ist eine Eigenschaft des Exportformats.
 *
 * WARUM NICHT EINFACH DIE FREMDSCHLÜSSEL ABSCHALTEN
 *
 * Geprüft und verworfen: `PRAGMA foreign_keys=OFF` wird von D1 nicht
 * beachtet, und das `PRAGMA defer_foreign_keys=TRUE`, das die Sicherung
 * selbst mitbringt, wirkt nur INNERHALB einer Transaktion — `wrangler d1
 * execute --file` führt jede Anweisung einzeln aus. Beide Wege wurden gegen
 * eine echte lokale D1 ausprobiert; beide scheitern mit derselben Meldung.
 *
 * WAS DIESES SKRIPT TUT — und ausschließlich das:
 *
 *   1. alle CREATE TABLE zuerst,
 *   2. dann die INSERTs, Tabelle für Tabelle in Fremdschlüsselreihenfolge,
 *   3. dann alles Übrige (Indizes, Trigger, Views).
 *
 * KEINE ANWEISUNG WIRD VERÄNDERT, KEINE FÄLLT WEG. Es wird ausschließlich
 * umsortiert — das ist der Grund, warum man dem Ergebnis trauen kann.
 *
 * DAS SKRIPT FASST KEINE DATENBANK AN. Es liest eine Datei und schreibt eine
 * Datei; eingespielt wird von Hand, mit Blick darauf, gegen welche Datenbank.
 * Dieselbe Entscheidung wie bei scripts/create-local-auth-account.mjs.
 *
 *     node scripts/d1-restore-order.mjs backup.sql restore.sql
 */

/**
 * Zerlegt SQL in einzelne Anweisungen.
 *
 * Ein einfaches `split(';')` wäre falsch: Ein Semikolon kann in einer
 * Zeichenkette stehen, und in diesem Datenbestand tut es das auch — in
 * Notizfeldern und Kundennamen. Deshalb wird zeichenweise gelesen und
 * mitgezählt, ob wir uns gerade in einer Zeichenkette befinden. Das
 * verdoppelte Hochkomma ('') ist in SQL das Escape und beendet die
 * Zeichenkette nicht.
 */
export function splitStatements(sql) {
  const anweisungen = [];
  let start = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const zeichen = sql[i];

    if (inString) {
      if (zeichen === "'") {
        // Verdoppeltes Hochkomma: Escape, kein Ende.
        if (sql[i + 1] === "'") {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (zeichen === "'") {
      inString = true;
      continue;
    }

    if (zeichen === ';') {
      const stueck = sql.slice(start, i).trim();
      if (stueck.length > 0) {
        anweisungen.push(stueck);
      }
      start = i + 1;
    }
  }

  const rest = sql.slice(start).trim();
  if (rest.length > 0) {
    anweisungen.push(rest);
  }

  return anweisungen;
}

/** Der Tabellenname einer CREATE TABLE-Anweisung — oder null. */
export function createdTable(statement) {
  const treffer = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/i.exec(
    statement,
  );
  if (treffer === null) {
    return null;
  }
  return treffer[2] ?? treffer[3] ?? treffer[4] ?? treffer[5] ?? null;
}

/** Der Tabellenname einer INSERT-Anweisung — oder null. */
export function insertedTable(statement) {
  const treffer = /^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/i.exec(
    statement,
  );
  if (treffer === null) {
    return null;
  }
  return treffer[2] ?? treffer[3] ?? treffer[4] ?? treffer[5] ?? null;
}

/**
 * Die Tabellen, auf die eine CREATE TABLE-Anweisung per REFERENCES zeigt.
 *
 * Eine Selbstreferenz zählt NICHT: Sie ist keine Reihenfolgebedingung
 * zwischen zwei Tabellen, sondern eine innerhalb einer — und als
 * Abhängigkeit gezählt wäre sie ein Zyklus der Länge eins, der das
 * Sortieren grundlos abbrechen ließe.
 */
export function tableDependencies(createTableStatement) {
  const eigene = createdTable(createTableStatement);
  const muster = /\bREFERENCES\s+("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/gi;

  const gefunden = [];
  let treffer;
  while ((treffer = muster.exec(createTableStatement)) !== null) {
    const name = treffer[2] ?? treffer[3] ?? treffer[4] ?? treffer[5];
    if (name === undefined || name === eigene || gefunden.includes(name)) {
      continue;
    }
    gefunden.push(name);
  }

  return gefunden;
}

/**
 * Bringt Tabellen so in eine Reihe, dass jede hinter denen steht, auf die sie
 * zeigt.
 *
 * Tiefensuche mit drei Zuständen, damit ein Zyklus erkannt und nicht
 * stillschweigend aufgelöst wird: Eine erfundene Reihenfolge wäre eine
 * Sicherung, die beim Einspielen an einer anderen Stelle scheitert — und
 * dann sucht jemand den Fehler in den Daten.
 *
 * Abhängigkeiten auf Tabellen, die in der Sicherung gar nicht vorkommen,
 * werden übergangen: Sie können keine Reihenfolge bestimmen.
 */
export function topologicalOrder(tables, dependencies) {
  const ergebnis = [];
  const zustand = new Map();

  function besuche(tabelle, pfad) {
    const jetzt = zustand.get(tabelle);
    if (jetzt === 'fertig') {
      return;
    }
    if (jetzt === 'offen') {
      throw new Error(
        `Zyklus in den Fremdschlüsseln: ${[...pfad, tabelle].join(' → ')}. ` +
          'Die Sicherung kann nicht in eine sichere Reihenfolge gebracht werden.',
      );
    }

    zustand.set(tabelle, 'offen');
    for (const abhaengig of dependencies[tabelle] ?? []) {
      if (tables.includes(abhaengig)) {
        besuche(abhaengig, [...pfad, tabelle]);
      }
    }
    zustand.set(tabelle, 'fertig');
    ergebnis.push(tabelle);
  }

  for (const tabelle of tables) {
    besuche(tabelle, []);
  }

  return ergebnis;
}

/**
 * Sortiert eine vollständige Sicherung um.
 *
 * Die Ausgabe ist wieder gültiges SQL mit denselben Anweisungen — nur in
 * einer Reihenfolge, die D1 annimmt.
 */
export function reorderDump(sql) {
  const anweisungen = splitStatements(sql);

  const pragmas = [];
  const creates = new Map();
  const inserts = new Map();
  const uebrige = [];

  for (const anweisung of anweisungen) {
    if (/^PRAGMA\b/i.test(anweisung)) {
      pragmas.push(anweisung);
      continue;
    }

    const erzeugt = createdTable(anweisung);
    if (erzeugt !== null) {
      creates.set(erzeugt, anweisung);
      continue;
    }

    const eingefuegt = insertedTable(anweisung);
    if (eingefuegt !== null) {
      const bisher = inserts.get(eingefuegt) ?? [];
      bisher.push(anweisung);
      inserts.set(eingefuegt, bisher);
      continue;
    }

    uebrige.push(anweisung);
  }

  const tabellen = [...creates.keys()];
  const abhaengigkeiten = Object.fromEntries(
    [...creates.entries()].map(([name, sqlText]) => [name, tableDependencies(sqlText)]),
  );
  const reihenfolge = topologicalOrder(tabellen, abhaengigkeiten);

  /**
   * Zeilen zu Tabellen, die in der Sicherung keine CREATE TABLE haben, gingen
   * sonst verloren. Sie kommen ans Ende der Einfügungen — dort können sie
   * niemandem im Weg stehen.
   */
  const ohneTabelle = [...inserts.keys()].filter((name) => !creates.has(name));

  const ausgabe = [
    ...pragmas,
    ...reihenfolge.map((name) => creates.get(name)),
    ...reihenfolge.flatMap((name) => inserts.get(name) ?? []),
    ...ohneTabelle.flatMap((name) => inserts.get(name) ?? []),
    ...uebrige,
  ];

  return ausgabe.map((anweisung) => `${anweisung};`).join('\n');
}

export async function main(argv) {
  const [eingabe, ausgabe] = argv;
  if (eingabe === undefined || ausgabe === undefined) {
    process.stderr.write(
      'Aufruf: node scripts/d1-restore-order.mjs <sicherung.sql> <wiederherstellung.sql>\n',
    );
    process.exitCode = 2;
    return;
  }

  const { readFile, writeFile } = await import('node:fs/promises');
  const sql = await readFile(eingabe, 'utf8');
  const sortiert = reorderDump(sql);
  await writeFile(ausgabe, `${sortiert}\n`, 'utf8');

  const anzahl = splitStatements(sortiert).length;
  process.stdout.write(`${anzahl} Anweisungen umsortiert → ${ausgabe}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
