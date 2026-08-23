<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Geldbetrag als ganzzahlige Cent.
 *
 * PHP kennt keinen Dezimaltyp, und MariaDB liefert DECIMAL als String —
 * jede Rechnung damit würde still nach float konvertieren. Deshalb rechnet
 * die Domäne ausschließlich in Cent: unter Addition und Multiplikation mit
 * einer ganzzahligen Menge ist das exakt und rundungsfrei.
 *
 * Die Obergrenze entspricht exakt DECIMAL(10,2). Ein Betrag, den die
 * Datenbank abschneiden würde, scheitert damit schon hier.
 *
 * Es gibt bewusst KEINE Division. Sobald Prozentwerte (Umsatzsteuer, Rabatt)
 * gebraucht werden, wird die Rundungsregel an genau dieser Stelle ergänzt
 * und getestet — nicht verstreut an den Aufrufstellen.
 */
final class Money
{
    public const MAX_CENTS = 9_999_999_999; // 99.999.999,99 € = DECIMAL(10,2)

    private function __construct(public readonly int $cents)
    {
    }

    public static function fromCents(int $cents): self
    {
        if ($cents < 0) {
            throw new InvalidArgumentException('Ein Geldbetrag darf nicht negativ sein.');
        }
        if ($cents > self::MAX_CENTS) {
            throw new InvalidArgumentException('Der Geldbetrag ist zu groß.');
        }
        return new self($cents);
    }

    public static function zero(): self
    {
        return new self(0);
    }

    /**
     * Erwartet das Format, in dem MariaDB DECIMAL(10,2) liefert: Punkt als
     * Trennzeichen, kein Tausenderpunkt, kein Vorzeichen. Bewusst streng —
     * das Normalisieren von Nutzereingaben („14,99") ist Aufgabe der
     * Eingabeschicht, nicht dieser Datenbank-Brücke.
     *
     * Arbeitet ausschließlich mit Stringoperationen; es gibt hier kein
     * floatval, weil genau das der Fehler wäre, den diese Klasse verhindert.
     */
    public static function fromDecimalString(string $amount): self
    {
        if (preg_match('/^(\d{1,10})(?:\.(\d{1,2}))?$/', $amount, $m) !== 1) {
            throw new InvalidArgumentException('Der Betrag hat kein gültiges Format.');
        }
        $fraction = str_pad($m[2] ?? '', 2, '0', STR_PAD_RIGHT);

        return self::fromCents(((int) $m[1]) * 100 + (int) $fraction);
    }

    public function plus(self $other): self
    {
        return self::fromCents($this->cents + $other->cents);
    }

    public function multipliedBy(int $factor): self
    {
        if ($factor < 0) {
            throw new InvalidArgumentException('Der Faktor darf nicht negativ sein.');
        }
        if ($factor !== 0 && $this->cents > intdiv(self::MAX_CENTS, $factor)) {
            throw new InvalidArgumentException('Der Geldbetrag ist zu groß.');
        }
        return self::fromCents($this->cents * $factor);
    }

    public function equals(self $other): bool
    {
        return $this->cents === $other->cents;
    }

    public function isZero(): bool
    {
        return $this->cents === 0;
    }

    /** Format für DECIMAL(10,2) — immer zwei Nachkommastellen. */
    public function toDecimalString(): string
    {
        return intdiv($this->cents, 100) . '.'
            . str_pad((string) ($this->cents % 100), 2, '0', STR_PAD_LEFT);
    }
}
