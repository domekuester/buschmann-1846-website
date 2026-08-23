<?php
declare(strict_types=1);

/**
 * PSR-4-Autoloader für Buschmann\OrderSystem\ → order-system/src/.
 *
 * Bewusst ohne Composer: Das Subsystem hat keine einzige Drittabhängigkeit,
 * und ein vendor/-Verzeichnis müsste bei jedem SFTP-Deployment mitgehen.
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'Buschmann\\OrderSystem\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});
