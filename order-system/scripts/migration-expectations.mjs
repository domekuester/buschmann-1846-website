/**
 * Was nach einer vollständigen Migrationskette in der Datenbank stehen muss.
 *
 * REINE FUNKTIONEN, KEINE DATENBANK. Das ist der Zweck der Trennung: Die
 * Erwartungen sind damit selbst prüfbar (tests/domain/migration-expectations.test.ts),
 * und `npm run db:verify:migrations` bleibt ein Skript, das Ergebnisse
 * einsammelt statt selbst zu urteilen.
 *
 * Jede Funktion liefert eine LISTE VON BEFUNDEN. Leer heißt in Ordnung. Kein
 * boolescher Rückgabewert und keine Ausnahme: Ein Prüflauf soll ALLE
 * Abweichungen zeigen und nicht bei der ersten stehen bleiben — sonst ist
 * jede Korrektur ein neuer Durchlauf mit einem neuen einzelnen Befund.
 */

/**
 * Die Tabellen, die es nach 0017 geben muss.
 *
 * `customer_access_tokens` steht bewusst NICHT hier: Sie kam mit 0006 und
 * wurde von 0010 wieder entfernt. Eine Prüfliste, die einfach jede jemals
 * angelegte Tabelle aufzählt, würde eine zurückgenommene Entscheidung
 * dauerhaft festschreiben.
 */
export const EXPECTED_TABLES = Object.freeze([
  'customers',
  'products',
  'orders',
  'order_items',
  'order_number_sequences',
  'auth_accounts',
  'auth_sessions',
  'price_lists',
  'catalog_products',
  'catalog_product_prices',
  'order_policy',
  'email_notification_settings',
  'email_operator_recipients',
  'email_outbox',
  'customer_account_requests',
  'public_request_rate_limits',
]);

/** Fehlende Tabellen. Zusätzliche sind kein Befund — sie können aus einer neueren Migration stammen. */
export function checkTables(vorhandene) {
  return EXPECTED_TABLES.filter((t) => !vorhandene.includes(t)).map(
    (t) => `Tabelle fehlt: ${t}`,
  );
}

/** Nur .sql, sortiert — dieselbe Reihenfolge, in der Wrangler anwendet. */
export function migrationFileNames(dateien) {
  return dateien.filter((n) => n.endsWith('.sql')).sort();
}

/**
 * Datei und Buchung müssen sich decken.
 *
 * Drei Abweichungen sind möglich, und alle drei sind ernst: eine Datei ohne
 * Buchung (nicht angewandt), eine Buchung ohne Datei (die Migration wurde aus
 * dem Repository entfernt, ihre Wirkung steckt aber in der Datenbank) und
 * eine doppelte Buchung (die Kette wurde manuell angefasst).
 */
export function checkMigrationLedger(dateien, angewandt) {
  const befunde = [];

  for (const datei of dateien) {
    const anzahl = angewandt.filter((n) => n === datei).length;
    if (anzahl === 0) {
      befunde.push(`Migration nicht angewandt: ${datei}`);
    } else if (anzahl > 1) {
      befunde.push(`Migration mehrfach gebucht (${anzahl}×): ${datei}`);
    }
  }

  for (const name of new Set(angewandt)) {
    if (!dateien.includes(name)) {
      befunde.push(`Gebuchte Migration ohne Datei im Repository: ${name}`);
    }
  }

  return befunde;
}

/** Jede Zeile, die PRAGMA foreign_key_check liefert, ist eine Verletzung. */
export function checkForeignKeys(zeilen) {
  return zeilen.map(
    (z) => `Fremdschlüsselverletzung: ${JSON.stringify(z)}`,
  );
}

const WOCHENTAGE = [
  'monday_enabled',
  'tuesday_enabled',
  'wednesday_enabled',
  'thursday_enabled',
  'friday_enabled',
  'saturday_enabled',
  'sunday_enabled',
];

/**
 * Die Voreinstellung aus 0016 — und zwar GENAU sie.
 *
 * Warum das eine Release-Prüfung ist und keine Spitzfindigkeit: Diese Zeile
 * entscheidet, ob nach einer Migration überhaupt noch bestellt werden kann.
 * Stünde `cutoff_enabled` auf 1, nähme eine bestehende Installation über
 * Nacht Bestellungen an, die vorher möglich waren — ohne dass jemand das
 * entschieden hat. Stünde ein Wochentag auf 0, wäre derselbe Effekt für
 * einen ganzen Tag.
 *
 * `updated_at` muss NULL sein: Ein Zeitstempel dort behauptete, jemand habe
 * die Regel eingerichtet.
 */
export function checkOrderPolicyDefaults(zeilen) {
  if (zeilen.length !== 1) {
    return [`order_policy muss genau eine Zeile haben, hat aber ${zeilen.length}.`];
  }

  const zeile = zeilen[0];
  const befunde = [];

  if (Number(zeile.id) !== 1) {
    befunde.push(`order_policy.id muss 1 sein, ist ${zeile.id}.`);
  }

  for (const tag of WOCHENTAGE) {
    if (Number(zeile[tag]) !== 1) {
      befunde.push(`order_policy.${tag} muss nach der Migration 1 sein, ist ${zeile[tag]}.`);
    }
  }

  if (Number(zeile.cutoff_enabled) !== 0) {
    befunde.push(
      `order_policy.cutoff_enabled muss nach der Migration 0 sein, ist ${zeile.cutoff_enabled}.`,
    );
  }

  if (Number(zeile.lead_days) !== 1) {
    befunde.push(`order_policy.lead_days muss 1 sein, ist ${zeile.lead_days}.`);
  }

  if (zeile.cutoff_time !== '12:00') {
    befunde.push(`order_policy.cutoff_time muss '12:00' sein, ist ${zeile.cutoff_time}.`);
  }

  if (zeile.updated_at !== null && zeile.updated_at !== undefined) {
    befunde.push(
      `order_policy.updated_at muss NULL sein (nie geändert), ist ${zeile.updated_at}.`,
    );
  }

  return befunde;
}

/** Neue Installationen versenden ohne ausdrückliche Betreiberentscheidung nichts. */
export function checkEmailNotificationDefaults(settingsRows, recipientRows) {
  const befunde = [];
  if (settingsRows.length !== 1) {
    befunde.push(
      `email_notification_settings muss genau eine Zeile haben, hat aber ${settingsRows.length}.`,
    );
  } else {
    const row = settingsRows[0];
    if (Number(row.id) !== 1) befunde.push('email_notification_settings.id muss 1 sein.');
    if (Number(row.operator_notifications_enabled) !== 0) {
      befunde.push('Betreiberbenachrichtigungen müssen nach der Migration ausgeschaltet sein.');
    }
    if (Number(row.customer_confirmations_enabled) !== 0) {
      befunde.push('Kundenbestätigungen müssen nach der Migration ausgeschaltet sein.');
    }
    if (row.updated_at !== null && row.updated_at !== undefined) {
      befunde.push('email_notification_settings.updated_at muss NULL sein.');
    }
  }
  if (recipientRows.length !== 0) {
    befunde.push('Die Migration darf keine Betreiber-Empfänger erfinden.');
  }
  return befunde;
}
