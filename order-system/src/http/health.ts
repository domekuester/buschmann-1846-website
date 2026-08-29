import { json } from './responses';

/**
 * Prüft, dass der Worker läuft und sein D1-Binding benutzbar ist.
 *
 * Die Abfrage geht bewusst gegen sqlite_master und nicht gegen SELECT 1:
 * SELECT 1 gelänge auch gegen eine leere, nie migrierte Datenbank. Gefragt
 * wird deshalb nach einer Tabelle, die es nur nach erfolgreicher Migration
 * gibt.
 */
export async function health(db: D1Database): Promise<Response> {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'`)
    .first<{ name: string }>();

  if (row === null) {
    return json({ status: 'error', database: 'not_migrated' }, 503);
  }
  return json({ status: 'ok', database: 'reachable' });
}
