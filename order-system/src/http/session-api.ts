import type { AuthContext } from '../application/authenticate-request';
import { json } from './responses';
import { privateHeaders } from './security';

/**
 * GET /api/auth/session
 *
 * Die Antwort auf „wer bin ich?" — und sie ist absichtlich fast leer.
 *
 * Ein Client braucht zwei Dinge: ob eine Sitzung gilt und welche Rolle sie
 * hat. Ein Café bekommt zusätzlich seinen Namen, weil die Oberfläche ihn
 * anzeigt. Alles Weitere fehlt nicht aus Versehen:
 *
 *   keine Konto-ID, keine Sitzungs-ID   Interne Zähler, die niemand braucht
 *                                       und die in einem Screenshot landen
 *                                       könnten.
 *   kein CSRF-Token                     Der steht im gerenderten HTML. Ihn
 *                                       zusätzlich über eine API abholbar zu
 *                                       machen wäre ein zweiter Weg zu
 *                                       demselben Wert — und ein zweiter Weg
 *                                       ist eine zweite Angriffsfläche.
 *   kein Fehlversuchszähler, kein Ablauf, keine Kontaktdaten, keine Adresse,
 *   keine interne Notiz                 Nichts davon gehört in eine Antwort,
 *                                       die ein Zwischenspeicher mitnehmen
 *                                       könnte.
 *
 * Die Kundenangabe ist ein Objekt mit genau einem Feld und keine
 * Zeichenkette: So kann später ein Feld dazukommen, ohne dass sich die Form
 * der Antwort ändert.
 */
export function sessionInfo(context: AuthContext): Response {
  const body =
    context.role === 'customer'
      ? { authenticated: true, role: 'customer', customer: { name: context.customer.name } }
      : { authenticated: true, role: 'admin' };

  return json(body, 200, privateHeaders());
}
