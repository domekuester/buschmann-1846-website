<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Shared\ValidationException;

/**
 * Liefer- oder Abholtag — Datum ohne Uhrzeit.
 *
 * Ein Café bestellt „für Freitag", nicht „für Freitag 14:32". Deshalb DATE
 * und nicht DATETIME, und deshalb wird eine mitgelieferte Uhrzeit verworfen
 * statt beibehalten.
 *
 * Der Vergleichszeitpunkt wird übergeben. Ein interner Zugriff auf now()
 * würde die Regel untestbar machen und Tests am Jahreswechsel kippen lassen.
 *
 * Vorlaufzeiten („bis Mittwoch für Freitag") sind Phase 2 und gehören dann
 * an genau diese Stelle.
 */
final class FulfillmentDate
{
    private function __construct(private readonly \DateTimeImmutable $date)
    {
    }

    public static function fromString(string $date, \DateTimeImmutable $notBefore): self
    {
        // Die Formatprüfung steht vor createFromFormat, weil dessen 'm' und 'd'
        // auch einstellige Zahlen annehmen — '2026-8-28' würde sonst durchgehen.
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw self::invalid();
        }

        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $errors = \DateTimeImmutable::getLastErrors();
        $bad    = is_array($errors)
            && ((($errors['warning_count'] ?? 0) > 0) || (($errors['error_count'] ?? 0) > 0));

        // Ein 30. Februar wird von PHP still auf den 2. März gedreht und nur
        // über warning_count gemeldet — deshalb wird er hier mitgeprüft.
        if ($parsed === false || $bad) {
            throw self::invalid();
        }

        return self::fromDateTime($parsed, $notBefore);
    }

    public static function fromDateTime(\DateTimeImmutable $date, \DateTimeImmutable $notBefore): self
    {
        $day      = $date->setTime(0, 0, 0);
        $earliest = $notBefore->setTime(0, 0, 0);

        if ($day < $earliest) {
            throw ValidationException::field(
                'fulfillment_date',
                'Der Liefer- oder Abholtag darf nicht in der Vergangenheit liegen.'
            );
        }

        return new self($day);
    }

    public function toString(): string
    {
        return $this->date->format('Y-m-d');
    }

    public function toDateTime(): \DateTimeImmutable
    {
        return $this->date;
    }

    private static function invalid(): ValidationException
    {
        return ValidationException::field(
            'fulfillment_date',
            'Bitte ein gültiges Datum im Format JJJJ-MM-TT angeben.'
        );
    }
}
