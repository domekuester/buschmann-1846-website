<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Shared\InvalidArgumentException;

/**
 * Bestellnummer im Format BUS-JJJJ-NNNNNN, zum Beispiel BUS-2026-000123.
 *
 * Am Telefon: „B-U-S, zweitausendsechsundzwanzig, null null null eins zwei
 * drei." Feste Länge, weil Menschen gleichlange Ziffernblöcke schneller
 * vorlesen und abgleichen. Keine UUID, kein Base62.
 *
 * ACHTUNG — die Bestellnummer ist KEIN Zugriffsschlüssel. Sie ist
 * fortlaufend und damit erratbar. Eine spätere Phase darf niemals „wer die
 * Nummer kennt, darf die Bestellung sehen" umsetzen; dafür wäre ein
 * separates Zufallstoken nötig.
 *
 * Die laufende Nummer wird nicht aus MAX(id)+1 gebildet, sondern aus der
 * Tabelle order_number_sequences — siehe database/migrations/006 und
 * database/README.md. Lücken sind zulässig und erwartet: Lückenlosigkeit
 * ist eine Anforderung an Rechnungsnummern, nicht an Bestellnummern.
 */
final class OrderNumber
{
    public const PREFIX       = 'BUS';
    public const MAX_SEQUENCE = 999_999;

    private function __construct(
        public readonly int $year,
        public readonly int $sequence,
    ) {
    }

    public static function fromYearAndSequence(int $year, int $sequence): self
    {
        if ($year < 2000 || $year > 9999) {
            throw new InvalidArgumentException('Das Jahr der Bestellnummer ist ungültig.');
        }
        if ($sequence < 1 || $sequence > self::MAX_SEQUENCE) {
            throw new InvalidArgumentException('Die laufende Nummer der Bestellnummer ist ungültig.');
        }
        return new self($year, $sequence);
    }

    public static function fromString(string $value): self
    {
        $pattern = '/^' . self::PREFIX . '-(\d{4})-(\d{6})$/';
        if (preg_match($pattern, $value, $m) !== 1) {
            throw new InvalidArgumentException('Die Bestellnummer hat kein gültiges Format.');
        }
        return self::fromYearAndSequence((int) $m[1], (int) $m[2]);
    }

    public function toString(): string
    {
        return sprintf('%s-%04d-%06d', self::PREFIX, $this->year, $this->sequence);
    }

    public function equals(self $other): bool
    {
        return $this->year === $other->year && $this->sequence === $other->sequence;
    }
}
