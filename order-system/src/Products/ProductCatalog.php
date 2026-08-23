<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Products;

use Buschmann\OrderSystem\Shared\InvalidArgumentException;

/**
 * Die Produkte, mit denen gerechnet werden darf.
 *
 * Dieser Typ ist Teil des Sicherheitsmodells, nicht bloß eine Sammlung: Er
 * ist die EINZIGE Quelle, aus der Order::place() Preise nimmt. Ein Preis,
 * der nicht aus einem Katalog stammt, kommt in keine Bestellung. Deshalb
 * heißt die Klasse so, wie sie heißt — man soll am Typ ablesen können,
 * woher der Preis kommt.
 *
 * Aufgebaut wird der Katalog in Phase 2 aus einer Datenbankabfrage.
 */
final class ProductCatalog
{
    /** @param array<int, Product> $byId */
    private function __construct(private readonly array $byId)
    {
    }

    /** @param Product[] $products */
    public static function fromList(array $products): self
    {
        $byId = [];
        foreach ($products as $product) {
            if (isset($byId[$product->id])) {
                throw new InvalidArgumentException('Der Produktkatalog enthält eine doppelte Produkt-ID.');
            }
            $byId[$product->id] = $product;
        }
        return new self($byId);
    }

    public function find(int $id): ?Product
    {
        return $this->byId[$id] ?? null;
    }

    public function get(int $id): Product
    {
        return $this->find($id)
            ?? throw new InvalidArgumentException('Das Produkt ist nicht im Katalog enthalten.');
    }

    /**
     * Das vollständige bestellbare Sortiment in Anzeigereihenfolge.
     * Entspricht genau dem Index (is_active, sort_order, id) auf products.
     *
     * @return Product[]
     */
    public function orderable(): array
    {
        $active = array_values(array_filter(
            $this->byId,
            static fn (Product $p) => $p->isActive
        ));

        usort($active, static fn (Product $a, Product $b) =>
            [$a->sortOrder, $a->id] <=> [$b->sortOrder, $b->id]);

        return $active;
    }

    public function count(): int
    {
        return count($this->byId);
    }
}
