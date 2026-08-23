<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

/**
 * Wie eine Bestellung zum Kunden kommt.
 *
 * String-Enum, damit Domänenwert und Datenbankwert identisch sind: Ein
 * unbekannter Wert scheitert dann bereits beim Laden über from(), nicht
 * erst irgendwo tief in der Anwendung.
 *
 * Abholung ist kein Sonderfall der Lieferung. Geschäftskunden bestellen
 * überwiegend delivery, Privat- und Sonderkunden überwiegend pickup.
 */
enum FulfillmentType: string
{
    case Delivery = 'delivery';
    case Pickup   = 'pickup';

    public function requiresAddress(): bool
    {
        return $this === self::Delivery;
    }

    public function label(): string
    {
        return match ($this) {
            self::Delivery => 'Lieferung',
            self::Pickup   => 'Abholung',
        };
    }
}
