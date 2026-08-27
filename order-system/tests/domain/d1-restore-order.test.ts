import { describe, expect, it } from 'vitest';
import {
  reorderDump,
  splitStatements,
  tableDependencies,
  topologicalOrder,
} from '../../scripts/d1-restore-order.mjs';

/**
 * Der Umsortierer für D1-Sicherungen.
 *
 * WARUM ES IHN GIBT — der Befund aus Phase 8A:
 *
 * `wrangler d1 export` schreibt die Tabellen in ihrer Entstehungsreihenfolge
 * und hängt die Zeilen JEDER Tabelle unmittelbar hinter deren CREATE TABLE.
 * Für dieses Schema ist das nicht wiederherstellbar: `customers` entstand in
 * 0001, der Fremdschlüssel auf `price_lists` kam erst mit 0013 dazu — die
 * Zeilen von `customers` stehen in der Sicherung also VOR der Tabelle, auf
 * die sie zeigen. D1 prüft Fremdschlüssel beim Einfügen und lehnt mit
 * „no such table: main.price_lists" ab. Das führende
 * `PRAGMA defer_foreign_keys=TRUE` der Sicherung hilft nicht, weil jede
 * Anweisung einzeln und damit in einer eigenen Transaktion läuft.
 *
 * Eine Sicherung, die sich nicht einspielen lässt, ist keine Sicherung.
 * Deshalb diese Datei.
 */

describe('splitStatements', () => {
  it('trennt an Semikolons außerhalb von Zeichenketten', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('trennt NICHT an einem Semikolon INNERHALB einer Zeichenkette', () => {
    const sql = `INSERT INTO "t" VALUES('a;b');INSERT INTO "t" VALUES('c');`;
    expect(splitStatements(sql)).toEqual([
      `INSERT INTO "t" VALUES('a;b')`,
      `INSERT INTO "t" VALUES('c')`,
    ]);
  });

  it('versteht das verdoppelte Hochkomma als Escape', () => {
    const sql = `INSERT INTO "t" VALUES('O''Brien; jr.');SELECT 1;`;
    expect(splitStatements(sql)).toEqual([
      `INSERT INTO "t" VALUES('O''Brien; jr.')`,
      'SELECT 1',
    ]);
  });

  it('behält mehrzeilige Anweisungen zusammen', () => {
    const sql = 'CREATE TABLE a (\n  id INTEGER\n);\nSELECT 1;';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (\n  id INTEGER\n)', 'SELECT 1']);
  });

  it('lässt eine leere Eingabe leer', () => {
    expect(splitStatements('   \n  ')).toEqual([]);
  });
});

describe('tableDependencies', () => {
  it('findet die referenzierte Tabelle einer Fremdschlüsselspalte', () => {
    const sql = 'CREATE TABLE customers (id INTEGER, price_list_id INTEGER REFERENCES price_lists(id))';
    expect(tableDependencies(sql)).toEqual(['price_lists']);
  });

  it('findet auch die Schreibweise mit Anführungszeichen', () => {
    const sql = 'CREATE TABLE a (b INTEGER REFERENCES "other"(id))';
    expect(tableDependencies(sql)).toEqual(['other']);
  });

  it('zählt eine Selbstreferenz NICHT als Abhängigkeit', () => {
    const sql = 'CREATE TABLE node (id INTEGER, parent INTEGER REFERENCES node(id))';
    expect(tableDependencies(sql)).toEqual([]);
  });

  it('liefert jede Tabelle nur einmal', () => {
    const sql =
      'CREATE TABLE a (x INTEGER REFERENCES b(id), y INTEGER REFERENCES b(id), z INTEGER REFERENCES c(id))';
    expect(tableDependencies(sql)).toEqual(['b', 'c']);
  });
});

describe('topologicalOrder', () => {
  it('stellt die referenzierte Tabelle vor die referenzierende', () => {
    const order = topologicalOrder(['customers', 'price_lists'], {
      customers: ['price_lists'],
      price_lists: [],
    });
    expect(order.indexOf('price_lists')).toBeLessThan(order.indexOf('customers'));
  });

  it('behält bei Gleichrangigkeit die Eingabereihenfolge', () => {
    expect(topologicalOrder(['a', 'b', 'c'], { a: [], b: [], c: [] })).toEqual(['a', 'b', 'c']);
  });

  it('bricht bei einem Zyklus ab statt eine Reihenfolge zu erfinden', () => {
    expect(() => topologicalOrder(['a', 'b'], { a: ['b'], b: ['a'] })).toThrow(/zyklus/i);
  });

  it('ignoriert Abhängigkeiten auf Tabellen, die es in der Sicherung nicht gibt', () => {
    expect(topologicalOrder(['a'], { a: ['weg'] })).toEqual(['a']);
  });
});

/** Array.prototype.findLastIndex verlangt lib es2023; das Projekt zielt tiefer. */
function letzterIndex(werte: string[], muster: RegExp): number {
  for (let i = werte.length - 1; i >= 0; i -= 1) {
    if (muster.test(werte[i] as string)) return i;
  }
  return -1;
}

describe('reorderDump', () => {
  /** Genau die Form, die wrangler d1 export erzeugt — Zeilen direkt hinter der Tabelle. */
  const dump = [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, price_list_id INTEGER REFERENCES price_lists(id));',
    `INSERT INTO "customers" ("id","price_list_id") VALUES(1,2);`,
    'CREATE TABLE price_lists (id INTEGER PRIMARY KEY);',
    `INSERT INTO "price_lists" ("id") VALUES(2);`,
    'CREATE INDEX idx_customers_price_list ON customers (price_list_id);',
  ].join('\n');

  it('legt JEDE Tabelle an, bevor die erste Zeile eingefügt wird', () => {
    const zeilen: string[] = splitStatements(reorderDump(dump));
    const letztesCreate = letzterIndex(zeilen, /^CREATE TABLE/i);
    const erstesInsert = zeilen.findIndex((s: string) => /^INSERT INTO/i.test(s));
    expect(letztesCreate).toBeLessThan(erstesInsert);
  });

  it('fügt die Zeilen der referenzierten Tabelle ZUERST ein', () => {
    const ausgabe = reorderDump(dump);
    expect(ausgabe.indexOf('INSERT INTO "price_lists"')).toBeLessThan(
      ausgabe.indexOf('INSERT INTO "customers"'),
    );
  });

  it('stellt die Indizes ans Ende', () => {
    const zeilen: string[] = splitStatements(reorderDump(dump));
    const ersterIndex = zeilen.findIndex((s: string) => /^CREATE INDEX/i.test(s));
    const letztesInsert = letzterIndex(zeilen, /^INSERT INTO/i);
    expect(letztesInsert).toBeLessThan(ersterIndex);
  });

  it('verliert keine einzige Anweisung', () => {
    const vorher = splitStatements(dump).length;
    const nachher = splitStatements(reorderDump(dump)).length;
    expect(nachher).toBe(vorher);
  });

  it('verändert keine einzige INSERT-Anweisung inhaltlich', () => {
    const nur = (sql: string): string[] =>
      (splitStatements(sql) as string[]).filter((s: string) => /^INSERT/i.test(s)).sort();
    expect(nur(reorderDump(dump))).toEqual(nur(dump));
  });

  it('behält das führende PRAGMA vorne', () => {
    expect(splitStatements(reorderDump(dump))[0]).toMatch(/^PRAGMA/i);
  });
});
