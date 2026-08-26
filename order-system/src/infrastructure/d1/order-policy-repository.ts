import { toUtcTimestamp } from '../../domain/clock';
import { DEFAULT_ORDER_POLICY, type OrderPolicy } from '../../domain/order-policy';
import { fromBoolean, toBoolean } from './rows';

/**
 * Die Bestellrichtlinie in der Datenbank — EINE ZEILE, ZWEI ZUGRIFFE.
 *
 * Es gibt hier kein Anlegen und kein Löschen: Die Zeile entsteht in
 * migrations/0016 und bleibt. Ein „lege sie an, falls sie fehlt" im Lesepfad
 * wäre ein Schreibvorgang, den jeder unangemeldete Seitenaufruf auslöste.
 */

interface OrderPolicyQueryRow {
  monday_enabled: number;
  tuesday_enabled: number;
  wednesday_enabled: number;
  thursday_enabled: number;
  friday_enabled: number;
  saturday_enabled: number;
  sunday_enabled: number;
  cutoff_enabled: number;
  lead_days: number;
  cutoff_time: string;
  updated_at: string | null;
}

export interface OrderPolicyRecord {
  readonly policy: OrderPolicy;
  /** Wann zuletzt jemand gespeichert hat — null heißt „noch nie geändert". */
  readonly updatedAt: string | null;
}

/**
 * Die geltende Bestellrichtlinie.
 *
 * EINE ABFRAGE, IMMER DIESELBE, MIT AUSDRÜCKLICH AUFGEZÄHLTEN SPALTEN. Kein
 * `SELECT *`: Eine Spalte, die später dazukommt, soll nicht von selbst in
 * einer Antwort landen.
 *
 * KEIN ZWISCHENSPEICHER IM MODUL. Die Versuchung ist offensichtlich — die
 * Zeile ändert sich fast nie, und ein `let cached` spart eine Abfrage je
 * Bestellung. Ein Worker ist aber kein Prozess: Isolate leben unterschiedlich
 * lang und werden nicht benachrichtigt, wenn jemand anderswo speichert. Ein
 * Café bekäme dann je nach Isolate eine andere Regel zu sehen als der
 * Bestell-Endpunkt anwendet, und der Fehler wäre nicht reproduzierbar. Eine
 * Abfrage auf eine Ein-Zeilen-Tabelle über den Primärschlüssel ist der
 * günstigere Handel.
 *
 * FEHLT DIE ZEILE, GILT DIE VOREINSTELLUNG — also alle Tage erlaubt und kein
 * Bestellschluss. Der Rückfall auf „alles verboten" wäre die gefährlichere
 * Wahl: Ein Lesefehler nähme dem Betrieb dann sämtliche Bestellungen weg,
 * ohne dass jemand etwas geändert hätte.
 */
export async function loadOrderPolicy(db: D1Database): Promise<OrderPolicyRecord> {
  const row = await db.prepare(
    `SELECT monday_enabled, tuesday_enabled, wednesday_enabled, thursday_enabled,
            friday_enabled, saturday_enabled, sunday_enabled,
            cutoff_enabled, lead_days, cutoff_time, updated_at
       FROM order_policy
      WHERE id = 1`,
  ).first<OrderPolicyQueryRow>();

  if (row === null) {
    return { policy: DEFAULT_ORDER_POLICY, updatedAt: null };
  }

  return {
    policy: {
      weekdays: [
        toBoolean(row.monday_enabled),
        toBoolean(row.tuesday_enabled),
        toBoolean(row.wednesday_enabled),
        toBoolean(row.thursday_enabled),
        toBoolean(row.friday_enabled),
        toBoolean(row.saturday_enabled),
        toBoolean(row.sunday_enabled),
      ],
      cutoffEnabled: toBoolean(row.cutoff_enabled),
      leadDays: row.lead_days,
      cutoffTime: row.cutoff_time,
    },
    updatedAt: row.updated_at,
  };
}

/**
 * Speichert die Bestellrichtlinie.
 *
 * EIN UPSERT UND KEIN „ERST LESEN, DANN SCHREIBEN". Zwei Anweisungen wären
 * zwei Gelegenheiten für zwei gleichzeitige Admins, sich gegenseitig zu
 * überholen; hier gewinnt schlicht der spätere Schreibvorgang vollständig,
 * und es kann keine halb übernommene Regel entstehen.
 *
 * ES WERDEN IMMER ALLE FELDER GESCHRIEBEN. Ein Formular, das ein Kästchen
 * nicht mitschickt, meint „ausgeschaltet" — ein Teil-UPDATE ließe den alten
 * Wert stehen und machte das Abwählen eines Wochentags unmöglich.
 *
 * DIE CHECK-BEDINGUNGEN AUS 0016 SIND DIE LETZTE INSTANZ. Der Endpunkt prüft
 * vorher, aber diese Funktion verlässt sich nicht darauf: Ein unmöglicher
 * Wert scheitert hier an der Datenbank und nicht erst beim nächsten Lesen.
 */
export async function saveOrderPolicy(
  db: D1Database,
  policy: OrderPolicy,
  now: Date,
): Promise<void> {
  const [montag, dienstag, mittwoch, donnerstag, freitag, samstag, sonntag] = policy.weekdays;

  await db.prepare(
    `INSERT INTO order_policy
       (id, monday_enabled, tuesday_enabled, wednesday_enabled, thursday_enabled,
        friday_enabled, saturday_enabled, sunday_enabled,
        cutoff_enabled, lead_days, cutoff_time, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
        monday_enabled    = excluded.monday_enabled,
        tuesday_enabled   = excluded.tuesday_enabled,
        wednesday_enabled = excluded.wednesday_enabled,
        thursday_enabled  = excluded.thursday_enabled,
        friday_enabled    = excluded.friday_enabled,
        saturday_enabled  = excluded.saturday_enabled,
        sunday_enabled    = excluded.sunday_enabled,
        cutoff_enabled    = excluded.cutoff_enabled,
        lead_days         = excluded.lead_days,
        cutoff_time       = excluded.cutoff_time,
        updated_at        = excluded.updated_at`,
  ).bind(
    fromBoolean(montag),
    fromBoolean(dienstag),
    fromBoolean(mittwoch),
    fromBoolean(donnerstag),
    fromBoolean(freitag),
    fromBoolean(samstag),
    fromBoolean(sonntag),
    fromBoolean(policy.cutoffEnabled),
    policy.leadDays,
    policy.cutoffTime,
    toUtcTimestamp(now),
  ).run();
}
