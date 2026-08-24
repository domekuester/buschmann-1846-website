import { InvalidArgumentError } from './errors';

const PREFIX = 'BUS';
const PATTERN = /^BUS-(\d{4})-(\d{6})$/;

/**
 * Bestellnummer im Format BUS-JJJJ-NNNNNN, zum Beispiel BUS-2026-000123.
 *
 * Am Telefon: „B-U-S, zweitausendsechsundzwanzig, null null null eins zwei
 * drei." Feste Länge, weil Menschen gleichlange Ziffernblöcke schneller
 * vorlesen und abgleichen. Keine UUID, kein Base62.
 *
 * ACHTUNG — die Bestellnummer ist KEIN Zugriffsschlüssel. Sie ist fortlaufend
 * und damit erratbar. Eine spätere Phase darf niemals „wer die Nummer kennt,
 * darf die Bestellung sehen" umsetzen; dafür wäre ein separates Zufallstoken
 * nötig.
 *
 * Die laufende Nummer wird nicht aus MAX(id)+1 gebildet, sondern je Jahr aus
 * der Tabelle order_number_sequences vergeben; siehe
 * infrastructure/d1/order-number-sequence.ts. Lücken sind zulässig und
 * erwartet: Lückenlosigkeit ist eine Anforderung an Rechnungsnummern, nicht an
 * Bestellnummern.
 */
export class OrderNumber {
  static readonly MAX_SEQUENCE = 999_999;

  readonly value: string;

  private constructor(
    readonly year: number,
    readonly sequence: number,
  ) {
    this.value = `${PREFIX}-${String(year).padStart(4, '0')}-${String(sequence).padStart(6, '0')}`;
  }

  static fromYearAndSequence(year: number, sequence: number): OrderNumber {
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new InvalidArgumentError('Das Jahr der Bestellnummer ist ungültig.');
    }
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > OrderNumber.MAX_SEQUENCE) {
      throw new InvalidArgumentError('Die laufende Nummer der Bestellnummer ist ungültig.');
    }
    return new OrderNumber(year, sequence);
  }

  static fromString(value: string): OrderNumber {
    const match = PATTERN.exec(value);
    const year = match?.[1];
    const sequence = match?.[2];
    if (year === undefined || sequence === undefined) {
      throw new InvalidArgumentError('Die Bestellnummer hat kein gültiges Format.');
    }
    return OrderNumber.fromYearAndSequence(Number(year), Number(sequence));
  }

  equals(other: OrderNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
