import { aggregateDashboardDay, type DashboardDay } from '../domain/dashboard-day';
import { findDashboardOrders } from '../infrastructure/d1/dashboard-day-repository';

/**
 * „Wie steht dieser Tag?"
 *
 * Kurz, und das ist die Absicht — dieselbe wie bei getProductionDay(): Der
 * Anwendungsfall verbindet zwei Teile, die je für sich vollständig geprüft
 * sind. Die Abfrage weiß, WELCHE Bestellungen zu diesem Tag gehören; die
 * Aggregation weiß, WIE gezählt wird und was der Storno daran ändert. Stünde
 * hier Logik, gäbe es eine dritte Stelle mit Regeln, die keiner der beiden
 * Testarten gehört.
 *
 * WAS DIESE FUNKTION NICHT KENNT: Request, Response, Status-Codes, Cookies,
 * Sitzungen, Rollen. Sie prüft auch nicht, ob der Tag ein gültiger
 * Kalendertag ist — sie bekommt einen bereits geprüften Wert. Die
 * Autorisierung steht in der HTTP-Schicht und ausschließlich dort.
 *
 * DER TAG WIRD HIER NICHT ABGELEITET. Kein „heute", kein Date.now(). Ein
 * Anwendungsfall, dessen Antwort davon abhängt, wann er aufgerufen wird, wäre
 * um 23:59 Uhr etwas anderes als um 00:01 Uhr und nicht deterministisch
 * testbar. Die Vorauswahl ist eine Frage der Oberfläche.
 *
 * READ ONLY. Der Zahlungsstatus wird hier gelesen und nirgends geschrieben;
 * der Schreibvorgang ist ein eigener Anwendungsfall mit eigener Prüfung.
 */
export async function getDashboardDay(db: D1Database, day: string): Promise<DashboardDay> {
  const orders = await findDashboardOrders(db, day);
  return aggregateDashboardDay(day, orders);
}
