import { describe, expect, it } from 'vitest';
import {
  EXPECTED_TABLES,
  checkEmailNotificationDefaults,
  checkForeignKeys,
  checkMigrationLedger,
  checkOrderPolicyDefaults,
  checkTables,
  migrationFileNames,
} from '../../scripts/migration-expectations.mjs';

/**
 * Die Erwartungen, gegen die `npm run db:verify:migrations` prüft.
 *
 * Sie stehen als reine Funktionen hier und nicht im Shell-Teil des Skripts:
 * Ein Prüfskript, dessen Prüfungen selbst ungeprüft sind, ist eine
 * Behauptung. Diese Datei ist der Grund, warum ein grünes
 * db:verify:migrations etwas bedeutet.
 */

describe('EXPECTED_TABLES', () => {
  it('enthält die tragenden Tabellen des Systems', () => {
    for (const t of [
      'customers',
      'products',
      'orders',
      'order_items',
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
    ]) {
      expect(EXPECTED_TABLES).toContain(t);
    }
  });

  it('enthält KEINE Tabelle, die 0010 wieder entfernt hat', () => {
    expect(EXPECTED_TABLES).not.toContain('customer_access_tokens');
  });
});

describe('checkEmailNotificationDefaults', () => {
  const safe = {
    id: 1,
    operator_notifications_enabled: 0,
    customer_confirmations_enabled: 0,
    updated_at: null,
  };

  it('nimmt ausgeschaltete Benachrichtigungen ohne erfundene Empfänger an', () => {
    expect(checkEmailNotificationDefaults([safe], [])).toEqual([]);
  });

  it('meldet aktivierte Voreinstellungen und voreingetragene Empfänger', () => {
    expect(checkEmailNotificationDefaults([
      { ...safe, operator_notifications_enabled: 1 },
    ], [{ email: 'real@example.test' }]).join(' ')).toMatch(/ausgeschaltet|Empfänger/i);
  });
});

describe('checkTables', () => {
  it('ist zufrieden, wenn alle erwarteten Tabellen da sind', () => {
    expect(checkTables([...EXPECTED_TABLES, 'd1_migrations'])).toEqual([]);
  });

  it('nennt jede fehlende Tabelle beim Namen', () => {
    const fehlend = EXPECTED_TABLES.filter((t) => t !== 'order_policy');
    expect(checkTables(fehlend).join(' ')).toMatch(/order_policy/);
  });

  it('stört sich nicht an zusätzlichen Tabellen', () => {
    expect(checkTables([...EXPECTED_TABLES, 'irgendwas_neues'])).toEqual([]);
  });
});

describe('checkMigrationLedger', () => {
  const dateien = ['0001_a.sql', '0002_b.sql'];

  it('ist zufrieden, wenn jede Datei genau einmal angewandt wurde', () => {
    expect(checkMigrationLedger(dateien, ['0001_a.sql', '0002_b.sql'])).toEqual([]);
  });

  it('meldet eine nicht angewandte Migration', () => {
    expect(checkMigrationLedger(dateien, ['0001_a.sql']).join(' ')).toMatch(/0002_b\.sql/);
  });

  it('meldet einen Eintrag, zu dem es keine Datei gibt', () => {
    expect(checkMigrationLedger(dateien, [...dateien, '0099_geist.sql']).join(' ')).toMatch(
      /0099_geist\.sql/,
    );
  });

  it('meldet eine doppelt angewandte Migration', () => {
    expect(checkMigrationLedger(dateien, ['0001_a.sql', '0001_a.sql', '0002_b.sql']).join(' ')).toMatch(
      /0001_a\.sql/,
    );
  });
});

describe('checkForeignKeys', () => {
  it('ist zufrieden, wenn foreign_key_check nichts liefert', () => {
    expect(checkForeignKeys([])).toEqual([]);
  });

  it('meldet jede Verletzung', () => {
    expect(checkForeignKeys([{ table: 'orders', rowid: 7 }]).join(' ')).toMatch(/orders/);
  });
});

describe('checkOrderPolicyDefaults', () => {
  const sicher = {
    id: 1,
    monday_enabled: 1,
    tuesday_enabled: 1,
    wednesday_enabled: 1,
    thursday_enabled: 1,
    friday_enabled: 1,
    saturday_enabled: 1,
    sunday_enabled: 1,
    cutoff_enabled: 0,
    lead_days: 1,
    cutoff_time: '12:00',
    updated_at: null,
  };

  it('nimmt die Voreinstellung aus 0016 an', () => {
    expect(checkOrderPolicyDefaults([sicher])).toEqual([]);
  });

  it('besteht darauf, dass es GENAU EINE Zeile gibt', () => {
    expect(checkOrderPolicyDefaults([]).join(' ')).toMatch(/genau eine/i);
    expect(checkOrderPolicyDefaults([sicher, sicher]).join(' ')).toMatch(/genau eine/i);
  });

  it('schlägt an, wenn der Bestellschluss nach der Migration AN wäre', () => {
    expect(checkOrderPolicyDefaults([{ ...sicher, cutoff_enabled: 1 }]).join(' ')).toMatch(
      /cutoff_enabled/,
    );
  });

  it('schlägt an, wenn ein Wochentag nach der Migration gesperrt wäre', () => {
    expect(checkOrderPolicyDefaults([{ ...sicher, sunday_enabled: 0 }]).join(' ')).toMatch(
      /sunday_enabled/,
    );
  });

  it('schlägt an, wenn updated_at einen erfundenen Zeitstempel trägt', () => {
    expect(
      checkOrderPolicyDefaults([{ ...sicher, updated_at: '2026-08-27T00:00:00.000Z' }]).join(' '),
    ).toMatch(/updated_at/);
  });
});

describe('migrationFileNames', () => {
  it('nimmt nur .sql-Dateien und sortiert sie', () => {
    expect(migrationFileNames(['0002_b.sql', 'README.md', '0001_a.sql'])).toEqual([
      '0001_a.sql',
      '0002_b.sql',
    ]);
  });
});
