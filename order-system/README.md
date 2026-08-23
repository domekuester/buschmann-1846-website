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

`src/Delivery/` gibt es bewusst nicht: Lieferung ist in Phase 1 keine eigene
Domäne, sondern eine Eigenschaft einer Bestellung. Ein leeres Modul würde
dazu einladen, dort verfrüht Touren- oder Fahrerlogik anzusiedeln.

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
