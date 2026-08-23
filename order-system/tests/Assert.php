<?php
declare(strict_types=1);

namespace Tests;

final class AssertionFailed extends \Exception
{
}

/**
 * Minimale Assertions. Absichtlich klein: Jede zusätzliche Assertion ist
 * eine Konvention, die ein späterer Leser erst lernen muss.
 */
final class Assert
{
    public static function same(mixed $expected, mixed $actual, string $what): void
    {
        if ($expected !== $actual) {
            throw new AssertionFailed(sprintf(
                '%s: erwartet %s, erhalten %s',
                $what,
                self::describe($expected),
                self::describe($actual)
            ));
        }
    }

    public static function true(bool $actual, string $what): void
    {
        self::same(true, $actual, $what);
    }

    public static function false(bool $actual, string $what): void
    {
        self::same(false, $actual, $what);
    }

    public static function null(mixed $actual, string $what): void
    {
        self::same(null, $actual, $what);
    }

    public static function notNull(mixed $actual, string $what): void
    {
        if ($actual === null) {
            throw new AssertionFailed($what . ': erwartet einen Wert, erhalten null');
        }
    }

    /** @param array<mixed> $actual */
    public static function count(int $expected, array $actual, string $what): void
    {
        self::same($expected, count($actual), $what . ' (Anzahl)');
    }

    /**
     * Prüft, dass $fn eine Ausnahme der Klasse $class wirft, und gibt sie
     * zurück, damit der Test die Meldung oder die Felder weiter prüfen kann.
     */
    public static function throws(string $class, callable $fn, string $what): \Throwable
    {
        try {
            $fn();
        } catch (AssertionFailed $e) {
            throw $e;
        } catch (\Throwable $e) {
            if (!$e instanceof $class) {
                throw new AssertionFailed(sprintf(
                    '%s: erwartet %s, erhalten %s (%s)',
                    $what, $class, get_class($e), $e->getMessage()
                ));
            }
            return $e;
        }
        throw new AssertionFailed($what . ': erwartet ' . $class . ', es wurde nichts geworfen');
    }

    private static function describe(mixed $v): string
    {
        return match (true) {
            is_string($v) => '"' . $v . '"',
            is_bool($v)   => $v ? 'true' : 'false',
            is_null($v)   => 'null',
            is_scalar($v) => (string) $v,
            is_array($v)  => 'array(' . count($v) . ')',
            is_object($v) => get_class($v),
            default       => gettype($v),
        };
    }
}
