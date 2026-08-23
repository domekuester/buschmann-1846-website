<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentDate;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class FulfillmentDateTest
{
    private function today(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 14:32:00');
    }

    public function testAcceptsAFutureDate(): void
    {
        $d = FulfillmentDate::fromString('2026-08-28', $this->today());
        Assert::same('2026-08-28', $d->toString(), 'Datum');
    }

    public function testAcceptsToday(): void
    {
        $d = FulfillmentDate::fromString('2026-08-23', $this->today());
        Assert::same('2026-08-23', $d->toString(), 'heute ist zulässig');
    }

    /** Die Uhrzeit spielt keine Rolle — ein Café bestellt „für Freitag". */
    public function testTimeOfDayIsDiscarded(): void
    {
        $d = FulfillmentDate::fromDateTime(
            new \DateTimeImmutable('2026-08-28 17:45:12'), $this->today()
        );
        Assert::same('2026-08-28 00:00:00', $d->toDateTime()->format('Y-m-d H:i:s'), 'Mitternacht');
    }

    public function testRejectsAPastDate(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => FulfillmentDate::fromString('2026-08-22', $this->today()),
            'gestriges Datum');
        Assert::true($e->hasError('fulfillment_date'), 'Fehler am richtigen Feld');
    }

    public function testRejectsMalformedInput(): void
    {
        foreach (['', '28.08.2026', '2026-13-01', '2026-02-30', 'morgen', '2026-8-28'] as $bad) {
            Assert::throws(ValidationException::class,
                fn () => FulfillmentDate::fromString($bad, $this->today()),
                'unzulässige Eingabe "' . $bad . '"');
        }
    }

    /**
     * Der Vergleichszeitpunkt wird übergeben, nicht intern aus now() gelesen —
     * sonst wären diese Tests am Jahreswechsel wertlos.
     */
    public function testComparisonPointIsInjectedNotRead(): void
    {
        $d = FulfillmentDate::fromString('2020-01-01', new \DateTimeImmutable('2019-12-31'));
        Assert::same('2020-01-01', $d->toString(), 'Vergangenheit relativ zu einem anderen Heute');
    }
}
