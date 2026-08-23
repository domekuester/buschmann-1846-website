<?php
declare(strict_types=1);

/**
 * Vorlage für order-system/config/config.php.
 *
 * config.php ist gitignored und gehört NIEMALS ins Repository.
 * Auf dem Server liegt diese Datei oberhalb des Web-Roots.
 *
 * In Phase 1 wird noch keine Datenbankverbindung aufgebaut; die Werte
 * beschreiben, was Phase 2 erwartet.
 */
return [
    'db' => [
        'host'     => 'localhost',
        'name'     => 'DATENBANKNAME',
        'user'     => 'BENUTZERNAME',
        'password' => 'PASSWORT',
        'charset'  => 'utf8mb4',
    ],
    // Absoluter Pfad außerhalb des Web-Roots.
    'log_file'  => __DIR__ . '/../var/log/order-system.log',
    // In Produktion zwingend false: keine Fehlerdetails im Browser.
    'debug'     => false,
];
