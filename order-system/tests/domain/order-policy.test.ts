import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/domain/errors';
import {
  DEFAULT_ORDER_POLICY,
  MAX_LEAD_DAYS,
  NEXT_DAY_SEARCH_LIMIT,
  cutoffExampleSentence,
  cutoffSentence,
  evaluateOrderAvailability,
  isCutoffTime,
  nextOrderableDay,
  orderDaysSentence,
  orderDeadline,
  orderUnavailableMessage,
  type OrderPolicy,
  type WeekdayFlags,
} from '../../src/domain/order-policy';

/**
 * Die Bestellrichtlinie als reine Regel — ohne Datenbank, ohne HTTP, ohne
 * Uhr. `now` wird überall übergeben; ein interner Date.now() machte genau
 * diese Datei untestbar und ließe sie am Jahreswechsel kippen.
 *
 * ALLE DATEN SIND FEST UND LIEGEN IN 2026/2027. Nichts hier wird morgen rot,
 * weil nichts hier von der echten Uhr abhängt.
 *
 * Kalendarische Verankerung, einmal für die ganze Datei:
 *   2026-08-25 Dienstag · 2026-08-28 Freitag · 2026-08-30 Sonntag
 *   2026-08-31 Montag   · 2026-09-01 Dienstag
 */

const MONTAG = 0;
const FREITAG = 4;
const SAMSTAG = 5;
const SONNTAG = 6;

function tage(...erlaubt: number[]): WeekdayFlags {
  const flags = [false, false, false, false, false, false, false];
  for (const index of erlaubt) flags[index] = true;
  return flags as unknown as WeekdayFlags;
}

const ALLE_TAGE: WeekdayFlags = [true, true, true, true, true, true, true];

function policy(overrides: Partial<OrderPolicy> = {}): OrderPolicy {
  return { ...DEFAULT_ORDER_POLICY, ...overrides };
}

/** Ein Zeitpunkt in UTC — so, wie der Worker ihn hat. */
function zeitpunkt(iso: string): Date {
  return new Date(iso);
}

describe('Voreinstellung — das bisherige Verhalten', () => {
  it('erlaubt alle sieben Wochentage und prüft keinen Bestellschluss', () => {
    expect(DEFAULT_ORDER_POLICY.weekdays).toEqual([true, true, true, true, true, true, true]);
    expect(DEFAULT_ORDER_POLICY.cutoffEnabled).toBe(false);
  });

  /**
   * §17.1 — Regel aus, altes Verhalten. Das ist der wichtigste Test der
   * Datei: Eine bestehende Installation darf durch 6F keine einzige
   * Bestellung verlieren.
   */
  it('lässt mit der Voreinstellung jeden Tag zu, auch mitten in der Nacht', () => {
    const jetzt = zeitpunkt('2026-08-25T23:30:00.000Z');

    for (const tag of ['2026-08-25', '2026-08-26', '2026-08-29', '2026-08-30', '2027-02-28']) {
      expect(evaluateOrderAvailability(DEFAULT_ORDER_POLICY, jetzt, tag)).toEqual({
        allowed: true,
        reason: 'allowed',
        deadline: null,
      });
    }
  });

  it('nennt ohne aktiven Bestellschluss keine Frist', () => {
    expect(orderDeadline(DEFAULT_ORDER_POLICY, '2026-08-28')).toBeNull();
  });
});

describe('Wochentage', () => {
  /** §17.2 */
  it('erlaubt einen freigeschalteten Wochentag', () => {
    const regel = policy({ weekdays: tage(FREITAG) });
    const ergebnis = evaluateOrderAvailability(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-08-28');

    expect(ergebnis.allowed).toBe(true);
    expect(ergebnis.reason).toBe('allowed');
  });

  /** §17.3 */
  it('lehnt einen abgeschalteten Wochentag ab', () => {
    const regel = policy({ weekdays: tage(MONTAG, FREITAG) });
    const ergebnis = evaluateOrderAvailability(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-08-30');

    expect(ergebnis.allowed).toBe(false);
    expect(ergebnis.reason).toBe('day_disabled');
  });

  /**
   * DER WOCHENTAG WIRD VOR DEM BESTELLSCHLUSS GEPRÜFT. An einem Sonntag, an
   * dem nicht gebacken wird, ist kein Bestellschluss „vorbei" — es gibt
   * keinen. Die Meldung soll das Richtige sagen.
   */
  it('meldet für einen abgeschalteten Tag den Wochentag und nicht den Bestellschluss', () => {
    const regel = policy({
      weekdays: tage(FREITAG),
      cutoffEnabled: true,
      leadDays: 1,
      cutoffTime: '12:00',
    });
    // Der Bestellschluss für Sonntag läge am Samstag und wäre längst vorbei.
    const ergebnis = evaluateOrderAvailability(regel, zeitpunkt('2026-09-07T09:00:00.000Z'), '2026-08-30');

    expect(ergebnis.reason).toBe('day_disabled');
    expect(ergebnis.deadline).toBeNull();
  });

  /** §17.13 — kein einziger Tag erlaubt. Kontrolliert, nicht endlos. */
  it('lehnt bei sieben abgeschalteten Tagen jeden Tag ab und findet keinen nächsten', () => {
    const regel = policy({ weekdays: tage() });
    const jetzt = zeitpunkt('2026-08-25T09:00:00.000Z');

    expect(evaluateOrderAvailability(regel, jetzt, '2026-08-28').reason).toBe('day_disabled');
    expect(nextOrderableDay(regel, jetzt)).toBeNull();
  });
});

describe('Bestellschluss', () => {
  const freitagsregel = policy({
    weekdays: ALLE_TAGE,
    cutoffEnabled: true,
    leadDays: 1,
    cutoffTime: '12:00',
  });

  /** §17.8 — lead_days 1: Produktion Freitag, Schluss Donnerstag 12:00. */
  it('legt den Bestellschluss bei einem Tag Vorlauf auf den Vortag', () => {
    expect(orderDeadline(freitagsregel, '2026-08-28')).toEqual({
      day: '2026-08-27',
      time: '12:00',
    });
  });

  /** §17.4 */
  it('erlaubt die Bestellung vor dem Bestellschluss', () => {
    // 2026-08-27, 09:59 UTC = 11:59 Berliner Sommerzeit.
    const ergebnis = evaluateOrderAvailability(
      freitagsregel,
      zeitpunkt('2026-08-27T09:59:59.000Z'),
      '2026-08-28',
    );

    expect(ergebnis.allowed).toBe(true);
    expect(ergebnis.deadline).toEqual({ day: '2026-08-27', time: '12:00' });
  });

  /**
   * §17.5 und §18 — DIE INKLUSIVREGEL, EXAKT AUF DER SEKUNDE.
   *
   * 10:00:00 UTC ist im Sommer punktgenau 12:00:00 Berliner Zeit. Ab diesem
   * Augenblick ist geschlossen: `now >= deadline` heißt zu. Wäre irgendwo
   * '>' statt '>=' implementiert, bliebe genau diese eine Minute offen — und
   * sie ist die einzige, in der es auffiele.
   */
  it('schließt exakt zum Bestellschluss', () => {
    expect(
      evaluateOrderAvailability(freitagsregel, zeitpunkt('2026-08-27T10:00:00.000Z'), '2026-08-28'),
    ).toEqual({
      allowed: false,
      reason: 'cutoff_passed',
      deadline: { day: '2026-08-27', time: '12:00' },
    });
  });

  /** §17.6 */
  it('lehnt die Bestellung nach dem Bestellschluss ab', () => {
    const ergebnis = evaluateOrderAvailability(
      freitagsregel,
      zeitpunkt('2026-08-27T14:00:00.000Z'),
      '2026-08-28',
    );

    expect(ergebnis.allowed).toBe(false);
    expect(ergebnis.reason).toBe('cutoff_passed');
  });

  /** §17.7 — lead_days 0: am Produktionstag selbst bis zur Uhrzeit. */
  it('erlaubt bei null Tagen Vorlauf die Bestellung am Produktionstag bis zur Uhrzeit', () => {
    const regel = policy({ weekdays: ALLE_TAGE, cutoffEnabled: true, leadDays: 0, cutoffTime: '10:00' });

    expect(orderDeadline(regel, '2026-08-28')).toEqual({ day: '2026-08-28', time: '10:00' });
    // 07:59 UTC = 09:59 Berlin — noch offen.
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-08-28T07:59:00.000Z'), '2026-08-28').allowed)
      .toBe(true);
    // 08:00 UTC = 10:00 Berlin — zu.
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-08-28T08:00:00.000Z'), '2026-08-28').allowed)
      .toBe(false);
  });

  it('rechnet auch einen langen Vorlauf in Kalendertagen und überspringt nichts', () => {
    const regel = policy({ weekdays: ALLE_TAGE, cutoffEnabled: true, leadDays: 7, cutoffTime: '12:00' });

    // Sieben Kalendertage vor Freitag ist der Freitag davor — nicht „fünf
    // Werktage", nicht „die Woche davor ohne Wochenende".
    expect(orderDeadline(regel, '2026-08-28')).toEqual({ day: '2026-08-21', time: '12:00' });
  });

  /** §17.9 — Monatswechsel. */
  it('rechnet über den Monatswechsel zurück', () => {
    expect(orderDeadline(freitagsregel, '2026-09-01')).toEqual({
      day: '2026-08-31',
      time: '12:00',
    });
  });

  /** §17.10 — Jahreswechsel. */
  it('rechnet über den Jahreswechsel zurück', () => {
    const regel = policy({ weekdays: ALLE_TAGE, cutoffEnabled: true, leadDays: 2, cutoffTime: '12:00' });

    expect(orderDeadline(regel, '2027-01-01')).toEqual({ day: '2026-12-30', time: '12:00' });
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-12-30T10:59:00.000Z'), '2027-01-01').allowed)
      .toBe(true);
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-12-30T11:00:00.000Z'), '2027-01-01').allowed)
      .toBe(false);
  });

  it('rechnet über den 29. Februar eines Schaltjahres zurück', () => {
    const regel = policy({ weekdays: ALLE_TAGE, cutoffEnabled: true, leadDays: 1, cutoffTime: '12:00' });
    expect(orderDeadline(regel, '2028-03-01')).toEqual({ day: '2028-02-29', time: '12:00' });
  });

  it('weist einen Tag zurück, den es nicht gibt', () => {
    expect(() =>
      evaluateOrderAvailability(freitagsregel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-02-30'),
    ).toThrow(InvalidArgumentError);
  });
});

/**
 * §17.11 — SOMMERZEIT.
 *
 * „12:00 Uhr" ist eine ORTSZEIT und keine UTC-Zeit. Im Sommer liegt sie bei
 * 10:00 UTC, im Winter bei 11:00 UTC. Ein System, das den Bestellschluss aus
 * der UTC-Uhr ableitete, schlösse ein halbes Jahr lang eine Stunde zu früh
 * oder zu spät — und niemand fände den Fehler im März wieder.
 */
describe('Sommerzeit', () => {
  const regel = policy({
    weekdays: ALLE_TAGE,
    cutoffEnabled: true,
    leadDays: 1,
    cutoffTime: '12:00',
  });

  it('schließt im Sommer um 10:00 UTC', () => {
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-08-27T09:59:00.000Z'), '2026-08-28').allowed)
      .toBe(true);
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-08-27T10:00:00.000Z'), '2026-08-28').allowed)
      .toBe(false);
  });

  it('schließt im Winter um 11:00 UTC', () => {
    // 2026-11-27 ist ein Freitag; der Bestellschluss liegt am Donnerstag.
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-11-26T10:59:00.000Z'), '2026-11-27').allowed)
      .toBe(true);
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-11-26T11:00:00.000Z'), '2026-11-27').allowed)
      .toBe(false);
  });

  /**
   * Der Umstellungstag selbst: In der Nacht zum 25. Oktober 2026 wird die Uhr
   * um 03:00 Ortszeit auf 02:00 zurückgestellt. Der Bestellschluss um 12:00
   * an diesem Tag liegt bereits in der Winterzeit, also bei 11:00 UTC — und
   * nicht bei 10:00, wie es die Sommerzeitrechnung des Vortages ergäbe.
   */
  it('rechnet am Umstellungstag mit der neuen Ortszeit', () => {
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-10-25T10:59:00.000Z'), '2026-10-26').allowed)
      .toBe(true);
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-10-25T11:00:00.000Z'), '2026-10-26').allowed)
      .toBe(false);
  });

  /**
   * Der Tag selbst wird ebenfalls in Ortszeit bestimmt: Um 23:30 UTC ist in
   * Düsseldorf im Sommer schon der nächste Tag. Ein Bestellschluss, der den
   * Tag aus der UTC-Uhr nähme, ließe hier eine Bestellung durch, die längst
   * geschlossen ist.
   */
  it('bestimmt auch den laufenden Tag in Ortszeit', () => {
    const nurHeute = policy({
      weekdays: ALLE_TAGE,
      cutoffEnabled: true,
      leadDays: 0,
      cutoffTime: '23:00',
    });

    // 21:30 UTC am 27. = 23:30 Berliner Zeit am 27. — Bestellschluss vorbei.
    expect(evaluateOrderAvailability(nurHeute, zeitpunkt('2026-08-27T21:30:00.000Z'), '2026-08-27').allowed)
      .toBe(false);
    // 22:30 UTC am 27. = 00:30 Berliner Zeit am 28. — der 28. ist noch offen.
    expect(evaluateOrderAvailability(nurHeute, zeitpunkt('2026-08-27T22:30:00.000Z'), '2026-08-28').allowed)
      .toBe(true);
  });
});

/** §17.12 */
describe('nextOrderableDay', () => {
  it('liefert heute, wenn heute geht', () => {
    const regel = policy({ weekdays: ALLE_TAGE });
    expect(nextOrderableDay(regel, zeitpunkt('2026-08-25T09:00:00.000Z'))).toBe('2026-08-25');
  });

  it('überspringt abgeschaltete Wochentage', () => {
    // Nur Montag. Vom Dienstag, 25. August aus ist das der 31. August.
    const regel = policy({ weekdays: tage(MONTAG) });
    expect(nextOrderableDay(regel, zeitpunkt('2026-08-25T09:00:00.000Z'))).toBe('2026-08-31');
  });

  it('überspringt Tage, deren Bestellschluss bereits vorbei ist', () => {
    const regel = policy({
      weekdays: ALLE_TAGE,
      cutoffEnabled: true,
      leadDays: 1,
      cutoffTime: '12:00',
    });

    // 25. August, 14:00 Berliner Zeit: Der Schluss für den 26. lag um 12:00
    // desselben Tages und ist vorbei; der 27. geht noch.
    expect(nextOrderableDay(regel, zeitpunkt('2026-08-25T12:00:00.000Z'))).toBe('2026-08-27');
  });

  it('sucht ab einem gewünschten Tag statt ab heute', () => {
    const regel = policy({ weekdays: tage(SAMSTAG, SONNTAG) });
    expect(nextOrderableDay(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-09-01')).toBe('2026-09-05');
  });

  /**
   * DIE SCHRANKE IST DER GRUND, WARUM DIE SUCHE EINE SCHLEIFE SEIN DARF.
   * Ohne sie liefe sie hier endlos — in einem Worker, der dann nichts anderes
   * mehr tut.
   */
  it('bricht nach der Schranke ab, statt endlos zu suchen', () => {
    const regel = policy({ weekdays: tage() });
    expect(NEXT_DAY_SEARCH_LIMIT).toBe(60);
    expect(nextOrderableDay(regel, zeitpunkt('2026-08-25T09:00:00.000Z'))).toBeNull();
  });

  it('findet auch bei größtmöglichem Vorlauf und einem einzigen Wochentag einen Tag', () => {
    const regel = policy({
      weekdays: tage(MONTAG),
      cutoffEnabled: true,
      leadDays: MAX_LEAD_DAYS,
      cutoffTime: '12:00',
    });

    const gefunden = nextOrderableDay(regel, zeitpunkt('2026-08-25T09:00:00.000Z'));
    expect(gefunden).not.toBeNull();
    expect(evaluateOrderAvailability(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), gefunden as string).allowed)
      .toBe(true);
  });
});

describe('Meldungen für das Café', () => {
  it('schweigt, wenn der Tag geht', () => {
    expect(orderUnavailableMessage(DEFAULT_ORDER_POLICY, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-08-28'))
      .toBeNull();
  });

  it('erklärt einen abgeschalteten Tag ohne Fachsprache und nennt den nächsten', () => {
    const regel = policy({ weekdays: tage(MONTAG) });
    const text = orderUnavailableMessage(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-08-30');

    expect(text).toBe(
      'Für diesen Tag können wir leider keine Bestellung annehmen. ' +
        'Nächster möglicher Produktionstag: Montag, 31. August.',
    );
    expect(text).not.toMatch(/lead_days|policy|cutoff|422/i);
  });

  it('erklärt einen verpassten Bestellschluss mit dem betroffenen Tag', () => {
    const regel = policy({
      weekdays: ALLE_TAGE,
      cutoffEnabled: true,
      leadDays: 1,
      cutoffTime: '12:00',
    });
    const text = orderUnavailableMessage(regel, zeitpunkt('2026-08-27T14:00:00.000Z'), '2026-08-28');

    expect(text).toBe(
      'Der Bestellschluss für Freitag, 28. August ist bereits vorbei. ' +
        'Nächster möglicher Produktionstag: Samstag, 29. August.',
    );
  });

  it('nennt keinen nächsten Tag, wenn es keinen gibt', () => {
    const regel = policy({ weekdays: tage() });
    expect(orderUnavailableMessage(regel, zeitpunkt('2026-08-25T09:00:00.000Z'), '2026-08-28'))
      .toBe('Für diesen Tag können wir leider keine Bestellung annehmen.');
  });

  it('zählt die Bestelltage auf, aber nur wenn nicht alle sieben gelten', () => {
    expect(orderDaysSentence(DEFAULT_ORDER_POLICY)).toBeNull();
    expect(orderDaysSentence(policy({ weekdays: tage(MONTAG, FREITAG, SAMSTAG) })))
      .toBe('Wir nehmen Bestellungen für Montag, Freitag und Samstag an.');
    expect(orderDaysSentence(policy({ weekdays: tage(FREITAG) })))
      .toBe('Wir nehmen Bestellungen für Freitag an.');
    expect(orderDaysSentence(policy({ weekdays: tage() })))
      .toBe('Zurzeit nehmen wir keine Bestellungen an.');
  });

  it('formuliert den Bestellschluss in Alltagssprache', () => {
    expect(cutoffSentence(DEFAULT_ORDER_POLICY)).toBeNull();
    expect(cutoffSentence(policy({ cutoffEnabled: true, leadDays: 0, cutoffTime: '09:30' })))
      .toBe('Bestellschluss ist am Produktionstag selbst um 09:30 Uhr.');
    expect(cutoffSentence(policy({ cutoffEnabled: true, leadDays: 1, cutoffTime: '12:00' })))
      .toBe('Bestellschluss ist einen Tag vorher um 12:00 Uhr.');
    expect(cutoffSentence(policy({ cutoffEnabled: true, leadDays: 3, cutoffTime: '17:45' })))
      .toBe('Bestellschluss ist 3 Tage vorher um 17:45 Uhr.');
  });

  it('erklärt die Regel an einem echten künftigen Tag', () => {
    const regel = policy({
      weekdays: tage(FREITAG),
      cutoffEnabled: true,
      leadDays: 1,
      cutoffTime: '12:00',
    });

    expect(cutoffExampleSentence(regel, zeitpunkt('2026-08-25T09:00:00.000Z')))
      .toBe('Für Freitag, 28. August endet die Bestellung am Donnerstag, 27. August um 12:00 Uhr.');
  });

  it('erklärt nichts, wenn kein Bestellschluss gilt oder kein Tag möglich ist', () => {
    expect(cutoffExampleSentence(DEFAULT_ORDER_POLICY, zeitpunkt('2026-08-25T09:00:00.000Z'))).toBeNull();
    expect(
      cutoffExampleSentence(
        policy({ weekdays: tage(), cutoffEnabled: true }),
        zeitpunkt('2026-08-25T09:00:00.000Z'),
      ),
    ).toBeNull();
  });
});

describe('isCutoffTime', () => {
  it('nimmt gültige Uhrzeiten an', () => {
    for (const wert of ['00:00', '09:05', '12:00', '23:59']) {
      expect(isCutoffTime(wert)).toBe(true);
    }
  });

  it('weist ab, was keine Uhrzeit ist', () => {
    for (const wert of ['24:00', '12:60', '29:71', '9:00', '12:0', '12:00:00', '', ' 12:00', 1200, null]) {
      expect(isCutoffTime(wert)).toBe(false);
    }
  });
});
