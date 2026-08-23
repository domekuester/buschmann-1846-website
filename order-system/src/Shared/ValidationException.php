<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Fehlerhafte Nutzereingabe. Trägt eine Zuordnung Feldname → Meldung, damit
 * eine spätere Oberfläche den Hinweis an das richtige Feld heften kann.
 * Es werden immer ALLE Fehler gesammelt, nie nur der erste.
 */
final class ValidationException extends DomainException
{
    /** @var array<string, string> */
    private array $errors;

    /** @param array<string, string> $errors */
    public function __construct(
        array $errors,
        string $message = 'Die Eingabe ist unvollständig oder fehlerhaft.'
    ) {
        parent::__construct($message);
        $this->errors = $errors;
    }

    public static function field(string $field, string $message): self
    {
        return new self([$field => $message]);
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function hasError(string $field): bool
    {
        return isset($this->errors[$field]);
    }
}
