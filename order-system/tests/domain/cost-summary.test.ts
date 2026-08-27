import { describe, expect, it } from 'vitest';
import { CostTally, type CostItem, type CostSummary } from '../../src/domain/cost-summary';

/**
 * DIE KOSTENZUSAMMENFASSUNG — die Regeln, ohne die Marge und Rohertrag
 * Behauptungen wären.
 *
 * Diese Datei prüft die Rechenmitte von Phase 7B: Was passiert mit einem
 * fehlenden Kostenwert, was mit der Menge, was bei null Umsatz, was bei
 * Kosten über dem Umsatz. Sie kennt weder Bestellungen noch Tage noch
 * Datenbank — nur Positionen und eine Umsatzzahl, die hereingereicht wird.
 *
 * ALLE BETRÄGE SIND FREI ERFUNDEN.
 */

function position(unitCostCents: number | null, quantity = 1): CostItem {
  return { quantity, unitCostCents };
}

/** Eine Bestellung mit Positionen, ausgewertet gegen einen Umsatz. */
function fasse(
  bestellungen: readonly (readonly CostItem[])[],
  revenueCents: number,
): CostSummary {
  const zaehler = new CostTally();
  for (const items of bestellungen) {
    zaehler.addOrder(items);
  }
  return zaehler.summary(revenueCents);
}

describe('§18.1 — eine vollständig kalkulierte Bestellung', () => {
  it('summiert die Herstellkosten ihrer Position', () => {
    const summe = fasse([[position(300)]], 1000);

    expect(summe.knownCostCents).toBe(300);
    expect(summe.complete).toBe(true);
    expect(summe.missingItemCount).toBe(0);
    expect(summe.missingOrderCount).toBe(0);
  });

  it('zählt Positionen und Bestellungen mit', () => {
    const summe = fasse([[position(300), position(150)]], 1000);

    expect(summe.itemCount).toBe(2);
    expect(summe.orderCount).toBe(1);
  });
});

describe('§18.2 — mehrere Positionen', () => {
  it('bildet die Summe über alle Positionen einer Bestellung', () => {
    expect(fasse([[position(300), position(150), position(45)]], 1000).knownCostCents).toBe(495);
  });
});

describe('§18.3 — die Menge zählt mit', () => {
  /**
   * DER FEHLER, DEN DIESER TEST FÄNGT, ist bei kleinen Bestellungen
   * unsichtbar und bei großen grotesk: Wer die Menge vergisst, bekommt für
   * drei Bleche die Kosten eines Blechs.
   */
  it('rechnet Kosten mal Menge und nicht Kosten allein', () => {
    expect(fasse([[position(300, 3)]], 1000).knownCostCents).toBe(900);
  });

  it('rechnet je Position mit ihrer eigenen Menge', () => {
    // 300 × 3 + 150 × 10 = 900 + 1500
    expect(fasse([[position(300, 3), position(150, 10)]], 5000).knownCostCents).toBe(2400);
  });

  it('zählt eine Position mit Menge 1 einfach', () => {
    expect(fasse([[position(777, 1)]], 1000).knownCostCents).toBe(777);
  });
});

describe('§18.4 — mehrere Bestellungen', () => {
  it('summiert über Bestellungen hinweg', () => {
    const summe = fasse([[position(300, 2)], [position(150, 4)]], 2000);

    expect(summe.knownCostCents).toBe(1200);
    expect(summe.orderCount).toBe(2);
    expect(summe.itemCount).toBe(2);
  });
});

describe('§18.7 und §18.8 — ein fehlender Kostenwert', () => {
  /** DAS IST DIE KERNREGEL DER GANZEN PHASE. */
  it('macht die Kostenbasis unvollständig', () => {
    expect(fasse([[position(null)]], 1000).complete).toBe(false);
  });

  it('wird NICHT als 0 gezählt', () => {
    /**
     * Der Beweis führt über den Rohertrag: Wäre null ein 0-€-Kostenwert,
     * stünde hier ein Rohertrag von 1000 — also der volle Umsatz als Gewinn.
     * Genau diese Zahl ist die gefährliche: Sie sieht großartig aus und ist
     * eine Aussage über die Pflegelücke, nicht über den Betrieb.
     */
    const summe = fasse([[position(null)]], 1000);

    expect(summe.grossProfitCents).toBeNull();
    expect(summe.marginTenthsPercent).toBeNull();
  });

  it('zählt trotzdem als Position und als Bestellung', () => {
    const summe = fasse([[position(null)]], 1000);

    expect(summe.itemCount).toBe(1);
    expect(summe.orderCount).toBe(1);
    expect(summe.missingItemCount).toBe(1);
    expect(summe.missingOrderCount).toBe(1);
  });

  it('lässt die bekannten Kosten der übrigen Positionen stehen', () => {
    /**
     * Was bekannt ist, bleibt bekannt — es wird nur nicht mehr zu einem
     * Rohertrag verrechnet. Der Teilbetrag ist die Antwort auf „wie weit bin
     * ich?" und wird auf der Seite bewusst nicht als Gesamtkosten gezeigt.
     */
    const summe = fasse([[position(300), position(null), position(200)]], 2000);

    expect(summe.knownCostCents).toBe(500);
    expect(summe.complete).toBe(false);
    expect(summe.missingItemCount).toBe(1);
  });

  it('macht eine Bestellung mit mehreren Lücken trotzdem nur zu EINER fehlenden Bestellung', () => {
    const summe = fasse([[position(null), position(null), position(300)]], 2000);

    expect(summe.missingItemCount).toBe(2);
    expect(summe.missingOrderCount).toBe(1);
  });

  it('macht mit einer einzigen Lücke die GANZE Menge unvollständig', () => {
    // Neun vollständige Bestellungen und eine mit einer Lücke.
    const bestellungen = [
      ...Array.from({ length: 9 }, () => [position(100)]),
      [position(null)],
    ];
    const summe = fasse(bestellungen, 10_000);

    expect(summe.orderCount).toBe(10);
    expect(summe.missingOrderCount).toBe(1);
    expect(summe.complete).toBe(false);
    expect(summe.grossProfitCents).toBeNull();
    expect(summe.marginTenthsPercent).toBeNull();
  });
});

describe('§18.9 und §18.10 — Rohertrag und Marge bei vollständigen Daten', () => {
  /** Das Beispiel aus §3 des Auftrags, Cent für Cent. */
  it('rechnet das Beispiel des Auftrags nach', () => {
    const summe = fasse([[position(51_030)]], 124_000);

    expect(summe.knownCostCents).toBe(51_030);
    expect(summe.grossProfitCents).toBe(72_970);
    expect(summe.marginTenthsPercent).toBe(588);
  });

  it('bildet den Rohertrag als Umsatz minus Kosten', () => {
    expect(fasse([[position(400, 2)]], 2000).grossProfitCents).toBe(1200);
  });

  it('bildet die Marge aus Rohertrag durch Umsatz', () => {
    // 1200 von 2000 sind 60,0 % — also 600 Zehntel.
    expect(fasse([[position(400, 2)]], 2000).marginTenthsPercent).toBe(600);
  });

  it('rundet die Marge kaufmännisch auf ein Zehntel Prozent', () => {
    // Rohertrag 1000 von 1300 = 76,923…% → 769 Zehntel.
    expect(fasse([[position(300)]], 1300).marginTenthsPercent).toBe(769);
  });

  it('kennt eine Marge von 100 Prozent, wenn die Kosten null sind', () => {
    /**
     * NULL EURO KOSTEN SIND ETWAS ANDERES ALS UNBEKANNTE KOSTEN. Ein
     * Betreiber darf 0,00 € eintragen — dann ist die Marge 100 %, und das
     * ist eine gepflegte Aussage. Genau deshalb ist parseUnitCost() die 0
     * ausdrücklich erlaubt.
     */
    const summe = fasse([[position(0)]], 1000);

    expect(summe.complete).toBe(true);
    expect(summe.grossProfitCents).toBe(1000);
    expect(summe.marginTenthsPercent).toBe(1000);
  });
});

describe('§18.11 und §15 — Kosten über dem Umsatz', () => {
  /** Das Beispiel aus §15 des Auftrags: 100 € Umsatz, 120 € Kosten. */
  it('lässt den Rohertrag negativ werden', () => {
    const summe = fasse([[position(12_000)]], 10_000);

    expect(summe.grossProfitCents).toBe(-2000);
    expect(summe.marginTenthsPercent).toBe(-200);
  });

  it('klemmt nichts auf null', () => {
    const summe = fasse([[position(500, 4)]], 100);

    expect(summe.grossProfitCents).toBe(-1900);
    expect(summe.grossProfitCents).toBeLessThan(0);
  });

  it('rundet den Verlust symmetrisch zum Gewinn', () => {
    /**
     * Math.round() allein rundet .5 immer nach oben und machte damit aus
     * einem Verlust systematisch den kleineren Verlust. Geprüft wird das
     * Paar: derselbe Betrag als Gewinn und als Verlust muss denselben
     * Zahlenwert ergeben.
     */
    const gewinn = fasse([[position(1)]], 1600).marginTenthsPercent;
    const verlust = fasse([[position(3201)]], 1600).marginTenthsPercent;

    expect(gewinn).toBe(999);
    expect(verlust).toBe(-1001);
  });

  it('macht aus einem winzigen Verlust keine negative Null', () => {
    // Rohertrag -1 Cent auf 1.000.000 Cent Umsatz rundet auf 0,0 %.
    const summe = fasse([[position(1_000_001)]], 1_000_000);

    expect(summe.grossProfitCents).toBe(-1);
    expect(Object.is(summe.marginTenthsPercent, -0)).toBe(false);
    expect(summe.marginTenthsPercent).toBe(0);
  });
});

describe('§18.12 und §14 — Umsatz null', () => {
  it('ergibt keine Marge statt Infinity', () => {
    const summe = fasse([[position(500)]], 0);

    expect(summe.marginTenthsPercent).toBeNull();
    expect(Number.isFinite(summe.marginTenthsPercent as number)).toBe(false);
  });

  it('ergibt keine Marge statt NaN, auch ohne jede Position', () => {
    const summe = fasse([], 0);

    expect(summe.marginTenthsPercent).toBeNull();
    expect(summe.revenueCents).toBe(0);
  });

  it('zeigt bei null Umsatz trotzdem einen Rohertrag, wenn die Basis vollständig ist', () => {
    /**
     * Ein Tag, an dem alles storniert wurde, hat 0 € Umsatz und 0 € Kosten —
     * beide Zahlen sind wahr, und der Rohertrag ist 0. Nur die Marge gibt es
     * nicht, weil man durch null nicht teilt.
     */
    const summe = fasse([], 0);

    expect(summe.complete).toBe(true);
    expect(summe.grossProfitCents).toBe(0);
  });

  it('ergibt auch mit bekannten Kosten und null Umsatz keine Marge', () => {
    const summe = fasse([[position(500)]], 0);

    expect(summe.grossProfitCents).toBe(-500);
    expect(summe.marginTenthsPercent).toBeNull();
  });
});

describe('Der leere Zeitraum', () => {
  it('ist vollständig, weil nichts fehlt', () => {
    expect(fasse([], 0)).toEqual({
      revenueCents: 0,
      knownCostCents: 0,
      itemCount: 0,
      missingItemCount: 0,
      orderCount: 0,
      missingOrderCount: 0,
      complete: true,
      grossProfitCents: 0,
      marginTenthsPercent: null,
    });
  });

  it('behandelt eine Bestellung ohne Positionen als vollständig', () => {
    const summe = fasse([[]], 1000);

    expect(summe.orderCount).toBe(1);
    expect(summe.itemCount).toBe(0);
    expect(summe.complete).toBe(true);
    expect(summe.missingOrderCount).toBe(0);
  });
});

describe('Der Umsatz wird hereingereicht und nicht gezählt', () => {
  /**
   * §7 DES AUFTRAGS: Die bestehende Umsatzkennzahl bleibt die einzige
   * Quelle. Diese Klasse hat keine Möglichkeit, einen Umsatz zu bilden —
   * addOrder() bekommt nur Positionen, und die tragen keinen Verkaufspreis.
   */
  it('übernimmt den übergebenen Umsatz unverändert', () => {
    expect(fasse([[position(100)]], 4321).revenueCents).toBe(4321);
  });

  it('ergibt mit zwei verschiedenen Umsätzen zwei verschiedene Margen', () => {
    const zaehler = new CostTally();
    zaehler.addOrder([position(500)]);

    expect(zaehler.summary(1000).marginTenthsPercent).toBe(500);
    expect(zaehler.summary(2000).marginTenthsPercent).toBe(750);
  });

  it('lässt sich mehrfach zusammenfassen, ohne sich zu verändern', () => {
    const zaehler = new CostTally();
    zaehler.addOrder([position(500)]);

    expect(zaehler.summary(1000)).toEqual(zaehler.summary(1000));
  });
});

describe('§22.G — addSummary summiert Rohzähler und keine Prozente', () => {
  /**
   * DER MUTATIONSTEST IN TESTFORM. Zwei Tage: einer mit wenig Umsatz und
   * hoher Marge, einer mit viel Umsatz und niedriger Marge. Der ungewichtete
   * Mittelwert der beiden Tagesmargen wäre 60,0 % — die richtige,
   * umsatzgewichtete Antwort ist eine deutlich andere Zahl.
   */
  const klein = fasse([[position(100)]], 1000); // Rohertrag 900 → 90,0 %
  const gross = fasse([[position(7000)]], 10_000); // Rohertrag 3000 → 30,0 %

  it('bildet die Gesamtmarge aus den Summen und nicht aus dem Mittelwert', () => {
    const gesamt = new CostTally();
    gesamt.addSummary(klein);
    gesamt.addSummary(gross);

    const summe = gesamt.summary(klein.revenueCents + gross.revenueCents);

    // 11.000 Umsatz, 7.100 Kosten, 3.900 Rohertrag → 35,5 %.
    expect(summe.knownCostCents).toBe(7100);
    expect(summe.grossProfitCents).toBe(3900);
    expect(summe.marginTenthsPercent).toBe(355);

    const mittelwert = ((klein.marginTenthsPercent as number) + (gross.marginTenthsPercent as number)) / 2;
    expect(summe.marginTenthsPercent).not.toBe(mittelwert);
  });

  it('addiert Positions- und Bestellzähler', () => {
    const gesamt = new CostTally();
    gesamt.addSummary(klein);
    gesamt.addSummary(gross);

    const summe = gesamt.summary(11_000);
    expect(summe.orderCount).toBe(2);
    expect(summe.itemCount).toBe(2);
  });

  it('überträgt die Unvollständigkeit eines einzigen Teils auf das Ganze', () => {
    const luecke = fasse([[position(null)]], 500);

    const gesamt = new CostTally();
    gesamt.addSummary(klein);
    gesamt.addSummary(luecke);

    const summe = gesamt.summary(1500);
    expect(summe.complete).toBe(false);
    expect(summe.missingOrderCount).toBe(1);
    expect(summe.grossProfitCents).toBeNull();
    expect(summe.marginTenthsPercent).toBeNull();
  });

  it('nimmt den Umsatz der Teile NICHT mit — er kommt aus der Gesamtsumme', () => {
    /**
     * Sonst gäbe es zwei Wochenumsätze: den der Summenzeile und den der
     * Marge. Genau diese beiden könnten auseinanderlaufen.
     */
    const gesamt = new CostTally();
    gesamt.addSummary(klein);
    gesamt.addSummary(gross);

    expect(gesamt.summary(0).revenueCents).toBe(0);
  });

  it('bleibt beim Zusammenfassen vollständiger Teile vollständig', () => {
    const gesamt = new CostTally();
    gesamt.addSummary(klein);
    gesamt.addSummary(gross);

    expect(gesamt.summary(11_000).complete).toBe(true);
  });
});

describe('Große Zahlen bleiben exakt', () => {
  /**
   * Geld ist ganzzahlig, und das soll auch für die Zwischenwerte der
   * Margenrechnung gelten: `gewinn * 1000` bleibt im sicheren Zahlenbereich.
   */
  it('rechnet auch mit Beträgen nahe der Money-Obergrenze ohne Rundungsfehler', () => {
    const summe = fasse([[position(1_000_000, 9999)]], 9_999_999_999);

    expect(summe.knownCostCents).toBe(9_999_000_000);
    expect(summe.grossProfitCents).toBe(999_999);
    expect(Number.isSafeInteger(summe.knownCostCents)).toBe(true);
    expect(summe.marginTenthsPercent).toBe(0);
  });
});
