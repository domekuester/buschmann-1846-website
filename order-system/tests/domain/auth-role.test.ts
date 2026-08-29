import { describe, expect, it } from 'vitest';
import { isAuthRole } from '../../src/domain/auth-role';

/**
 * Zwei Rollen, und der Test besteht vor allem darauf, dass es nicht mehr
 * werden. Ein Rollenmodell auf Vorrat ist ein Rollenmodell, das niemand
 * geprüft hat.
 */
describe('isAuthRole', () => {
  it('erkennt die beiden Rollen', () => {
    expect(isAuthRole('customer')).toBe(true);
    expect(isAuthRole('admin')).toBe(true);
  });

  it('kennt keine weiteren Rollen', () => {
    for (const value of ['manager', 'superadmin', 'accounting', 'production', 'editor', 'owner', 'moderator']) {
      expect(isAuthRole(value)).toBe(false);
    }
  });

  /**
   * Kein Kleinschreiben, kein Trimmen. Diese Funktion prüft einen bereits
   * gespeicherten Wert aus D1 — dort steht er exakt oder gar nicht.
   */
  it('vergleicht ohne Nachsicht', () => {
    for (const value of ['ADMIN', 'Admin', ' admin', 'admin ', 'customer\n']) {
      expect(isAuthRole(value)).toBe(false);
    }
  });

  it('lehnt alles ab, was keine Zeichenkette ist', () => {
    for (const value of [null, undefined, 0, 1, true, {}, [], () => 'admin']) {
      expect(isAuthRole(value)).toBe(false);
    }
  });
});
