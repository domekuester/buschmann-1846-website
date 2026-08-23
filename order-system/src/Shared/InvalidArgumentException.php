<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Eine Invariante wurde verletzt. Das ist ein Programmierfehler, keine
 * Nutzereingabe — die Eingabeprüfung hätte vorher greifen müssen.
 */
class InvalidArgumentException extends DomainException
{
}
