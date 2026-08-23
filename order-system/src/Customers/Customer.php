<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Customers;

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;

/**
 * Ein Geschäftskunde (Café) oder ein Privat-/Sonderkunde.
 *
 * Datenminimierung ist hier Voreinstellung, nicht Bequemlichkeit: Pflicht
 * ist ausschließlich der Kunden- oder Cafénname. Ansprechpartner, E-Mail und
 * Telefon sind optional, weil ein Café zur Bestellung keinen
 * personenbezogenen Kontakt braucht.
 *
 * internalNote ist ein Feld für BETRIEBLICHE Hinweise („Lieferung an der
 * Rückseite", „Kühlkette beachten") — niemals für Angaben über Personen und
 * niemals für besondere Datenkategorien.
 *
 * Kunden werden deaktiviert, nicht gelöscht, solange Bestellungen bestehen.
 */
final class Customer
{
    public readonly string $name;
    public readonly ?string $contactPerson;
    public readonly ?string $email;
    public readonly ?string $phone;
    public readonly ?string $internalNote;

    public function __construct(
        public readonly int $id,
        string $name,
        ?string $contactPerson,
        ?string $email,
        ?string $phone,
        public readonly ?Address $deliveryAddress,
        public readonly bool $isActive,
        public readonly FulfillmentType $defaultFulfillment,
        ?string $internalNote,
    ) {
        if ($id <= 0) {
            throw new InvalidArgumentException('Die Kunden-ID ist ungültig.');
        }

        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 120) {
            throw new InvalidArgumentException('Der Kundenname fehlt oder ist zu lang.');
        }
        $this->name = $name;

        $this->contactPerson = self::optional($contactPerson, 120, 'Der Ansprechpartner');
        $this->phone         = self::optional($phone, 40, 'Die Telefonnummer');
        $this->internalNote  = self::optional($internalNote, 1000, 'Die interne Notiz');

        $email = self::optional($email, 190, 'Die E-Mail-Adresse');
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('Die E-Mail-Adresse ist ungültig.');
        }
        $this->email = $email;

        if ($defaultFulfillment->requiresAddress() && $deliveryAddress === null) {
            throw new InvalidArgumentException(
                'Ein Kunde mit Standardlieferung braucht eine Lieferadresse.'
            );
        }
    }

    /** Eine Lieferung ist möglich, sobald eine Adresse hinterlegt ist. */
    public function canBeDeliveredTo(): bool
    {
        return $this->deliveryAddress !== null;
    }

    private static function optional(?string $value, int $maxLength, string $label): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > $maxLength) {
            throw new InvalidArgumentException($label . ' ist zu lang.');
        }
        return $value;
    }
}
