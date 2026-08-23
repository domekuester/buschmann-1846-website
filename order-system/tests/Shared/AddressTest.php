<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class AddressTest
{
    public function testKeepsItsPartsAndTrimsThem(): void
    {
        $a = new Address('  Akademiestraße 8 ', ' 40213 ', ' Düsseldorf ');
        Assert::same('Akademiestraße 8', $a->street, 'Straße');
        Assert::same('40213', $a->postalCode, 'Postleitzahl');
        Assert::same('Düsseldorf', $a->city, 'Ort');
    }

    public function testRendersOneLineForTheOrderSnapshot(): void
    {
        $a = new Address('Akademiestraße 8', '40213', 'Düsseldorf');
        Assert::same('Akademiestraße 8, 40213 Düsseldorf', $a->toSingleLine(), 'Einzeiler');
    }

    public function testAllThreePartsAreRequired(): void
    {
        foreach ([['', '40213', 'Düsseldorf'], ['Straße 1', '', 'Düsseldorf'],
                  ['Straße 1', '40213', ''], ['   ', '40213', 'Düsseldorf']] as $parts) {
            Assert::throws(InvalidArgumentException::class,
                static fn () => new Address(...$parts), 'unvollständige Adresse');
        }
    }

    public function testRejectsOverlongParts(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => new Address(str_repeat('a', 161), '40213', 'Düsseldorf'), 'zu lange Straße');
        Assert::throws(InvalidArgumentException::class,
            static fn () => new Address('Straße 1', str_repeat('1', 11), 'Düsseldorf'), 'zu lange Postleitzahl');
        Assert::throws(InvalidArgumentException::class,
            static fn () => new Address('Straße 1', '40213', str_repeat('a', 101)), 'zu langer Ort');
    }

    /**
     * Bewusst KEINE Formatprüfung: Eine PLZ-Regex im Domänenkern ist eine
     * klassische Überprüfungsfalle. Formathinweise gehören in die Eingabemaske.
     */
    public function testAcceptsNonGermanPostalCodeFormats(): void
    {
        $a = new Address('Rue de la Paix 1', '1211', 'Genève');
        Assert::same('1211', $a->postalCode, 'vierstellige Postleitzahl');
    }
}
