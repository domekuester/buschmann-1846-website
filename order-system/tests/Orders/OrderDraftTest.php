<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Orders\OrderDraft;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class OrderDraftTest
{
    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 09:00:00');
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function input(array $overrides = []): array
    {
        return $overrides + [
            'fulfillment_type' => 'delivery',
            'fulfillment_date' => '2026-08-28',
            'note'             => null,
            'items'            => [['product_id' => 1, 'quantity' => 3]],
        ];
    }

    public function testReadsAValidOrder(): void
    {
        $draft = OrderDraft::fromInput($this->input(['note' => ' Bitte kühl stellen ']), $this->now());
        Assert::same(FulfillmentType::Delivery, $draft->fulfillmentType, 'Fulfillment');
        Assert::same('2026-08-28', $draft->fulfillmentDate->toString(), 'Datum');
        Assert::same('Bitte kühl stellen', $draft->note, 'Notiz getrimmt');
        Assert::count(1, $draft->items, 'Positionen');
        Assert::same(['product_id' => 1, 'quantity' => 3], $draft->items[0], 'Position');
    }

    /**
     * Regel 7: Der Entwurf hat kein Preisfeld. Mitgesendete Beträge werden
     * nicht „geprüft und verworfen", sondern gar nicht erst gelesen.
     */
    public function testPriceFieldsInTheRequestAreNotRead(): void
    {
        $draft = OrderDraft::fromInput($this->input([
            'total'       => '0.01',
            'total_cents' => 1,
            'items'       => [[
                'product_id' => 1, 'quantity' => 3,
                'unit_price' => '0.01', 'line_total' => '0.03', 'price' => 1,
            ]],
        ]), $this->now());

        Assert::same(['product_id' => 1, 'quantity' => 3], $draft->items[0],
            'Position enthält nur ID und Menge');
        Assert::false(property_exists($draft, 'total'), 'kein Gesamtbetrag im Entwurf');
        Assert::false(property_exists($draft, 'unitPrice'), 'kein Einzelpreis im Entwurf');
    }

    public function testStatusAndOrderNumberCannotBeInjected(): void
    {
        $draft = OrderDraft::fromInput($this->input([
            'status' => 'completed', 'order_number' => 'BUS-2026-000001', 'customer_id' => 99,
        ]), $this->now());

        Assert::false(property_exists($draft, 'status'), 'kein Status im Entwurf');
        Assert::false(property_exists($draft, 'orderNumber'), 'keine Bestellnummer im Entwurf');
        Assert::false(property_exists($draft, 'customerId'), 'kein Kunde im Entwurf');
    }

    /**
     * Die Bestellseite sendet ALLE Produkte mit, die meisten mit Menge 0.
     * Menge 0 heißt „nicht bestellt" und ist kein Fehler — sie fällt weg.
     */
    public function testQuantityZeroMeansNotOrdered(): void
    {
        $draft = OrderDraft::fromInput($this->input(['items' => [
            ['product_id' => 1, 'quantity' => 0],
            ['product_id' => 2, 'quantity' => 5],
            ['product_id' => 3, 'quantity' => 0],
        ]]), $this->now());

        Assert::count(1, $draft->items, 'nur die tatsächlich bestellte Position');
        Assert::same(2, $draft->items[0]['product_id'], 'Produkt 2');
    }

    /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
    public function testAnOrderWithoutItemsIsRejected(): void
    {
        foreach ([[], [['product_id' => 1, 'quantity' => 0]]] as $items) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input(['items' => $items]), $this->now()),
                'Bestellung ohne Positionen');
            Assert::true($e->hasError('items'), 'Fehler am Feld items');
        }
        Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => 'keine Liste']), $this->now()),
            'items ist keine Liste');
    }

    /** Regel 2: Eine negative Menge ist ein Fehler, kein „nicht bestellt". */
    public function testNegativeOrNonNumericQuantitiesAreRejected(): void
    {
        foreach ([-1, 'drei', null, 2.5, ''] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input([
                    'items' => [['product_id' => 1, 'quantity' => $bad]],
                ]), $this->now()),
                'unzulässige Menge');
            Assert::true($e->hasError('items.0.quantity'), 'Fehler an der richtigen Position');
        }
    }

    public function testInvalidProductIdsAreRejected(): void
    {
        foreach ([0, -5, 'abc', null] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input([
                    'items' => [['product_id' => $bad, 'quantity' => 1]],
                ]), $this->now()),
                'unzulässige Produkt-ID');
            Assert::true($e->hasError('items.0.product_id'), 'Fehler an der richtigen Position');
        }
    }

    public function testTheSameProductMustNotAppearTwice(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => [
                ['product_id' => 1, 'quantity' => 2],
                ['product_id' => 1, 'quantity' => 3],
            ]]), $this->now()),
            'doppeltes Produkt');
        Assert::true($e->hasError('items.1.product_id'), 'Fehler an der zweiten Position');
    }

    /** Regel 4: Ein unbekannter Fulfillment-Typ ist ungültig. */
    public function testUnknownFulfillmentTypeIsRejected(): void
    {
        foreach (['versand', '', null, 'DELIVERY', 42] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input(['fulfillment_type' => $bad]), $this->now()),
                'unzulässiger Fulfillment-Typ');
            Assert::true($e->hasError('fulfillment_type'), 'Fehler am Feld fulfillment_type');
        }
    }

    public function testPickupIsAcceptedToo(): void
    {
        $draft = OrderDraft::fromInput($this->input(['fulfillment_type' => 'pickup']), $this->now());
        Assert::same(FulfillmentType::Pickup, $draft->fulfillmentType, 'Abholung');
    }

    public function testPastFulfillmentDatesAreRejected(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['fulfillment_date' => '2026-08-01']), $this->now()),
            'Datum in der Vergangenheit');
        Assert::true($e->hasError('fulfillment_date'), 'Fehler am Feld fulfillment_date');
    }

    /** Alle Fehler auf einmal — ein Café soll nicht fünfmal absenden müssen. */
    public function testAllErrorsAreCollectedNotJustTheFirst(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput([
                'fulfillment_type' => 'versand',
                'fulfillment_date' => '2020-01-01',
                'items'            => [['product_id' => 0, 'quantity' => -3]],
            ], $this->now()),
            'mehrere Fehler');

        $errors = $e->errors();
        Assert::true(isset($errors['fulfillment_type']), 'Fulfillment-Fehler enthalten');
        Assert::true(isset($errors['fulfillment_date']), 'Datumsfehler enthalten');
        Assert::true(isset($errors['items.0.product_id']), 'Produktfehler enthalten');
        Assert::true(isset($errors['items.0.quantity']), 'Mengenfehler enthalten');
        Assert::same(4, count($errors), 'genau vier Fehler');
    }

    public function testNoteIsOptionalAndBounded(): void
    {
        Assert::null(OrderDraft::fromInput($this->input(['note' => '   ']), $this->now())->note,
            'leere Notiz wird null');
        Assert::null(OrderDraft::fromInput($this->input(['note' => null]), $this->now())->note,
            'fehlende Notiz wird null');

        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['note' => str_repeat('a', 501)]), $this->now()),
            'zu lange Notiz');
        Assert::true($e->hasError('note'), 'Fehler am Feld note');
    }

    public function testTooManyItemsAreRejected(): void
    {
        $items = [];
        for ($i = 1; $i <= OrderDraft::MAX_ITEMS + 1; $i++) {
            $items[] = ['product_id' => $i, 'quantity' => 1];
        }
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => $items]), $this->now()),
            'zu viele Positionen');
        Assert::true($e->hasError('items'), 'Fehler am Feld items');
    }
}
