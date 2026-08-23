<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderNumber;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class OrderNumberTest
{
    public function testFormatIsPrefixYearAndSixDigits(): void
    {
        Assert::same('BUS-2026-000123',
            OrderNumber::fromYearAndSequence(2026, 123)->toString(), 'Bestellnummer');
        Assert::same('BUS-2026-000001',
            OrderNumber::fromYearAndSequence(2026, 1)->toString(), 'erste Nummer des Jahres');
        Assert::same('BUS-2026-999999',
            OrderNumber::fromYearAndSequence(2026, 999999)->toString(), 'letzte Nummer des Jahres');
    }

    public function testParsesItsOwnFormat(): void
    {
        $n = OrderNumber::fromString('BUS-2026-000123');
        Assert::same(2026, $n->year, 'Jahr');
        Assert::same(123, $n->sequence, 'laufende Nummer');
        Assert::same('BUS-2026-000123', $n->toString(), 'Hin- und Rückumwandlung');
    }

    public function testRejectsForeignOrMalformedNumbers(): void
    {
        foreach (['', 'BUS-2026-123', 'bus-2026-000123', 'BUS-26-000123',
                  'BUS-2026-0001234', 'XYZ-2026-000123', 'BUS_2026_000123',
                  'BUS-2026-000000', ' BUS-2026-000123'] as $bad) {
            Assert::throws(InvalidArgumentException::class,
                static fn () => OrderNumber::fromString($bad),
                'unzulässige Bestellnummer "' . $bad . '"');
        }
    }

    public function testSequenceStartsAtOneAndHasAnUpperBound(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, 0), 'laufende Nummer 0');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, -1), 'negative laufende Nummer');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, 1000000), 'siebenstellige Nummer');
    }

    public function testYearMustBePlausible(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(1999, 1), 'Jahr vor 2000');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(10000, 1), 'fünfstelliges Jahr');
    }

    public function testEqualityComparesValue(): void
    {
        Assert::true(
            OrderNumber::fromYearAndSequence(2026, 7)->equals(OrderNumber::fromString('BUS-2026-000007')),
            'gleiche Nummer'
        );
        Assert::false(
            OrderNumber::fromYearAndSequence(2026, 7)->equals(OrderNumber::fromYearAndSequence(2027, 7)),
            'gleiche laufende Nummer, anderes Jahr'
        );
    }

    /** Die feste Länge von 20 Zeichen passt in VARCHAR(20) der Tabelle orders. */
    public function testFitsTheDatabaseColumn(): void
    {
        Assert::true(
            strlen(OrderNumber::fromYearAndSequence(2026, 999999)->toString()) <= 20,
            'Länge höchstens 20 Zeichen'
        );
    }
}
