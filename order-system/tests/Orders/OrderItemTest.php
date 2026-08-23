<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderItem;
use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class OrderItemTest
{
    private function product(string $price = '4.35'): Product
    {
        return new Product(1, 'Zitronen-Cheesecake', null,
            Money::fromDecimalString($price), 'Stück', true, 10);
    }

    public function testTakesItsSnapshotFromTheProduct(): void
    {
        $item = OrderItem::forProduct($this->product(), 3);
        Assert::same(1, $item->productId, 'Produkt-ID');
        Assert::same('Zitronen-Cheesecake', $item->productNameSnapshot, 'Name-Snapshot');
        Assert::same('Stück', $item->productUnitSnapshot, 'Einheit-Snapshot');
        Assert::same(435, $item->unitPrice->cents, 'Preis-Snapshot');
        Assert::same(3, $item->quantity, 'Menge');
        Assert::null($item->id, 'noch nicht persistiert');
    }

    /** Regel 6/7: Der Positionsbetrag wird berechnet, nicht entgegengenommen. */
    public function testLineTotalIsComputedFromPriceAndQuantity(): void
    {
        Assert::same('13.05', OrderItem::forProduct($this->product(), 3)->lineTotal->toDecimalString(), '3 x 4.35');
        Assert::same('4.35', OrderItem::forProduct($this->product(), 1)->lineTotal->toDecimalString(), '1 x 4.35');
        Assert::same('43.50', OrderItem::forProduct($this->product(), 10)->lineTotal->toDecimalString(), '10 x 4.35');
    }

    /** Regel 2: Menge muss größer als 0 sein. */
    public function testQuantityMustBeGreaterThanZero(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), 0), 'Menge 0');
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), -1), 'negative Menge');
    }

    public function testQuantityHasASanityBound(): void
    {
        Assert::same(OrderItem::MAX_QUANTITY,
            OrderItem::forProduct($this->product(), OrderItem::MAX_QUANTITY)->quantity,
            'Obergrenze ist zulässig');
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), OrderItem::MAX_QUANTITY + 1),
            'unplausibel große Menge');
    }

    public function testSnapshotsAreRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 1, '  ', 'Stück', Money::fromCents(100), 1),
            'leerer Name-Snapshot');
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 1, 'Kuchen', '', Money::fromCents(100), 1),
            'leerer Einheit-Snapshot');
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 0, 'Kuchen', 'Stück', Money::fromCents(100), 1),
            'ungültige Produkt-ID');
    }

    public function testAPriceOfZeroIsAllowed(): void
    {
        $item = OrderItem::forProduct($this->product('0.00'), 4);
        Assert::same('0.00', $item->lineTotal->toDecimalString(), 'Werbeprobe zum Preis 0');
    }

    public function testReceivingAnIdReturnsANewItem(): void
    {
        $item  = OrderItem::forProduct($this->product(), 2);
        $saved = $item->withId(42);
        Assert::same(42, $saved->id, 'ID gesetzt');
        Assert::null($item->id, 'Original bleibt unverändert');
        Assert::same('8.70', $saved->lineTotal->toDecimalString(), 'Betrag bleibt gleich');
    }
}
