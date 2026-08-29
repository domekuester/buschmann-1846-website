/**
 * Die Rollen des Bestellsystems — genau zwei, und das ist eine Entscheidung
 * und keine Zwischenstufe.
 *
 *   customer   Ein Café. Bestellt, und sonst nichts.
 *   admin      Buschmann. Sieht den Betrieb, bestellt aber nicht.
 *
 * Kein manager, superadmin, accounting, production, editor, owner, moderator.
 * Es gibt heute niemanden, der eine dieser Rollen hätte; ein Rollenmodell auf
 * Vorrat ist ein Rollenmodell, das niemand geprüft hat.
 *
 * Die Rollen sind GETRENNT, nicht gestuft. Ein Admin ist kein Café mit mehr
 * Rechten — er hat keinen Kundenbezug und kann deshalb nicht bestellen. Sonst
 * gäbe es einen Weg, im Namen eines Cafés zu bestellen, der im Bestellablauf
 * nicht sichtbar wäre.
 */
export type AuthRole = 'customer' | 'admin';

export const AUTH_ROLES: readonly AuthRole[] = ['customer', 'admin'];

/**
 * Ohne Nachsicht: kein Trimmen, kein Kleinschreiben.
 *
 * Diese Funktion prüft einen Wert, der aus D1 kommt und dort durch eine
 * CHECK-Bedingung gegangen ist. Er steht exakt so da oder gar nicht. Wäre die
 * Prüfung großzügig, verdeckte sie genau den Fall, für den sie da ist — eine
 * Zeile, die vor einer Schemaänderung entstanden ist.
 */
export function isAuthRole(value: unknown): value is AuthRole {
  return value === 'customer' || value === 'admin';
}
