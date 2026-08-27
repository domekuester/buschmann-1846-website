import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';
import {
  MAX_UNIT_COST_CENTS,
  ProductCostBook,
  parseUnitCost,
  unitCostFromCents,
} from '../../src/domain/product-cost';
import { formatAmountInput, formatEuro } from '../../src/ui/format';

/**
 * Die Geldeingabe der Herstellkosten — §7 und §15.
 *
 * DIE WICHTIGSTE GRUPPE IST DIE DRITTE: Was nicht eindeutig lesbar ist, wird
 * ABGELEHNT und nicht gerundet. Eine stille Rundung ist eine Zahl, die
 * niemand eingegeben hat, und sie stünde später in einer Margenrechnung.
 */

describe('parseUnitCost — der leere Wert', () => {
  /** §15.1 — „nicht hinterlegt" ist ein eigener, gültiger Zustand. */
  it('liest ein leeres Feld als „keine Herstellkosten hinterlegt"', () => {
    expect(parseUnitCost('')).toEqual({ kind: 'cleared' });
  });

  it('liest ein Feld aus lauter Leerzeichen ebenso', () => {
    expect(parseUnitCost('   ')).toEqual({ kind: 'cleared' });
  });

  /**
   * DER UNTERSCHIED ZWISCHEN „LEER" UND „UNGÜLTIG" IST DER GANZE PUNKT DES
   * DREIWERTIGEN ERGEBNISSES: Leer löscht einen gepflegten Wert absichtlich,
   * ungültig schreibt gar nichts. Beides auf null abzubilden hieße, bei einem
   * Tippfehler still eine Kostenangabe zu verlieren.
   */
  it('unterscheidet den leeren Wert von einer unlesbaren Eingabe', () => {
    expect(parseUnitCost('').kind).toBe('cleared');
    expect(parseUnitCost('zwei Euro').kind).toBe('invalid');
  });
});

describe('parseUnitCost — lesbare Beträge', () => {
  /** §15.3 — der Normalfall: „2,10" wird zu 210 Cent. */
  it('liest das deutsche Dezimalkomma', () => {
    expect(parseUnitCost('2,10')).toEqual({ kind: 'amount', cents: 210 });
  });

  it('liest auch den Dezimalpunkt', () => {
    expect(parseUnitCost('2.10')).toEqual({ kind: 'amount', cents: 210 });
  });

  it('liest einen Betrag ohne Nachkommastellen', () => {
    expect(parseUnitCost('3')).toEqual({ kind: 'amount', cents: 300 });
  });

  /**
   * EINE NACHKOMMASTELLE WIRD AUFGEFÜLLT UND NICHT GERUNDET: „2,1" ist
   * zweifelsfrei 2,10 €. Es geht dabei keine eingegebene Stelle verloren —
   * genau das unterscheidet Auffüllen von Runden.
   */
  it('füllt eine einzelne Nachkommastelle auf', () => {
    expect(parseUnitCost('2,1')).toEqual({ kind: 'amount', cents: 210 });
  });

  /** §15.2 — 0 ist eine Aussage und wird angenommen. */
  it('nimmt 0 an', () => {
    expect(parseUnitCost('0')).toEqual({ kind: 'amount', cents: 0 });
    expect(parseUnitCost('0,00')).toEqual({ kind: 'amount', cents: 0 });
  });

  /**
   * Umgebende Leerzeichen sind die EINZIGE Normalisierung. Das Feld ist ein
   * freies Textfeld; ' 2,10 ' aus einer Zwischenablage hat genau eine Lesart.
   */
  it('entfernt umgebende Leerzeichen', () => {
    expect(parseUnitCost('  2,10  ')).toEqual({ kind: 'amount', cents: 210 });
  });

  /** Ein Zahlenfeld füllt manchmal auf; '02' ist eindeutig zwei Euro. */
  it('nimmt eine führende Null an', () => {
    expect(parseUnitCost('02,50')).toEqual({ kind: 'amount', cents: 250 });
  });

  /**
   * ES ENTSTEHT NIRGENDS EINE FLIESSKOMMAZAHL. Der Klassiker 0,1 + 0,2 würde
   * über `Number(x) * 100` zu 30.000000000000004; hier ist er exakt.
   */
  it('rechnet exakt in ganzen Cent', () => {
    expect(parseUnitCost('0,10')).toEqual({ kind: 'amount', cents: 10 });
    expect(parseUnitCost('0,20')).toEqual({ kind: 'amount', cents: 20 });
    expect(parseUnitCost('8,29')).toEqual({ kind: 'amount', cents: 829 });
    expect(parseUnitCost('1234,56')).toEqual({ kind: 'amount', cents: 123456 });
  });
});

describe('parseUnitCost — was abgelehnt wird', () => {
  /** §15.4 — negative Herstellkosten gibt es nicht. */
  it('lehnt negative Beträge ab', () => {
    for (const wert of ['-1', '-2,10', '−2,10']) {
      expect(parseUnitCost(wert).kind).toBe('invalid');
    }
  });

  /**
   * §7 — KEINE STILLEN RUNDUNGEN. '2,105' wird NICHT zu 211 oder 210 Cent,
   * sondern abgelehnt. Der Admin sieht eine Meldung und entscheidet selbst.
   */
  it('rundet drei Nachkommastellen nicht, sondern lehnt sie ab', () => {
    expect(parseUnitCost('2,105').kind).toBe('invalid');
    expect(parseUnitCost('2,999').kind).toBe('invalid');
  });

  /**
   * Ein Tausenderpunkt neben einem Dezimalkomma wäre eine Eingabe mit zwei
   * Bedeutungen für dasselbe Zeichen. Sie wird abgelehnt, statt geraten.
   */
  it('lehnt Tausendertrennzeichen ab', () => {
    expect(parseUnitCost('1.234,56').kind).toBe('invalid');
    expect(parseUnitCost('1 234,56').kind).toBe('invalid');
  });

  it('lehnt Währungszeichen und Text ab', () => {
    for (const wert of ['2,10 €', '€2,10', '2,10 EUR', 'zwei', 'NaN', 'null']) {
      expect(parseUnitCost(wert).kind).toBe('invalid');
    }
  });

  /**
   * Number() allein wäre hier zu nachsichtig: Number('2e2') ist 200. Aus
   * einem Formular soll nichts durchkommen, was nur zufällig wie eine Zahl
   * aussieht — dieselbe Strenge wie bei den Kennungen im Pfad.
   */
  it('lehnt Exponential- und Sonderschreibweisen ab', () => {
    for (const wert of ['2e2', '+2', '0x10', '2,', ',10', '.', '2..1', '2,1,0']) {
      expect(parseUnitCost(wert).kind).toBe('invalid');
    }
  });

  /** §7 — Extremwerte werden kontrolliert begrenzt statt gespeichert. */
  it('begrenzt den Betrag nach oben', () => {
    expect(parseUnitCost('10000')).toEqual({ kind: 'amount', cents: MAX_UNIT_COST_CENTS });
    expect(parseUnitCost('10000,01').kind).toBe('invalid');
    expect(parseUnitCost('99999,99').kind).toBe('invalid');
  });

  it('lehnt absurd lange Zahlen ab, statt sie zu kürzen', () => {
    expect(parseUnitCost('123456789').kind).toBe('invalid');
  });
});

describe('unitCostFromCents', () => {
  it('macht aus NULL kein Geld', () => {
    expect(unitCostFromCents(null)).toBeNull();
  });

  it('macht aus 0 einen Betrag von 0 und nicht null', () => {
    expect(unitCostFromCents(0)?.cents).toBe(0);
  });

  it('gibt einen gespeicherten Centwert als Money zurück', () => {
    expect(unitCostFromCents(210)?.cents).toBe(210);
  });

  /**
   * Die CHECK-Bedingung aus 0017 garantiert das bereits. Geprüft wird
   * trotzdem: Ein CHECK schützt gegen künftige Schreibvorgänge, nicht gegen
   * Daten, die an der Anwendung vorbei eingespielt wurden.
   */
  it('scheitert laut an einem kaputten gespeicherten Wert', () => {
    for (const wert of [-1, 2.5]) {
      expect(() => unitCostFromCents(wert)).toThrow(InvalidArgumentError);
    }
  });
});

describe('ProductCostBook', () => {
  it('kennt für ein leeres Buch keine Kosten', () => {
    expect(ProductCostBook.empty().costFor(1)).toBeNull();
  });

  it('gibt den gepflegten Betrag eines Produkts zurück', () => {
    const buch = ProductCostBook.fromCosts(new Map([[1, Money.fromCents(210)]]));
    expect(buch.costFor(1)?.cents).toBe(210);
  });

  /** §14 — ein fehlender Eintrag ist null und niemals 0 €. */
  it('antwortet für ein ungepflegtes Produkt mit null und nicht mit 0', () => {
    const buch = ProductCostBook.fromCosts(new Map([[1, Money.fromCents(210)]]));
    expect(buch.costFor(2)).toBeNull();
  });

  it('unterscheidet ein gepflegtes 0 € von einem ungepflegten Produkt', () => {
    const buch = ProductCostBook.fromCosts(new Map([[1, Money.fromCents(0)]]));
    expect(buch.costFor(1)?.cents).toBe(0);
    expect(buch.costFor(2)).toBeNull();
  });

  /**
   * Das Buch ist eine MOMENTAUFNAHME. Änderte sich die übergebene Map nach
   * dem Bauen noch, wäre es eine Sicht — und genau dieser Inhalt wird gleich
   * in eine Bestellung geschrieben.
   */
  it('kopiert die übergebene Zuordnung', () => {
    const quelle = new Map([[1, Money.fromCents(210)]]);
    const buch = ProductCostBook.fromCosts(quelle);

    quelle.set(1, Money.fromCents(999));
    quelle.set(2, Money.fromCents(500));

    expect(buch.costFor(1)?.cents).toBe(210);
    expect(buch.costFor(2)).toBeNull();
  });
});

describe('Geldformatierung der Herstellkosten — §15.6', () => {
  it('zeigt einen Kostenwert als deutschen Eurobetrag', () => {
    expect(formatEuro(210)).toBe('2,10 €');
    expect(formatEuro(0)).toBe('0,00 €');
  });

  /**
   * DER EINGABEWERT TRÄGT WEDER EUROZEICHEN NOCH TAUSENDERPUNKT. Beides käme
   * beim Absenden zurück, und parseUnitCost() lehnt beides ab — ein Feld,
   * dessen eigener Inhalt unabsendbar ist, wäre eine Falle.
   */
  it('schreibt den Eingabewert so, dass er wieder lesbar ist', () => {
    expect(formatAmountInput(210)).toBe('2,10');
    expect(formatAmountInput(0)).toBe('0,00');
    expect(formatAmountInput(5)).toBe('0,05');
    expect(formatAmountInput(123456)).toBe('1234,56');
  });

  /** Die Probe darauf: Was die Seite anzeigt, nimmt der Server wieder an. */
  it('liest jeden ausgegebenen Eingabewert unverändert zurück', () => {
    for (const cents of [0, 1, 5, 99, 210, 1000, 123456, MAX_UNIT_COST_CENTS]) {
      expect(parseUnitCost(formatAmountInput(cents))).toEqual({ kind: 'amount', cents });
    }
  });

  it('weist einen unmöglichen Betrag zur Anzeige zurück', () => {
    for (const wert of [-1, 2.5]) {
      expect(() => formatAmountInput(wert)).toThrow(InvalidArgumentError);
    }
  });
});
