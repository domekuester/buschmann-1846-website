import { aggregateProductionDay, type ProductionDay } from '../domain/production-day';
import { findProductionOrders } from '../infrastructure/d1/production-day-repository';

/**
 * „Was muss Buschmann an diesem Tag produzieren?"
 *
 * Der Anwendungsfall ist kurz, und das ist die Absicht: Er verbindet zwei
 * Teile, die je für sich vollständig geprüft sind — eine Abfrage, die weiß,
 * WELCHE Bestellungen zählen, und eine Aggregation, die weiß, WIE summiert
 * wird. Stünde hier Logik, gäbe es eine dritte Stelle mit Regeln, die keiner
 * der beiden Testarten gehört.
 *
 * WAS DIESE FUNKTION NICHT KENNT: Request, Response, Status-Codes, Cookies,
 * Sitzungen, Rollen. Sie prüft auch nicht, ob der Tag ein gültiges
 * Kalenderdatum ist — sie bekommt einen bereits geprüften Wert. Die
 * Autorisierung steht in der HTTP-Schicht und ausschließlich dort.
 *
 * Der Tag wird HIER NICHT ABGELEITET. Kein „heute", kein „morgen", kein
 * Date.now(). Ein Anwendungsfall, dessen Antwort davon abhängt, wann er
 * aufgerufen wird, wäre nicht deterministisch testbar und um 23:59 Uhr etwas
 * anderes als um 00:01 Uhr. Eine Oberfläche darf gern „morgen" vorauswählen —
 * dann steht die Entscheidung dort, wo sie hingehört.
 *
 * READ ONLY. Es gibt in dieser Phase keine Gegenrichtung: kein Statuswechsel,
 * kein Bearbeiten, kein Löschen.
 */
export async function getProductionDay(db: D1Database, day: string): Promise<ProductionDay> {
  const orders = await findProductionOrders(db, day);
  return aggregateProductionDay(day, orders);
}
