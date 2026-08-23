<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Postanschrift. Alle drei Teile sind Pflicht, geprüft wird nur
 * Vorhandensein und Länge — nicht das Format. Adressformate sind
 * international uneinheitlich; eine Regex hier würde irgendwann eine gültige
 * Adresse ablehnen und dafür keinen Fehler verhindern.
 */
final class Address
{
    public readonly string $street;
    public readonly string $postalCode;
    public readonly string $city;

    public function __construct(string $street, string $postalCode, string $city)
    {
        $this->street     = self::requirePart($street, 160, 'Die Straße');
        $this->postalCode = self::requirePart($postalCode, 10, 'Die Postleitzahl');
        $this->city       = self::requirePart($city, 100, 'Der Ort');
    }

    public function toSingleLine(): string
    {
        return $this->street . ', ' . $this->postalCode . ' ' . $this->city;
    }

    private static function requirePart(string $value, int $maxLength, string $label): string
    {
        $value = trim($value);
        if ($value === '') {
            throw new InvalidArgumentException($label . ' darf nicht leer sein.');
        }
        if (mb_strlen($value) > $maxLength) {
            throw new InvalidArgumentException($label . ' ist zu lang.');
        }
        return $value;
    }
}
