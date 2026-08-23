<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class CustomerTest
{
    private function address(): Address
    {
        return new Address('Musterstraße 1', '40213', 'Düsseldorf');
    }

    /** @param array<string, mixed> $overrides */
    private function customer(array $overrides = []): Customer
    {
        $v = $overrides + [
            'id' => 1, 'name' => 'Café Beispiel', 'contactPerson' => null,
            'email' => null, 'phone' => null, 'deliveryAddress' => $this->address(),
            'isActive' => true, 'defaultFulfillment' => FulfillmentType::Delivery,
            'internalNote' => null,
        ];
        return new Customer($v['id'], $v['name'], $v['contactPerson'], $v['email'],
            $v['phone'], $v['deliveryAddress'], $v['isActive'],
            $v['defaultFulfillment'], $v['internalNote']);
    }

    public function testKeepsItsData(): void
    {
        $c = $this->customer(['contactPerson' => 'Frau Beispiel', 'phone' => '0211 1234567']);
        Assert::same(1, $c->id, 'ID');
        Assert::same('Café Beispiel', $c->name, 'Name');
        Assert::same('Frau Beispiel', $c->contactPerson, 'Ansprechpartner');
        Assert::same('0211 1234567', $c->phone, 'Telefon');
        Assert::same(FulfillmentType::Delivery, $c->defaultFulfillment, 'Standard-Fulfillment');
    }

    /** Datenminimierung: Nur der Kundenname ist Pflicht. */
    public function testOnlyTheNameIsMandatory(): void
    {
        $c = $this->customer([
            'contactPerson' => null, 'email' => null, 'phone' => null,
            'deliveryAddress' => null, 'defaultFulfillment' => FulfillmentType::Pickup,
        ]);
        Assert::same('Café Beispiel', $c->name, 'Name');
        Assert::null($c->email, 'keine E-Mail');
        Assert::null($c->phone, 'kein Telefon');
        Assert::null($c->deliveryAddress, 'keine Adresse');
    }

    public function testNameIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['name' => '   ']), 'leerer Kundenname');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['name' => str_repeat('a', 121)]), 'zu langer Kundenname');
    }

    /** Invariante: Wer standardmäßig beliefert wird, braucht eine Lieferadresse. */
    public function testDeliveryCustomerNeedsAnAddress(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer([
                'defaultFulfillment' => FulfillmentType::Delivery, 'deliveryAddress' => null,
            ]),
            'Lieferkunde ohne Adresse');
    }

    /** Umgekehrt ist eine Adresse bei einem Abholkunden kein Widerspruch. */
    public function testPickupCustomerMayStillHaveAnAddress(): void
    {
        $c = $this->customer([
            'defaultFulfillment' => FulfillmentType::Pickup, 'deliveryAddress' => $this->address(),
        ]);
        Assert::notNull($c->deliveryAddress, 'Adresse bleibt erhalten');
        Assert::true($c->canBeDeliveredTo(), 'Lieferung wäre möglich');
    }

    public function testKnowsWhetherDeliveryIsPossible(): void
    {
        Assert::false(
            $this->customer(['defaultFulfillment' => FulfillmentType::Pickup, 'deliveryAddress' => null])
                ->canBeDeliveredTo(),
            'ohne Adresse keine Lieferung'
        );
    }

    public function testRejectsMalformedEmail(): void
    {
        foreach (['keine-adresse', 'a@', '@b.de', 'a b@c.de'] as $bad) {
            Assert::throws(InvalidArgumentException::class,
                fn () => $this->customer(['email' => $bad]), 'unzulässige E-Mail "' . $bad . '"');
        }
        Assert::same('kontakt@example.org',
            $this->customer(['email' => ' kontakt@example.org '])->email, 'gültige E-Mail');
    }

    public function testBlankOptionalFieldsBecomeNull(): void
    {
        $c = $this->customer(['contactPerson' => '  ', 'phone' => '', 'internalNote' => '   ']);
        Assert::null($c->contactPerson, 'leerer Ansprechpartner');
        Assert::null($c->phone, 'leeres Telefon');
        Assert::null($c->internalNote, 'leere Notiz');
    }

    public function testOptionalFieldsHaveUpperBounds(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['contactPerson' => str_repeat('a', 121)]), 'Ansprechpartner');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['phone' => str_repeat('1', 41)]), 'Telefon');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['internalNote' => str_repeat('a', 1001)]), 'interne Notiz');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['email' => str_repeat('a', 190) . '@e.de']), 'E-Mail');
    }

    public function testIdMustBePositive(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['id' => 0]), 'ID 0');
    }
}
