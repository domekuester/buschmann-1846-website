import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_POLICY } from '../../src/domain/order-policy';
import { loadOrderPolicy, saveOrderPolicy } from '../../src/infrastructure/d1/order-policy-repository';

const NOW = new Date('2026-08-25T12:00:00.000Z');

/**
 * Migration 0016 — die Bestellrichtlinie.
 *
 * DER WICHTIGSTE TEST DIESER DATEI IST DER ERSTE: Nach der Migration darf
 * eine bestehende Installation keine einzige Bestellung verlieren. Alle
 * sieben Tage erlaubt, kein Bestellschluss — also genau das Verhalten von
 * vorher.
 *
 * Geprüft wird die DATENBANK und nicht der Anwendungscode: dass die Zeile
 * genau einmal existieren kann, dass unmögliche Werte an einem CHECK
 * scheitern und nicht erst beim Lesen auffallen, und dass „noch nie
 * geändert" ein eigener Zustand ist und kein erfundener Zeitstempel.
 */

async function zeile(): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT * FROM order_policy WHERE id = 1')
    .first<Record<string, unknown>>();
  if (!row) throw new Error('Die Bestellrichtlinie fehlt');
  return row;
}

/** Setzt die Tabelle auf den Zustand direkt nach der Migration zurück. */
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM order_policy').run();
  await env.DB.prepare('INSERT INTO order_policy (id) VALUES (1)').run();
});

describe('Migration 0016 — Voreinstellung', () => {
  it('legt genau eine Zeile an', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS anzahl FROM order_policy')
      .first<{ anzahl: number }>();
    expect(row?.anzahl).toBe(1);
  });

  /** §1 — SAFE DEFAULT. Nichts wird verboten, bis jemand es entscheidet. */
  it('erlaubt alle sieben Wochentage und schaltet den Bestellschluss aus', async () => {
    expect(await zeile()).toMatchObject({
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
    });
  });

  /**
   * NULL heißt „noch nie geändert" und ist keine Behauptung über die
   * Vergangenheit — dieselbe Regel wie bei customers.price_list_id in 0013.
   */
  it('trägt keinen erfundenen Änderungszeitpunkt ein', async () => {
    expect((await zeile())['updated_at']).toBeNull();
  });

  it('stimmt mit der Voreinstellung im Code überein', async () => {
    const { policy, updatedAt } = await loadOrderPolicy(env.DB);
    expect(policy).toEqual(DEFAULT_ORDER_POLICY);
    expect(updatedAt).toBeNull();
  });
});

describe('Migration 0016 — die Datenbank lässt keine unmögliche Regel zu', () => {
  it('duldet keine zweite Zeile', async () => {
    await expect(
      env.DB.prepare('INSERT INTO order_policy (id) VALUES (2)').run(),
    ).rejects.toThrow();
  });

  it('nimmt für einen Wochentag nur 0 oder 1', async () => {
    await expect(
      env.DB.prepare('UPDATE order_policy SET monday_enabled = 2 WHERE id = 1').run(),
    ).rejects.toThrow();
  });

  it('nimmt für den Schalter nur 0 oder 1', async () => {
    await expect(
      env.DB.prepare("UPDATE order_policy SET cutoff_enabled = 'ja' WHERE id = 1").run(),
    ).rejects.toThrow();
  });

  it('lässt einen Vorlauf von 0 bis 30 zu und nichts darüber hinaus', async () => {
    for (const tage of [0, 1, 30]) {
      await env.DB.prepare('UPDATE order_policy SET lead_days = ? WHERE id = 1').bind(tage).run();
      expect((await zeile())['lead_days']).toBe(tage);
    }

    for (const tage of [-1, 31, 365]) {
      await expect(
        env.DB.prepare('UPDATE order_policy SET lead_days = ? WHERE id = 1').bind(tage).run(),
      ).rejects.toThrow();
    }
  });

  it('lässt keinen gebrochenen Vorlauf zu', async () => {
    await expect(
      env.DB.prepare('UPDATE order_policy SET lead_days = 1.5 WHERE id = 1').run(),
    ).rejects.toThrow();
  });

  /**
   * DAS MUSTER ALLEIN GENÜGT NICHT — '29:71' besteht jede Ziffernprüfung und
   * ist trotzdem keine Uhrzeit. Deshalb steht neben dem GLOB die
   * Bereichsprüfung.
   */
  it('nimmt nur Uhrzeiten an, die es gibt', async () => {
    for (const zeit of ['00:00', '09:05', '12:00', '23:59']) {
      await env.DB.prepare('UPDATE order_policy SET cutoff_time = ? WHERE id = 1').bind(zeit).run();
      expect((await zeile())['cutoff_time']).toBe(zeit);
    }

    for (const zeit of ['24:00', '12:60', '29:71', '9:00', '12:0', '12:00:00', 'mittags', '']) {
      await expect(
        env.DB.prepare('UPDATE order_policy SET cutoff_time = ? WHERE id = 1').bind(zeit).run(),
      ).rejects.toThrow();
    }
  });
});

describe('Speichern und Lesen', () => {
  it('schreibt alle Felder und liest sie unverändert zurück', async () => {
    await saveOrderPolicy(
      env.DB,
      {
        weekdays: [true, false, true, false, true, false, false],
        cutoffEnabled: true,
        leadDays: 2,
        cutoffTime: '09:30',
      },
      NOW,
    );

    const { policy, updatedAt } = await loadOrderPolicy(env.DB);
    expect(policy).toEqual({
      weekdays: [true, false, true, false, true, false, false],
      cutoffEnabled: true,
      leadDays: 2,
      cutoffTime: '09:30',
    });
    expect(updatedAt).toBe('2026-08-25T12:00:00.000Z');
  });

  /**
   * EIN NICHT ANGEHAKTES KÄSTCHEN MUSS EINEN TAG AUSSCHALTEN KÖNNEN. Ein
   * Teil-UPDATE ließe den alten Wert stehen, und das Abwählen eines
   * Wochentags wäre unmöglich — ohne dass irgendwo ein Fehler erschiene.
   */
  it('schaltet einen zuvor erlaubten Wochentag tatsächlich ab', async () => {
    const alleTage = { ...DEFAULT_ORDER_POLICY };
    await saveOrderPolicy(env.DB, alleTage, NOW);
    expect((await loadOrderPolicy(env.DB)).policy.weekdays[6]).toBe(true);

    await saveOrderPolicy(
      env.DB,
      { ...alleTage, weekdays: [true, true, true, true, true, true, false] },
      NOW,
    );
    expect((await loadOrderPolicy(env.DB)).policy.weekdays[6]).toBe(false);
  });

  it('legt beim Speichern keine zweite Zeile an', async () => {
    await saveOrderPolicy(env.DB, DEFAULT_ORDER_POLICY, NOW);
    await saveOrderPolicy(env.DB, DEFAULT_ORDER_POLICY, NOW);

    const row = await env.DB.prepare('SELECT COUNT(*) AS anzahl FROM order_policy')
      .first<{ anzahl: number }>();
    expect(row?.anzahl).toBe(1);
  });

  /**
   * Fehlt die Zeile, gilt die Voreinstellung — und NICHT „alles verboten".
   * Ein Lesefehler soll dem Betrieb nicht sämtliche Bestellungen nehmen.
   */
  it('fällt ohne Zeile auf die Voreinstellung zurück', async () => {
    await env.DB.prepare('DELETE FROM order_policy').run();

    const { policy, updatedAt } = await loadOrderPolicy(env.DB);
    expect(policy).toEqual(DEFAULT_ORDER_POLICY);
    expect(updatedAt).toBeNull();
  });

  it('legt die fehlende Zeile beim Speichern wieder an', async () => {
    await env.DB.prepare('DELETE FROM order_policy').run();
    await saveOrderPolicy(env.DB, { ...DEFAULT_ORDER_POLICY, leadDays: 3 }, NOW);

    expect((await loadOrderPolicy(env.DB)).policy.leadDays).toBe(3);
  });

  /**
   * DIE DATENBANK IST DIE LETZTE INSTANZ. Der Endpunkt prüft vorher, aber das
   * Repository verlässt sich nicht darauf — ein unmöglicher Wert scheitert
   * hier und nicht erst beim nächsten Lesen.
   */
  it('weist eine unmögliche Uhrzeit auch aus dem Code heraus ab', async () => {
    await expect(
      saveOrderPolicy(env.DB, { ...DEFAULT_ORDER_POLICY, cutoffTime: '25:00' }, NOW),
    ).rejects.toThrow();
  });
});
