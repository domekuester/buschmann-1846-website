<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Products;

use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;

/**
 * Ein bestellbares Produkt. Stammdatum: Es wird geladen, existiert also
 * bereits und hat eine ID.
 *
 * Produkte werden nie gelöscht, sondern über isActive deaktiviert — sonst
 * verlören historische Bestellungen ihren Fremdschlüssel. Varianten,
 * Kategorien, SKU und Bilder sind ausdrücklich nicht Teil des Modells.
 */
final class Product
{
    public readonly string $name;
    public readonly ?string $description;
    public readonly string $unit;

    public function __construct(
        public readonly int $id,
        string $name,
        ?string $description,
        public readonly Money $unitPrice,
        string $unit,
        public readonly bool $isActive,
        public readonly int $sortOrder,
    ) {
        if ($id <= 0) {
            throw new InvalidArgumentException('Die Produkt-ID ist ungültig.');
        }
        if ($sortOrder < 0) {
            throw new InvalidArgumentException('Die Sortierreihenfolge darf nicht negativ sein.');
        }

        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 120) {
            throw new InvalidArgumentException('Der Produktname fehlt oder ist zu lang.');
        }
        $this->name = $name;

        $unit = trim($unit);
        if ($unit === '' || mb_strlen($unit) > 20) {
            throw new InvalidArgumentException('Die Einheit fehlt oder ist zu lang.');
        }
        $this->unit = $unit;

        $description = $description === null ? null : trim($description);
        if ($description !== null && mb_strlen($description) > 500) {
            throw new InvalidArgumentException('Die Beschreibung ist zu lang.');
        }
        $this->description = ($description === null || $description === '') ? null : $description;
    }
}
