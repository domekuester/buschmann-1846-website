<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\DomainException;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Buschmann\OrderSystem\Shared\ValidationException;

/**
 * Eine Bestellung.
 *
 * Die Signatur von place() IST das Sicherheitsmodell: Kunde und
 * Produktkatalog kommen aus der Datenbank, der Entwurf aus der Anfrage — und
 * der Entwurf enthält nur Produkt-IDs und Mengen. Der Preis kann deshalb
 * nicht aus der Anfrage stammen, weil es dort nichts gibt, aus dem er
 * stammen könnte.
 *
 * Eine Bestellung ist unveränderlich. Statusänderungen liefern eine neue
 * Instanz. Das schützt die Snapshots vor versehentlicher Bearbeitung.
 */
final class Order
{
    public readonly ?string $note;

    /** @param OrderItem[] $items */
    private function __construct(
        public readonly ?int $id,
        public readonly OrderNumber $orderNumber,
        public readonly int $customerId,
        public readonly string $customerNameSnapshot,
        public readonly FulfillmentType $fulfillmentType,
        public readonly FulfillmentDate $fulfillmentDate,
        public readonly ?string $deliveryAddressSnapshot,
        ?string $note,
        public readonly OrderStatus $status,
        public readonly array $items,
        public readonly \DateTimeImmutable $createdAt,
        public readonly \DateTimeImmutable $updatedAt,
    ) {
        if ($items === []) {
            throw new InvalidArgumentException('Eine Bestellung braucht mindestens eine Position.');
        }
        if ($customerId <= 0) {
            throw new InvalidArgumentException('Die Kunden-ID der Bestellung ist ungültig.');
        }
        if (trim($customerNameSnapshot) === '') {
            throw new InvalidArgumentException('Der Kundenname der Bestellung fehlt.');
        }
        if ($fulfillmentType->requiresAddress()
            && ($deliveryAddressSnapshot === null || trim($deliveryAddressSnapshot) === '')) {
            throw new InvalidArgumentException('Eine Lieferung braucht eine Lieferadresse.');
        }

        $note = $note === null ? null : trim($note);
        if ($note !== null && mb_strlen($note) > 500) {
            throw new InvalidArgumentException('Die Notiz ist zu lang.');
        }
        $this->note = ($note === null || $note === '') ? null : $note;
    }

    public static function place(
        Customer $customer,
        ProductCatalog $catalog,
        OrderDraft $draft,
        OrderNumber $orderNumber,
        \DateTimeImmutable $now,
    ): self {
        $errors = [];

        if (!$customer->isActive) {
            $errors['customer'] = 'Für diesen Kunden können derzeit keine Bestellungen angelegt werden.';
        }

        $addressSnapshot = null;
        if ($draft->fulfillmentType->requiresAddress()) {
            if ($customer->deliveryAddress === null) {
                $errors['fulfillment_type'] = 'Für diesen Kunden ist keine Lieferadresse hinterlegt.';
            } else {
                $addressSnapshot = $customer->deliveryAddress->toSingleLine();
            }
        }

        $items = [];
        foreach ($draft->items as $index => $draftItem) {
            $product = $catalog->find($draftItem['product_id']);

            if ($product === null) {
                $errors['items.' . $index . '.product_id'] = 'Dieses Produkt gibt es nicht.';
                continue;
            }
            if (!$product->isActive) {
                $errors['items.' . $index . '.product_id'] = 'Dieses Produkt ist derzeit nicht bestellbar.';
                continue;
            }

            $items[] = OrderItem::forProduct($product, $draftItem['quantity']);
        }

        if ($items === [] && $errors === []) {
            $errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
        }

        if ($errors !== []) {
            throw new ValidationException($errors);
        }

        return new self(
            null,
            $orderNumber,
            $customer->id,
            $customer->name,
            $draft->fulfillmentType,
            $draft->fulfillmentDate,
            $addressSnapshot,
            $draft->note,
            OrderStatus::New,
            $items,
            $now,
            $now,
        );
    }

    /** Die Bestellsumme wird berechnet, nie entgegengenommen. */
    public function total(): Money
    {
        $total = Money::zero();
        foreach ($this->items as $item) {
            $total = $total->plus($item->lineTotal);
        }
        return $total;
    }

    public function itemCount(): int
    {
        return count($this->items);
    }

    public function withStatus(OrderStatus $target, \DateTimeImmutable $now): self
    {
        if (!$this->status->canTransitionTo($target)) {
            throw new DomainException(sprintf(
                'Eine Bestellung im Status „%s" kann nicht auf „%s" gesetzt werden.',
                $this->status->label(),
                $target->label(),
            ));
        }
        return $this->copyWith(status: $target, updatedAt: $now);
    }

    public function withId(int $id): self
    {
        if ($id <= 0) {
            throw new InvalidArgumentException('Die Bestell-ID ist ungültig.');
        }
        return $this->copyWith(id: $id);
    }

    private function copyWith(
        ?int $id = null,
        ?OrderStatus $status = null,
        ?\DateTimeImmutable $updatedAt = null,
    ): self {
        return new self(
            $id ?? $this->id,
            $this->orderNumber,
            $this->customerId,
            $this->customerNameSnapshot,
            $this->fulfillmentType,
            $this->fulfillmentDate,
            $this->deliveryAddressSnapshot,
            $this->note,
            $status ?? $this->status,
            $this->items,
            $this->createdAt,
            $updatedAt ?? $this->updatedAt,
        );
    }
}
