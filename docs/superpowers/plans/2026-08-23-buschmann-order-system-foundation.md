# Buschmann Bestellsystem — Phase 1 Foundation, Implementierungsplan

> ## ⚠️ HISTORISCHES DOKUMENT — ÜBERHOLT AM 2026-08-24
>
> Dieses Dokument beschreibt die **PHP-/MariaDB-Fassung** des Bestellsystems.
> Diese Plattform wurde aufgegeben. Der Domänenkern wurde nach TypeScript
> portiert und läuft jetzt auf Cloudflare Workers mit Cloudflare D1.
>
> **Gültig ist stattdessen:**
> `docs/superpowers/specs/2026-08-24-buschmann-order-system-cloudflare-design.md`
>
> Das Dokument bleibt erhalten, weil die **fachlichen** Festlegungen darin
> unverändert gelten — Preis-Snapshots, serverseitige Preisbildung, die zwei
> Fulfillment-Arten, die fünf Statuswerte, Datenminimierung beim Kunden. Was
> nicht mehr gilt, ist alles Technische: PHP, MariaDB, DECIMAL(10,2),
> .htaccess, klassisches Webhosting, der eigene Test-Runner.

> **Für agentische Bearbeitung:** ERFORDERLICHE SUB-SKILL:
> `superpowers:subagent-driven-development` (empfohlen) oder
> `superpowers:executing-plans`, um diesen Plan Task für Task umzusetzen.
> Schritte tragen Checkbox-Syntax (`- [ ]`) zur Nachverfolgung.

**Ziel:** Ein persistenzfreier, vollständig getesteter Domänenkern für das
B2B-Vorbestellsystem von Buschmann 1846, plus das MariaDB-Schema, auf dem
Phase 2 aufsetzen kann.

**Architektur:** Vanilla PHP 8.1 ohne jede Drittabhängigkeit. Vier Module
(`Shared`, `Products`, `Customers`, `Orders`) mit gerichteter Abhängigkeit auf
`Shared`. Entities erzwingen ihre Invarianten im Konstruktor und sind
`readonly`; Preise entstehen ausschließlich aus einem serverseitig geladenen
`ProductCatalog`. Datenbankschema als nummerierte `.sql`-Migrationen, ohne
Zugriffsschicht.

**Tech Stack:** PHP 8.1+ (nur Standardbibliothek), eigener PSR-4-Autoloader,
eigener Test-Runner, MariaDB 10.x / MySQL 8.x, Apache `.htaccess`.

**Spec:** `docs/superpowers/specs/2026-08-23-buschmann-order-system-foundation-design.md`

---

## Global Constraints

Diese gelten für **jeden** Task, ohne Wiederholung:

- **Branch:** ausschließlich `feature/order-system-foundation`. Kein Merge,
  kein Force-Push, kein History-Rewrite.
- **Die bestehende Website wird nicht angefasst.** Keine Änderung an
  `index.html`, `en/`, `assets/`, `impressum/`, `datenschutz/`, `sitemap.xml`,
  `robots.txt`, `.nojekyll`, `README.md` im Repo-Root.
- **Alle neuen Dateien** liegen unter `order-system/` oder
  `docs/superpowers/`.
- **PHP-Mindestversion 8.1.** `declare(strict_types=1);` als erste Anweisung
  in **jeder** PHP-Datei.
- **Namespace-Wurzel:** `Buschmann\OrderSystem\`, abgebildet auf
  `order-system/src/`. Verzeichnisnamen in `StudlyCase`.
- **Keine Abhängigkeit** außerhalb der PHP-Standardbibliothek. Kein Composer,
  kein `vendor/`, kein npm, kein SaaS, keine Zahlungsanbindung.
- **Kein Geheimnis im Repository.** `order-system/config/config.php` ist
  gitignored.
- **Geld** ist immer `Money` (ganzzahlige Cent). Nie `float`, nie `floatval`,
  nie `round()` auf Geldbeträge.
- **Fehlermeldungen** sind deutsche, anzeigbare Sätze ohne Klassennamen,
  Dateipfade oder Spaltennamen.
- **Testkommando** nach jedem Task: `php order-system/tests/run.php`
- **Syntaxprüfung** nach jedem Task:
  `find order-system -name '*.php' -exec php -l {} \; | grep -v 'No syntax errors'`
  — erwartete Ausgabe: leer.
- **Vor jedem Commit:** `git status` und `git diff --stat` prüfen; es darf
  keine Datei außerhalb von `order-system/` und `docs/superpowers/`
  auftauchen.

**Voraussetzung:** PHP 8.1+ muss lokal installiert sein
(`brew install php`). Ohne Interpreter ist kein Task abschließbar, weil jeder
Task mit einem belegten Testlauf endet.

---

## Dateistruktur

Was am Ende von Phase 1 existiert und wofür jede Datei zuständig ist:

```
order-system/
├── README.md                          Subsystem-Einstieg (Task 14)
├── .htaccess                          Grundschutz (Task 1)
├── autoload.php                       PSR-4-Autoloader (Task 1)
├── config/
│   ├── .htaccess                      Require all denied (Task 1)
│   └── config.example.php             Platzhalter-Konfiguration (Task 1)
├── database/
│   ├── .htaccess                      Require all denied (Task 1)
│   ├── README.md                      Anwendung der Migrationen (Task 12)
│   ├── migrations/
│   │   ├── 001_create_schema_migrations.sql
│   │   ├── 002_create_customers.sql
│   │   ├── 003_create_products.sql
│   │   ├── 004_create_orders.sql
│   │   ├── 005_create_order_items.sql
│   │   └── 006_create_order_number_sequences.sql
│   └── seeds/
│       ├── 001_products_placeholder.sql
│       └── 002_customers_placeholder.sql
├── src/
│   ├── .htaccess                      Require all denied (Task 1)
│   ├── Shared/
│   │   ├── DomainException.php        Basis aller Domänenfehler (Task 1)
│   │   ├── InvalidArgumentException.php  Invariante verletzt (Task 1)
│   │   ├── ValidationException.php    Feld → Meldung (Task 1)
│   │   ├── Money.php                  Ganzzahlige Cent, DECIMAL-Brücke (Task 2)
│   │   └── Address.php                Straße, PLZ, Ort (Task 3)
│   ├── Products/
│   │   ├── Product.php                Stammdatum Produkt (Task 4)
│   │   └── ProductCatalog.php         Die vertrauenswürdige Preisquelle (Task 9)
│   ├── Customers/
│   │   └── Customer.php               Stammdatum Kunde (Task 6)
│   └── Orders/
│       ├── FulfillmentType.php        Enum delivery|pickup (Task 5)
│       ├── FulfillmentDate.php        Datum ohne Uhrzeit (Task 5)
│       ├── OrderStatus.php            Enum + Übergangsregeln (Task 7)
│       ├── OrderNumber.php            BUS-JJJJ-NNNNNN (Task 8)
│       ├── OrderItem.php              Position mit Snapshot (Task 10)
│       ├── OrderDraft.php             Eingabe-Whitelist, preisfrei (Task 11)
│       └── Order.php                  Aggregat, Preislogik, Status (Task 12)
└── tests/
    ├── .htaccess                      Require all denied (Task 1)
    ├── run.php                        Test-Runner (Task 1)
    ├── Assert.php                     Assertion-Helfer (Task 1)
    ├── Shared/MoneyTest.php · AddressTest.php
    ├── Products/ProductTest.php · ProductCatalogTest.php
    ├── Customers/CustomerTest.php
    └── Orders/FulfillmentTypeTest.php · FulfillmentDateTest.php ·
        OrderStatusTest.php · OrderNumberTest.php · OrderItemTest.php ·
        OrderDraftTest.php · OrderTest.php
```

`src/Delivery/` wird **nicht** angelegt — Begründung in §6.3 der Spec.
Die vorhandenen `.gitkeep`-Dateien in Verzeichnissen, die echten Inhalt
bekommen, werden entfernt; in `public/` und `admin/` bleiben sie, weil diese
Verzeichnisse erst in Phase 2 gefüllt werden.

---

## Task 1: Fundament — Autoloader, Fehlertypen, Test-Runner, Zugriffsschutz

Ohne diesen Task ist kein weiterer Task testbar. Er endet deshalb mit einem
Testlauf, der einen absichtlich fehlschlagenden und einen erfolgreichen Test
zeigt.

**Files:**
- Create: `order-system/autoload.php`
- Create: `order-system/src/Shared/DomainException.php`
- Create: `order-system/src/Shared/InvalidArgumentException.php`
- Create: `order-system/src/Shared/ValidationException.php`
- Create: `order-system/tests/Assert.php`
- Create: `order-system/tests/run.php`
- Create: `order-system/.htaccess`, `order-system/src/.htaccess`,
  `order-system/config/.htaccess`, `order-system/database/.htaccess`,
  `order-system/tests/.htaccess`
- Create: `order-system/config/config.example.php`
- Modify: `.gitignore` (eine Zeile anfügen)
- Delete: `order-system/src/*/.gitkeep`, `order-system/src/delivery/`,
  `order-system/tests/.gitkeep`, `order-system/config/.gitkeep`,
  `order-system/database/*/.gitkeep`

**Interfaces:**
- Produces:
  - `Buschmann\OrderSystem\Shared\DomainException extends \RuntimeException`
  - `Buschmann\OrderSystem\Shared\InvalidArgumentException extends DomainException`
  - `Buschmann\OrderSystem\Shared\ValidationException extends DomainException`
    mit `__construct(array $errors, string $message = 'Die Eingabe ist unvollständig oder fehlerhaft.')`,
    `errors(): array` (Feld → Meldung), `static field(string $field, string $message): self`
  - `Tests\Assert` mit statischen Methoden `same`, `true`, `false`, `null`,
    `notNull`, `count`, `throws`
  - Runner: `php order-system/tests/run.php` → Exit-Code 0 oder 1

- [ ] **Schritt 1: Aufräumen der vorbereiteten Struktur**

```bash
cd /Users/dominikkuster/Desktop/buschmann-1846-rebuild
rm -rf order-system/src/delivery
rm -f order-system/src/orders/.gitkeep order-system/src/products/.gitkeep \
      order-system/src/customers/.gitkeep order-system/src/shared/.gitkeep \
      order-system/tests/.gitkeep order-system/config/.gitkeep \
      order-system/database/migrations/.gitkeep order-system/database/seeds/.gitkeep \
      order-system/docs/.gitkeep
rmdir order-system/src/orders order-system/src/products \
      order-system/src/customers order-system/src/shared order-system/docs 2>/dev/null
mkdir -p order-system/src/Shared order-system/src/Products \
         order-system/src/Customers order-system/src/Orders \
         order-system/tests/Shared order-system/tests/Products \
         order-system/tests/Customers order-system/tests/Orders
```

`order-system/docs/` entfällt: Die Dokumentation liegt in
`docs/superpowers/` und in der README des Subsystems. Zwei
Dokumentationsorte für dasselbe Subsystem sind eine Quelle für Widersprüche.

- [ ] **Schritt 2: Autoloader schreiben**

`order-system/autoload.php`:

```php
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
```

- [ ] **Schritt 3: Fehlerhierarchie schreiben**

`order-system/src/Shared/DomainException.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/** Basis aller fachlichen Fehler des Bestellsystems. */
class DomainException extends \RuntimeException
{
}
```

`order-system/src/Shared/InvalidArgumentException.php`:

```php
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
```

`order-system/src/Shared/ValidationException.php`:

```php
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
```

- [ ] **Schritt 4: Assertion-Helfer schreiben**

`order-system/tests/Assert.php`:

```php
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
            // Eine Assertion INNERHALB des Callables ist ein Testfehler und
            // darf nicht als "erwartete Ausnahme" durchgehen.
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
```

- [ ] **Schritt 5: Test-Runner schreiben**

`order-system/tests/run.php`:

```php
<?php
declare(strict_types=1);

/**
 * Test-Runner ohne Abhängigkeiten.
 *
 * Findet tests/**\/*Test.php, instanziiert jede Klasse und ruft jede
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
```

- [ ] **Schritt 6: Runner mit einem absichtlich fehlschlagenden Test prüfen**

Temporär anlegen — `order-system/tests/Shared/RunnerSmokeTest.php`:

```php
<?php
declare(strict_types=1);

use Tests\Assert;

final class RunnerSmokeTest
{
    public function testPasses(): void
    {
        Assert::same(2, 1 + 1, 'Addition');
    }

    public function testFailsOnPurpose(): void
    {
        Assert::same(3, 1 + 1, 'Absichtlicher Fehlschlag');
    }
}
```

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `.F`, ein Fehlerblock für `testFailsOnPurpose`, Zeile
`2 Tests, 1 erfolgreich, 1 fehlgeschlagen`, `Exit=1`.

Damit ist belegt, dass der Runner Fehlschläge **tatsächlich meldet** — ein
Runner, der immer grün ist, ist schlimmer als keiner.

- [ ] **Schritt 7: Fehlschlagenden Test korrigieren und Grünlauf prüfen**

`Assert::same(3, 1 + 1, …)` → `Assert::same(2, 1 + 1, 'Addition ohne Fehler');`

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `..`, `2 Tests, 2 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

Danach die Datei löschen: `rm order-system/tests/Shared/RunnerSmokeTest.php`

- [ ] **Schritt 8: Zugriffsschutz und Konfigurationsvorlage**

`order-system/src/.htaccess`, `order-system/config/.htaccess`,
`order-system/database/.htaccess`, `order-system/tests/.htaccess` — jeweils
identisch:

```apache
# Kein direkter HTTP-Zugriff auf dieses Verzeichnis.
# Zweite Verteidigungslinie: Im korrekten Deployment liegt nur public/
# im Web-Root, dieses Verzeichnis also ohnehin darüber.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

`order-system/.htaccess`:

```apache
# Falls order-system/ versehentlich im Web-Root landet: nichts ausliefern.
# Der Document Root muss auf order-system/public/ zeigen, nicht hierher.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

`order-system/config/config.example.php`:

```php
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
```

`.gitignore` — folgende Zeilen am Ende anfügen:

```
# Bestellsystem: Zugangsdaten und Laufzeitdaten
order-system/config/config.php
order-system/var/
```

- [ ] **Schritt 9: Prüfen, dass die Website unberührt ist**

```bash
git status --short
git diff --stat -- index.html en assets impressum datenschutz sitemap.xml robots.txt README.md
```
Erwartet: Der zweite Befehl gibt **nichts** aus. `git status` zeigt nur
`.gitignore` als geändert und `order-system/`, `docs/` als neu.

- [ ] **Schritt 10: Commit**

```bash
git add .gitignore order-system docs/superpowers
git commit -m "feat(order-system): Fundament — Autoloader, Fehlertypen, Test-Runner, Zugriffsschutz"
```

---

## Task 2: `Money` — exakte Geldarithmetik

Der wichtigste Baustein. Wenn er falsch ist, ist jede Bestellsumme falsch.

**Files:**
- Create: `order-system/src/Shared/Money.php`
- Test: `order-system/tests/Shared/MoneyTest.php`

**Interfaces:**
- Consumes: `Buschmann\OrderSystem\Shared\InvalidArgumentException` (Task 1)
- Produces: `Buschmann\OrderSystem\Shared\Money` mit
  `public readonly int $cents` ·
  `static fromCents(int $cents): self` ·
  `static fromDecimalString(string $amount): self` ·
  `static zero(): self` ·
  `plus(Money $other): self` ·
  `multipliedBy(int $factor): self` ·
  `equals(Money $other): bool` ·
  `isZero(): bool` ·
  `toDecimalString(): string` ·
  `public const MAX_CENTS = 9_999_999_999`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Shared/MoneyTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class MoneyTest
{
    public function testCentsAreStoredExactly(): void
    {
        Assert::same(1499, Money::fromCents(1499)->cents, 'Cent-Wert');
        Assert::same(0, Money::zero()->cents, 'Null-Betrag');
    }

    public function testParsesDecimalStringsFromTheDatabase(): void
    {
        Assert::same(1499, Money::fromDecimalString('14.99')->cents, '14.99');
        Assert::same(1490, Money::fromDecimalString('14.9')->cents, '14.9');
        Assert::same(1500, Money::fromDecimalString('15')->cents, '15');
        Assert::same(5, Money::fromDecimalString('0.05')->cents, '0.05');
        Assert::same(0, Money::fromDecimalString('0.00')->cents, '0.00');
    }

    public function testFormatsForTheDatabaseWithTwoDecimals(): void
    {
        Assert::same('14.99', Money::fromCents(1499)->toDecimalString(), '1499 Cent');
        Assert::same('15.00', Money::fromCents(1500)->toDecimalString(), '1500 Cent');
        Assert::same('0.05', Money::fromCents(5)->toDecimalString(), '5 Cent');
        Assert::same('0.00', Money::zero()->toDecimalString(), '0 Cent');
    }

    /** Regel 10: Die Umwandlung DECIMAL ↔ Cent verliert nichts. */
    public function testConversionIsLosslessInBothDirections(): void
    {
        foreach (['0.01', '0.10', '0.20', '0.30', '0.70', '1.15', '4.35',
                  '8.15', '19.99', '99.95', '1234.56'] as $value) {
            Assert::same(
                $value,
                Money::fromDecimalString($value)->toDecimalString(),
                'Hin- und Rückumwandlung von ' . $value
            );
        }
    }

    /** Regel 10: 0,10 € + 0,20 € ergibt exakt 0,30 € — mit float wäre es das nicht. */
    public function testAdditionIsExactWhereFloatWouldNotBe(): void
    {
        $sum = Money::fromDecimalString('0.10')->plus(Money::fromDecimalString('0.20'));
        Assert::same('0.30', $sum->toDecimalString(), 'Summe 0.10 + 0.20');
    }

    /** Regel 10: 3 × 4,35 € ergibt exakt 13,05 € — mit float 13,049999… */
    public function testMultiplicationByQuantityIsExact(): void
    {
        $total = Money::fromDecimalString('4.35')->multipliedBy(3);
        Assert::same('13.05', $total->toDecimalString(), '3 × 4.35');
    }

    /** Regel 10: Auch über viele Positionen entsteht keine Abweichung. */
    public function testSummingManySmallAmountsStaysExact(): void
    {
        $sum = Money::zero();
        for ($i = 0; $i < 100; $i++) {
            $sum = $sum->plus(Money::fromDecimalString('0.07'));
        }
        Assert::same('7.00', $sum->toDecimalString(), '100 × 0.07');
    }

    public function testRejectsNegativeAmounts(): void
    {
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromCents(-1),
            'negativer Cent-Betrag'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromDecimalString('-5.00'),
            'negative Dezimalzahl'
        );
    }

    public function testRejectsAmountsTheDatabaseColumnCannotHold(): void
    {
        Assert::same(
            Money::MAX_CENTS,
            Money::fromCents(Money::MAX_CENTS)->cents,
            'Obergrenze ist zulässig'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS + 1),
            'ein Cent über DECIMAL(10,2)'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS)->plus(Money::fromCents(1)),
            'Überlauf durch Addition'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromCents(Money::MAX_CENTS)->multipliedBy(2),
            'Überlauf durch Multiplikation'
        );
    }

    public function testRejectsMalformedDecimalStrings(): void
    {
        foreach (['14,99', '', ' ', 'abc', '14.999', '1e3', '14.', '.5'] as $bad) {
            Assert::throws(
                InvalidArgumentException::class,
                static fn () => Money::fromDecimalString($bad),
                'unzulässige Eingabe "' . $bad . '"'
            );
        }
    }

    public function testRejectsNegativeQuantities(): void
    {
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => Money::fromCents(100)->multipliedBy(-1),
            'negativer Faktor'
        );
    }

    public function testEqualityComparesValueNotIdentity(): void
    {
        Assert::true(Money::fromCents(1499)->equals(Money::fromDecimalString('14.99')), 'gleicher Betrag');
        Assert::false(Money::fromCents(1499)->equals(Money::fromCents(1500)), 'anderer Betrag');
        Assert::true(Money::zero()->isZero(), 'Null erkannt');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Jeder Test schlägt mit `Unerwartete Ausnahme: Error — Class
"Buschmann\OrderSystem\Shared\Money" not found` fehl, Exit-Code 1.

- [ ] **Schritt 3: `Money` implementieren**

`order-system/src/Shared/Money.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Geldbetrag als ganzzahlige Cent.
 *
 * PHP kennt keinen Dezimaltyp, und MariaDB liefert DECIMAL als String —
 * jede Rechnung damit würde still nach float konvertieren. Deshalb rechnet
 * die Domäne ausschließlich in Cent: unter Addition und Multiplikation mit
 * einer ganzzahligen Menge ist das exakt und rundungsfrei.
 *
 * Die Obergrenze entspricht exakt DECIMAL(10,2). Ein Betrag, den die
 * Datenbank abschneiden würde, scheitert damit schon hier.
 *
 * Es gibt bewusst KEINE Division. Sobald Prozentwerte (Umsatzsteuer, Rabatt)
 * gebraucht werden, wird die Rundungsregel an genau dieser Stelle ergänzt
 * und getestet — nicht verstreut an den Aufrufstellen.
 */
final class Money
{
    public const MAX_CENTS = 9_999_999_999; // 99.999.999,99 € = DECIMAL(10,2)

    private function __construct(public readonly int $cents)
    {
    }

    public static function fromCents(int $cents): self
    {
        if ($cents < 0) {
            throw new InvalidArgumentException('Ein Geldbetrag darf nicht negativ sein.');
        }
        if ($cents > self::MAX_CENTS) {
            throw new InvalidArgumentException('Der Geldbetrag ist zu groß.');
        }
        return new self($cents);
    }

    public static function zero(): self
    {
        return new self(0);
    }

    /**
     * Erwartet das Format, in dem MariaDB DECIMAL(10,2) liefert: Punkt als
     * Trennzeichen, kein Tausenderpunkt, kein Vorzeichen. Bewusst streng —
     * das Normalisieren von Nutzereingaben („14,99") ist Aufgabe der
     * Eingabeschicht, nicht dieser Datenbank-Brücke.
     *
     * Arbeitet ausschließlich mit Stringoperationen; es gibt hier kein
     * floatval, weil genau das der Fehler wäre, den diese Klasse verhindert.
     */
    public static function fromDecimalString(string $amount): self
    {
        if (preg_match('/^(\d{1,10})(?:\.(\d{1,2}))?$/', $amount, $m) !== 1) {
            throw new InvalidArgumentException('Der Betrag hat kein gültiges Format.');
        }
        $fraction = str_pad($m[2] ?? '', 2, '0', STR_PAD_RIGHT);

        return self::fromCents(((int) $m[1]) * 100 + (int) $fraction);
    }

    public function plus(self $other): self
    {
        return self::fromCents($this->cents + $other->cents);
    }

    public function multipliedBy(int $factor): self
    {
        if ($factor < 0) {
            throw new InvalidArgumentException('Der Faktor darf nicht negativ sein.');
        }
        if ($factor !== 0 && $this->cents > intdiv(self::MAX_CENTS, $factor)) {
            throw new InvalidArgumentException('Der Geldbetrag ist zu groß.');
        }
        return self::fromCents($this->cents * $factor);
    }

    public function equals(self $other): bool
    {
        return $this->cents === $other->cents;
    }

    public function isZero(): bool
    {
        return $this->cents === 0;
    }

    /** Format für DECIMAL(10,2) — immer zwei Nachkommastellen. */
    public function toDecimalString(): string
    {
        return intdiv($this->cents, 100) . '.'
            . str_pad((string) ($this->cents % 100), 2, '0', STR_PAD_LEFT);
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `11 Tests, 11 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Shared/Money.php order-system/tests/Shared/MoneyTest.php
git commit -m "feat(order-system): Money mit exakter Cent-Arithmetik und DECIMAL-Brücke"
```

---

## Task 3: `Address` — Lieferanschrift als Value Object

**Files:**
- Create: `order-system/src/Shared/Address.php`
- Test: `order-system/tests/Shared/AddressTest.php`

**Interfaces:**
- Produces: `Buschmann\OrderSystem\Shared\Address` mit
  `__construct(string $street, string $postalCode, string $city)` ·
  `public readonly string $street, $postalCode, $city` ·
  `toSingleLine(): string` — Format `"Straße, PLZ Ort"`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Shared/AddressTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class AddressTest
{
    public function testKeepsItsPartsAndTrimsThem(): void
    {
        $a = new Address('  Akademiestraße 8 ', ' 40213 ', ' Düsseldorf ');
        Assert::same('Akademiestraße 8', $a->street, 'Straße');
        Assert::same('40213', $a->postalCode, 'Postleitzahl');
        Assert::same('Düsseldorf', $a->city, 'Ort');
    }

    public function testRendersOneLineForTheOrderSnapshot(): void
    {
        $a = new Address('Akademiestraße 8', '40213', 'Düsseldorf');
        Assert::same('Akademiestraße 8, 40213 Düsseldorf', $a->toSingleLine(), 'Einzeiler');
    }

    public function testAllThreePartsAreRequired(): void
    {
        foreach ([['', '40213', 'Düsseldorf'], ['Straße 1', '', 'Düsseldorf'],
                  ['Straße 1', '40213', ''], ['   ', '40213', 'Düsseldorf']] as $parts) {
            Assert::throws(
                InvalidArgumentException::class,
                static fn () => new Address(...$parts),
                'unvollständige Adresse'
            );
        }
    }

    public function testRejectsOverlongParts(): void
    {
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => new Address(str_repeat('a', 161), '40213', 'Düsseldorf'),
            'zu lange Straße'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => new Address('Straße 1', str_repeat('1', 11), 'Düsseldorf'),
            'zu lange Postleitzahl'
        );
        Assert::throws(
            InvalidArgumentException::class,
            static fn () => new Address('Straße 1', '40213', str_repeat('a', 101)),
            'zu langer Ort'
        );
    }

    /**
     * Bewusst KEINE Formatprüfung: Eine PLZ-Regex im Domänenkern ist eine
     * klassische Überprüfungsfalle. Formathinweise gehören in die Eingabemaske.
     */
    public function testAcceptsNonGermanPostalCodeFormats(): void
    {
        $a = new Address('Rue de la Paix 1', '1211', 'Genève');
        Assert::same('1211', $a->postalCode, 'vierstellige Postleitzahl');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … Address not found`, Exit-Code 1.

- [ ] **Schritt 3: `Address` implementieren**

`order-system/src/Shared/Address.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Shared;

/**
 * Postanschrift. Alle drei Teile sind Pflicht, geprüft wird nur
 * Vorhandensein und Länge — nicht das Format. Adressformate sind
 * international uneinheitlich; eine Regex hier würde irgendwann eine gültige
 * Adresse ablehnen und dafür keinen Fehler verhindern.
 */
final class Address
{
    public readonly string $street;
    public readonly string $postalCode;
    public readonly string $city;

    public function __construct(string $street, string $postalCode, string $city)
    {
        // requirePart, nicht require: 'require' ist ein Sprachkonstrukt und
        // als self::require(...) nicht aufrufbar.
        $this->street     = self::requirePart($street, 160, 'Die Straße');
        $this->postalCode = self::requirePart($postalCode, 10, 'Die Postleitzahl');
        $this->city       = self::requirePart($city, 100, 'Der Ort');
    }

    public function toSingleLine(): string
    {
        return $this->street . ', ' . $this->postalCode . ' ' . $this->city;
    }

    private static function requirePart(string $value, int $maxLength, string $label): string
    {
        $value = trim($value);
        if ($value === '') {
            throw new InvalidArgumentException($label . ' darf nicht leer sein.');
        }
        if (mb_strlen($value) > $maxLength) {
            throw new InvalidArgumentException($label . ' ist zu lang.');
        }
        return $value;
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `16 Tests, 16 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Shared/Address.php order-system/tests/Shared/AddressTest.php
git commit -m "feat(order-system): Address als Value Object"
```

---

## Task 4: `Product` — Stammdatum Produkt

**Files:**
- Create: `order-system/src/Products/Product.php`
- Test: `order-system/tests/Products/ProductTest.php`

**Interfaces:**
- Consumes: `Money` (Task 2), `InvalidArgumentException` (Task 1)
- Produces: `Buschmann\OrderSystem\Products\Product` mit
  `__construct(int $id, string $name, ?string $description, Money $unitPrice, string $unit, bool $isActive, int $sortOrder)` ·
  `public readonly int $id` · `string $name` · `?string $description` ·
  `Money $unitPrice` · `string $unit` · `bool $isActive` · `int $sortOrder`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Products/ProductTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class ProductTest
{
    private function product(array $overrides = []): Product
    {
        $v = $overrides + [
            'id' => 1, 'name' => 'Zitronen-Cheesecake', 'description' => null,
            'unitPrice' => Money::fromDecimalString('4.35'), 'unit' => 'Stück',
            'isActive' => true, 'sortOrder' => 10,
        ];
        return new Product($v['id'], $v['name'], $v['description'],
            $v['unitPrice'], $v['unit'], $v['isActive'], $v['sortOrder']);
    }

    public function testKeepsItsData(): void
    {
        $p = $this->product();
        Assert::same(1, $p->id, 'ID');
        Assert::same('Zitronen-Cheesecake', $p->name, 'Name');
        Assert::same(435, $p->unitPrice->cents, 'Preis');
        Assert::same('Stück', $p->unit, 'Einheit');
        Assert::true($p->isActive, 'aktiv');
        Assert::same(10, $p->sortOrder, 'Reihenfolge');
        Assert::null($p->description, 'keine Beschreibung');
    }

    public function testEmptyDescriptionBecomesNull(): void
    {
        Assert::null($this->product(['description' => '   '])->description, 'leere Beschreibung');
        Assert::same('Mürbeteig', $this->product(['description' => ' Mürbeteig '])->description, 'getrimmt');
    }

    public function testNameIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['name' => '  ']), 'leerer Produktname');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['name' => str_repeat('a', 121)]), 'zu langer Produktname');
    }

    public function testUnitIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['unit' => '']), 'leere Einheit');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['unit' => str_repeat('a', 21)]), 'zu lange Einheit');
    }

    /** Die Einheit ist ein freies Anzeigelabel — keine Enum, keine Migration je Einheit. */
    public function testUnitAcceptsAnyReasonableLabel(): void
    {
        foreach (['Stück', 'Blech', 'kg', 'Torte', 'Portion'] as $unit) {
            Assert::same($unit, $this->product(['unit' => $unit])->unit, 'Einheit ' . $unit);
        }
    }

    public function testIdMustBePositive(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['id' => 0]), 'ID 0');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['id' => -1]), 'negative ID');
    }

    public function testSortOrderMustNotBeNegative(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['sortOrder' => -1]), 'negative Reihenfolge');
    }

    public function testDescriptionHasAnUpperBound(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->product(['description' => str_repeat('a', 501)]), 'zu lange Beschreibung');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … Product not found`, Exit-Code 1.

- [ ] **Schritt 3: `Product` implementieren**

`order-system/src/Products/Product.php`:

```php
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
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `24 Tests, 24 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Products/Product.php order-system/tests/Products/ProductTest.php
git commit -m "feat(order-system): Product-Entity mit Invarianten"
```

---

## Task 5: `FulfillmentType` und `FulfillmentDate`

Deckt Regel 4 ab: Ein unbekannter Fulfillment-Typ ist ungültig.

**Files:**
- Create: `order-system/src/Orders/FulfillmentType.php`
- Create: `order-system/src/Orders/FulfillmentDate.php`
- Test: `order-system/tests/Orders/FulfillmentTypeTest.php`
- Test: `order-system/tests/Orders/FulfillmentDateTest.php`

**Interfaces:**
- Produces:
  - `Buschmann\OrderSystem\Orders\FulfillmentType: string`
    mit `case Delivery = 'delivery'`, `case Pickup = 'pickup'`,
    `requiresAddress(): bool`, `label(): string`
  - `Buschmann\OrderSystem\Orders\FulfillmentDate` mit
    `static fromString(string $date, \DateTimeImmutable $notBefore): self` ·
    `static fromDateTime(\DateTimeImmutable $date, \DateTimeImmutable $notBefore): self` ·
    `toString(): string` (Format `Y-m-d`) · `toDateTime(): \DateTimeImmutable`

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

`order-system/tests/Orders/FulfillmentTypeTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Tests\Assert;

final class FulfillmentTypeTest
{
    public function testThereAreExactlyTwoKinds(): void
    {
        Assert::count(2, FulfillmentType::cases(), 'Fulfillment-Arten');
        Assert::same('delivery', FulfillmentType::Delivery->value, 'Lieferung');
        Assert::same('pickup', FulfillmentType::Pickup->value, 'Abholung');
    }

    /** Regel 4: Ein unbekannter Wert ist ungültig und scheitert sofort. */
    public function testUnknownValueIsRejected(): void
    {
        Assert::throws(\ValueError::class,
            static fn () => FulfillmentType::from('versand'), 'unbekannter Typ');
        Assert::null(FulfillmentType::tryFrom('versand'), 'tryFrom liefert null');
        Assert::null(FulfillmentType::tryFrom(''), 'leerer Wert');
        Assert::null(FulfillmentType::tryFrom('DELIVERY'), 'Großschreibung ist ein anderer Wert');
    }

    public function testOnlyDeliveryNeedsAnAddress(): void
    {
        Assert::true(FulfillmentType::Delivery->requiresAddress(), 'Lieferung braucht Adresse');
        Assert::false(FulfillmentType::Pickup->requiresAddress(), 'Abholung braucht keine');
    }

    public function testEachKindHasAGermanLabel(): void
    {
        Assert::same('Lieferung', FulfillmentType::Delivery->label(), 'Label Lieferung');
        Assert::same('Abholung', FulfillmentType::Pickup->label(), 'Label Abholung');
    }
}
```

`order-system/tests/Orders/FulfillmentDateTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentDate;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class FulfillmentDateTest
{
    private function today(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 14:32:00');
    }

    public function testAcceptsAFutureDate(): void
    {
        $d = FulfillmentDate::fromString('2026-08-28', $this->today());
        Assert::same('2026-08-28', $d->toString(), 'Datum');
    }

    public function testAcceptsToday(): void
    {
        $d = FulfillmentDate::fromString('2026-08-23', $this->today());
        Assert::same('2026-08-23', $d->toString(), 'heute ist zulässig');
    }

    /** Die Uhrzeit spielt keine Rolle — ein Café bestellt „für Freitag". */
    public function testTimeOfDayIsDiscarded(): void
    {
        $d = FulfillmentDate::fromDateTime(
            new \DateTimeImmutable('2026-08-28 17:45:12'), $this->today()
        );
        Assert::same('2026-08-28 00:00:00', $d->toDateTime()->format('Y-m-d H:i:s'), 'Mitternacht');
    }

    public function testRejectsAPastDate(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => FulfillmentDate::fromString('2026-08-22', $this->today()),
            'gestriges Datum');
        Assert::true($e->hasError('fulfillment_date'), 'Fehler am richtigen Feld');
    }

    public function testRejectsMalformedInput(): void
    {
        foreach (['', '28.08.2026', '2026-13-01', '2026-02-30', 'morgen', '2026-8-28'] as $bad) {
            Assert::throws(ValidationException::class,
                fn () => FulfillmentDate::fromString($bad, $this->today()),
                'unzulässige Eingabe "' . $bad . '"');
        }
    }

    /**
     * Der Vergleichszeitpunkt wird übergeben, nicht intern aus now() gelesen —
     * sonst wären diese Tests am Jahreswechsel wertlos.
     */
    public function testComparisonPointIsInjectedNotRead(): void
    {
        $d = FulfillmentDate::fromString('2020-01-01', new \DateTimeImmutable('2019-12-31'));
        Assert::same('2020-01-01', $d->toString(), 'Vergangenheit relativ zu einem anderen Heute');
    }
}
```

- [ ] **Schritt 2: Tests ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … FulfillmentType not found` bzw.
`FulfillmentDate not found`, Exit-Code 1.

- [ ] **Schritt 3: Beide Typen implementieren**

`order-system/src/Orders/FulfillmentType.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

/**
 * Wie eine Bestellung zum Kunden kommt.
 *
 * String-Enum, damit Domänenwert und Datenbankwert identisch sind: Ein
 * unbekannter Wert scheitert dann bereits beim Laden über from(), nicht
 * erst irgendwo tief in der Anwendung.
 *
 * Abholung ist kein Sonderfall der Lieferung. Geschäftskunden bestellen
 * überwiegend delivery, Privat- und Sonderkunden überwiegend pickup.
 */
enum FulfillmentType: string
{
    case Delivery = 'delivery';
    case Pickup   = 'pickup';

    public function requiresAddress(): bool
    {
        return $this === self::Delivery;
    }

    public function label(): string
    {
        return match ($this) {
            self::Delivery => 'Lieferung',
            self::Pickup   => 'Abholung',
        };
    }
}
```

`order-system/src/Orders/FulfillmentDate.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Shared\ValidationException;

/**
 * Liefer- oder Abholtag — Datum ohne Uhrzeit.
 *
 * Ein Café bestellt „für Freitag", nicht „für Freitag 14:32". Deshalb DATE
 * und nicht DATETIME, und deshalb wird eine mitgelieferte Uhrzeit verworfen
 * statt beibehalten.
 *
 * Der Vergleichszeitpunkt wird übergeben. Ein interner Zugriff auf now()
 * würde die Regel untestbar machen und Tests am Jahreswechsel kippen lassen.
 *
 * Vorlaufzeiten („bis Mittwoch für Freitag") sind Phase 2 und gehören dann
 * an genau diese Stelle.
 */
final class FulfillmentDate
{
    private function __construct(private readonly \DateTimeImmutable $date)
    {
    }

    public static function fromString(string $date, \DateTimeImmutable $notBefore): self
    {
        // Die Formatprüfung steht vor createFromFormat, weil dessen 'm' und 'd'
        // auch einstellige Zahlen annehmen — '2026-8-28' würde sonst durchgehen.
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw self::invalid();
        }

        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $errors = \DateTimeImmutable::getLastErrors();
        $bad    = $errors !== false
            && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0);

        // Ein 30. Februar wird von PHP still auf den 2. März gedreht und nur
        // über warning_count gemeldet — deshalb wird er hier mitgeprüft.
        if ($parsed === false || $bad) {
            throw self::invalid();
        }

        return self::fromDateTime($parsed, $notBefore);
    }

    private static function invalid(): ValidationException
    {
        return ValidationException::field(
            'fulfillment_date',
            'Bitte ein gültiges Datum im Format JJJJ-MM-TT angeben.'
        );
    }

    public static function fromDateTime(\DateTimeImmutable $date, \DateTimeImmutable $notBefore): self
    {
        $day      = $date->setTime(0, 0, 0);
        $earliest = $notBefore->setTime(0, 0, 0);

        if ($day < $earliest) {
            throw ValidationException::field(
                'fulfillment_date',
                'Der Liefer- oder Abholtag darf nicht in der Vergangenheit liegen.'
            );
        }

        return new self($day);
    }

    public function toString(): string
    {
        return $this->date->format('Y-m-d');
    }

    public function toDateTime(): \DateTimeImmutable
    {
        return $this->date;
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `34 Tests, 34 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/FulfillmentType.php order-system/src/Orders/FulfillmentDate.php \
        order-system/tests/Orders/FulfillmentTypeTest.php order-system/tests/Orders/FulfillmentDateTest.php
git commit -m "feat(order-system): FulfillmentType und FulfillmentDate"
```

---

## Task 6: `Customer` — Stammdatum Kunde

**Files:**
- Create: `order-system/src/Customers/Customer.php`
- Test: `order-system/tests/Customers/CustomerTest.php`

**Interfaces:**
- Consumes: `Address` (Task 3), `FulfillmentType` (Task 5),
  `InvalidArgumentException` (Task 1)
- Produces: `Buschmann\OrderSystem\Customers\Customer` mit
  `__construct(int $id, string $name, ?string $contactPerson, ?string $email, ?string $phone, ?Address $deliveryAddress, bool $isActive, FulfillmentType $defaultFulfillment, ?string $internalNote)` ·
  gleichnamige `public readonly` Eigenschaften ·
  `canBeDeliveredTo(): bool`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Customers/CustomerTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class CustomerTest
{
    private function address(): Address
    {
        return new Address('Musterstraße 1', '40213', 'Düsseldorf');
    }

    private function customer(array $overrides = []): Customer
    {
        $v = $overrides + [
            'id' => 1, 'name' => 'Café Beispiel', 'contactPerson' => null,
            'email' => null, 'phone' => null, 'deliveryAddress' => $this->address(),
            'isActive' => true, 'defaultFulfillment' => FulfillmentType::Delivery,
            'internalNote' => null,
        ];
        return new Customer($v['id'], $v['name'], $v['contactPerson'], $v['email'],
            $v['phone'], $v['deliveryAddress'], $v['isActive'],
            $v['defaultFulfillment'], $v['internalNote']);
    }

    public function testKeepsItsData(): void
    {
        $c = $this->customer(['contactPerson' => 'Frau Beispiel', 'phone' => '0211 1234567']);
        Assert::same(1, $c->id, 'ID');
        Assert::same('Café Beispiel', $c->name, 'Name');
        Assert::same('Frau Beispiel', $c->contactPerson, 'Ansprechpartner');
        Assert::same('0211 1234567', $c->phone, 'Telefon');
        Assert::same(FulfillmentType::Delivery, $c->defaultFulfillment, 'Standard-Fulfillment');
    }

    /** Datenminimierung: Nur der Kundenname ist Pflicht. */
    public function testOnlyTheNameIsMandatory(): void
    {
        $c = $this->customer([
            'contactPerson' => null, 'email' => null, 'phone' => null,
            'deliveryAddress' => null, 'defaultFulfillment' => FulfillmentType::Pickup,
        ]);
        Assert::same('Café Beispiel', $c->name, 'Name');
        Assert::null($c->email, 'keine E-Mail');
        Assert::null($c->phone, 'kein Telefon');
        Assert::null($c->deliveryAddress, 'keine Adresse');
    }

    public function testNameIsRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['name' => '   ']), 'leerer Kundenname');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['name' => str_repeat('a', 121)]), 'zu langer Kundenname');
    }

    /** Invariante: Wer standardmäßig beliefert wird, braucht eine Lieferadresse. */
    public function testDeliveryCustomerNeedsAnAddress(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer([
                'defaultFulfillment' => FulfillmentType::Delivery, 'deliveryAddress' => null,
            ]),
            'Lieferkunde ohne Adresse');
    }

    /** Umgekehrt ist eine Adresse bei einem Abholkunden kein Widerspruch. */
    public function testPickupCustomerMayStillHaveAnAddress(): void
    {
        $c = $this->customer([
            'defaultFulfillment' => FulfillmentType::Pickup, 'deliveryAddress' => $this->address(),
        ]);
        Assert::notNull($c->deliveryAddress, 'Adresse bleibt erhalten');
        Assert::true($c->canBeDeliveredTo(), 'Lieferung wäre möglich');
    }

    public function testKnowsWhetherDeliveryIsPossible(): void
    {
        Assert::false(
            $this->customer(['defaultFulfillment' => FulfillmentType::Pickup, 'deliveryAddress' => null])
                ->canBeDeliveredTo(),
            'ohne Adresse keine Lieferung'
        );
    }

    public function testRejectsMalformedEmail(): void
    {
        foreach (['keine-adresse', 'a@', '@b.de', 'a b@c.de'] as $bad) {
            Assert::throws(InvalidArgumentException::class,
                fn () => $this->customer(['email' => $bad]), 'unzulässige E-Mail "' . $bad . '"');
        }
        Assert::same('kontakt@example.org',
            $this->customer(['email' => ' kontakt@example.org '])->email, 'gültige E-Mail');
    }

    public function testBlankOptionalFieldsBecomeNull(): void
    {
        $c = $this->customer(['contactPerson' => '  ', 'phone' => '', 'internalNote' => '   ']);
        Assert::null($c->contactPerson, 'leerer Ansprechpartner');
        Assert::null($c->phone, 'leeres Telefon');
        Assert::null($c->internalNote, 'leere Notiz');
    }

    public function testOptionalFieldsHaveUpperBounds(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['contactPerson' => str_repeat('a', 121)]), 'Ansprechpartner');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['phone' => str_repeat('1', 41)]), 'Telefon');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['internalNote' => str_repeat('a', 1001)]), 'interne Notiz');
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['email' => str_repeat('a', 190) . '@e.de']), 'E-Mail');
    }

    public function testIdMustBePositive(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => $this->customer(['id' => 0]), 'ID 0');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … Customer not found`, Exit-Code 1.

- [ ] **Schritt 3: `Customer` implementieren**

`order-system/src/Customers/Customer.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Customers;

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;

/**
 * Ein Geschäftskunde (Café) oder ein Privat-/Sonderkunde.
 *
 * Datenminimierung ist hier Voreinstellung, nicht Bequemlichkeit: Pflicht
 * ist ausschließlich der Kunden- oder Cafénname. Ansprechpartner, E-Mail und
 * Telefon sind optional, weil ein Café zur Bestellung keinen
 * personenbezogenen Kontakt braucht.
 *
 * internalNote ist ein Feld für BETRIEBLICHE Hinweise („Lieferung an der
 * Rückseite", „Kühlkette beachten") — niemals für Angaben über Personen und
 * niemals für besondere Datenkategorien.
 *
 * Kunden werden deaktiviert, nicht gelöscht, solange Bestellungen bestehen.
 */
final class Customer
{
    public readonly string $name;
    public readonly ?string $contactPerson;
    public readonly ?string $email;
    public readonly ?string $phone;
    public readonly ?string $internalNote;

    public function __construct(
        public readonly int $id,
        string $name,
        ?string $contactPerson,
        ?string $email,
        ?string $phone,
        public readonly ?Address $deliveryAddress,
        public readonly bool $isActive,
        public readonly FulfillmentType $defaultFulfillment,
        ?string $internalNote,
    ) {
        if ($id <= 0) {
            throw new InvalidArgumentException('Die Kunden-ID ist ungültig.');
        }

        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 120) {
            throw new InvalidArgumentException('Der Kundenname fehlt oder ist zu lang.');
        }
        $this->name = $name;

        $this->contactPerson = self::optional($contactPerson, 120, 'Der Ansprechpartner');
        $this->phone         = self::optional($phone, 40, 'Die Telefonnummer');
        $this->internalNote  = self::optional($internalNote, 1000, 'Die interne Notiz');

        $email = self::optional($email, 190, 'Die E-Mail-Adresse');
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('Die E-Mail-Adresse ist ungültig.');
        }
        $this->email = $email;

        if ($defaultFulfillment->requiresAddress() && $deliveryAddress === null) {
            throw new InvalidArgumentException(
                'Ein Kunde mit Standardlieferung braucht eine Lieferadresse.'
            );
        }
    }

    /** Eine Lieferung ist möglich, sobald eine Adresse hinterlegt ist. */
    public function canBeDeliveredTo(): bool
    {
        return $this->deliveryAddress !== null;
    }

    private static function optional(?string $value, int $maxLength, string $label): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > $maxLength) {
            throw new InvalidArgumentException($label . ' ist zu lang.');
        }
        return $value;
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `44 Tests, 44 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Customers/Customer.php order-system/tests/Customers/CustomerTest.php
git commit -m "feat(order-system): Customer-Entity mit Datenminimierung und Lieferinvariante"
```

---

## Task 7: `OrderStatus` — Zustände und erlaubte Übergänge

Deckt Regel 5 ab: Ein unbekannter Status ist ungültig.

**Files:**
- Create: `order-system/src/Orders/OrderStatus.php`
- Test: `order-system/tests/Orders/OrderStatusTest.php`

**Interfaces:**
- Produces: `Buschmann\OrderSystem\Orders\OrderStatus: string` mit
  `New='new'`, `Confirmed='confirmed'`, `InProduction='in_production'`,
  `Completed='completed'`, `Cancelled='cancelled'` ·
  `canTransitionTo(self $target): bool` · `isFinal(): bool` · `label(): string`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Orders/OrderStatusTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderStatus;
use Tests\Assert;

final class OrderStatusTest
{
    public function testThereAreExactlyFiveStates(): void
    {
        Assert::count(5, OrderStatus::cases(), 'Statuswerte');
        Assert::same('new', OrderStatus::New->value, 'neu');
        Assert::same('confirmed', OrderStatus::Confirmed->value, 'bestätigt');
        Assert::same('in_production', OrderStatus::InProduction->value, 'in Produktion');
        Assert::same('completed', OrderStatus::Completed->value, 'abgeschlossen');
        Assert::same('cancelled', OrderStatus::Cancelled->value, 'storniert');
    }

    /** Regel 5: Ein unbekannter Status ist ungültig. */
    public function testUnknownValueIsRejected(): void
    {
        Assert::throws(\ValueError::class,
            static fn () => OrderStatus::from('geliefert'), 'unbekannter Status');
        Assert::null(OrderStatus::tryFrom('offen'), 'tryFrom liefert null');
        Assert::null(OrderStatus::tryFrom(''), 'leerer Status');
    }

    public function testTheNormalPathIsAllowed(): void
    {
        Assert::true(OrderStatus::New->canTransitionTo(OrderStatus::Confirmed), 'neu → bestätigt');
        Assert::true(OrderStatus::Confirmed->canTransitionTo(OrderStatus::InProduction), 'bestätigt → Produktion');
        Assert::true(OrderStatus::InProduction->canTransitionTo(OrderStatus::Completed), 'Produktion → abgeschlossen');
    }

    public function testCancellingIsPossibleUntilCompletion(): void
    {
        foreach ([OrderStatus::New, OrderStatus::Confirmed, OrderStatus::InProduction] as $from) {
            Assert::true($from->canTransitionTo(OrderStatus::Cancelled),
                $from->value . ' → storniert');
        }
    }

    /** Kein Rückwärtsgang: Das wäre Datenkorruption, keine Korrektur. */
    public function testFinishedOrdersCannotBeReopened(): void
    {
        foreach (OrderStatus::cases() as $target) {
            Assert::false(OrderStatus::Completed->canTransitionTo($target),
                'abgeschlossen → ' . $target->value);
            Assert::false(OrderStatus::Cancelled->canTransitionTo($target),
                'storniert → ' . $target->value);
        }
    }

    public function testStepsCannotBeSkippedOrReversed(): void
    {
        Assert::false(OrderStatus::New->canTransitionTo(OrderStatus::Completed), 'neu → abgeschlossen');
        Assert::false(OrderStatus::New->canTransitionTo(OrderStatus::InProduction), 'neu → Produktion');
        Assert::false(OrderStatus::InProduction->canTransitionTo(OrderStatus::Confirmed), 'Produktion → bestätigt');
        Assert::false(OrderStatus::Confirmed->canTransitionTo(OrderStatus::New), 'bestätigt → neu');
    }

    public function testAStatusIsNeverATransitionToItself(): void
    {
        foreach (OrderStatus::cases() as $status) {
            Assert::false($status->canTransitionTo($status), $status->value . ' → sich selbst');
        }
    }

    public function testKnowsItsFinalStates(): void
    {
        Assert::true(OrderStatus::Completed->isFinal(), 'abgeschlossen ist final');
        Assert::true(OrderStatus::Cancelled->isFinal(), 'storniert ist final');
        Assert::false(OrderStatus::New->isFinal(), 'neu ist nicht final');
    }

    public function testEachStateHasAGermanLabel(): void
    {
        Assert::same('Neu', OrderStatus::New->label(), 'Label neu');
        Assert::same('In Produktion', OrderStatus::InProduction->label(), 'Label Produktion');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … OrderStatus not found`, Exit-Code 1.

- [ ] **Schritt 3: `OrderStatus` implementieren**

`order-system/src/Orders/OrderStatus.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

/**
 * Lebenszyklus einer Bestellung.
 *
 *   new ──▶ confirmed ──▶ in_production ──▶ completed
 *    │           │              │
 *    └───────────┴──────────────┴────────▶ cancelled
 *
 * Bewusst KEINE ausgebaute State Machine: keine Guards, keine Ereignisse,
 * kein Framework. Nur eine Zuordnungstabelle. Sie existiert trotzdem, weil
 * „abgeschlossen zurück auf neu" oder „storniert wieder in Produktion"
 * echte Datenkorruption wären — und die Absicherung acht Zeilen kostet.
 */
enum OrderStatus: string
{
    case New          = 'new';
    case Confirmed    = 'confirmed';
    case InProduction = 'in_production';
    case Completed    = 'completed';
    case Cancelled    = 'cancelled';

    public function canTransitionTo(self $target): bool
    {
        return in_array($target, $this->allowedTargets(), true);
    }

    public function isFinal(): bool
    {
        return $this->allowedTargets() === [];
    }

    public function label(): string
    {
        return match ($this) {
            self::New          => 'Neu',
            self::Confirmed    => 'Bestätigt',
            self::InProduction => 'In Produktion',
            self::Completed    => 'Abgeschlossen',
            self::Cancelled    => 'Storniert',
        };
    }

    /** @return self[] */
    private function allowedTargets(): array
    {
        return match ($this) {
            self::New          => [self::Confirmed, self::Cancelled],
            self::Confirmed    => [self::InProduction, self::Cancelled],
            self::InProduction => [self::Completed, self::Cancelled],
            self::Completed, self::Cancelled => [],
        };
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `53 Tests, 53 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/OrderStatus.php order-system/tests/Orders/OrderStatusTest.php
git commit -m "feat(order-system): OrderStatus mit minimalen Übergangsregeln"
```

---

## Task 8: `OrderNumber` — menschenlesbare Bestellnummer

**Files:**
- Create: `order-system/src/Orders/OrderNumber.php`
- Test: `order-system/tests/Orders/OrderNumberTest.php`

**Interfaces:**
- Produces: `Buschmann\OrderSystem\Orders\OrderNumber` mit
  `public const PREFIX = 'BUS'` · `public const MAX_SEQUENCE = 999_999` ·
  `static fromYearAndSequence(int $year, int $sequence): self` ·
  `static fromString(string $value): self` ·
  `public readonly int $year, int $sequence` · `toString(): string` ·
  `equals(self $other): bool`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Orders/OrderNumberTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderNumber;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Tests\Assert;

final class OrderNumberTest
{
    public function testFormatIsPrefixYearAndSixDigits(): void
    {
        Assert::same('BUS-2026-000123',
            OrderNumber::fromYearAndSequence(2026, 123)->toString(), 'Bestellnummer');
        Assert::same('BUS-2026-000001',
            OrderNumber::fromYearAndSequence(2026, 1)->toString(), 'erste Nummer des Jahres');
        Assert::same('BUS-2026-999999',
            OrderNumber::fromYearAndSequence(2026, 999999)->toString(), 'letzte Nummer des Jahres');
    }

    public function testParsesItsOwnFormat(): void
    {
        $n = OrderNumber::fromString('BUS-2026-000123');
        Assert::same(2026, $n->year, 'Jahr');
        Assert::same(123, $n->sequence, 'laufende Nummer');
        Assert::same('BUS-2026-000123', $n->toString(), 'Hin- und Rückumwandlung');
    }

    public function testRejectsForeignOrMalformedNumbers(): void
    {
        foreach (['', 'BUS-2026-123', 'bus-2026-000123', 'BUS-26-000123',
                  'BUS-2026-0001234', 'XYZ-2026-000123', 'BUS_2026_000123',
                  'BUS-2026-000000', ' BUS-2026-000123'] as $bad) {
            Assert::throws(InvalidArgumentException::class,
                static fn () => OrderNumber::fromString($bad),
                'unzulässige Bestellnummer "' . $bad . '"');
        }
    }

    public function testSequenceStartsAtOneAndHasAnUpperBound(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, 0), 'laufende Nummer 0');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, -1), 'negative laufende Nummer');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(2026, 1000000), 'siebenstellige Nummer');
    }

    public function testYearMustBePlausible(): void
    {
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(1999, 1), 'Jahr vor 2000');
        Assert::throws(InvalidArgumentException::class,
            static fn () => OrderNumber::fromYearAndSequence(10000, 1), 'fünfstelliges Jahr');
    }

    public function testEqualityComparesValue(): void
    {
        Assert::true(
            OrderNumber::fromYearAndSequence(2026, 7)->equals(OrderNumber::fromString('BUS-2026-000007')),
            'gleiche Nummer'
        );
        Assert::false(
            OrderNumber::fromYearAndSequence(2026, 7)->equals(OrderNumber::fromYearAndSequence(2027, 7)),
            'gleiche laufende Nummer, anderes Jahr'
        );
    }

    /** Die feste Länge von 20 Zeichen passt in VARCHAR(20) der Tabelle orders. */
    public function testFitsTheDatabaseColumn(): void
    {
        Assert::true(
            strlen(OrderNumber::fromYearAndSequence(2026, 999999)->toString()) <= 20,
            'Länge höchstens 20 Zeichen'
        );
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … OrderNumber not found`, Exit-Code 1.

- [ ] **Schritt 3: `OrderNumber` implementieren**

`order-system/src/Orders/OrderNumber.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Shared\InvalidArgumentException;

/**
 * Bestellnummer im Format BUS-JJJJ-NNNNNN, zum Beispiel BUS-2026-000123.
 *
 * Am Telefon: „B-U-S, zweitausendsechsundzwanzig, null null null eins zwei
 * drei." Feste Länge, weil Menschen gleichlange Ziffernblöcke schneller
 * vorlesen und abgleichen. Keine UUID, kein Base62.
 *
 * ACHTUNG — die Bestellnummer ist KEIN Zugriffsschlüssel. Sie ist
 * fortlaufend und damit erratbar. Eine spätere Phase darf niemals „wer die
 * Nummer kennt, darf die Bestellung sehen" umsetzen; dafür wäre ein
 * separates Zufallstoken nötig.
 *
 * Die laufende Nummer wird nicht aus MAX(id)+1 gebildet, sondern aus der
 * Tabelle order_number_sequences — siehe database/migrations/006 und
 * database/README.md. Lücken sind zulässig und erwartet: Lückenlosigkeit
 * ist eine Anforderung an Rechnungsnummern, nicht an Bestellnummern.
 */
final class OrderNumber
{
    public const PREFIX       = 'BUS';
    public const MAX_SEQUENCE = 999_999;

    private function __construct(
        public readonly int $year,
        public readonly int $sequence,
    ) {
    }

    public static function fromYearAndSequence(int $year, int $sequence): self
    {
        if ($year < 2000 || $year > 9999) {
            throw new InvalidArgumentException('Das Jahr der Bestellnummer ist ungültig.');
        }
        if ($sequence < 1 || $sequence > self::MAX_SEQUENCE) {
            throw new InvalidArgumentException('Die laufende Nummer der Bestellnummer ist ungültig.');
        }
        return new self($year, $sequence);
    }

    public static function fromString(string $value): self
    {
        $pattern = '/^' . self::PREFIX . '-(\d{4})-(\d{6})$/';
        if (preg_match($pattern, $value, $m) !== 1) {
            throw new InvalidArgumentException('Die Bestellnummer hat kein gültiges Format.');
        }
        return self::fromYearAndSequence((int) $m[1], (int) $m[2]);
    }

    public function toString(): string
    {
        return sprintf('%s-%04d-%06d', self::PREFIX, $this->year, $this->sequence);
    }

    public function equals(self $other): bool
    {
        return $this->year === $other->year && $this->sequence === $other->sequence;
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `60 Tests, 60 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/OrderNumber.php order-system/tests/Orders/OrderNumberTest.php
git commit -m "feat(order-system): OrderNumber im Format BUS-JJJJ-NNNNNN"
```

---

## Task 9: `ProductCatalog` — die vertrauenswürdige Preisquelle

Der Name ist Teil des Sicherheitsmodells: Wo der Preis herkommt, soll man am
Typ ablesen können.

**Files:**
- Create: `order-system/src/Products/ProductCatalog.php`
- Test: `order-system/tests/Products/ProductCatalogTest.php`

**Interfaces:**
- Consumes: `Product` (Task 4)
- Produces: `Buschmann\OrderSystem\Products\ProductCatalog` mit
  `static fromList(Product[] $products): self` ·
  `find(int $id): ?Product` · `get(int $id): Product` (wirft) ·
  `orderable(): Product[]` (aktiv, sortiert nach sortOrder dann id) ·
  `count(): int`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Products/ProductCatalogTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class ProductCatalogTest
{
    private function product(int $id, string $name, bool $active = true, int $sort = 0): Product
    {
        return new Product($id, $name, null, Money::fromDecimalString('4.00'), 'Stück', $active, $sort);
    }

    public function testFindsProductsById(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A'), $this->product(2, 'B')]);
        Assert::same('B', $catalog->get(2)->name, 'Produkt 2');
        Assert::same(2, $catalog->count(), 'Anzahl');
    }

    public function testReturnsNullForUnknownProducts(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A')]);
        Assert::null($catalog->find(99), 'unbekannte ID');
    }

    /** get() ist für Stellen, an denen ein fehlendes Produkt ein Fehler ist. */
    public function testGetThrowsForUnknownProducts(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(1, 'A')]);
        Assert::throws(InvalidArgumentException::class,
            static fn () => $catalog->get(99), 'unbekannte ID bei get()');
    }

    /**
     * Die Bestellseite braucht das gesamte aktive Sortiment in
     * Anzeigereihenfolge in einem Zugriff — UX-Prinzip 2.
     */
    public function testOrderableProductsAreActiveAndSorted(): void
    {
        $catalog = ProductCatalog::fromList([
            $this->product(3, 'Drittes', true, 30),
            $this->product(1, 'Erstes', true, 10),
            $this->product(9, 'Inaktives', false, 5),
            $this->product(2, 'Zweites', true, 20),
        ]);

        $names = array_map(static fn (Product $p) => $p->name, $catalog->orderable());
        Assert::same(['Erstes', 'Zweites', 'Drittes'], $names, 'Reihenfolge');
    }

    public function testProductsWithTheSameSortOrderFallBackToId(): void
    {
        $catalog = ProductCatalog::fromList([
            $this->product(7, 'Sieben', true, 10),
            $this->product(3, 'Drei', true, 10),
        ]);
        $names = array_map(static fn (Product $p) => $p->name, $catalog->orderable());
        Assert::same(['Drei', 'Sieben'], $names, 'stabile Reihenfolge über die ID');
    }

    public function testInactiveProductsAreStillFindable(): void
    {
        $catalog = ProductCatalog::fromList([$this->product(9, 'Inaktiv', false)]);
        Assert::notNull($catalog->find(9), 'inaktives Produkt bleibt auffindbar');
        Assert::count(0, $catalog->orderable(), 'aber nicht bestellbar');
    }

    public function testRejectsDuplicateIds(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => ProductCatalog::fromList([$this->product(1, 'A'), $this->product(1, 'B')]),
            'doppelte Produkt-ID');
    }

    public function testAnEmptyCatalogIsAllowed(): void
    {
        $catalog = ProductCatalog::fromList([]);
        Assert::same(0, $catalog->count(), 'leerer Katalog');
        Assert::count(0, $catalog->orderable(), 'nichts bestellbar');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … ProductCatalog not found`, Exit-Code 1.

- [ ] **Schritt 3: `ProductCatalog` implementieren**

`order-system/src/Products/ProductCatalog.php`:

```php
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
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `68 Tests, 68 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Products/ProductCatalog.php order-system/tests/Products/ProductCatalogTest.php
git commit -m "feat(order-system): ProductCatalog als einzige Preisquelle"
```

---

## Task 10: `OrderItem` — Bestellposition mit unfälschbarem Positionsbetrag

Deckt Regel 2 ab (Menge > 0) und die Snapshot-Anforderung.

**Files:**
- Create: `order-system/src/Orders/OrderItem.php`
- Test: `order-system/tests/Orders/OrderItemTest.php`

**Interfaces:**
- Consumes: `Product` (Task 4), `Money` (Task 2)
- Produces: `Buschmann\OrderSystem\Orders\OrderItem` mit
  `public const MAX_QUANTITY = 9_999` ·
  `__construct(?int $id, int $productId, string $productNameSnapshot, string $productUnitSnapshot, Money $unitPrice, int $quantity)` ·
  `static forProduct(Product $product, int $quantity): self` ·
  `public readonly Money $lineTotal` (berechnet) · `withId(int $id): self`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Orders/OrderItemTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderItem;
use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Tests\Assert;

final class OrderItemTest
{
    private function product(string $price = '4.35'): Product
    {
        return new Product(1, 'Zitronen-Cheesecake', null,
            Money::fromDecimalString($price), 'Stück', true, 10);
    }

    public function testTakesItsSnapshotFromTheProduct(): void
    {
        $item = OrderItem::forProduct($this->product(), 3);
        Assert::same(1, $item->productId, 'Produkt-ID');
        Assert::same('Zitronen-Cheesecake', $item->productNameSnapshot, 'Name-Snapshot');
        Assert::same('Stück', $item->productUnitSnapshot, 'Einheit-Snapshot');
        Assert::same(435, $item->unitPrice->cents, 'Preis-Snapshot');
        Assert::same(3, $item->quantity, 'Menge');
        Assert::null($item->id, 'noch nicht persistiert');
    }

    /** Regel 6/7: Der Positionsbetrag wird berechnet, nicht entgegengenommen. */
    public function testLineTotalIsComputedFromPriceAndQuantity(): void
    {
        Assert::same('13.05', OrderItem::forProduct($this->product(), 3)->lineTotal->toDecimalString(),
            '3 × 4.35');
        Assert::same('4.35', OrderItem::forProduct($this->product(), 1)->lineTotal->toDecimalString(),
            '1 × 4.35');
        Assert::same('43.50', OrderItem::forProduct($this->product(), 10)->lineTotal->toDecimalString(),
            '10 × 4.35');
    }

    /** Regel 2: Menge muss größer als 0 sein. */
    public function testQuantityMustBeGreaterThanZero(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), 0), 'Menge 0');
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), -1), 'negative Menge');
    }

    public function testQuantityHasASanityBound(): void
    {
        Assert::same(OrderItem::MAX_QUANTITY,
            OrderItem::forProduct($this->product(), OrderItem::MAX_QUANTITY)->quantity,
            'Obergrenze ist zulässig');
        Assert::throws(InvalidArgumentException::class,
            fn () => OrderItem::forProduct($this->product(), OrderItem::MAX_QUANTITY + 1),
            'unplausibel große Menge');
    }

    public function testSnapshotsAreRequired(): void
    {
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 1, '  ', 'Stück', Money::fromCents(100), 1),
            'leerer Name-Snapshot');
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 1, 'Kuchen', '', Money::fromCents(100), 1),
            'leerer Einheit-Snapshot');
        Assert::throws(InvalidArgumentException::class,
            fn () => new OrderItem(null, 0, 'Kuchen', 'Stück', Money::fromCents(100), 1),
            'ungültige Produkt-ID');
    }

    public function testAPriceOfZeroIsAllowed(): void
    {
        $item = OrderItem::forProduct($this->product('0.00'), 4);
        Assert::same('0.00', $item->lineTotal->toDecimalString(), 'Werbeprobe zum Preis 0');
    }

    public function testReceivingAnIdReturnsANewItem(): void
    {
        $item  = OrderItem::forProduct($this->product(), 2);
        $saved = $item->withId(42);
        Assert::same(42, $saved->id, 'ID gesetzt');
        Assert::null($item->id, 'Original bleibt unverändert');
        Assert::same('8.70', $saved->lineTotal->toDecimalString(), 'Betrag bleibt gleich');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … OrderItem not found`, Exit-Code 1.

- [ ] **Schritt 3: `OrderItem` implementieren**

`order-system/src/Orders/OrderItem.php`:

```php
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
            $id, $this->productId, $this->productNameSnapshot,
            $this->productUnitSnapshot, $this->unitPrice, $this->quantity,
        );
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `75 Tests, 75 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/OrderItem.php order-system/tests/Orders/OrderItemTest.php
git commit -m "feat(order-system): OrderItem mit berechnetem Positionsbetrag und Snapshots"
```

---

## Task 11: `OrderDraft` — Eingabe-Whitelist ohne Preisfeld

Deckt Regel 7 ab: Der Client kann den Preis nicht vorgeben — weil es kein
Feld dafür gibt.

**Files:**
- Create: `order-system/src/Orders/OrderDraft.php`
- Test: `order-system/tests/Orders/OrderDraftTest.php`

**Interfaces:**
- Consumes: `FulfillmentType`, `FulfillmentDate` (Task 5),
  `ValidationException` (Task 1)
- Produces: `Buschmann\OrderSystem\Orders\OrderDraft` mit
  `public const MAX_ITEMS = 200` ·
  `static fromInput(array $input, \DateTimeImmutable $now): self` ·
  `public readonly FulfillmentType $fulfillmentType` ·
  `public readonly FulfillmentDate $fulfillmentDate` ·
  `public readonly ?string $note` ·
  `public readonly array $items` — Form `array<int, array{product_id: int, quantity: int}>`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Orders/OrderDraftTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Orders\OrderDraft;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class OrderDraftTest
{
    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 09:00:00');
    }

    private function input(array $overrides = []): array
    {
        return $overrides + [
            'fulfillment_type' => 'delivery',
            'fulfillment_date' => '2026-08-28',
            'note'             => null,
            'items'            => [['product_id' => 1, 'quantity' => 3]],
        ];
    }

    public function testReadsAValidOrder(): void
    {
        $draft = OrderDraft::fromInput($this->input(['note' => ' Bitte kühl stellen ']), $this->now());
        Assert::same(FulfillmentType::Delivery, $draft->fulfillmentType, 'Fulfillment');
        Assert::same('2026-08-28', $draft->fulfillmentDate->toString(), 'Datum');
        Assert::same('Bitte kühl stellen', $draft->note, 'Notiz getrimmt');
        Assert::count(1, $draft->items, 'Positionen');
        Assert::same(['product_id' => 1, 'quantity' => 3], $draft->items[0], 'Position');
    }

    /**
     * Regel 7: Der Entwurf hat kein Preisfeld. Mitgesendete Beträge werden
     * nicht „geprüft und verworfen", sondern gar nicht erst gelesen.
     */
    public function testPriceFieldsInTheRequestAreNotRead(): void
    {
        $draft = OrderDraft::fromInput($this->input([
            'total'      => '0.01',
            'total_cents' => 1,
            'items'      => [[
                'product_id' => 1, 'quantity' => 3,
                'unit_price' => '0.01', 'line_total' => '0.03', 'price' => 1,
            ]],
        ]), $this->now());

        Assert::same(['product_id' => 1, 'quantity' => 3], $draft->items[0],
            'Position enthält nur ID und Menge');
        Assert::false(property_exists($draft, 'total'), 'kein Gesamtbetrag im Entwurf');
        Assert::false(property_exists($draft, 'unitPrice'), 'kein Einzelpreis im Entwurf');
    }

    public function testStatusAndOrderNumberCannotBeInjected(): void
    {
        $draft = OrderDraft::fromInput($this->input([
            'status' => 'completed', 'order_number' => 'BUS-2026-000001', 'customer_id' => 99,
        ]), $this->now());

        Assert::false(property_exists($draft, 'status'), 'kein Status im Entwurf');
        Assert::false(property_exists($draft, 'orderNumber'), 'keine Bestellnummer im Entwurf');
        Assert::false(property_exists($draft, 'customerId'), 'kein Kunde im Entwurf');
    }

    /**
     * Die Bestellseite sendet ALLE Produkte mit, die meisten mit Menge 0.
     * Menge 0 heißt „nicht bestellt" und ist kein Fehler — sie fällt weg.
     */
    public function testQuantityZeroMeansNotOrdered(): void
    {
        $draft = OrderDraft::fromInput($this->input(['items' => [
            ['product_id' => 1, 'quantity' => 0],
            ['product_id' => 2, 'quantity' => 5],
            ['product_id' => 3, 'quantity' => 0],
        ]]), $this->now());

        Assert::count(1, $draft->items, 'nur die tatsächlich bestellte Position');
        Assert::same(2, $draft->items[0]['product_id'], 'Produkt 2');
    }

    /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
    public function testAnOrderWithoutItemsIsRejected(): void
    {
        foreach ([[], [['product_id' => 1, 'quantity' => 0]]] as $items) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input(['items' => $items]), $this->now()),
                'Bestellung ohne Positionen');
            Assert::true($e->hasError('items'), 'Fehler am Feld items');
        }
        Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => 'keine Liste']), $this->now()),
            'items ist keine Liste');
    }

    /** Regel 2: Eine negative Menge ist ein Fehler, kein „nicht bestellt". */
    public function testNegativeOrNonNumericQuantitiesAreRejected(): void
    {
        foreach ([-1, 'drei', null, 2.5, ''] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input([
                    'items' => [['product_id' => 1, 'quantity' => $bad]],
                ]), $this->now()),
                'unzulässige Menge');
            Assert::true($e->hasError('items.0.quantity'), 'Fehler an der richtigen Position');
        }
    }

    public function testInvalidProductIdsAreRejected(): void
    {
        foreach ([0, -5, 'abc', null] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input([
                    'items' => [['product_id' => $bad, 'quantity' => 1]],
                ]), $this->now()),
                'unzulässige Produkt-ID');
            Assert::true($e->hasError('items.0.product_id'), 'Fehler an der richtigen Position');
        }
    }

    public function testTheSameProductMustNotAppearTwice(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => [
                ['product_id' => 1, 'quantity' => 2],
                ['product_id' => 1, 'quantity' => 3],
            ]]), $this->now()),
            'doppeltes Produkt');
        Assert::true($e->hasError('items.1.product_id'), 'Fehler an der zweiten Position');
    }

    /** Regel 4: Ein unbekannter Fulfillment-Typ ist ungültig. */
    public function testUnknownFulfillmentTypeIsRejected(): void
    {
        foreach (['versand', '', null, 'DELIVERY', 42] as $bad) {
            $e = Assert::throws(ValidationException::class,
                fn () => OrderDraft::fromInput($this->input(['fulfillment_type' => $bad]), $this->now()),
                'unzulässiger Fulfillment-Typ');
            Assert::true($e->hasError('fulfillment_type'), 'Fehler am Feld fulfillment_type');
        }
    }

    public function testPickupIsAcceptedToo(): void
    {
        $draft = OrderDraft::fromInput($this->input(['fulfillment_type' => 'pickup']), $this->now());
        Assert::same(FulfillmentType::Pickup, $draft->fulfillmentType, 'Abholung');
    }

    public function testPastFulfillmentDatesAreRejected(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['fulfillment_date' => '2026-08-01']), $this->now()),
            'Datum in der Vergangenheit');
        Assert::true($e->hasError('fulfillment_date'), 'Fehler am Feld fulfillment_date');
    }

    /** Alle Fehler auf einmal — ein Café soll nicht fünfmal absenden müssen. */
    public function testAllErrorsAreCollectedNotJustTheFirst(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput([
                'fulfillment_type' => 'versand',
                'fulfillment_date' => '2020-01-01',
                'items'            => [['product_id' => 0, 'quantity' => -3]],
            ], $this->now()),
            'mehrere Fehler');

        $errors = $e->errors();
        Assert::true(isset($errors['fulfillment_type']), 'Fulfillment-Fehler enthalten');
        Assert::true(isset($errors['fulfillment_date']), 'Datumsfehler enthalten');
        Assert::true(isset($errors['items.0.product_id']), 'Produktfehler enthalten');
        Assert::true(isset($errors['items.0.quantity']), 'Mengenfehler enthalten');
        Assert::same(4, count($errors), 'genau vier Fehler');
    }

    public function testNoteIsOptionalAndBounded(): void
    {
        Assert::null(OrderDraft::fromInput($this->input(['note' => '   ']), $this->now())->note,
            'leere Notiz wird null');
        Assert::null(OrderDraft::fromInput($this->input(['note' => null]), $this->now())->note,
            'fehlende Notiz wird null');

        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['note' => str_repeat('a', 501)]), $this->now()),
            'zu lange Notiz');
        Assert::true($e->hasError('note'), 'Fehler am Feld note');
    }

    public function testTooManyItemsAreRejected(): void
    {
        $items = [];
        for ($i = 1; $i <= OrderDraft::MAX_ITEMS + 1; $i++) {
            $items[] = ['product_id' => $i, 'quantity' => 1];
        }
        $e = Assert::throws(ValidationException::class,
            fn () => OrderDraft::fromInput($this->input(['items' => $items]), $this->now()),
            'zu viele Positionen');
        Assert::true($e->hasError('items'), 'Fehler am Feld items');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … OrderDraft not found`, Exit-Code 1.

- [ ] **Schritt 3: `OrderDraft` implementieren**

`order-system/src/Orders/OrderDraft.php`:

```php
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

        $type = null;
        $rawType = $input['fulfillment_type'] ?? null;
        if (!is_string($rawType) || ($type = FulfillmentType::tryFrom($rawType)) === null) {
            $errors['fulfillment_type'] = 'Bitte Lieferung oder Abholung auswählen.';
        }

        $date = null;
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

        $note = null;
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
     * @param array<string, string> $errors  wird per Referenz ergänzt
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
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `88 Tests, 88 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/OrderDraft.php order-system/tests/Orders/OrderDraftTest.php
git commit -m "feat(order-system): OrderDraft als preisfreie Eingabe-Whitelist"
```

---

## Task 12: `Order` — das Aggregat mit serverseitiger Preislogik

Der Kern. Deckt die Regeln 1, 3, 6, 7, 8 und 9 ab.

**Files:**
- Create: `order-system/src/Orders/Order.php`
- Test: `order-system/tests/Orders/OrderTest.php`

**Interfaces:**
- Consumes: `Customer` (Task 6), `ProductCatalog` (Task 9),
  `OrderDraft` (Task 11), `OrderItem` (Task 10), `OrderNumber` (Task 8),
  `OrderStatus` (Task 7), `FulfillmentType`/`FulfillmentDate` (Task 5)
- Produces: `Buschmann\OrderSystem\Orders\Order` mit
  `static place(Customer $customer, ProductCatalog $catalog, OrderDraft $draft, OrderNumber $orderNumber, \DateTimeImmutable $now): self` ·
  `total(): Money` · `itemCount(): int` ·
  `withStatus(OrderStatus $target, \DateTimeImmutable $now): self` ·
  `withId(int $id): self` · alle Felder aus Spec 7.3 als `public readonly`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

`order-system/tests/Orders/OrderTest.php`:

```php
<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Orders\FulfillmentType;
use Buschmann\OrderSystem\Orders\Order;
use Buschmann\OrderSystem\Orders\OrderDraft;
use Buschmann\OrderSystem\Orders\OrderNumber;
use Buschmann\OrderSystem\Orders\OrderStatus;
use Buschmann\OrderSystem\Products\Product;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\Address;
use Buschmann\OrderSystem\Shared\DomainException;
use Buschmann\OrderSystem\Shared\Money;
use Buschmann\OrderSystem\Shared\ValidationException;
use Tests\Assert;

final class OrderTest
{
    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-23 09:00:00');
    }

    private function catalog(string $priceA = '4.35', string $priceB = '2.80', bool $bActive = true): ProductCatalog
    {
        return ProductCatalog::fromList([
            new Product(1, 'Zitronen-Cheesecake', null, Money::fromDecimalString($priceA), 'Stück', true, 10),
            new Product(2, 'Butterkuchen', null, Money::fromDecimalString($priceB), 'Blech', $bActive, 20),
        ]);
    }

    private function customer(FulfillmentType $type = FulfillmentType::Delivery, bool $withAddress = true, bool $active = true): Customer
    {
        return new Customer(
            7, 'Café Beispiel', null, null, null,
            $withAddress ? new Address('Musterstraße 1', '40213', 'Düsseldorf') : null,
            $active, $type, null
        );
    }

    private function draft(array $overrides = []): OrderDraft
    {
        return OrderDraft::fromInput($overrides + [
            'fulfillment_type' => 'delivery',
            'fulfillment_date' => '2026-08-28',
            'items'            => [['product_id' => 1, 'quantity' => 3]],
        ], $this->now());
    }

    private function place(?OrderDraft $draft = null, ?Customer $customer = null, ?ProductCatalog $catalog = null): Order
    {
        return Order::place(
            $customer ?? $this->customer(),
            $catalog ?? $this->catalog(),
            $draft ?? $this->draft(),
            OrderNumber::fromYearAndSequence(2026, 1),
            $this->now(),
        );
    }

    public function testPlacesAnOrderWithSnapshotsAndStatusNew(): void
    {
        $order = $this->place();

        Assert::same('BUS-2026-000001', $order->orderNumber->toString(), 'Bestellnummer');
        Assert::same(7, $order->customerId, 'Kunde');
        Assert::same('Café Beispiel', $order->customerNameSnapshot, 'Kundenname-Snapshot');
        Assert::same(OrderStatus::New, $order->status, 'Startstatus');
        Assert::same('2026-08-28', $order->fulfillmentDate->toString(), 'Liefertag');
        Assert::same('Musterstraße 1, 40213 Düsseldorf', $order->deliveryAddressSnapshot, 'Adress-Snapshot');
        Assert::null($order->id, 'noch nicht persistiert');
        Assert::same('2026-08-23 09:00:00', $order->createdAt->format('Y-m-d H:i:s'), 'Zeitstempel');
    }

    /** Regel 6: Der Preis stammt aus dem Katalog, nicht aus der Eingabe. */
    public function testPriceComesFromTheCatalog(): void
    {
        $order = $this->place();
        Assert::same(435, $order->items[0]->unitPrice->cents, 'Einzelpreis aus dem Katalog');
        Assert::same('13.05', $order->total()->toDecimalString(), 'Gesamtsumme');
    }

    /** Regel 7: Ein mitgesendeter Preis ändert nichts. */
    public function testPricesInTheRequestAreIgnored(): void
    {
        $draft = $this->draft(['items' => [[
            'product_id' => 1, 'quantity' => 3,
            'unit_price' => '0.01', 'line_total' => '0.03',
        ]], 'total' => '0.03']);

        Assert::same('13.05', $this->place($draft)->total()->toDecimalString(),
            'Gesamtsumme unbeeinflusst von der Eingabe');
    }

    /** Regel 9: Mehrere Positionen werden korrekt summiert. */
    public function testMultipleItemsAreSummedCorrectly(): void
    {
        $order = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 3],   // 3 × 4.35 = 13.05
            ['product_id' => 2, 'quantity' => 7],   // 7 × 2.80 = 19.60
        ]]));

        Assert::same(2, $order->itemCount(), 'zwei Positionen');
        Assert::same('13.05', $order->items[0]->lineTotal->toDecimalString(), 'Position 1');
        Assert::same('19.60', $order->items[1]->lineTotal->toDecimalString(), 'Position 2');
        Assert::same('32.65', $order->total()->toDecimalString(), 'Summe');
    }

    /** Regel 10 im Zusammenspiel: viele krumme Beträge, kein Rundungsfehler. */
    public function testManyAwkwardAmountsSumExactly(): void
    {
        $catalog = ProductCatalog::fromList([
            new Product(1, 'A', null, Money::fromDecimalString('0.07'), 'Stück', true, 1),
            new Product(2, 'B', null, Money::fromDecimalString('0.10'), 'Stück', true, 2),
            new Product(3, 'C', null, Money::fromDecimalString('0.20'), 'Stück', true, 3),
        ]);
        $order = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 100],  // 7.00
            ['product_id' => 2, 'quantity' => 3],    // 0.30
            ['product_id' => 3, 'quantity' => 3],    // 0.60
        ]]), null, $catalog);

        Assert::same('7.90', $order->total()->toDecimalString(), 'Summe ohne Abweichung');
    }

    /** Regel 8: Eine Preisänderung wirkt nicht rückwirkend. */
    public function testPriceSnapshotSurvivesALaterPriceChange(): void
    {
        $order = $this->place();
        Assert::same('13.05', $order->total()->toDecimalString(), 'Summe zum Bestellzeitpunkt');

        // Buschmann erhöht den Preis. Der Katalog ist neu, die Bestellung nicht.
        $newCatalog = $this->catalog('5.00');
        Assert::same(500, $newCatalog->get(1)->unitPrice->cents, 'neuer Katalogpreis');

        Assert::same('13.05', $order->total()->toDecimalString(), 'alte Bestellung unverändert');
        Assert::same(435, $order->items[0]->unitPrice->cents, 'Preis-Snapshot unverändert');

        $newOrder = $this->place(null, null, $newCatalog);
        Assert::same('15.00', $newOrder->total()->toDecimalString(), 'neue Bestellung zum neuen Preis');
    }

    /** Der Name-Snapshot überlebt eine Umbenennung des Cafés genauso. */
    public function testNameSnapshotSurvivesARename(): void
    {
        $order   = $this->place();
        $renamed = new Customer(7, 'Café Neuer Name', null, null, null,
            new Address('Musterstraße 1', '40213', 'Düsseldorf'),
            true, FulfillmentType::Delivery, null);

        Assert::same('Café Beispiel', $order->customerNameSnapshot, 'alter Name in der Bestellung');
        Assert::same('Café Neuer Name', $renamed->name, 'neuer Name im Stammdatensatz');
    }

    /** Regel 3: Inaktive Produkte dürfen nicht neu bestellt werden. */
    public function testInactiveProductsCannotBeOrdered(): void
    {
        $catalog = $this->catalog('4.35', '2.80', false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [['product_id' => 2, 'quantity' => 1]]]), null, $catalog),
            'inaktives Produkt');
        Assert::true($e->hasError('items.0.product_id'), 'Fehler an der Position');
    }

    /** Aber: Ein inaktives Produkt bleibt in einer bestehenden Bestellung sichtbar. */
    public function testAnAlreadyPlacedOrderKeepsDeactivatedProducts(): void
    {
        // Bestellt wird, solange das Produkt aktiv ist.
        $order = $this->place($this->draft(['items' => [['product_id' => 2, 'quantity' => 4]]]));

        // Danach nimmt Buschmann es aus dem Sortiment.
        $withoutIt = $this->catalog('4.35', '2.80', false);
        Assert::false($withoutIt->get(2)->isActive, 'Produkt ist jetzt deaktiviert');
        Assert::count(1, $withoutIt->orderable(), 'und nicht mehr bestellbar');

        // Die bestehende Bestellung bleibt vollständig lesbar.
        Assert::same('Butterkuchen', $order->items[0]->productNameSnapshot, 'Snapshot bleibt');
        Assert::same('Blech', $order->items[0]->productUnitSnapshot, 'Einheit bleibt');
        Assert::same('11.20', $order->total()->toDecimalString(), 'Betrag bleibt');
    }

    public function testUnknownProductsAreRejected(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [['product_id' => 999, 'quantity' => 1]]])),
            'unbekanntes Produkt');
        Assert::true($e->hasError('items.0.product_id'), 'Fehler an der Position');
    }

    public function testAllProductProblemsAreReportedAtOnce(): void
    {
        $catalog = $this->catalog('4.35', '2.80', false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place($this->draft(['items' => [
                ['product_id' => 999, 'quantity' => 1],
                ['product_id' => 2, 'quantity' => 1],
            ]]), null, $catalog),
            'zwei Produktprobleme');
        Assert::same(2, count($e->errors()), 'beide Positionen gemeldet');
    }

    public function testInactiveCustomersCannotOrder(): void
    {
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place(null, $this->customer(FulfillmentType::Delivery, true, false)),
            'inaktiver Kunde');
        Assert::true($e->hasError('customer'), 'Fehler am Feld customer');
    }

    public function testDeliveryWithoutAnAddressIsRejected(): void
    {
        $pickupCustomer = $this->customer(FulfillmentType::Pickup, false);
        $e = Assert::throws(ValidationException::class,
            fn () => $this->place(null, $pickupCustomer),
            'Lieferung ohne hinterlegte Adresse');
        Assert::true($e->hasError('fulfillment_type'), 'Fehler am Feld fulfillment_type');
    }

    public function testPickupOrdersCarryNoAddress(): void
    {
        $order = Order::place(
            $this->customer(FulfillmentType::Pickup, false),
            $this->catalog(),
            $this->draft(['fulfillment_type' => 'pickup']),
            OrderNumber::fromYearAndSequence(2026, 2),
            $this->now(),
        );
        Assert::same(FulfillmentType::Pickup, $order->fulfillmentType, 'Abholung');
        Assert::null($order->deliveryAddressSnapshot, 'keine Adresse');
    }

    /** Regel 1: Eine Bestellung ohne Positionen ist ungültig. */
    public function testAnOrderWithoutItemsCannotExist(): void
    {
        Assert::throws(ValidationException::class,
            fn () => $this->draft(['items' => []]),
            'leere Bestellung wird schon im Entwurf abgelehnt');
    }

    public function testStatusFollowsTheAllowedPath(): void
    {
        $later = $this->now()->modify('+1 hour');
        $order = $this->place()->withStatus(OrderStatus::Confirmed, $later);

        Assert::same(OrderStatus::Confirmed, $order->status, 'bestätigt');
        Assert::same('2026-08-23 10:00:00', $order->updatedAt->format('Y-m-d H:i:s'), 'updatedAt gesetzt');
        Assert::same('2026-08-23 09:00:00', $order->createdAt->format('Y-m-d H:i:s'), 'createdAt unverändert');
        Assert::same('13.05', $order->total()->toDecimalString(), 'Betrag unverändert');
    }

    public function testForbiddenStatusChangesAreRejected(): void
    {
        $order = $this->place();
        Assert::throws(DomainException::class,
            fn () => $order->withStatus(OrderStatus::Completed, $this->now()),
            'neu direkt auf abgeschlossen');

        $cancelled = $order->withStatus(OrderStatus::Cancelled, $this->now());
        Assert::throws(DomainException::class,
            fn () => $cancelled->withStatus(OrderStatus::InProduction, $this->now()),
            'storniert zurück in Produktion');
    }

    public function testChangingStatusLeavesTheOriginalUntouched(): void
    {
        $order    = $this->place();
        $confirmed = $order->withStatus(OrderStatus::Confirmed, $this->now());
        Assert::same(OrderStatus::New, $order->status, 'Original unverändert');
        Assert::same(OrderStatus::Confirmed, $confirmed->status, 'Kopie geändert');
    }

    public function testReceivingIdsAfterPersistence(): void
    {
        $saved = $this->place()->withId(55);
        Assert::same(55, $saved->id, 'Bestell-ID');
        Assert::same('13.05', $saved->total()->toDecimalString(), 'Betrag unverändert');
    }

    /**
     * „Letzte Bestellung wiederholen" wird noch nicht gebaut — aber das
     * Modell muss es ohne Sonderarchitektur erlauben. Dieser Test belegt es.
     */
    public function testAnOrderCanBeRebuiltAsANewDraft(): void
    {
        $original = $this->place($this->draft(['items' => [
            ['product_id' => 1, 'quantity' => 3],
            ['product_id' => 2, 'quantity' => 7],
        ]]));

        $items = [];
        foreach ($original->items as $item) {
            $items[] = ['product_id' => $item->productId, 'quantity' => $item->quantity];
        }

        $repeat = Order::place(
            $this->customer(),
            $this->catalog(),
            OrderDraft::fromInput([
                'fulfillment_type' => $original->fulfillmentType->value,
                'fulfillment_date' => '2026-09-04',
                'items'            => $items,
            ], $this->now()),
            OrderNumber::fromYearAndSequence(2026, 2),
            $this->now(),
        );

        Assert::same('32.65', $repeat->total()->toDecimalString(), 'gleiche Summe');
        Assert::same('2026-09-04', $repeat->fulfillmentDate->toString(), 'neuer Liefertag');
        Assert::same('BUS-2026-000002', $repeat->orderNumber->toString(), 'eigene Bestellnummer');
    }
}
```

- [ ] **Schritt 2: Test ausführen, Fehlschlag bestätigen**

Ausführen: `php order-system/tests/run.php`
Erwartet: Fehlschläge mit `Class … Order not found`, Exit-Code 1.

- [ ] **Schritt 3: `Order` implementieren**

`order-system/src/Orders/Order.php`:

```php
<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

use Buschmann\OrderSystem\Customers\Customer;
use Buschmann\OrderSystem\Products\ProductCatalog;
use Buschmann\OrderSystem\Shared\DomainException;
use Buschmann\OrderSystem\Shared\InvalidArgumentException;
use Buschmann\OrderSystem\Shared\Money;
use Buschmann\OrderSystem\Shared\ValidationException;

/**
 * Eine Bestellung.
 *
 * Die Signatur von place() IST das Sicherheitsmodell: Kunde und
 * Produktkatalog kommen aus der Datenbank, der Entwurf aus der Anfrage — und
 * der Entwurf enthält nur Produkt-IDs und Mengen. Der Preis kann deshalb
 * nicht aus der Anfrage stammen, weil es dort nichts gibt, aus dem er
 * stammen könnte.
 *
 * Eine Bestellung ist unveränderlich. Statusänderungen liefern eine neue
 * Instanz. Das schützt die Snapshots vor versehentlicher Bearbeitung.
 */
final class Order
{
    public readonly ?string $note;

    /** @param OrderItem[] $items */
    private function __construct(
        public readonly ?int $id,
        public readonly OrderNumber $orderNumber,
        public readonly int $customerId,
        public readonly string $customerNameSnapshot,
        public readonly FulfillmentType $fulfillmentType,
        public readonly FulfillmentDate $fulfillmentDate,
        public readonly ?string $deliveryAddressSnapshot,
        ?string $note,
        public readonly OrderStatus $status,
        public readonly array $items,
        public readonly \DateTimeImmutable $createdAt,
        public readonly \DateTimeImmutable $updatedAt,
    ) {
        if ($items === []) {
            throw new InvalidArgumentException('Eine Bestellung braucht mindestens eine Position.');
        }
        if ($customerId <= 0) {
            throw new InvalidArgumentException('Die Kunden-ID der Bestellung ist ungültig.');
        }
        if (trim($customerNameSnapshot) === '') {
            throw new InvalidArgumentException('Der Kundenname der Bestellung fehlt.');
        }
        if ($fulfillmentType->requiresAddress()
            && ($deliveryAddressSnapshot === null || trim($deliveryAddressSnapshot) === '')) {
            throw new InvalidArgumentException('Eine Lieferung braucht eine Lieferadresse.');
        }

        $note = $note === null ? null : trim($note);
        if ($note !== null && mb_strlen($note) > 500) {
            throw new InvalidArgumentException('Die Notiz ist zu lang.');
        }
        $this->note = ($note === null || $note === '') ? null : $note;
    }

    public static function place(
        Customer $customer,
        ProductCatalog $catalog,
        OrderDraft $draft,
        OrderNumber $orderNumber,
        \DateTimeImmutable $now,
    ): self {
        $errors = [];

        if (!$customer->isActive) {
            $errors['customer'] = 'Für diesen Kunden können derzeit keine Bestellungen angelegt werden.';
        }

        $addressSnapshot = null;
        if ($draft->fulfillmentType->requiresAddress()) {
            if ($customer->deliveryAddress === null) {
                $errors['fulfillment_type'] = 'Für diesen Kunden ist keine Lieferadresse hinterlegt.';
            } else {
                $addressSnapshot = $customer->deliveryAddress->toSingleLine();
            }
        }

        $items = [];
        foreach ($draft->items as $index => $draftItem) {
            $product = $catalog->find($draftItem['product_id']);

            if ($product === null) {
                $errors['items.' . $index . '.product_id'] = 'Dieses Produkt gibt es nicht.';
                continue;
            }
            if (!$product->isActive) {
                $errors['items.' . $index . '.product_id'] = 'Dieses Produkt ist derzeit nicht bestellbar.';
                continue;
            }

            $items[] = OrderItem::forProduct($product, $draftItem['quantity']);
        }

        if ($items === [] && $errors === []) {
            $errors['items'] = 'Bitte mindestens ein Produkt bestellen.';
        }

        if ($errors !== []) {
            throw new ValidationException($errors);
        }

        return new self(
            null,
            $orderNumber,
            $customer->id,
            $customer->name,
            $draft->fulfillmentType,
            $draft->fulfillmentDate,
            $addressSnapshot,
            $draft->note,
            OrderStatus::New,
            $items,
            $now,
            $now,
        );
    }

    /** Die Bestellsumme wird berechnet, nie entgegengenommen. */
    public function total(): Money
    {
        $total = Money::zero();
        foreach ($this->items as $item) {
            $total = $total->plus($item->lineTotal);
        }
        return $total;
    }

    public function itemCount(): int
    {
        return count($this->items);
    }

    public function withStatus(OrderStatus $target, \DateTimeImmutable $now): self
    {
        if (!$this->status->canTransitionTo($target)) {
            throw new DomainException(sprintf(
                'Eine Bestellung im Status „%s" kann nicht auf „%s" gesetzt werden.',
                $this->status->label(),
                $target->label(),
            ));
        }
        return $this->copyWith(status: $target, updatedAt: $now);
    }

    public function withId(int $id): self
    {
        if ($id <= 0) {
            throw new InvalidArgumentException('Die Bestell-ID ist ungültig.');
        }
        return $this->copyWith(id: $id);
    }

    private function copyWith(
        ?int $id = null,
        ?OrderStatus $status = null,
        ?\DateTimeImmutable $updatedAt = null,
    ): self {
        return new self(
            $id ?? $this->id,
            $this->orderNumber,
            $this->customerId,
            $this->customerNameSnapshot,
            $this->fulfillmentType,
            $this->fulfillmentDate,
            $this->deliveryAddressSnapshot,
            $this->note,
            $status ?? $this->status,
            $this->items,
            $this->createdAt,
            $updatedAt ?? $this->updatedAt,
        );
    }
}
```

- [ ] **Schritt 4: Tests ausführen, Grünlauf bestätigen**

Ausführen: `php order-system/tests/run.php; echo "Exit=$?"`
Erwartet: `108 Tests, 108 erfolgreich, 0 fehlgeschlagen`, `Exit=0`.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/src/Orders/Order.php order-system/tests/Orders/OrderTest.php
git commit -m "feat(order-system): Order-Aggregat mit serverseitiger Preislogik und Snapshots"
```

---

## Task 13: Datenbankschema als Migrationen

Kein Testlauf möglich (Phase 1 hat keine Datenbankverbindung). Die Prüfung
ist deshalb ein Syntaxdurchlauf gegen eine leere Datenbank und die
Übereinstimmung mit dem Domänenmodell.

**Files:**
- Create: `order-system/database/migrations/001_create_schema_migrations.sql`
- Create: `order-system/database/migrations/002_create_customers.sql`
- Create: `order-system/database/migrations/003_create_products.sql`
- Create: `order-system/database/migrations/004_create_orders.sql`
- Create: `order-system/database/migrations/005_create_order_items.sql`
- Create: `order-system/database/migrations/006_create_order_number_sequences.sql`
- Create: `order-system/database/README.md`

**Interfaces:**
- Consumes: die Feldlängen und Wertebereiche aus den Tasks 2–12. Jede
  `VARCHAR`-Länge hier entspricht exakt der Prüfung in der zugehörigen
  Entity; `DECIMAL(10,2)` entspricht `Money::MAX_CENTS`.

- [ ] **Schritt 1: Migrationen schreiben**

`001_create_schema_migrations.sql`:

```sql
-- Welche Migration wurde wann auf dieser Umgebung angewandt.
CREATE TABLE schema_migrations (
    filename   VARCHAR(190) NOT NULL,
    applied_at DATETIME     NOT NULL,
    PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`002_create_customers.sql`:

```sql
-- Geschäftskunden (Cafés) und Privat-/Sonderkunden.
--
-- Datenminimierung ist Voreinstellung: Pflicht ist ausschließlich der Name.
-- Ansprechpartner, E-Mail und Telefon sind optional, weil ein Café zur
-- Bestellung keinen personenbezogenen Kontakt braucht.
--
-- internal_note ist für BETRIEBLICHE Hinweise („Lieferung an der Rückseite").
-- Niemals für Angaben über Personen, niemals für besondere Datenkategorien.
--
-- Die Regel „Standardlieferung ⇒ Lieferadresse" verbindet mehrere Spalten und
-- steht deshalb in Customer.php, wo sie eine verständliche Meldung erzeugt.
CREATE TABLE customers (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                 VARCHAR(120) NOT NULL,
    contact_person       VARCHAR(120)     NULL,
    email                VARCHAR(190)     NULL,
    phone                VARCHAR(40)      NULL,
    delivery_street      VARCHAR(160)     NULL,
    delivery_postal_code VARCHAR(10)      NULL,
    delivery_city        VARCHAR(100)     NULL,
    is_active            TINYINT(1)   NOT NULL DEFAULT 1,
    default_fulfillment  ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery',
    internal_note        TEXT             NULL,
    created_at           DATETIME     NOT NULL,
    updated_at           DATETIME     NOT NULL,
    PRIMARY KEY (id),
    KEY idx_customers_active_name (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`003_create_products.sql`:

```sql
-- Bestellbare Produkte.
--
-- Produkte werden NIE gelöscht, sondern über is_active deaktiviert: Auf
-- order_items.product_id liegt ON DELETE RESTRICT, damit historische
-- Bestellungen ihren Bezug behalten.
--
-- unit ist ein freies Anzeigelabel („Stück", „Blech", „kg") und geht in keine
-- Berechnung ein. Eine ENUM hier würde jede neue Einheit zu einem Deployment
-- machen.
--
-- Geld als DECIMAL(10,2): exakt, in Backups und Auswertungen lesbar, und
-- summierbar per SQL. Die Anwendung rechnet in ganzzahligen Cent (Money.php);
-- die Umwandlung liegt an genau einer getesteten Stelle.
CREATE TABLE products (
    id          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    name        VARCHAR(120)   NOT NULL,
    description VARCHAR(500)       NULL,
    unit_price  DECIMAL(10,2)  NOT NULL,
    unit        VARCHAR(20)    NOT NULL,
    is_active   TINYINT(1)     NOT NULL DEFAULT 1,
    sort_order  INT            NOT NULL DEFAULT 0,
    created_at  DATETIME       NOT NULL,
    updated_at  DATETIME       NOT NULL,
    PRIMARY KEY (id),
    -- Deckt exakt die eine Abfrage der Bestellseite ab: das vollständige
    -- aktive Sortiment in Anzeigereihenfolge, in einem Zugriff.
    KEY idx_products_orderable (is_active, sort_order, id),
    CONSTRAINT chk_products_price_not_negative CHECK (unit_price >= 0),
    CONSTRAINT chk_products_sort_not_negative  CHECK (sort_order >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`004_create_orders.sql`:

```sql
-- Bestellungen.
--
-- Eine Bestellung ist ein DOKUMENT, keine Sicht auf den aktuellen
-- Stammdatenbestand. Deshalb tragen customer_name_snapshot und
-- delivery_address_snapshot den Stand zum Bestellzeitpunkt: Benennt ein Café
-- sich um oder zieht es um, ändert sich eine Bestellung von letzter Woche
-- nicht rückwirkend.
--
-- total_amount wird beim Anlegen einmal geschrieben und danach nicht mehr
-- angefasst — dieselbe Begründung, und die Tagesübersichten der Phase 2
-- müssen dafür nicht über order_items aggregieren.
--
-- fulfillment_date ist DATE: Ein Café bestellt „für Freitag", nicht „für
-- Freitag 14:32".
--
-- Zeitstempel in UTC, geschrieben von der Anwendung. Kein TIMESTAMP, dessen
-- Zeitzonenverhalten von der Serverkonfiguration abhängt.
CREATE TABLE orders (
    id                        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_number              VARCHAR(20)   NOT NULL,
    customer_id               INT UNSIGNED  NOT NULL,
    customer_name_snapshot    VARCHAR(120)  NOT NULL,
    fulfillment_type          ENUM('delivery','pickup') NOT NULL,
    fulfillment_date          DATE          NOT NULL,
    delivery_address_snapshot VARCHAR(400)      NULL,
    note                      VARCHAR(500)      NULL,
    status                    ENUM('new','confirmed','in_production','completed','cancelled')
                                            NOT NULL DEFAULT 'new',
    total_amount              DECIMAL(10,2) NOT NULL,
    created_at                DATETIME      NOT NULL,
    updated_at                DATETIME      NOT NULL,
    PRIMARY KEY (id),
    -- Die Eindeutigkeit hängt an der Datenbank, nicht am Anwendungscode.
    UNIQUE KEY uq_orders_order_number (order_number),
    -- „Was ist für Freitag zu produzieren?" — die wichtigste Abfrage des Betriebs.
    KEY idx_orders_day (fulfillment_date, status),
    -- „Die letzte Bestellung dieses Cafés" — Grundlage für „Bestellung wiederholen".
    KEY idx_orders_customer_day (customer_id, fulfillment_date),
    -- RESTRICT: Ein Kunde mit Bestellungen wird deaktiviert, nicht gelöscht.
    -- Ein Löschverlangen wird als Anonymisierung umgesetzt; der Namens-
    -- Snapshot hält die Bestellung dann weiterhin lesbar.
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_orders_total_not_negative CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`005_create_order_items.sql`:

```sql
-- Bestellpositionen.
--
-- unit_price ist der Preis-SNAPSHOT zum Bestellzeitpunkt, nicht der aktuelle
-- Produktpreis. Eine spätere Preisänderung darf historische Bestellungen
-- nicht verändern.
--
-- line_total wird von der Anwendung als unit_price × quantity berechnet und
-- einmal geschrieben. Der Konstruktor von OrderItem nimmt den Betrag gar
-- nicht erst entgegen — es gibt im Code keinen Weg, einen abweichenden Wert
-- zu setzen.
--
-- Die CHECK-Bedingungen setzt MariaDB ab 10.2 durch; ältere MySQL-Versionen
-- ignorieren sie stillschweigend. Die Domäne erzwingt dieselben Regeln
-- unabhängig davon — das Schema ist die zweite Verteidigungslinie.
CREATE TABLE order_items (
    id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_id              INT UNSIGNED  NOT NULL,
    product_id            INT UNSIGNED  NOT NULL,
    product_name_snapshot VARCHAR(120)  NOT NULL,
    product_unit_snapshot VARCHAR(20)   NOT NULL,
    unit_price            DECIMAL(10,2) NOT NULL,
    quantity              INT UNSIGNED  NOT NULL,
    line_total            DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    -- CASCADE: Positionen ohne Bestellung sind sinnlos.
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- RESTRICT: Ein je bestelltes Produkt darf nicht verschwinden.
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_order_items_price_not_negative CHECK (unit_price >= 0),
    CONSTRAINT chk_order_items_total_not_negative CHECK (line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`006_create_order_number_sequences.sql`:

```sql
-- Laufende Nummer je Kalenderjahr für das Format BUS-JJJJ-NNNNNN.
--
-- Bewusst NICHT aus MAX(id)+1 und nicht aus der AUTO_INCREMENT-ID der
-- Bestellung. Die Vergabe erfolgt atomar in EINER Anweisung:
--
--   INSERT INTO order_number_sequences (year, next_value)
--   VALUES (:year, LAST_INSERT_ID(1))
--   ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1);
--   SELECT LAST_INSERT_ID();
--
-- LAST_INSERT_ID(expr) setzt den Wert auch im INSERT-Zweig, deshalb liefert
-- das SELECT in beiden Fällen die richtige Zahl. Keine Race Condition, kein
-- SELECT … FOR UPDATE, lauffähig auf jedem Shared Hosting.
--
-- Lücken sind zulässig und erwartet: Rollt eine Transaktion zurück, ist die
-- Nummer verbraucht. Lückenlosigkeit ist eine Anforderung an
-- Rechnungsnummern, nicht an Bestellnummern.
CREATE TABLE order_number_sequences (
    year       SMALLINT UNSIGNED NOT NULL,
    next_value INT UNSIGNED      NOT NULL,
    PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Schritt 2: `order-system/database/README.md` schreiben**

````markdown
# Datenbank

MariaDB 10.2+ oder MySQL 8.0+, `utf8mb4`, InnoDB.

## Migrationen anwenden

In Phase 1 gibt es bewusst keinen Migrationsrunner: Er bräuchte eine
Datenbankverbindung, die das Fundament nicht hat, und wäre damit ungetestet.
Die Migrationen werden in aufsteigender Reihenfolge angewandt.

Per Kommandozeile:

```bash
for f in order-system/database/migrations/*.sql; do
  mysql -u BENUTZER -p DATENBANK < "$f"
done
```

Über phpMyAdmin: Reiter „Importieren", jede Datei einzeln, in der
Reihenfolge der Nummern.

Nach jeder angewandten Datei den Vermerk setzen:

```sql
INSERT INTO schema_migrations (filename, applied_at)
VALUES ('002_create_customers.sql', UTC_TIMESTAMP());
```

## Reihenfolge ist verbindlich

`004_create_orders.sql` verweist auf `customers`, `005_create_order_items.sql`
auf `orders` und `products`. Eine Migration außer der Reihe scheitert am
Fremdschlüssel — das ist beabsichtigt.

## Seeds

`seeds/` enthält ausschließlich **Platzhalterdaten für die Entwicklung**.
Keine echten Buschmann-Preise, keine echten Kunden. Niemals in eine
produktive Datenbank einspielen.

## Zeitzonen

Alle `DATETIME`-Spalten enthalten **UTC**, geschrieben von der Anwendung.
`TIMESTAMP` wird bewusst nicht verwendet, weil dessen Zeitzonenumrechnung von
der Serverkonfiguration abhängt und auf Shared Hosting nicht kontrollierbar
ist.

## Geld

`DECIMAL(10,2)`, niemals `FLOAT` oder `DOUBLE`. Die Anwendung rechnet in
ganzzahligen Cent; die Umwandlung liegt allein in `src/Shared/Money.php` und
ist dort getestet. Der Wertebereich von `Money` entspricht exakt dem, was
`DECIMAL(10,2)` speichern kann.
````

- [ ] **Schritt 3: Migrationen gegen eine echte Datenbank prüfen (optional, empfohlen)**

Wenn lokal MariaDB oder MySQL verfügbar ist:

```bash
mysql -u root -e "CREATE DATABASE buschmann_order_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
for f in order-system/database/migrations/*.sql; do
  mysql -u root buschmann_order_test < "$f" || echo "FEHLER in $f"
done
mysql -u root buschmann_order_test -e "SHOW TABLES; SHOW CREATE TABLE order_items\G"
mysql -u root -e "DROP DATABASE buschmann_order_test;"
```

Erwartet: sechs Tabellen, keine Fehlermeldung, Fremdschlüssel in
`SHOW CREATE TABLE` sichtbar.

Ist keine Datenbank verfügbar: Diesen Schritt **ausdrücklich als
ungeprüft ausweisen** und nicht als erledigt melden. Der erste Import auf
dem Hosting ist dann die Prüfung.

- [ ] **Schritt 4: Feldlängen gegen die Entities abgleichen**

```bash
grep -n -E '> *(120|20|500|190|40|1000|160|10|100|400)' order-system/src/**/*.php
grep -n -E 'VARCHAR\(' order-system/database/migrations/*.sql
```

Erwartet: Jede `VARCHAR`-Länge im Schema hat eine entsprechende Prüfung in
einer Entity. Abweichungen sind Fehler — die Datenbank würde sonst
stillschweigend abschneiden.

- [ ] **Schritt 5: Commit**

```bash
git add order-system/database
git commit -m "feat(order-system): MariaDB-Schema als Migrationen"
```

---

## Task 14: Seed-Struktur mit Platzhalterdaten

**Files:**
- Create: `order-system/database/seeds/001_products_placeholder.sql`
- Create: `order-system/database/seeds/002_customers_placeholder.sql`

- [ ] **Schritt 1: Seeds schreiben**

`001_products_placeholder.sql`:

```sql
-- ============================================================================
--  PLATZHALTERDATEN FÜR DIE ENTWICKLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Die Preise sind FREI ERFUNDEN und stellen keine Buschmann-Preise dar.
--  Verbindliche Fakten zum Sortiment stehen in content/FACTS.md; dort sind
--  keine Preise hinterlegt, und es werden hier auch keine erfunden, die als
--  echt missverstanden werden könnten.
-- ============================================================================

INSERT INTO products
    (name, description, unit_price, unit, is_active, sort_order, created_at, updated_at)
VALUES
    ('Beispielkuchen A', 'Platzhalter — Beschreibung folgt', 4.35, 'Stück', 1, 10, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispielkuchen B', NULL,                               2.80, 'Blech', 1, 20, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispieltorte C',  'Platzhalter — Beschreibung folgt', 24.00, 'Torte', 1, 30, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Beispielgebäck D', NULL,                               1.20, 'Stück', 1, 40, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
    ('Saisonartikel E',  'Nur zeitweise im Sortiment',      3.50, 'Stück', 0, 50, UTC_TIMESTAMP(), UTC_TIMESTAMP());
```

`002_customers_placeholder.sql`:

```sql
-- ============================================================================
--  PLATZHALTERDATEN FÜR DIE ENTWICKLUNG — NICHT PRODUKTIV EINSPIELEN
--
--  Es sind KEINE echten Kunden, Adressen oder Kontaktdaten enthalten und es
--  dürfen auch keine eingetragen werden. Echte Kundendaten gehören in die
--  produktive Datenbank, niemals in ein Repository.
-- ============================================================================

INSERT INTO customers
    (name, contact_person, email, phone, delivery_street, delivery_postal_code,
     delivery_city, is_active, default_fulfillment, internal_note, created_at, updated_at)
VALUES
    ('Beispielcafé Nord', NULL, NULL, NULL,
     'Beispielweg 1', '40213', 'Düsseldorf', 1, 'delivery',
     'Platzhalter — betrieblicher Hinweis, niemals Angaben über Personen',
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Beispielcafé Süd', NULL, NULL, NULL,
     'Beispielallee 22', '40215', 'Düsseldorf', 1, 'delivery', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Beispiel-Abholkunde', NULL, NULL, NULL,
     NULL, NULL, NULL, 1, 'pickup', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP()),

    ('Ehemaliges Beispielcafé', NULL, NULL, NULL,
     'Beispielstraße 5', '40210', 'Düsseldorf', 0, 'delivery', NULL,
     UTC_TIMESTAMP(), UTC_TIMESTAMP());
```

- [ ] **Schritt 2: Prüfen, dass keine echten Daten enthalten sind**

```bash
grep -n -i -E 'buschmann|schwarz|akademiestr|cheesecake|@|0211|0170|0151' \
     order-system/database/seeds/*.sql
```
Erwartet: **keine Treffer**. Jeder Treffer ist zu entfernen, bevor
committet wird.

- [ ] **Schritt 3: Commit**

```bash
git add order-system/database/seeds
git commit -m "feat(order-system): Seed-Struktur mit gekennzeichneten Platzhalterdaten"
```

---

## Task 15: README des Subsystems

**Files:**
- Create: `order-system/README.md`

- [ ] **Schritt 1: README schreiben**

````markdown
# Buschmann 1846 — Bestellsystem

## Was ist das?

Ein B2B-Vorbestellsystem für Buschmann 1846. Es lebt in diesem Repository
neben der Website, ist aber ein **eigenständiges Subsystem**: eigener Stack,
eigenes Deployment, keine gemeinsame Laufzeit mit den statischen Seiten.

**Es ist kein Onlineshop.** Keine Zahlungsabwicklung, kein anonymer
Endkundenverkauf, kein Marketingkatalog.

## Warum gibt es das?

Buschmann beliefert überwiegend feste Cafés in Düsseldorf, die regelmäßig
bestellen. Diese Bestellungen laufen bisher über informelle Kanäle. Daraus
folgt: keine strukturierten Daten für die Produktionsplanung, kein
nachvollziehbarer Preisstand, viel manuelle Übertragung.

Die entscheidende Anforderung ist eine UX-Anforderung:

> Eine Bestellung über das System muss für ein Stammcafé schneller und
> angenehmer sein als dieselbe Bestellung über WhatsApp.

Zielgröße für eine typische Wiederholungsbestellung: 20–30 Sekunden.

## Was gehört zu Phase 1?

Ein persistenzfreier, vollständig getesteter Domänenkern plus das
Datenbankschema:

- `Money` — exakte Geldarithmetik in ganzzahligen Cent
- `Address`, `OrderNumber`, `FulfillmentDate` — Value Objects
- `Product`, `Customer`, `Order`, `OrderItem` — Entities mit Invarianten
- `OrderStatus`, `FulfillmentType` — Enums mit zentral definierten Werten
- `ProductCatalog` — die einzige Quelle, aus der Preise stammen dürfen
- `OrderDraft` — Eingabe-Whitelist **ohne Preisfeld**
- MariaDB-Schema als nummerierte Migrationen
- Seeds mit gekennzeichneten Platzhalterdaten

## Was gehört ausdrücklich noch NICHT dazu?

Keine Bestelloberfläche · keine Adminoberfläche · keine
Datenbank-Zugriffsschicht · kein Mailversand · kein Login · kein Passwort ·
keine Zahlungsabwicklung · kein Stripe, PayPal, Shopify, WooCommerce,
Supabase oder Firebase · kein CRM · kein Newsletter · keine Treuepunkte oder
Gutscheine · keine Lagerverwaltung oder Warenwirtschaft · keine Buchhaltung ·
kein Rechnungsgenerator · keine Lieferfahrer-App · keine Routenoptimierung ·
keine Analytics · kein Chat · keine WhatsApp-Integration · keine
KI-Funktionen · keine App · keine Mandantenfähigkeit · keine
Produktvarianten · keine Rabatte · kein Umsatzsteuerausweis.

Das ist keine Aufschubliste, sondern eine Abgrenzung. Was hier steht, wird
nicht „vorbereitet" — nichts davon hat Platzhalter im Code.

## Wie führt man die Tests aus?

```bash
php order-system/tests/run.php
```

Exit-Code 0 bedeutet: alle Tests grün. Zusätzlich die Syntaxprüfung:

```bash
find order-system -name '*.php' -exec php -l {} \;
```

Der Test-Runner ist selbstgeschrieben (`tests/run.php`, rund hundert Zeilen)
und hat keine Abhängigkeiten. Die Testklassen sind bewusst PHPUnit-förmig
(`class …Test`, Methoden `test…()`), damit eine spätere Umstellung
Konfigurationsarbeit bleibt und keine Umschreibung wird.

## Welche Runtime wird benötigt?

- **PHP 8.1 oder neuer**, nur Standardbibliothek. Kein Composer, kein
  `vendor/`, kein npm.
  PHP 8.1 wegen `enum` (Statuswerte werden auf Typebene unfälschbar) und
  `readonly` (Unveränderlichkeit wird erzwungen statt nur vereinbart).
- **MariaDB 10.2+ oder MySQL 8.0+** — erst ab Phase 2 tatsächlich benötigt.
- **Apache mit `.htaccess`** — Zielhosting IONOS.

Auf macOS ist PHP nicht mehr vorinstalliert: `brew install php`.

## Wie sieht die Struktur aus?

```
order-system/
├── autoload.php        PSR-4-Autoloader, ~20 Zeilen
├── config/             config.php (gitignored) + config.example.php
├── database/           Migrationen und Seeds, siehe database/README.md
├── public/             Web-Root ab Phase 2 — heute leer
├── admin/              Adminanwendung ab Phase 2 — heute leer
├── src/
│   ├── Shared/         Money, Address, Fehlerhierarchie
│   ├── Products/       Product, ProductCatalog
│   ├── Customers/      Customer
│   └── Orders/         Order, OrderItem, OrderDraft, Status, Fulfillment,
│                       OrderNumber
└── tests/              run.php + Testklassen, Struktur spiegelt src/
```

Abhängigkeitsrichtung, verbindlich:
`Orders → Products, Customers → Shared`. Keine Rückwärtskante. Ein `Product`
weiß nicht, in welchen Bestellungen es vorkommt.

## Die drei Entscheidungen, die man kennen muss

**1. Geld ist ganzzahliger Cent, in der Datenbank `DECIMAL(10,2)`.**
PHP hat keinen Dezimaltyp, und MariaDB liefert `DECIMAL` als String — jede
Rechnung damit würde still nach `float` konvertieren. Die Umwandlung liegt
allein in `Money` und ist dort getestet. Niemals `float`, niemals `floatval`.

**2. Der Preis kann nicht aus der Anfrage kommen.**
Nicht weil er geprüft wird, sondern weil `OrderDraft` **kein Preisfeld hat**
und `OrderItem` seinen Positionsbetrag selbst berechnet. Aus der Anfrage
kommen ausschließlich Produkt-IDs und Mengen.

**3. Eine Bestellung ist ein Dokument.**
Name, Einheit, Preis und Lieferadresse werden als Snapshot gespeichert. Eine
spätere Preisänderung oder Umbenennung verändert historische Bestellungen
nicht. Deshalb werden Produkte und Kunden **deaktiviert, nicht gelöscht**.

## Deployment (ab Phase 2)

Nur `public/` gehört in den Web-Root — empfohlen als eigene Subdomain
(`bestellung.<domain>`). Konfiguration, Quelltext, Migrationen und Protokolle
liegen darüber. Zusätzlich trägt jedes nicht-öffentliche Verzeichnis eine
`.htaccess` mit `Require all denied`.

**`order-system/` gehört NICHT in ein GitHub-Pages-Deployment.** GitHub Pages
führt PHP nicht aus, sondern liefert `.php`-Dateien als Klartext aus. Der
Quelltext enthält zwar keine Geheimnisse — `config/config.php` ist gitignored
und liegt nie im Repository —, aber ausgeliefert werden soll er trotzdem
nicht.

## Wo beginnt Phase 2?

In dieser Reihenfolge:

1. **PDO-Verbindung und Repositories** — `ProductRepository`,
   `CustomerRepository`, `OrderRepository`. Ausschließlich Prepared
   Statements, `EMULATE_PREPARES = false`, keine Stringinterpolation in SQL.
2. **Vergabe der Bestellnummer** in derselben Transaktion wie das Anlegen der
   Bestellung, über das Idiom in `database/migrations/006`.
3. **Bestellseite** in `public/` — ein Formular, Mengen über `− / +`,
   Lieferdatum, Notiz, absenden. Ohne JavaScript grundsätzlich benutzbar.
   CSRF-Token per `random_bytes(32)` und `hash_equals()`. Ausgabe
   ausnahmslos durch `htmlspecialchars(…, ENT_QUOTES | ENT_SUBSTITUTE,
   'UTF-8')`.
4. **Kundenspezifischer Bestell-Link** — Spalte
   `public_token CHAR(32) UNIQUE` auf `customers`. Bewusst noch nicht
   angelegt: Eine ungenutzte Token-Spalte wäre eine Sicherheitsfassade.
   **Die Bestellnummer darf niemals als Zugriffsschlüssel dienen** — sie ist
   fortlaufend und damit erratbar.
5. **Adminbereich** in `admin/`, nicht öffentlich erreichbar, zusätzlich per
   HTTP-Basic-Auth über den Webserver geschützt.
6. **„Letzte Bestellung wiederholen"** — braucht keine neue Architektur; der
   Index `(customer_id, fulfillment_date)` und `OrderDraft` genügen. Ein Test
   in `OrderTest` belegt das bereits.

Verbindliche Grundlagen:
`docs/superpowers/specs/2026-08-23-buschmann-order-system-foundation-design.md`
und
`docs/superpowers/plans/2026-08-23-buschmann-order-system-foundation.md`.
````

- [ ] **Schritt 2: Commit**

```bash
git add order-system/README.md
git commit -m "docs(order-system): README des Subsystems"
```

---

## Task 16: Abschlussprüfung gegen die Definition of Done

Kein neuer Code. Dieser Task belegt, dass Phase 1 die Definition of Done aus
§18 der Spezifikation tatsächlich erfüllt — mit Ausgaben, nicht mit
Behauptungen.

- [ ] **Schritt 1: Die bestehende Website ist unverändert**

```bash
git diff --stat rebuild/flagship-recovery..HEAD -- \
  index.html en assets impressum datenschutz sitemap.xml robots.txt .nojekyll README.md
```
Erwartet: **keine Ausgabe**. Jede Zeile hier ist ein Verstoß gegen §9 des
Briefings und muss rückgängig gemacht werden.

- [ ] **Schritt 2: Alle Änderungen liegen im erlaubten Bereich**

```bash
git diff --name-only rebuild/flagship-recovery..HEAD | grep -v -E '^(order-system/|docs/superpowers/|\.gitignore$)'
```
Erwartet: **keine Ausgabe**.

- [ ] **Schritt 3: Syntaxprüfung**

```bash
find order-system -name '*.php' -exec php -l {} \; | grep -v 'No syntax errors'
```
Erwartet: **keine Ausgabe**.

- [ ] **Schritt 4: Testlauf**

```bash
php order-system/tests/run.php; echo "Exit=$?"
```
Erwartet: `… Tests, … erfolgreich, 0 fehlgeschlagen`, `Exit=0`.
Die Ausgabe wird im Abschlussbericht **wörtlich** wiedergegeben.

- [ ] **Schritt 5: Kein Geheimnis im Repository**

```bash
git ls-files order-system | grep -E 'config\.php$' || echo "OK: keine config.php eingecheckt"
grep -rn -i -E 'password\s*=>\s*[^P]|secret|api[_-]?key' order-system/ --include='*.php' \
  | grep -v config.example.php || echo "OK: keine Zugangsdaten im Code"
```
Erwartet: beide Male die `OK`-Meldung.

- [ ] **Schritt 6: Keine verbotene Abhängigkeit**

```bash
ls order-system/composer.json order-system/package.json order-system/vendor 2>&1 | grep -v 'No such file' \
  || echo "OK: keine Composer-, npm- oder vendor-Artefakte"
grep -rn -i -E 'stripe|paypal|shopify|firebase|supabase|woocommerce' order-system/ \
  || echo "OK: keine Zahlungs- oder SaaS-Anbindung"
```
Erwartet: beide Male die `OK`-Meldung.

- [ ] **Schritt 7: Die zehn Geschäftsregeln sind abgedeckt**

```bash
grep -rn -E 'public function test' order-system/tests | wc -l
grep -rln -E 'Regel [0-9]' order-system/tests
```
Erwartet: Die Testanzahl entspricht dem Testlauf; die Regeln 1–10 aus §16 der
Spezifikation lassen sich in `MoneyTest`, `OrderTest`, `OrderItemTest`,
`OrderDraftTest`, `OrderStatusTest` und `FulfillmentTypeTest` benennen.

- [ ] **Schritt 8: Branchzustand**

```bash
git branch --show-current
git status --short
git log --oneline rebuild/flagship-recovery..HEAD
```
Erwartet: `feature/order-system-foundation`, sauberer Arbeitsbaum, eine
lesbare Commitfolge. **Kein Merge, kein Push nach `main`** — ein `main`
existiert in diesem Repository ohnehin nicht, weder lokal noch auf `origin`.

---

## Self-Review

**Spec-Abdeckung.** Jeder Abschnitt der Spezifikation hat einen Task:
Problemdefinition/Nutzergruppen/UX-Prinzipien → Rahmen aller Tasks ·
Scope/Non-Goals → Global Constraints und Task 15 · Architektur/Modulgrenzen →
Task 1 und Dateistruktur · Money (7.0) → Task 2 · Product (7.1) → Task 4 ·
Customer (7.2) → Task 6 · Order (7.3) → Task 12 · OrderItem (7.4) → Task 10 ·
Snapshots (7.5) → Tasks 10 und 12 · Fulfillment (7.6) → Task 5 ·
OrderStatus (7.7) → Task 7 · Bestellnummern (§8) → Task 8 und Migration 006 ·
serverseitige Preislogik (§9) → Tasks 9, 11, 12 · Validierungsstrategie (§10)
→ Tasks 1, 11, 12 · Sicherheitsmodell (§11) → Task 1 (Umsetzung), Task 15
(Entwurf) · Fehlerbehandlung (§12) → Task 1 · Datenschutz (§13) → Tasks 6,
13, 14 · Hosting/Deployment (§14) → Tasks 1, 15 · Datenbankschema (§15) →
Task 13 · Teststrategie (§16) → Tasks 1–12 · Erweiterungspunkte (§17) →
Task 15 · Definition of Done (§18) → Task 16.

**Keine Lücke gefunden.** Zwei Punkte sind bewusst ohne Task, weil sie
Non-Goals sind: die Repository-/PDO-Schicht und die Spalte `public_token`.
Beide sind in Task 15 als Phase-2-Einstieg dokumentiert.

**Typkonsistenz.** `Money::fromDecimalString`/`toDecimalString`,
`FulfillmentDate::fromString`/`toString`,
`OrderNumber::fromString`/`toString`, `ProductCatalog::find`/`get`/`orderable`,
`OrderItem::forProduct`/`withId`, `Order::place`/`total`/`withStatus`/`withId`
werden in allen Tasks unter demselben Namen und mit derselben Signatur
verwendet. `OrderItem::MAX_QUANTITY` wird in Task 10 definiert und in Task 11
verwendet. `ValidationException::field`/`errors`/`hasError` wird in Task 1
definiert und ab Task 5 verwendet.

**Zwei Stellen, an denen die Testerwartung von der Implementierung abhängt
und deshalb genau zu lesen ist:**

1. `OrderDraft::readItems` darf den allgemeinen `items`-Hinweis **nicht**
   setzen, wenn bereits Positionsfehler gemeldet sind — sonst zählt
   `testAllErrorsAreCollectedNotJustTheFirst` fünf statt vier Fehler.
2. Die kumulierten Testzahlen in „Schritt 4" jedes Tasks sind Erwartungswerte
   für den Fall, dass die Tasks der Reihe nach abgearbeitet werden. Werden
   Tests ergänzt, ist die Zahl anzupassen — der prüfbare Teil ist
   `0 fehlgeschlagen` und `Exit=0`.
