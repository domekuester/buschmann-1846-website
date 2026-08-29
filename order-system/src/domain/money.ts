import { InvalidArgumentError } from './errors';

/**
 * Geldbetrag als ganzzahlige Cent.
 *
 * TypeScript kennt nur `number`, also IEEE-754-Fließkomma. `0.1 + 0.2` ist
 * dort nicht `0.3`. Deshalb rechnet die Domäne ausschließlich in Cent: Unter
 * Addition und Multiplikation mit einer ganzzahligen Menge ist das exakt und
 * rundungsfrei, solange alle Zwischenergebnisse ganze Zahlen im sicheren
 * Bereich bleiben. Genau das erzwingt diese Klasse an ihren Grenzen.
 *
 * D1/SQLite speichert diese Werte unverändert als INTEGER — es gibt keine
 * Umwandlung nach DECIMAL und keine Stelle, an der ein Float entstehen könnte.
 *
 * Es gibt bewusst KEINE Division. Sobald Prozentwerte (Umsatzsteuer, Rabatt)
 * gebraucht werden, wird die Rundungsregel an genau dieser Stelle ergänzt und
 * getestet — nicht verstreut an den Aufrufstellen.
 */
export class Money {
  /**
   * 99.999.999,99 €. Die Grenze ist nicht mehr von einer Datenbankspalte
   * vorgegeben (SQLite-INTEGER ist 64 Bit), sondern von zwei Überlegungen:
   * Sie liegt weit unter Number.MAX_SAFE_INTEGER, sodass auch Summen und
   * Produkte exakt bleiben, und ein höherer Betrag wäre für eine
   * Kuchenbestellung ohnehin ein Eingabefehler.
   */
  static readonly MAX_CENTS = 9_999_999_999;

  private constructor(readonly cents: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new InvalidArgumentError('Ein Geldbetrag muss ganzzahlige Cent sein.');
    }
    if (cents < 0) {
      throw new InvalidArgumentError('Ein Geldbetrag darf nicht negativ sein.');
    }
    if (cents > Money.MAX_CENTS) {
      throw new InvalidArgumentError('Der Geldbetrag ist zu groß.');
    }
    return new Money(cents);
  }

  static zero(): Money {
    return new Money(0);
  }

  plus(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  multipliedBy(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new InvalidArgumentError('Der Faktor muss ganzzahlig sein.');
    }
    if (factor < 0) {
      throw new InvalidArgumentError('Der Faktor darf nicht negativ sein.');
    }
    // Vor der Multiplikation prüfen, nicht danach: Ein Produkt jenseits des
    // sicheren Zahlenbereichs wäre bereits gerundet, wenn man es ansieht.
    if (factor !== 0 && this.cents > Math.floor(Money.MAX_CENTS / factor)) {
      throw new InvalidArgumentError('Der Geldbetrag ist zu groß.');
    }
    return Money.fromCents(this.cents * factor);
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  /**
   * Anzeige- und Protokollformat mit immer zwei Nachkommastellen.
   * Rein zeichenbasiert aufgebaut — hier entsteht bewusst kein Float, auch
   * nicht kurzzeitig für die Ausgabe.
   */
  toDecimalString(): string {
    const euros = Math.floor(this.cents / 100);
    const rest = this.cents % 100;
    return `${euros}.${String(rest).padStart(2, '0')}`;
  }
}
