<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;

/**
 * Eine Position einer Bestellung.
 *
 * Der Konstruktor nimmt den Positionsbetrag NICHT entgegen — er berechnet
 * ihn. Es gibt damit im gesamten Code keinen Weg, einen abweichenden Betrag
 * zu setzen; auch nicht versehentlich, auch nicht durch einen späteren
 * Entwickler. Das ist der Unterschied zwischen einer Regel, die man einhalten
 * soll, und einer, die man nicht brechen kann.
 *
 * Name, Einheit und Preis sind Snapshots zum Bestellzeitpunkt. Ändert sich
 * das Produkt später, bleibt diese Position unverändert — eine Bestellung
 * ist ein Dokument, keine Sicht auf den aktuellen Stammdatenbestand.
 *
 * Die Menge ist ganzzahlig: Ein Café bestellt drei Bleche oder zwölf Stück,
 * keine 2,4 Stück. Wird je nach Gewicht bestellt, ist das ein eigenes
 * Produkt mit der Einheit „kg".
 */
final class OrderItem
{
    public const MAX_QUANTITY = 9_999;

    public readonly string $productNameSnapshot;
    public readonly string $productUnitSnapshot;
    public readonly Money $lineTotal;

    public function __construct(
        public readonly ?int $id,
        public readonly int $productId,
        string $productNameSnapshot,
        string $productUnitSnapshot,
        public readonly Money $unitPrice,
        public readonly int $quantity,
    ) {
        if ($productId <= 0) {
            throw new InvalidArgumentException('Die Produkt-ID der Position ist ungültig.');
        }
        if ($quantity < 1) {
            throw new InvalidArgumentException('Die Menge muss größer als 0 sein.');
        }
        if ($quantity > self::MAX_QUANTITY) {
            throw new InvalidArgumentException('Die Menge ist unplausibel hoch.');
        }

        $name = trim($productNameSnapshot);
        if ($name === '' || mb_strlen($name) > 120) {
            throw new InvalidArgumentException('Der Produktname der Position fehlt oder ist zu lang.');
        }
        $this->productNameSnapshot = $name;

        $unit = trim($productUnitSnapshot);
        if ($unit === '' || mb_strlen($unit) > 20) {
            throw new InvalidArgumentException('Die Einheit der Position fehlt oder ist zu lang.');
        }
        $this->productUnitSnapshot = $unit;

        $this->lineTotal = $unitPrice->multipliedBy($quantity);
    }

    public static function forProduct(Product $product, int $quantity): self
    {
        return new self(
            null,
            $product->id,
            $product->name,
            $product->unit,
            $product->unitPrice,
            $quantity,
        );
    }

    public function withId(int $id): self
    {
        return new self(
            $id,
            $this->productId,
            $this->productNameSnapshot,
            $this->productUnitSnapshot,
            $this->unitPrice,
            $this->quantity,
        );
    }
}
