<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class MoneyTest
{
    public function testCentsAreStoredExactly(): void
    {
        Assert::same(1499, Money::fromCents(1499)->cents, 'Cent-Wert');
        Assert::same(0, Money::zero()->cents, 'Null-Betrag');
    }

    public function testParsesDecimalStringsFromTheDatabase(): void
    {
        Assert::same(1499, Money::fromDecimalString('14.99')->cents, '14.99');
        Assert::same(1490, Money::fromDecimalString('14.9')->cents, '14.9');
        Assert::same(1500, Money::fromDecimalString('15')->cents, '15');
        Assert::same(5, Money::fromDecimalString('0.05')->cents, '0.05');
        Assert::same(0, Money::fromDecimalString('0.00')->cents, '0.00');
    }

    public function testFormatsForTheDatabaseWithTwoDecimals(): void
    {
        Assert::same('14.99', Money::fromCents(1499)->toDecimalString(), '1499 Cent');
        Assert::same('15.00', Money::fromCents(1500)->toDecimalString(), '1500 Cent');
        Assert::same('0.05', Money::fromCents(5)->toDecimalString(), '5 Cent');
        Assert::same('0.00', Money::zero()->toDecimalString(), '0 Cent');
    }

    /** Regel 10: Die Umwandlung DECIMAL <-> Cent verliert nichts. */
    public function testConversionIsLosslessInBothDirections(): void
    {
        foreach (['0.01', '0.10', '0.20', '0.30', '0.70', '1.15', '4.35',
                  '8.15', '19.99', '99.95', '1234.56'] as $value) {
            Assert::same(
                $value,
                Money::fromDecimalString($value)->toDecimalString(),
                'Hin- und Rückumwandlung von ' . $value
            );
        }
    }

    /** Regel 10: 0,10 EUR + 0,20 EUR ergibt exakt 0,30 EUR — mit float nicht. */
    public function testAdditionIsExactWhereFloatWouldNotBe(): void
    {
        $sum = Money::fromDecimalString('0.10')->plus(Money::fromDecimalString('0.20'));
        Assert::same('0.30', $sum->toDecimalString(), 'Summe 0.10 + 0.20');
    }

    /** Regel 10: 3 x 4,35 EUR ergibt exakt 13,05 EUR — mit float 13,049999… */
    public function testMultiplicationByQuantityIsExact(): void
    {
        $total = Money::fromDecimalString('4.35')->multipliedBy(3);
        Assert::same('13.05', $total->toDecimalString(), '3 x 4.35');
    }

    /** Regel 10: Auch über viele Positionen entsteht keine Abweichung. */
    public function testSummingManySmallAmountsStaysExact(): void
    {
        $sum = Money::zero();
        for ($i = 0; $i < 100; $i++) {
            $sum = $sum->plus(Money::fromDecimalString('0.07'));
        }
        Assert::same('7.00', $sum->toDecimalString(), '100 x 0.07');
    }

    public function testRejectsNegativeAmounts(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromCents(-1), 'negativer Cent-Betrag');
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromDecimalString('-5.00'), 'negative Dezimalzahl');
    }

    public function testRejectsAmountsTheDatabaseColumnCannotHold(): void
    {
        Assert::same(Money::MAX_CENTS, Money::fromCents(Money::MAX_CENTS)->cents,
            'Obergrenze ist zulässig');
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS + 1), 'ein Cent über DECIMAL(10,2)');
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS)->plus(Money::fromCents(1)),
            'Überlauf durch Addition');
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS)->multipliedBy(2),
            'Überlauf durch Multiplikation');
    }

    public function testRejectsMalformedDecimalStrings(): void
    {
        foreach (['14,99', '', ' ', 'abc', '14.999', '1e3', '14.', '.5'] as $bad) {
            Assert::throws(InvalidArgumentException::class,
                static fn () => Money::fromDecimalString($bad),
                'unzulässige Eingabe "' . $bad . '"');
        }
    }

    public function testRejectsNegativeQuantities(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => Money::fromCents(100)->multipliedBy(-1), 'negativer Faktor');
    }

    public function testEqualityComparesValueNotIdentity(): void
    {
        Assert::true(Money::fromCents(1499)->equals(Money::fromDecimalString('14.99')), 'gleicher Betrag');
        Assert::false(Money::fromCents(1499)->equals(Money::fromCents(1500)), 'anderer Betrag');
        Assert::true(Money::zero()->isZero(), 'Null erkannt');
    }
}
