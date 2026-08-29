/**
 * Eine Datenbankkennung aus einem Pfadsegment — geprüft, nicht bloß
 * weitergereicht.
 *
 * SIE STAND BIS PHASE 7C IN admin-customer-api.ts, und dort war sie richtig
 * aufgehoben, solange genau ein Endpunkt eine Kundenkennung aus dem Pfad las.
 * Seit es zwei gibt — der schreibende Endpunkt und die lesende
 * Detailansicht —, wäre eine zweite Fassung eine zweite Meinung darüber, was
 * eine gültige Kennung ist. Und die Fassung, die eines Tages nachsichtiger
 * ist, wäre diejenige, die etwas durchlässt.
 *
 * ERLAUBT IST AUSSCHLIESSLICH EINE POSITIVE GANZE DEZIMALZAHL. Kein trim,
 * kein Vorzeichen, keine führenden Nullen als Zahl umgedeutet, kein '1e3',
 * kein '1.0', kein Leerraum: Number() allein wäre hier zu nachsichtig —
 * Number(' 1 ') ist 1, und aus einer Adresszeile soll nichts durchkommen,
 * was nur zufällig wie eine Zahl aussieht.
 *
 * Sie taugt für JEDE Kennung dieses Systems, weil alle Tabellen INTEGER
 * PRIMARY KEY tragen und SQLite dort ab 1 vergibt.
 */
export function parseIdSegment(segment: string): number | null {
  if (!/^[1-9][0-9]{0,17}$/.test(segment)) {
    return null;
  }
  const wert = Number(segment);
  return Number.isSafeInteger(wert) ? wert : null;
}
