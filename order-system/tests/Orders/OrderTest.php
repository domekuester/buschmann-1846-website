<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Orders\Order;
use Buschmann\OrderSystem\Orders\OrderDraft;
use Buschmann\OrderSystem\Orders\OrderNumber;
use Buschmann\OrderSystem\Orders\OrderStatus;
use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\DomainException;
use Buschmann\OrderSystem\Shared\Money;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class OrderTest
{
    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 09:00:00');
    }

    private function catalog(string $priceA = '4.35', string $priceB = '2.80', bool $bActive = true): ProductCatalog
    {
        return ProductCatalog::fromList([
            new Product(1, 'Zitronen-Cheesecake', null, Money::fromDecimalString($priceA), 'Stück', true, 10),
            new Product(2, 'Butterkuchen', null, Money::fromDecimalString($priceB), 'Blech', $bActive, 20),
        ]);
    }

    private function customer(
        FulfillmentType $type = FulfillmentType::Delivery,
        bool $withAddress = true,
        bool $active = true
    ): Customer {
        return new Customer(
            7, 'Café Beispiel', null, null, null,
            $withAddress ? new Address('Musterstraße 1', '40213', 'Düsseldorf') : null,
            $active, $type, null
        );
    }

    /** @param array<string, mixed> $overrides */
    private function draft(array $overrides = []): OrderDraft
    {
        return OrderDraft::fromInput($overrides + [
            'fulfillment_type' => 'delivery',
            'fulfillment_date' => '2026-08-28',
            'items'            => [['product_id' => 1, 'quantity' => 3]],
        ], $this->now());
    }

    private function place(?OrderDraft $draft = null, ?Customer $customer = null, ?ProductCatalog $catalog = null): Order
    {
        return Order::place(
            $customer ?? $this->customer(),
            $catalog ?? $this->catalog(),
            $draft ?? $this->draft(),
            OrderNumber::fromYearAndSequence(2026, 1),
            $this->now(),
        );
    }

    public function testPlacesAnOrderWithSnapshotsAndStatusNew(): void
    {
        $order = $this->place();

        Assert::same('BUS-2026-000001', $order->orderNumber->toString(), 'Bestellnummer');
        Assert::same(7, $order->customerId, 'Kunde');
        Assert::same('Café Beispiel', $order->customerNameSnapshot, 'Kundenname-Snapshot');
        Assert::same(OrderStatus::New, $order->status, 'Startstatus');
        Assert::same('2026-08-28', $order->fulfillmentDate->toString(), 'Liefertag');
        Assert::same('Musterstraße 1, 40213 Düsseldorf', $order->deliveryAddressSnapshot, 'Adress-Snapshot');
        Assert::null($order->id, 'noch nicht persistiert');
        Assert::same('2026-08-23 09:00:00', $order->createdAt->format('Y-m-d H:i:s'), 'Zeitstempel');
    }

    /** Regel 6: Der Preis stammt aus dem Katalog, nicht aus der Eingabe. */
    public function testPriceComesFromTheCatalog(): void
    {
        $order = $this->place();
        Assert::same(435, $order->items[0]->unitPrice->cents, 'Einzelpreis aus dem Katalog');
        Assert::same('13.05', $order->total()->toDecimalString(), 'Gesamtsumme');
    }

    /** Regel 7: Ein mitgesendeter Preis ändert nichts. */
    public function testPricesInTheRequestAreIgnored(): void
    {
        $draft = $this->draft(['items' => [[
            'product_id' => 1, 'quantity' => 3,
            'unit_price' => '0.01', 'line_total' => '0.03',
        ]], 'total' => '0.03']);

        Assert::same('13.05', $this->place($draft)->total()->toDecimalString(),
            'Gesamtsumme unbeeinflusst von der Eingabe');
    }

    /** Regel 9: Mehrere Positionen werden korrekt summiert. */
    public function testMultipleItemsAreSummedCorrectly(): void
    {
        $order = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 3],   // 3 x 4.35 = 13.05
            ['product_id' => 2, 'quantity' => 7],   // 7 x 2.80 = 19.60
        ]]));

        Assert::same(2, $order->itemCount(), 'zwei Positionen');
        Assert::same('13.05', $order->items[0]->lineTotal->toDecimalString(), 'Position 1');
        Assert::same('19.60', $order->items[1]->lineTotal->toDecimalString(), 'Position 2');
        Assert::same('32.65', $order->total()->toDecimalString(), 'Summe');
    }

    /** Regel 10 im Zusammenspiel: viele krumme Beträge, kein Rundungsfehler. */
    public function testManyAwkwardAmountsSumExactly(): void
    {
        $catalog = ProductCatalog::fromList([
            new Product(1, 'A', null, Money::fromDecimalString('0.07'), 'Stück', true, 1),
            new Product(2, 'B', null, Money::fromDecimalString('0.10'), 'Stück', true, 2),
            new Product(3, 'C', null, Money::fromDecimalString('0.20'), 'Stück', true, 3),
        ]);
        $order = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 100],  // 7.00
            ['product_id' => 2, 'quantity' => 3],    // 0.30
            ['product_id' => 3, 'quantity' => 3],    // 0.60
        ]]), null, $catalog);

        Assert::same('7.90', $order->total()->toDecimalString(), 'Summe ohne Abweichung');
    }

    /** Regel 8: Eine Preisänderung wirkt nicht rückwirkend. */
    public function testPriceSnapshotSurvivesALaterPriceChange(): void
    {
        $order = $this->place();
        Assert::same('13.05', $order->total()->toDecimalString(), 'Summe zum Bestellzeitpunkt');

        // Buschmann erhöht den Preis. Der Katalog ist neu, die Bestellung nicht.
        $newCatalog = $this->catalog('5.00');
        Assert::same(500, $newCatalog->get(1)->unitPrice->cents, 'neuer Katalogpreis');

        Assert::same('13.05', $order->total()->toDecimalString(), 'alte Bestellung unverändert');
        Assert::same(435, $order->items[0]->unitPrice->cents, 'Preis-Snapshot unverändert');

        $newOrder = $this->place(null, null, $newCatalog);
        Assert::same('15.00', $newOrder->total()->toDecimalString(), 'neue Bestellung zum neuen Preis');
    }

    /** Der Name-Snapshot überlebt eine Umbenennung des Cafés genauso. */
    public function testNameSnapshotSurvivesARename(): void
    {
        $order   = $this->place();
        $renamed = new Customer(7, 'Café Neuer Name', null, null, null,
            new Address('Musterstraße 1', '40213', 'Düsseldorf'),
            true, FulfillmentType::Delivery, null);

        Assert::same('Café Beispiel', $order->customerNameSnapshot, 'alter Name in der Bestellung');
        Assert::same('Café Neuer Name', $renamed->name, 'neuer Name im Stammdatensatz');
    }

    /** Regel 3: Inaktive Produkte dürfen nicht neu bestellt werden. */
    public function testInactiveProductsCannotBeOrdered(): void
    {
        $catalog = $this->catalog('4.35', '2.80', false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [['product_id' => 2, 'quantity' => 1]]]), null, $catalog),
            'inaktives Produkt');
        Assert::true($e->hasError('items.0.product_id'), 'Fehler an der Position');
    }

    /** Aber: Ein inaktives Produkt bleibt in einer bestehenden Bestellung sichtbar. */
    public function testAnAlreadyPlacedOrderKeepsDeactivatedProducts(): void
    {
        // Bestellt wird, solange das Produkt aktiv ist.
        $order = $this->place($this->draft(['items' => [['product_id' => 2, 'quantity' => 4]]]));

        // Danach nimmt Buschmann es aus dem Sortiment.
        $withoutIt = $this->catalog('4.35', '2.80', false);
        Assert::false($withoutIt->get(2)->isActive, 'Produkt ist jetzt deaktiviert');
        Assert::count(1, $withoutIt->orderable(), 'und nicht mehr bestellbar');

        // Die bestehende Bestellung bleibt vollständig lesbar.
        Assert::same('Butterkuchen', $order->items[0]->productNameSnapshot, 'Snapshot bleibt');
        Assert::same('Blech', $order->items[0]->productUnitSnapshot, 'Einheit bleibt');
        Assert::same('11.20', $order->total()->toDecimalString(), 'Betrag bleibt');
    }

    public function testUnknownProductsAreRejected(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [['product_id' => 999, 'quantity' => 1]]])),
            'unbekanntes Produkt');
        Assert::true($e->hasError('items.0.product_id'), 'Fehler an der Position');
    }

    public function testAllProductProblemsAreReportedAtOnce(): void
    {
        $catalog = $this->catalog('4.35', '2.80', false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [
                ['product_id' => 999, 'quantity' => 1],
                ['product_id' => 2, 'quantity' => 1],
            ]]), null, $catalog),
            'zwei Produktprobleme');
        Assert::same(2, count($e->errors()), 'beide Positionen gemeldet');
    }

    public function testInactiveCustomersCannotOrder(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place(null, $this->customer(FulfillmentType::Delivery, true, false)),
            'inaktiver Kunde');
        Assert::true($e->hasError('customer'), 'Fehler am Feld customer');
    }

    public function testDeliveryWithoutAnAddressIsRejected(): void
    {
        $pickupCustomer = $this->customer(FulfillmentType::Pickup, false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place(null, $pickupCustomer),
            'Lieferung ohne hinterlegte Adresse');
        Assert::true($e->hasError('fulfillment_type'), 'Fehler am Feld fulfillment_type');
    }

    public function testPickupOrdersCarryNoAddress(): void
    {
        $order = Order::place(
            $this->customer(FulfillmentType::Pickup, false),
            $this->catalog(),
            $this->draft(['fulfillment_type' => 'pickup']),
            OrderNumber::fromYearAndSequence(2026, 2),
            $this->now(),
        );
        Assert::same(FulfillmentType::Pickup, $order->fulfillmentType, 'Abholung');
        Assert::null($order->deliveryAddressSnapshot, 'keine Adresse');
    }

    /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
    public function testAnOrderWithoutItemsCannotExist(): void
    {
        Assert::throws(ValidationException::class,
            fn () => $this->draft(['items' => []]),
            'leere Bestellung wird schon im Entwurf abgelehnt');
    }

    public function testStatusFollowsTheAllowedPath(): void
    {
        $later = $this->now()->modify('+1 hour');
        $order = $this->place()->withStatus(OrderStatus::Confirmed, $later);

        Assert::same(OrderStatus::Confirmed, $order->status, 'bestätigt');
        Assert::same('2026-08-23 10:00:00', $order->updatedAt->format('Y-m-d H:i:s'), 'updatedAt gesetzt');
        Assert::same('2026-08-23 09:00:00', $order->createdAt->format('Y-m-d H:i:s'), 'createdAt unverändert');
        Assert::same('13.05', $order->total()->toDecimalString(), 'Betrag unverändert');
    }

    public function testForbiddenStatusChangesAreRejected(): void
    {
        $order = $this->place();
        Assert::throws(DomainException::class,
            fn () => $order->withStatus(OrderStatus::Completed, $this->now()),
            'neu direkt auf abgeschlossen');

        $cancelled = $order->withStatus(OrderStatus::Cancelled, $this->now());
        Assert::throws(DomainException::class,
            fn () => $cancelled->withStatus(OrderStatus::InProduction, $this->now()),
            'storniert zurück in Produktion');
    }

    public function testChangingStatusLeavesTheOriginalUntouched(): void
    {
        $order     = $this->place();
        $confirmed = $order->withStatus(OrderStatus::Confirmed, $this->now());
        Assert::same(OrderStatus::New, $order->status, 'Original unverändert');
        Assert::same(OrderStatus::Confirmed, $confirmed->status, 'Kopie geändert');
    }

    public function testReceivingIdsAfterPersistence(): void
    {
        $saved = $this->place()->withId(55);
        Assert::same(55, $saved->id, 'Bestell-ID');
        Assert::same('13.05', $saved->total()->toDecimalString(), 'Betrag unverändert');
    }

    /**
     * „Letzte Bestellung wiederholen" wird noch nicht gebaut — aber das
     * Modell muss es ohne Sonderarchitektur erlauben. Dieser Test belegt es.
     */
    public function testAnOrderCanBeRebuiltAsANewDraft(): void
    {
        $original = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 3],
            ['product_id' => 2, 'quantity' => 7],
        ]]));

        $items = [];
        foreach ($original->items as $item) {
            $items[] = ['product_id' => $item->productId, 'quantity' => $item->quantity];
        }

        $repeat = Order::place(
            $this->customer(),
            $this->catalog(),
            OrderDraft::fromInput([
                'fulfillment_type' => $original->fulfillmentType->value,
                'fulfillment_date' => '2026-09-04',
                'items'            => $items,
            ], $this->now()),
            OrderNumber::fromYearAndSequence(2026, 2),
            $this->now(),
        );

        Assert::same('32.65', $repeat->total()->toDecimalString(), 'gleiche Summe');
        Assert::same('2026-09-04', $repeat->fulfillmentDate->toString(), 'neuer Liefertag');
        Assert::same('BUS-2026-000002', $repeat->orderNumber->toString(), 'eigene Bestellnummer');
    }
}
