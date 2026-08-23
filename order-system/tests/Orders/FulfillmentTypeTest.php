<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Tests\Assert;

final class FulfillmentTypeTest
{
    public function testThereAreExactlyTwoKinds(): void
    {
        Assert::count(2, FulfillmentType::cases(), 'Fulfillment-Arten');
        Assert::same('delivery', FulfillmentType::Delivery->value, 'Lieferung');
        Assert::same('pickup', FulfillmentType::Pickup->value, 'Abholung');
    }

    /** Regel 4: Ein unbekannter Wert ist ungültig und scheitert sofort. */
    public function testUnknownValueIsRejected(): void
    {
        Assert::throws(\ValueError::class,
            static fn () => FulfillmentType::from('versand'), 'unbekannter Typ');
        Assert::null(FulfillmentType::tryFrom('versand'), 'tryFrom liefert null');
        Assert::null(FulfillmentType::tryFrom(''), 'leerer Wert');
        Assert::null(FulfillmentType::tryFrom('DELIVERY'), 'Großschreibung ist ein anderer Wert');
    }

    public function testOnlyDeliveryNeedsAnAddress(): void
    {
        Assert::true(FulfillmentType::Delivery->requiresAddress(), 'Lieferung braucht Adresse');
        Assert::false(FulfillmentType::Pickup->requiresAddress(), 'Abholung braucht keine');
    }

    public function testEachKindHasAGermanLabel(): void
    {
        Assert::same('Lieferung', FulfillmentType::Delivery->label(), 'Label Lieferung');
        Assert::same('Abholung', FulfillmentType::Pickup->label(), 'Label Abholung');
    }
}
