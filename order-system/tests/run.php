<?php
declare(strict_types=1);

/**
 * Test-Runner ohne Abhängigkeiten.
 *
 * Findet tests/ ** / *Test.php, instanziiert jede Klasse und ruft jede
 * öffentliche Methode auf, deren Name mit "test" beginnt. Exit-Code 1,
 * sobald ein Test fehlschlägt.
 *
 * Aufruf:  php order-system/tests/run.php
 */

require __DIR__ . '/../autoload.php';
require __DIR__ . '/Assert.php';

use Tests\AssertionFailed;

$root = __DIR__;
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
$testFiles = [];
foreach ($files as $file) {
    if ($file->isFile() && str_ends_with($file->getFilename(), 'Test.php')) {
        $testFiles[] = $file->getPathname();
    }
}
sort($testFiles);

$passed = 0;
$failures = [];

foreach ($testFiles as $path) {
    $before = get_declared_classes();
    require_once $path;
    $new = array_diff(get_declared_classes(), $before);

    foreach ($new as $class) {
        if (!str_ends_with($class, 'Test')) {
            continue;
        }
        $instance = new $class();
        foreach (get_class_methods($instance) as $method) {
            if (!str_starts_with($method, 'test')) {
                continue;
            }
            try {
                $instance->$method();
                $passed++;
                echo '.';
            } catch (AssertionFailed $e) {
                $failures[] = [$class, $method, $e->getMessage()];
                echo 'F';
            } catch (\Throwable $e) {
                $failures[] = [$class, $method, 'Unerwartete Ausnahme: '
                    . get_class($e) . ' — ' . $e->getMessage()];
                echo 'E';
            }
        }
    }
}

echo PHP_EOL, PHP_EOL;

foreach ($failures as [$class, $method, $message]) {
    echo 'FEHLGESCHLAGEN  ', $class, '::', $method, PHP_EOL,
         '                ', $message, PHP_EOL, PHP_EOL;
}

printf(
    "%d Tests, %d erfolgreich, %d fehlgeschlagen%s",
    $passed + count($failures),
    $passed,
    count($failures),
    PHP_EOL
);

exit($failures === [] ? 0 : 1);
