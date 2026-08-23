<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class ProductCatalogTest
{
    private function product(int $id, string $name, bool $active = true, int $sort = 0): Product
    {
        return new Product($id, $name, null, Money::fromDecimalString('4.00'), 'Stück', $active, $sort);
    }

    public function testFindsProductsById(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A'), $this->product(2, 'B')]);
        Assert::same('B', $catalog->get(2)->name, 'Produkt 2');
        Assert::same(2, $catalog->count(), 'Anzahl');
    }

    public function testReturnsNullForUnknownProducts(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A')]);
        Assert::null($catalog->find(99), 'unbekannte ID');
    }

    /** get() ist für Stellen, an denen ein fehlendes Produkt ein Fehler ist. */
    public function testGetThrowsForUnknownProducts(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A')]);
        Assert::throws(InvalidArgumentException::class,
            static fn () => $catalog->get(99), 'unbekannte ID bei get()');
    }

    /**
     * Die Bestellseite braucht das gesamte aktive Sortiment in
     * Anzeigereihenfolge in einem Zugriff — UX-Prinzip 2.
     */
    public function testOrderableProductsAreActiveAndSorted(): void
    {
        $catalog = ProductCatalog::fromList([
            $this->product(3, 'Drittes', true, 30),
            $this->product(1, 'Erstes', true, 10),
            $this->product(9, 'Inaktives', false, 5),
            $this->product(2, 'Zweites', true, 20),
        ]);

        $names = array_map(static fn (Product $p) => $p->name, $catalog->orderable());
        Assert::same(['Erstes', 'Zweites', 'Drittes'], $names, 'Reihenfolge');
    }

    public function testProductsWithTheSameSortOrderFallBackToId(): void
    {
        $catalog = ProductCatalog::fromList([
            $this->product(7, 'Sieben', true, 10),
            $this->product(3, 'Drei', true, 10),
        ]);
        $names = array_map(static fn (Product $p) => $p->name, $catalog->orderable());
        Assert::same(['Drei', 'Sieben'], $names, 'stabile Reihenfolge über die ID');
    }

    public function testInactiveProductsAreStillFindable(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(9, 'Inaktiv', false)]);
        Assert::notNull($catalog->find(9), 'inaktives Produkt bleibt auffindbar');
        Assert::count(0, $catalog->orderable(), 'aber nicht bestellbar');
    }

    public function testRejectsDuplicateIds(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => ProductCatalog::fromList([$this->product(1, 'A'), $this->product(1, 'B')]),
            'doppelte Produkt-ID');
    }

    public function testAnEmptyCatalogIsAllowed(): void
    {
        $catalog = ProductCatalog::fromList([]);
        Assert::same(0, $catalog->count(), 'leerer Katalog');
        Assert::count(0, $catalog->orderable(), 'nichts bestellbar');
    }
}
