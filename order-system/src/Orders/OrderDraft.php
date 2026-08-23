<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Shared\ValidationException;

/**
 * Der geprüfte Inhalt einer Bestellanfrage.
 *
 * DIESE KLASSE HAT KEIN PREISFELD — und das ist ihr eigentlicher Zweck.
 * Ein mitgesendeter Betrag wird nicht „geprüft und verworfen", er wird gar
 * nicht erst gelesen. Aus dem Anfrage-Array kommen ausschließlich
 * fulfillment_type, fulfillment_date, note sowie items mit je product_id und
 * quantity. Alles Weitere fällt weg, egal wie es heißt.
 *
 * Es werden immer ALLE Fehler gesammelt statt beim ersten abzubrechen: Ein
 * Café soll nicht fünfmal absenden müssen, um fünf Hinweise zu bekommen.
 *
 * Menge 0 ist KEIN Fehler, sondern „nicht bestellt". Die Bestellseite sendet
 * jedes Produkt mit; die meisten stehen auf 0. Eine negative oder nicht
 * ganzzahlige Menge ist dagegen sehr wohl ein Fehler.
 */
final class OrderDraft
{
    public const MAX_ITEMS = 200;

    /** @param array<int, array{product_id: int, quantity: int}> $items */
    private function __construct(
        public readonly FulfillmentType $fulfillmentType,
        public readonly FulfillmentDate $fulfillmentDate,
        public readonly ?string $note,
        public readonly array $items,
    ) {
    }

    /** @param array<mixed> $input */
    public static function fromInput(array $input, \DateTimeImmutable $now): self
    {
        $errors = [];

        $type    = null;
        $rawType = $input['fulfillment_type'] ?? null;
        if (!is_string($rawType) || ($type = FulfillmentType::tryFrom($rawType)) === null) {
            $errors['fulfillment_type'] = 'Bitte Lieferung oder Abholung auswählen.';
        }

        $date    = null;
        $rawDate = $input['fulfillment_date'] ?? null;
        if (!is_string($rawDate)) {
            $errors['fulfillment_date'] = 'Bitte einen Liefer- oder Abholtag angeben.';
        } else {
            try {
                $date = FulfillmentDate::fromString($rawDate, $now);
            } catch (ValidationException $e) {
                $errors += $e->errors();
            }
        }

        $note    = null;
        $rawNote = $input['note'] ?? null;
        if ($rawNote !== null && !is_string($rawNote)) {
            $errors['note'] = 'Die Notiz ist ungültig.';
        } elseif (is_string($rawNote)) {
            $note = trim($rawNote);
            if (mb_strlen($note) > 500) {
                $errors['note'] = 'Die Notiz ist zu lang (höchstens 500 Zeichen).';
            }
            if ($note === '') {
                $note = null;
            }
        }

        $items = self::readItems($input['items'] ?? null, $errors);

        if ($errors !== []) {
            throw new ValidationException($errors);
        }

        return new self($type, $date, $note, $items);
    }

    /**
     * @param array<string, string> $errors wird per Referenz ergänzt
     * @return array<int, array{product_id: int, quantity: int}>
     */
    private static function readItems(mixed $raw, array &$errors): array
    {
        if (!is_array($raw)) {
            $errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
            return [];
        }
        if (count($raw) > self::MAX_ITEMS) {
            $errors['items'] = 'Die Bestellung enthält zu viele Positionen.';
            return [];
        }

        $items         = [];
        $seen          = [];
        $hadItemErrors = false;

        foreach (array_values($raw) as $index => $rawItem) {
            $prefix = 'items.' . $index . '.';

            if (!is_array($rawItem)) {
                $errors[$prefix . 'product_id'] = 'Die Position ist ungültig.';
                $hadItemErrors = true;
                continue;
            }

            $productId = self::readPositiveInt($rawItem['product_id'] ?? null);
            $duplicate = $productId !== null && isset($seen[$productId]);
            if ($productId === null) {
                $errors[$prefix . 'product_id'] = 'Das Produkt ist ungültig.';
                $hadItemErrors = true;
            } elseif ($duplicate) {
                $errors[$prefix . 'product_id'] = 'Dieses Produkt kommt mehrfach vor.';
                $hadItemErrors = true;
            }

            $quantity = self::readNonNegativeInt($rawItem['quantity'] ?? null);
            if ($quantity === null) {
                $errors[$prefix . 'quantity'] = 'Die Menge muss eine ganze Zahl ab 0 sein.';
                $hadItemErrors = true;
            } elseif ($quantity > OrderItem::MAX_QUANTITY) {
                $errors[$prefix . 'quantity'] = 'Die Menge ist unplausibel hoch.';
                $hadItemErrors = true;
            }

            if ($productId === null || $quantity === null || $duplicate) {
                continue;
            }

            $seen[$productId] = true;

            // Menge 0 heißt „nicht bestellt" und fällt hier weg.
            if ($quantity > 0) {
                $items[] = ['product_id' => $productId, 'quantity' => $quantity];
            }
        }

        // Der allgemeine Hinweis nur, wenn nicht ohnehin schon Positionsfehler
        // gemeldet werden — sonst bekäme das Café zwei Meldungen für dasselbe.
        if ($items === [] && !$hadItemErrors && !isset($errors['items'])) {
            $errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
        }

        return $items;
    }

    private static function readPositiveInt(mixed $value): ?int
    {
        $int = self::readNonNegativeInt($value);
        return ($int === null || $int === 0) ? null : $int;
    }

    /** Akzeptiert int und reine Ziffernstrings — Formularwerte kommen als String an. */
    private static function readNonNegativeInt(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 ? $value : null;
        }
        if (is_string($value) && preg_match('/^\d+$/', $value) === 1) {
            return (int) $value;
        }
        return null;
    }
}
