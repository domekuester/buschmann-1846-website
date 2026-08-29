import { describe, expect, it } from 'vitest';
import { FulfillmentDate } from '../../src/domain/fulfillment-date';
import { ValidationError } from '../../src/domain/errors';

/** Ein Zeitpunkt, kein Datum: 2026-08-23, 12:32 Uhr in Berlin. */
const now = new Date('2026-08-23T10:32:00Z');

describe('FulfillmentDate', () => {
  it('akzeptiert ein künftiges Datum', () => {
    expect(FulfillmentDate.fromString('2026-08-28', now).value).toBe('2026-08-28');
  });

  it('akzeptiert den heutigen Tag', () => {
    expect(FulfillmentDate.fromString('2026-08-23', now).value).toBe('2026-08-23');
  });

  it('lehnt ein vergangenes Datum ab', () => {
    try {
      FulfillmentDate.fromString('2026-08-22', now);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).hasError('fulfillment_date')).toBe(true);
    }
  });

  it('lehnt fehlerhafte Eingaben ab', () => {
    for (const bad of ['', '28.08.2026', '2026-13-01', '2026-02-30', 'morgen', '2026-8-28', '2026-08-32', '0000-01-01']) {
      expect(() => FulfillmentDate.fromString(bad, now)).toThrow(ValidationError);
    }
  });

  it('akzeptiert den 29. Februar eines Schaltjahres', () => {
    expect(FulfillmentDate.fromString('2028-02-29', now).value).toBe('2028-02-29');
    expect(() => FulfillmentDate.fromString('2027-02-29', now)).toThrow(ValidationError);
  });

  /**
   * Der Vergleichszeitpunkt wird übergeben, nicht intern aus Date.now()
   * gelesen — sonst wären diese Tests am Jahreswechsel wertlos.
   */
  it('bekommt den Vergleichszeitpunkt übergeben', () => {
    const silvester = new Date('2019-12-31T12:00:00Z');
    expect(FulfillmentDate.fromString('2020-01-01', silvester).value).toBe('2020-01-01');
  });

  /**
   * DIE entscheidende Regel des Zeitmodells. Der Worker läuft in UTC. Um
   * 23:30 UTC ist in Düsseldorf bereits der nächste Tag. Würde „heute" aus
   * der UTC-Uhr abgeleitet, könnte ein Café um kurz nach Mitternacht keine
   * Bestellung für den laufenden Tag mehr aufgeben — und eine für „gestern"
   * würde durchgehen.
   */
  it('bestimmt „heute" in Europe/Berlin, nicht in UTC (Sommerzeit)', () => {
    const kurzNachMitternachtInBerlin = new Date('2026-08-23T23:30:00Z'); // = 24.08., 01:30 Berlin
    expect(FulfillmentDate.fromString('2026-08-24', kurzNachMitternachtInBerlin).value).toBe('2026-08-24');
    expect(() => FulfillmentDate.fromString('2026-08-23', kurzNachMitternachtInBerlin)).toThrow(ValidationError);
  });

  it('bestimmt „heute" in Europe/Berlin, nicht in UTC (Winterzeit)', () => {
    const kurzNachMitternachtInBerlin = new Date('2026-01-15T23:30:00Z'); // = 16.01., 00:30 Berlin
    expect(FulfillmentDate.fromString('2026-01-16', kurzNachMitternachtInBerlin).value).toBe('2026-01-16');
    expect(() => FulfillmentDate.fromString('2026-01-15', kurzNachMitternachtInBerlin)).toThrow(ValidationError);
  });

  /** Der gespeicherte Wert ist genau die Zeichenkette, die in D1 landet. */
  it('behält das Format, in dem D1 den Tag speichert', () => {
    expect(String(FulfillmentDate.fromString('2026-08-28', now))).toBe('2026-08-28');
  });
});

describe('FulfillmentDate.restore', () => {
  /**
   * Beim LADEN einer bestehenden Bestellung darf der Liefertag in der
   * Vergangenheit liegen — die Regel „nicht in der Vergangenheit" gilt beim
   * Bestellen, nicht beim Lesen. Eine Bestellung von letzter Woche muss
   * lesbar bleiben.
   */
  it('nimmt einen vergangenen Tag aus der Datenbank an', () => {
    expect(FulfillmentDate.restore('2020-01-01').value).toBe('2020-01-01');
  });

  it('lehnt einen unbrauchbaren gespeicherten Wert trotzdem ab', () => {
    for (const bad of ['', 'morgen', '2026-02-30', '2026-8-28']) {
      expect(() => FulfillmentDate.restore(bad)).toThrow();
    }
  });
});
