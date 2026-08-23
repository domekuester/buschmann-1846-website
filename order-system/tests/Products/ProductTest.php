<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class ProductTest
{
    /** @param array<string, mixed> $overrides */
    private function product(array $overrides = []): Product
    {
        $v = $overrides + [
            'id' => 1, 'name' => 'Zitronen-Cheesecake', 'description' => null,
            'unitPrice' => Money::fromDecimalString('4.35'), 'unit' => 'Stück',
            'isActive' => true, 'sortOrder' => 10,
        ];
        return new Product($v['id'], $v['name'], $v['description'],
            $v['unitPrice'], $v['unit'], $v['isActive'], $v['sortOrder']);
    }

    public function testKeepsItsData(): void
    {
        $p = $this->product();
        Assert::same(1, $p->id, 'ID');
        Assert::same('Zitronen-Cheesecake', $p->name, 'Name');
        Assert::same(435, $p->unitPrice->cents, 'Preis');
        Assert::same('Stück', $p->unit, 'Einheit');
        Assert::true($p->isActive, 'aktiv');
        Assert::same(10, $p->sortOrder, 'Reihenfolge');
        Assert::null($p->description, 'keine Beschreibung');
    }

    public function testEmptyDescriptionBecomesNull(): void
    {
        Assert::null($this->product(['description' => '   '])->description, 'leere Beschreibung');
        Assert::same('Mürbeteig', $this->product(['description' => ' Mürbeteig '])->description, 'getrimmt');
    }

    public function testNameIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['name' => '  ']), 'leerer Produktname');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['name' => str_repeat('a', 121)]), 'zu langer Produktname');
    }

    public function testUnitIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['unit' => '']), 'leere Einheit');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['unit' => str_repeat('a', 21)]), 'zu lange Einheit');
    }

    /** Die Einheit ist ein freies Anzeigelabel — keine Enum, keine Migration je Einheit. */
    public function testUnitAcceptsAnyReasonableLabel(): void
    {
        foreach (['Stück', 'Blech', 'kg', 'Torte', 'Portion'] as $unit) {
            Assert::same($unit, $this->product(['unit' => $unit])->unit, 'Einheit ' . $unit);
        }
    }

    public function testIdMustBePositive(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['id' => 0]), 'ID 0');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['id' => -1]), 'negative ID');
    }

    public function testSortOrderMustNotBeNegative(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['sortOrder' => -1]), 'negative Reihenfolge');
    }

    public function testDescriptionHasAnUpperBound(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['description' => str_repeat('a', 501)]), 'zu lange Beschreibung');
    }
}
