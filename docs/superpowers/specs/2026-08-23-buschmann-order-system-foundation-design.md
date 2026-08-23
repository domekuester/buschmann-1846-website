# Buschmann 1846 — Bestellsystem, Phase 1: Foundation Design

**Datum:** 2026-08-23
**Branch:** `feature/order-system-foundation`
**Status:** verbindliche Entwurfsgrundlage für Phase 1
**Gilt für:** `order-system/` — nicht für die bestehende Website

> Dieses Dokument beschreibt **nur das Fundament**. Es beschreibt kein fertiges
> Produkt, keine Bestelloberfläche und keine Adminanwendung. Was Phase 1
> ausdrücklich *nicht* enthält, steht unter „Non-Goals" — diese Liste ist Teil
> der Spezifikation, nicht ein Vorbehalt.

---

## 1. Problemdefinition

Buschmann 1846 beliefert überwiegend eine überschaubare Zahl fester Cafés in
Düsseldorf mit Kuchen und Pâtisserie. Diese Geschäftskunden bestellen
regelmäßig, meist dieselben Positionen in wechselnden Mengen. Daneben gibt es
gelegentliche Privat- oder Sonderbestellungen, die überwiegend selbst abgeholt
werden.

Bestellungen laufen heute über informelle Kanäle. Daraus folgen drei konkrete
Probleme:

1. **Keine strukturierten Daten.** Eine Bestellung ist ein Fließtext. Sie lässt
   sich nicht zuverlässig zählen, summieren, für die Produktionsplanung
   auswerten oder gegen die Lieferung prüfen.
2. **Kein verbindlicher Preisstand.** Was eine Bestellung gekostet hat, ist
   nachträglich nicht rekonstruierbar, wenn sich Preise ändern.
3. **Wiederholte manuelle Übertragung.** Jede Bestellung wird von Hand in die
   Produktionsplanung übernommen — fehleranfällig und zeitaufwendig.

Das Bestellsystem löst zuerst Problem 1 und 2. Problem 3 wird erst durch spätere
Phasen adressiert und darf das Fundament nicht verkomplizieren.

**Was dieses System ausdrücklich nicht ist:** ein Onlineshop. Es gibt keine
Zahlungsabwicklung, keinen anonymen Endkundenverkauf, keinen Katalog mit
Marketingfunktion. Es ist ein B2B-Vorbestellsystem für bekannte Kunden.

---

## 2. Nutzergruppen

| Gruppe | Beschreibung | Häufigkeit | Primärgerät | Fulfillment |
|---|---|---|---|---|
| **Stammcafé** | Bekanntes Geschäftskunden-Café, bestellt wiederkehrend, kennt das Sortiment auswendig | mehrmals pro Woche | Mobil, oft im Betrieb, oft in Eile | `delivery` |
| **Sonderkunde** | Privat- oder Einmalkunde, Bestellung für einen Anlass | selten bis einmalig | Mobil oder Desktop | `pickup` |
| **Buschmann-Backoffice** | Bearbeitet und bestätigt Bestellungen, pflegt Sortiment und Kunden | täglich | Desktop | — |

Die drei Gruppen haben grundverschiedene Anforderungen. Das Fundament darf
keine Annahme treffen, die eine der drei ausschließt — insbesondere darf es
`pickup` nicht als Sonderfall von `delivery` modellieren.

---

## 3. UX-Prinzipien

Diese Prinzipien binden **Architekturentscheidungen**, auch wenn Phase 1 keine
Oberfläche baut.

1. **Schneller als WhatsApp.** Die Messlatte ist nicht „ein guter Webshop",
   sondern eine Nachricht in einem Messenger. Alles, was diese Messlatte
   reißt, ist ein Fehler.
2. **Sortiment sofort sichtbar.** Kein Katalog-Browsing, keine
   Produktdetailseiten, keine Kategorienavigation als Pflichtweg. Die
   Datenzugriffe müssen so beschaffen sein, dass *ein* Query das gesamte
   bestellbare Sortiment liefert.
3. **Menge ist die einzige Eingabe.** `−` / `+` pro Produkt. Kein
   Warenkorb-Zwischenschritt, keine „In den Warenkorb"-Bestätigung.
4. **Ein Formular, ein Absenden.** Produkte, Datum, Notiz und Absenden liegen
   auf einer Seite. Daraus folgt: Eine Bestellung wird in *einem*
   Serverrequest angelegt, nicht schrittweise über mehrere Requests aufgebaut.
   Es gibt deshalb in Phase 1 **kein serverseitiges Warenkorb-Modell** und
   keine Sessionpersistenz eines Bestellentwurfs.
5. **Keine Registrierungshürde.** Ein Café darf zum Bestellen kein Passwort
   brauchen. Die Identifikation läuft später über einen kundenspezifischen
   Link. Das Datenmodell muss dafür einen stabilen, nicht erratbaren
   Kundenschlüssel tragen können — siehe 7.2.
6. **Ohne JavaScript grundsätzlich benutzbar.** Die Mengensteuerung ist eine
   Verbesserung über einem normalen Formular, keine Voraussetzung. Das ist
   dieselbe Haltung wie auf der bestehenden Website.

**Zielgröße:** Eine typische Wiederholungsbestellung eines Stammcafés soll in
20–30 Sekunden abgeschlossen sein.

---

## 4. Scope Phase 1

Phase 1 liefert ein **testgetriebenes Domänenfundament plus Datenbankschema**.
Konkret:

- Zentrale Domänenkonstanten: `OrderStatus`, `FulfillmentType`
- Geldarithmetik: `Money` (ganzzahlige Cent, exakte Konvertierung zu/von `DECIMAL`)
- Value Objects: `Address`, `OrderNumber`, `FulfillmentDate`
- Entities: `Product`, `Customer`, `Order`, `OrderItem`
- Serverseitige Preisberechnung im `Order`-Aggregat
- Eingabe-Mapping für Bestellungen (`OrderDraft`) mit Whitelist
- Fehlerhierarchie (`DomainException`, `ValidationException`)
- Abhängigkeitsfreier Test-Runner und Tests für alle Geschäftsregeln aus §17
  des Briefings
- MariaDB-/MySQL-Schema als nummerierte `.sql`-Migrationen
- Seed-Struktur mit klar gekennzeichneten Platzhalterdaten
- Zugriffsschutz-Grundlagen (`.htaccess`, Konfigurationstrennung)
- README für das Subsystem

---

## 5. Non-Goals (Phase 1)

Nicht Bestandteil, ausdrücklich und ohne Vorbereitung „für den Fall der Fälle":

Zahlungsabwicklung jeder Art · Stripe · PayPal · Shopify · WooCommerce ·
Supabase · Firebase · Kundenkonten mit Passwort · Auth-System · Kunden-App ·
native Apps · PWA · CRM · Newsletter · Treuepunkte · Gutscheine ·
Lagerverwaltung · Warenwirtschaft · Buchhaltung · Rechnungsgenerator ·
Lieferfahrer-App · Routenoptimierung · Analytics · Chat ·
WhatsApp-Integration · KI-Funktionen · Bestelloberfläche · Adminoberfläche ·
Datenbank-Zugriffsschicht (Repositories) · Mailversand · Mandantenfähigkeit ·
Produktvarianten · Rabatte · Umsatzsteuerausweis · Redesign der bestehenden
Website.

**Besonders wichtige Abgrenzungen:**

- **Keine Repositories/PDO-Schicht in Phase 1.** Das Fundament ist bewusst
  persistenzfrei. Entities kennen keine Datenbank. Das Schema existiert
  parallel und wird in Phase 2 verbunden. Grund: Eine Persistenzschicht ohne
  laufende Datenbank wäre ungetestet und damit wertlos.
- **Keine Security-Fassade.** Es wird kein CSRF-Token-Generator und keine
  Rate-Limit-Implementierung gebaut, solange es kein Formular gibt, das sie
  schützen könnte. Beides ist unter „Sicherheitsmodell" *entworfen*, nicht
  implementiert.

---

## 6. Architektur

### 6.1 Stack-Entscheidung

**Vanilla PHP 8.1+ und MariaDB/MySQL. Keine Frameworks, keine Composer-Pakete.**

Begründung:

- **Zielhosting.** `content/TODO.md` und die Datenschutzerklärung benennen
  IONOS als vorgesehenen Hoster. IONOS-Webhosting bietet Apache, PHP 8.1–8.3
  und MariaDB. Ein Node-, Python- oder Container-Stack wäre dort nicht
  lauffähig und würde ein teureres VPS-Produkt erzwingen.
- **Kontinuität mit dem Bestand.** Die Website ist ein Stylesheet, eine
  JS-Datei, keine Build-Pipeline, keine `package.json`. Ein
  Framework-Ökosystem neben dieser Website wäre ein Fremdkörper.
- **Wartbarkeit über fünf Jahre.** Vanilla PHP altert kalkulierbar. Ein
  Framework-Major-Upgrade in einem Projekt ohne festes Entwicklungsbudget ist
  ein reales Ausfallrisiko.
- **Keine laufenden Kosten.** Kein SaaS, kein Abonnement, keine externe
  Abhängigkeit im Betrieb.

**Kein Composer.** Composer ist ein Entwicklungswerkzeug, aber sein Einsatz
zieht ein `vendor/`-Verzeichnis nach sich, das per SFTP mit deployt werden
muss, und ein `composer.lock`, das gepflegt werden will. Für ein Fundament
ohne einzige Drittabhängigkeit ist der Preis höher als der Nutzen. Stattdessen:
ein PSR-4-konformer Autoloader von rund zwanzig Zeilen. Sollte Phase 2 oder 3
eine echte Bibliothek brauchen, ist die Umstellung auf Composer mechanisch —
die Namespaces sind bereits PSR-4.

**Kein PHPUnit.** Aus demselben Grund. Der Test-Runner ist eine einzelne Datei.
Die Testklassen sind bewusst so geschrieben (`class …Test`, Methoden
`test…()`), dass eine spätere Migration auf PHPUnit eine reine
Konfigurationsarbeit wäre.

**Mindestversion PHP 8.1.** Begründet durch `enum` (Statuswerte und
Fulfillment-Typen werden dadurch auf Typebene unfälschbar) und `readonly`
Properties (Unveränderlichkeit historischer Daten wird vom Compiler
durchgesetzt statt von Disziplin).

### 6.2 Modulgrenzen

```
order-system/
├── public/              Einziges Verzeichnis im Web-Root (ab Phase 2)
├── admin/              Adminanwendung (ab Phase 2)
├── config/             config.php (gitignored) + config.example.php
├── database/
│   ├── migrations/     nummerierte .sql-Dateien
│   └── seeds/          Platzhalterdaten für Entwicklung
├── src/
│   ├── Shared/         Money, Address, Fehlerhierarchie, Autoloader
│   ├── Products/       Product
│   ├── Customers/      Customer
│   └── Orders/         Order, OrderItem, OrderStatus, FulfillmentType,
│                       FulfillmentDate, OrderNumber, OrderDraft
├── tests/              run.php + Testklassen, Struktur spiegelt src/
└── README.md
```

**Abhängigkeitsrichtung — verbindlich:**

```
Orders  ──▶ Products
   │           │
   ├──▶ Customers
   │           │
   └───────────┴──▶ Shared
```

`Shared` kennt niemanden. `Products` und `Customers` kennen nur `Shared` und
einander nicht. `Orders` darf beide kennen. **Es gibt keine Rückwärtskante.**
Ein `Product` weiß nicht, in welchen Bestellungen es vorkommt.

### 6.3 Zwei Abweichungen von der vorbereiteten Struktur

Die vorgefundene Ordnerstruktur wird in zwei Punkten geändert. Beide sind klein
und beide sind begründet:

1. **`src/delivery/` entfällt.** Lieferung ist in Phase 1 keine eigene Domäne,
   sondern eine Eigenschaft einer Bestellung (`FulfillmentType`,
   `FulfillmentDate`, Lieferadress-Snapshot). Ein leeres `delivery/`-Modul
   lädt dazu ein, dort verfrüht Touren-, Zeitfenster- oder Fahrerlogik
   anzusiedeln — allesamt ausdrückliche Non-Goals. Sollte Lieferlogistik
   später eigenständig werden, wird das Verzeichnis dann angelegt.
2. **Modulverzeichnisse in `StudlyCase`.** `src/Orders/` statt `src/orders/`,
   damit Verzeichnisname und Namespace-Segment identisch sind und der
   PSR-4-Autoloader ohne Übersetzungstabelle auskommt. Das ist auf
   case-insensitiven macOS-Dateisystemen egal, auf dem case-sensitiven
   Linux-Hosting bei IONOS nicht.

Alles Übrige bleibt wie vorbereitet.

### 6.4 Namespace

Wurzel: `Buschmann\OrderSystem`. Danach das Modul, z. B.
`Buschmann\OrderSystem\Orders\Order`. Der Autoloader bildet
`Buschmann\OrderSystem\` auf `order-system/src/` ab.

---

## 7. Datenmodell

### 7.0 Geld — die Grundsatzentscheidung

**In der Domäne: ganzzahlige Cent (`int`). In der Datenbank: `DECIMAL(10,2)`.**

Warum nicht Float, warum diese Kombination:

- PHP kennt keinen Dezimaltyp. `0.1 + 0.2 !== 0.3` gilt in PHP wie überall.
  Geld darf deshalb nie als `float` durch die Anwendung laufen.
- MariaDB liefert `DECIMAL` an PHP als **String** zurück. Jede Rechnung damit
  würde still nach `float` konvertieren — genau der Fehler, den `DECIMAL`
  vermeiden sollte. Die Domäne muss also einen eigenen exakten Typ haben.
- Ganzzahlige Cent sind unter den einzigen zwei Operationen, die Phase 1
  braucht, **exakt und rundungsfrei**: Positionssumme = Einzelpreis × Menge
  (Ganzzahlmultiplikation), Bestellsumme = Summe der Positionen
  (Ganzzahladdition). Es entsteht in Phase 1 **kein einziger Rundungsschritt**.
- `DECIMAL(10,2)` in der Datenbank statt `INT`-Cent, weil die Datenbank auch
  von Menschen gelesen wird: Backups, phpMyAdmin, spätere Auswertungen
  (`SUM(line_total)`), CSV-Exporte für die Steuerberatung. `1499` in einer
  Spalte namens `unit_price` ist eine Fehlerquelle; `14.99` ist keine.
- Der Preis dieser Entscheidung ist **eine** Umwandlungsstelle. Sie liegt
  vollständig in `Money::fromDecimalString()` / `Money::toDecimalString()`,
  arbeitet ausschließlich mit Stringoperationen (nie `floatval`) und ist
  Gegenstand eigener Tests.

`Money` bietet in Phase 1 **keine Division**. Sobald Phase 2 Prozentwerte
braucht (Umsatzsteuer, Rabatt), wird die Rundungsregel — kaufmännisch,
halbe Cent aufwärts — an genau dieser einen Stelle ergänzt und getestet.

Wertebereich: `Money` erlaubt `0` bis `9_999_999_999` Cent
(= 99.999.999,99 €). Die Obergrenze ist nicht willkürlich, sondern exakt das,
was `DECIMAL(10,2)` speichern kann; ein Betrag, den die Datenbank abschneiden
würde, scheitert damit schon in der Domäne. Negative Beträge sind unzulässig:
In Phase 1 gibt es keine Gutschrift, keinen Rabatt und keine Stornosumme, ein
negativer Betrag wäre also immer ein Fehler und soll früh und laut scheitern.

### 7.1 Product

| Feld | Typ (Domäne) | Regeln |
|---|---|---|
| `id` | `int` | > 0 |
| `name` | `string` | 1–120 Zeichen, nach `trim` nicht leer |
| `description` | `?string` | max. 500 Zeichen, leer ⇒ `null` |
| `unitPrice` | `Money` | ≥ 0 |
| `unit` | `string` | 1–20 Zeichen, freies Anzeigelabel („Stück", „Blech", „kg") |
| `isActive` | `bool` | |
| `sortOrder` | `int` | ≥ 0, bestimmt die Reihenfolge auf der Bestellseite |

`unit` ist bewusst **keine Enum**. Ein Konditoreisortiment erfindet
Mengeneinheiten schneller, als man Migrationen schreibt; eine Enum würde jede
neue Einheit zu einem Code-Deployment machen. Die Einheit ist reines
Anzeigelabel und geht in keine Berechnung ein.

Es gibt **keine Varianten, keine Kategorien, keine SKU und kein Produktbild.**
Alles drei sind Non-Goals.

### 7.2 Customer

| Feld | Typ (Domäne) | Regeln |
|---|---|---|
| `id` | `int` | > 0 |
| `name` | `string` | 1–120 Zeichen, Café- oder Kundenname |
| `contactPerson` | `?string` | max. 120 Zeichen |
| `email` | `?string` | gültige Adresse, max. 190 Zeichen |
| `phone` | `?string` | max. 40 Zeichen, keine Formatvorgabe |
| `deliveryAddress` | `?Address` | |
| `isActive` | `bool` | |
| `defaultFulfillment` | `FulfillmentType` | |
| `internalNote` | `?string` | max. 1000 Zeichen |

**Invariante:** `defaultFulfillment === delivery` ⇒ `deliveryAddress !== null`.
Ein Kunde, der standardmäßig beliefert wird, muss eine Lieferadresse haben.
Umgekehrt darf ein `pickup`-Kunde eine Adresse haben (Rechnungsanschrift) —
das ist kein Widerspruch.

`email` und `phone` sind **optional**, und das ist eine Datenschutzentscheidung,
keine Bequemlichkeit: Ein Café braucht zur Bestellung keinen personenbezogenen
Kontakt. Siehe §13.

`Address` ist ein Value Object aus `street`, `postalCode`, `city` — alle drei
Pflicht, alle drei nur auf Vorhandensein und Länge geprüft, **nicht auf
Format**. Eine Postleitzahl-Regex im Domänenkern ist eine klassische
Überprüfungsfalle; Formathinweise gehören in die Eingabemaske der Phase 2.

### 7.3 Order

| Feld | Typ (Domäne) | Regeln |
|---|---|---|
| `id` | `?int` | `null`, solange nicht persistiert |
| `orderNumber` | `OrderNumber` | siehe §8 |
| `customerId` | `int` | > 0 |
| `customerNameSnapshot` | `string` | 1–120 Zeichen |
| `fulfillmentType` | `FulfillmentType` | |
| `fulfillmentDate` | `FulfillmentDate` | Datum ohne Uhrzeit, nicht in der Vergangenheit |
| `deliveryAddressSnapshot` | `?string` | max. 400 Zeichen |
| `note` | `?string` | max. 500 Zeichen |
| `status` | `OrderStatus` | |
| `items` | `OrderItem[]` | mindestens ein Element |
| `createdAt` / `updatedAt` | `DateTimeImmutable` | |

**Invarianten:**

1. Mindestens eine Position. Eine Bestellung ohne Positionen ist keine
   Bestellung.
2. `fulfillmentType === delivery` ⇒ `deliveryAddressSnapshot` ist gesetzt und
   nicht leer.
3. `total()` = Summe aller `lineTotal`. Wird berechnet, nie entgegengenommen.

**Warum `id` hier nullable ist und bei `Product`/`Customer` nicht:** `Product`
und `Customer` sind Stammdaten — sie werden geladen, existieren also bereits
und haben eine ID. Eine `Order` wird von der Domäne *erzeugt* und bekommt ihre
ID erst beim Speichern. Diese Unterscheidung ist beabsichtigt und macht
unmöglich, versehentlich mit einem nicht existierenden Produkt zu rechnen.

### 7.4 OrderItem

| Feld | Typ (Domäne) | Regeln |
|---|---|---|
| `id` | `?int` | |
| `productId` | `int` | > 0 |
| `productNameSnapshot` | `string` | 1–120 Zeichen |
| `productUnitSnapshot` | `string` | 1–20 Zeichen |
| `unitPrice` | `Money` | Snapshot zum Bestellzeitpunkt |
| `quantity` | `int` | **> 0** |
| `lineTotal` | `Money` | **berechnet**, nicht übergebbar |

**Der Konstruktor nimmt `lineTotal` nicht entgegen.** Er berechnet ihn aus
`unitPrice × quantity`. Es gibt damit im gesamten Code keinen Weg, einen
abweichenden Positionsbetrag zu setzen — auch nicht versehentlich, auch nicht
durch einen späteren Entwickler. Das ist der Unterschied zwischen einer Regel,
die man einhalten *soll*, und einer, die man nicht brechen *kann*.

`quantity` ist bewusst `int`, nicht dezimal. Ein Café bestellt drei Bleche oder
zwölf Stück, keine 2,4 Stück. Sollte je nach Gewicht bestellt werden, wird das
ein eigenes Produkt mit Einheit „kg" und ganzzahliger Menge — oder eine
bewusste, dokumentierte Modelländerung.

### 7.5 Snapshots — warum es sie gibt

Drei Felder speichern redundant, was auch per Join zu ermitteln wäre:
`customerNameSnapshot`, `productNameSnapshot`/`productUnitSnapshot` und
`unitPrice` je Position, dazu `deliveryAddressSnapshot`.

Das ist kein Denormalisierungs-Unfall, sondern die zentrale Anforderung: **Eine
Bestellung ist ein Dokument.** Sie beschreibt, was zu welchem Preis, unter
welchem Namen und an welche Adresse bestellt wurde — zum Zeitpunkt der
Bestellung. Ändert Buschmann morgen den Preis des Zitronen-Cheesecakes, benennt
ein Café sich um oder zieht es um, dann darf sich eine Bestellung von letzter
Woche **nicht** rückwirkend ändern. Ohne Snapshot wäre genau das der Fall.

Die Snapshots werden beim Anlegen einmal geschrieben und danach nie wieder
angefasst. `readonly` erzwingt das auf Sprachebene.

`orders.total_amount` und `order_items.line_total` werden ebenfalls gespeichert,
obwohl sie berechenbar sind — aus demselben Grund, und weil die Produktions-
und Tagesübersichten der Phase 2 sonst für jede Zeile aggregieren müssten.

### 7.6 Fulfillment

```php
enum FulfillmentType: string {
    case Delivery = 'delivery';
    case Pickup   = 'pickup';
}
```

Genau zwei Werte, als String-Enum, damit der DB-Wert und der Domänenwert
identisch sind und ein unbekannter Wert beim Laden sofort scheitert
(`FulfillmentType::from()` wirft).

`FulfillmentDate` ist ein Value Object über einem `DateTimeImmutable`, auf
Mitternacht normalisiert. **Datum ohne Uhrzeit**, weil ein Café „für Freitag"
bestellt und nicht „für Freitag 14:32". Regel: Das Datum darf nicht vor dem
Bestelltag liegen. Der Vergleichszeitpunkt wird **übergeben**, nicht intern aus
`now()` gelesen — sonst wäre die Regel nicht testbar und die Tests würden am
Jahreswechsel kippen.

Vorlaufzeiten („Bestellung bis Mittwoch für Freitag") sind ein Non-Goal der
Phase 1, aber das Modell verhindert sie nicht: Sie wären eine zusätzliche
Prüfung an derselben Stelle.

### 7.7 Order Status

```php
enum OrderStatus: string {
    case New          = 'new';
    case Confirmed    = 'confirmed';
    case InProduction = 'in_production';
    case Completed    = 'completed';
    case Cancelled    = 'cancelled';
}
```

Erlaubte Übergänge:

```
new ──▶ confirmed ──▶ in_production ──▶ completed
 │           │              │
 └───────────┴──────────────┴────────▶ cancelled

completed ──▶ (Endzustand)
cancelled ──▶ (Endzustand)
```

Das ist bewusst **keine ausgebaute State Machine**: keine Guards, keine
Hooks, keine Ereignisse, kein Zustandsdiagramm-Framework. Es ist eine
Zuordnungstabelle von fünf Zeilen in der Enum plus eine Methode
`canTransitionTo()`. Sie ist trotzdem enthalten, weil „abgeschlossen zurück
auf neu" oder „storniert wieder in Produktion" echte Datenkorruption wären und
die Absicherung acht Zeilen kostet.

Neue Bestellungen starten immer bei `new`.

---

## 8. Bestellnummern

**Format: `BUS-JJJJ-NNNNNN`** — Beispiel `BUS-2026-000123`.

- `BUS` — fester Präfix. Macht die Nummer in einer WhatsApp-Nachricht, auf
  einem Lieferschein oder am Telefon sofort als Buschmann-Bestellnummer
  erkennbar.
- `JJJJ` — Kalenderjahr. Grenzt den Suchraum sofort ein und macht die Nummer
  ohne Datenbank halbwegs einordbar.
- `NNNNNN` — sechsstellige, je Jahr bei 1 beginnende laufende Nummer,
  linksseitig mit Nullen aufgefüllt. Feste Länge, weil Menschen
  gleichlange Ziffernblöcke schneller vorlesen und abgleichen.

Am Telefon: „B-U-S, zweitausendsechsundzwanzig, null null null eins zwei drei".
Keine Buchstaben-Ziffern-Verwechslung (kein O/0, kein I/1 im variablen Teil),
kein Bindestrich-Chaos, keine 36 Zeichen lange UUID.

**Erzeugung.** Nicht aus `MAX(id) + 1`, nicht aus der AUTO_INCREMENT-ID der
Bestellung. Stattdessen eine eigene Zählertabelle `order_number_sequences` und
das atomare MariaDB-Idiom:

```sql
INSERT INTO order_number_sequences (year, next_value)
VALUES (:year, LAST_INSERT_ID(1))
ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1);

SELECT LAST_INSERT_ID();
```

Eine Anweisung, keine Race Condition, kein `SELECT … FOR UPDATE`, funktioniert
auf jedem Shared Hosting. `LAST_INSERT_ID(expr)` setzt den Wert auch im
INSERT-Zweig, deshalb liefert das `SELECT` in beiden Fällen die richtige Zahl.

**Lücken sind zulässig und erwartet.** Rollt eine Transaktion zurück, ist die
Nummer verbraucht. Lückenlosigkeit ist eine Anforderung an
Rechnungsnummern — und Rechnungen sind ein Non-Goal.

**Die Bestellnummer ist kein Zugriffsschlüssel.** Sie ist erratbar, das liegt
in ihrer Natur als fortlaufende Nummer. Phase 2 darf deshalb **niemals**
„wer die Bestellnummer kennt, darf die Bestellung sehen" implementieren. Wird
später eine öffentlich abrufbare Bestellbestätigung gebraucht, bekommt sie ein
separates Zufallstoken. Das ist hier festgehalten, damit die Entscheidung
nicht in Phase 2 unbemerkt falsch getroffen wird.

Die Nummer verrät außerdem die ungefähre Bestellmenge des Jahres. Bei einem
Betrieb dieser Größe ist das akzeptabel und bewusst in Kauf genommen.

---

## 9. Serverseitige Preislogik

Die Anforderung lautet: Der Client darf den Preis nicht bestimmen. Umgesetzt
wird sie nicht durch eine Prüfung, sondern durch die **Form der Schnittstelle**.

```php
Order::place(
    Customer $customer,          // aus der Datenbank geladen
    ProductCatalog $catalog,     // aus der Datenbank geladen — die Preisquelle
    OrderDraft $draft,           // aus der Anfrage — enthält NUR IDs und Mengen
    OrderNumber $orderNumber,
    DateTimeImmutable $now,
): Order
```

- `OrderDraft` hat **kein Preisfeld**. Nicht „ignoriert", sondern nicht
  vorhanden. `OrderDraft::fromInput()` liest aus dem Anfrage-Array
  ausschließlich `fulfillment_type`, `fulfillment_date`, `note` und `items`
  mit je `product_id` und `quantity`. Alles Weitere wird verworfen, egal wie
  es heißt.
- `ProductCatalog` ist die einzige Preisquelle. Er wird aus vertrauenswürdigen
  Daten aufgebaut. `Order::place()` schlägt jede Position dort nach; ein
  Produkt, das nicht im Katalog ist, führt zu einem Validierungsfehler, nicht
  zu einer Position mit Preis 0.
- `OrderItem` berechnet seinen Positionsbetrag selbst (siehe 7.4).
- `Order::total()` summiert. Es gibt keinen Setter.

Berechnung, vollständig:

```
lineTotal_i  = product_i.unitPrice × quantity_i     (Ganzzahl, exakt)
orderTotal   = Σ lineTotal_i                        (Ganzzahl, exakt)
```

Keine Steuer, kein Rabatt, kein Versand, keine Mindermenge, kein
Mindestbestellwert. Alles Non-Goals. Damit gibt es in Phase 1 **keine
Division und keine Rundung**, und damit auch keine Rundungsfehler.

**Zusätzlich geprüft wird beim Anlegen:** Ein Produkt mit `isActive === false`
darf nicht neu bestellt werden. Es bleibt in historischen Bestellungen
selbstverständlich sichtbar — dort steht der Snapshot, nicht das Produkt.
Genau deswegen werden Produkte deaktiviert und nicht gelöscht.

---

## 10. Validierungsstrategie

Zwei Schichten mit unterschiedlichen Aufgaben. Die Trennung ist wichtig, weil
eine einzige Schicht immer eine der beiden Aufgaben schlecht erledigt.

**Schicht 1 — Invarianten in Konstruktoren (immer aktiv).**
Jede Entity und jedes Value Object prüft im Konstruktor alles, was für dieses
Objekt wahr sein *muss*, und wirft bei Verstoß sofort. Ein `Money` mit
negativem Betrag, ein `OrderItem` mit Menge 0, eine `Order` ohne Positionen
kann nicht existieren. Diese Schicht kann nicht umgangen werden — auch nicht
von einem Importskript, einer Konsole oder einem Adminwerkzeug.
Fehlertyp: `DomainException`. Ein Verstoß hier ist ein **Programmierfehler**.

**Schicht 2 — Eingabeprüfung (`OrderDraft::fromInput`).**
Prüft ein rohes Anfrage-Array und sammelt **alle** Fehler, statt beim ersten
abzubrechen — ein Café soll nicht fünfmal absenden, um fünf Hinweise zu
bekommen. Prüft Vorhandensein, Typ, Wertebereich und Whitelist.
Fehlertyp: `ValidationException` mit einer Zuordnung Feld → Meldung.
Ein Verstoß hier ist eine **normale Nutzereingabe**.

Reihenfolge: Schicht 2 läuft zuerst. Erst wenn sie fehlerfrei durchläuft,
werden Domänenobjekte gebaut. Erreicht eine Eingabe Schicht 1 mit einem
Fehler, ist Schicht 2 lückenhaft — dann ist ein Test fällig, keine
zusätzliche Prüfung in Schicht 1.

**Was Phase 1 nicht baut:** kein Validierungs-DSL, keine Regel-Registry, keine
Annotations. Prüfungen stehen als lesbarer PHP-Code an der Stelle, an der sie
gelten.

---

## 11. Sicherheitsmodell

### 11.1 Was Phase 1 tatsächlich implementiert

| Maßnahme | Umsetzung |
|---|---|
| Preis-Manipulation ausgeschlossen | Schnittstellenform, siehe §9 — keine Prüfung, sondern Unmöglichkeit |
| Eingabe-Whitelist | `OrderDraft::fromInput()` liest nur bekannte Schlüssel |
| Typsicherheit der Zustandswerte | String-Enums; ein unbekannter Wert wirft beim Laden |
| Keine Secrets im Repository | `order-system/config/config.php` ist gitignored, `config.example.php` enthält nur Platzhalter |
| Konfiguration außerhalb des Web-Roots | Deployment-Layout, siehe §14 |
| Verzeichnisschutz | `.htaccess` mit `Require all denied` in `src/`, `config/`, `database/`, `tests/` — Gürtel *und* Hosenträger, falls das Document Root doch falsch gesetzt wird |
| Keine Datenbankzugangsdaten im Frontend | In Phase 1 existiert kein Frontend und keine Verbindung |

### 11.2 Was Phase 1 entwirft, aber nicht implementiert

Ausdrücklich nicht gebaut, weil es ohne Formular und ohne Datenbankzugriff
eine **Sicherheitsfassade** wäre, die Schutz suggeriert, den es nicht gibt:

- **SQL Injection.** Sämtlicher Datenbankzugriff der Phase 2 läuft über
  PDO mit `ERRMODE_EXCEPTION`, `EMULATE_PREPARES = false` und ausschließlich
  gebundenen Parametern. Kein String wird je in SQL interpoliert — auch nicht
  in `ORDER BY`; dort gilt eine Whitelist erlaubter Spaltennamen.
- **Output-Escaping.** Jede Ausgabe in HTML durch
  `htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`. Es gibt keine
  „bereits sichere" Zeichenkette; Kunden- und Produktnamen sind Nutzereingabe.
- **CSRF.** Jede schreibende Aktion — Bestellung anlegen wie Adminaktion —
  bekommt ein Token aus `random_bytes(32)`, in der Session hinterlegt, per
  `hash_equals()` verglichen. Formulare ausschließlich per POST.
- **Adminzugang.** Nicht öffentlich erreichbar. Erste Stufe: HTTP-Basic-Auth
  über den Webserver, zusätzlich zur Anwendungsprüfung. Kein selbstgebautes
  Passwort-Login, kein Framework-Auth.
- **Spam und Missbrauch.** Bestellungen kommen von bekannten Kunden über einen
  kundenspezifischen Link, nicht von einem offenen Formular — das ist der
  wirksamste Teil des Schutzes. Ergänzend: Begrenzung der Bestellungen je
  Kunde und Zeitfenster, Höchstzahl Positionen je Bestellung, Höchstmenge je
  Position. Kein CAPTCHA, kein Drittanbieterdienst.
- **Transport.** Ausschließlich HTTPS, HSTS, `SameSite=Strict`-Cookies.

### 11.3 Ein Befund aus dem Repository-Audit

Die bestehende Website ist auf **GitHub Pages** ausgerichtet (`.nojekyll`,
absolute URLs auf `domekuester.github.io`). GitHub Pages führt PHP **nicht
aus**, sondern liefert `.php`-Dateien als Klartext aus. Würde
`order-system/` je Teil eines Pages-Deployments, wäre der gesamte
Serverquelltext öffentlich lesbar.

Daraus folgt für das Design — unabhängig vom späteren Hosting:

1. `order-system/config/config.php` enthält die Zugangsdaten, ist gitignored
   und liegt **niemals** im Repository.
2. Der Quelltext selbst enthält keine Geheimnisse; er darf lesbar sein, ohne
   dass daraus ein Zugang entsteht.
3. `order-system/` gehört nicht in ein GitHub-Pages-Deployment. Das ist in
   der README des Subsystems festgehalten.

An der Konfiguration der bestehenden Website oder von GitHub Pages wird in
dieser Phase **nichts** geändert.

---

## 12. Fehlerbehandlung

```
Buschmann\OrderSystem\Shared\DomainException      (extends \RuntimeException)
├── InvalidArgumentException   Invariante verletzt — Programmierfehler
└── ValidationException        Nutzereingabe fehlerhaft — trägt Feld → Meldung
```

Grundsätze:

- **Ausnahmen statt Rückgabewerten.** Ein ungültiges Objekt wird nie gebaut
  und nie zurückgegeben. Es gibt keine „halb gültige" Bestellung.
- **`ValidationException` trägt Struktur**, keinen Fließtext:
  `['items.0.quantity' => 'Menge muss größer als 0 sein.']`. Die Oberfläche
  der Phase 2 kann den Fehler damit an das richtige Feld heften.
- **Meldungen sind für Menschen.** Auf Deutsch, ohne Klassennamen, ohne
  Feldnamen aus der Datenbank. Sie können unverändert angezeigt werden.
- **Ausnahmen erreichen niemals den Browser.** In Phase 2 gilt:
  `display_errors=0` in Produktion, ein globaler Handler protokolliert
  Ausnahme, Datei und Zeile in ein Logfile außerhalb des Web-Roots und zeigt
  eine neutrale Fehlerseite. Kein Stacktrace, keine SQL-Meldung, kein
  Dateipfad im HTML.

---

## 13. Datenschutz-Grundsätze

Keine Rechtsberatung — das gilt hier wie in `content/PRIVACY-TECH-AUDIT.md`.
Dies sind technische Gestaltungsregeln.

- **Datenminimierung als Voreinstellung.** Pflicht ist ausschließlich der
  Kunden-/Cafénname. Ansprechpartner, E-Mail und Telefon sind optional; die
  Lieferadresse ist nur Pflicht, wenn tatsächlich geliefert wird.
- **Zweckbindung.** Erhoben wird, was zur Abwicklung einer Bestellung nötig
  ist. Keine Geburtsdaten, keine Umsatzhistorie zu Marketingzwecken, keine
  Profilbildung, kein Tracking, kein Newsletter.
- **Besondere Kategorien niemals.** `internal_note` ist ein Feld für
  betriebliche Hinweise („Lieferung an der Rückseite", „Kühlkette beachten"),
  nicht für Angaben über Personen. Das steht als Kommentar im Schema und in
  der README, weil ein freies Textfeld sonst zuverlässig zweckentfremdet wird.
- **Kunden sind Betriebe, keine Verbraucher.** Der Regelfall ist ein Café.
  Personenbezug entsteht überwiegend erst über den Ansprechpartner — genau
  deshalb ist dieses Feld optional.
- **Löschung.** Kunden werden deaktiviert, nicht gelöscht, solange
  Bestellungen bestehen (`ON DELETE RESTRICT`). Ein Löschverlangen wird in
  Phase 2 als **Anonymisierung** umgesetzt: Personenfelder werden geleert, die
  Bestellhistorie bleibt für steuerliche Aufbewahrungspflichten erhalten. Der
  Namens-Snapshot in `orders` macht die Bestellung auch dann noch lesbar.
- **Aufbewahrungsfristen** sind eine offene, fachlich zu klärende Frage und
  gehören zu den Launch-Punkten in `content/TODO.md`. Technisch ist die
  Anonymisierung vorbereitet, die Frist ist es nicht.
- **Keine Drittdienste.** Kein CDN, kein externer Schriftdienst, keine
  Analyse, kein Zahlungsdienstleister — dieselbe Haltung wie auf der
  bestehenden Website. Auftragsverarbeitung betrifft damit allein den Hoster;
  der AVV-Status bei IONOS steht bereits in `content/TODO.md`.
- **Seed-Daten enthalten keine echten Kunden.** Die Beispieldaten sind als
  Platzhalter gekennzeichnet und frei erfunden.

---

## 14. Hosting- und Deployment-Annahmen

**Angenommene Zielumgebung:** IONOS Webhosting — Apache mit `.htaccess`,
PHP 8.1 oder neuer, MariaDB 10.x, Deployment per SFTP, **kein garantierter
Shell-Zugang, kein Composer auf dem Server, kein Cron als Voraussetzung.**
Diese Annahme stammt aus `content/TODO.md` und der Datenschutzerklärung, die
IONOS bereits als vorgesehenen Hoster benennen. Sie ist bis zum Launch zu
bestätigen — der Punkt steht dort bereits offen.

Das Fundament der Phase 1 ist von dieser Annahme kaum abhängig: Es läuft auf
jedem PHP 8.1+ ohne Erweiterung außer der Standardbibliothek. Abhängig sind
das Schema (MariaDB-Idiome), die `.htaccess`-Dateien (Apache) und das
Verzeichnis-Layout.

**Verzeichnis-Layout auf dem Server:**

```
<Webspace-Wurzel>                       nicht öffentlich erreichbar
├── buschmann-order/
│   ├── config/config.php               Zugangsdaten — nie im Repository
│   ├── src/                            Domänenkern
│   ├── database/                       Migrationen und Seeds
│   ├── var/log/                        Fehlerprotokoll
│   └── public/         ◀── Document Root der Bestell-Subdomain
└── <domain>/           ◀── Document Root der bestehenden Website
```

Nur `public/` liegt im Web-Root. Konfiguration, Quelltext, Migrationen und
Protokolle liegen darüber und sind damit über HTTP nicht erreichbar — auch
dann nicht, wenn eine `.htaccess` einmal nicht greift. Zusätzlich tragen
`src/`, `config/`, `database/` und `tests/` je eine `.htaccess` mit
`Require all denied`.

**Empfohlen: eigene Subdomain** (z. B. `bestellung.<domain>`), damit das
Document Root sauber auf `public/` gesetzt werden kann und die bestehende
statische Website vollständig unberührt bleibt. Ein Unterverzeichnis der
Hauptdomain wäre technisch möglich, würde aber Website und Bestellsystem in
denselben Web-Root zwingen.

**Die bestehende Website bleibt in dieser Phase unverändert** — Dateien,
Pages-Konfiguration, DNS und Domain gleichermaßen.

**PHP-Einstellungen in Produktion (Phase 2):** `display_errors=0`,
`log_errors=1`, `error_log` außerhalb des Web-Roots, `expose_php=0`,
`session.cookie_httponly=1`, `session.cookie_secure=1`,
`session.cookie_samesite=Strict`.

**Datenbankverbindung (Phase 2):** PDO, DSN mit `charset=utf8mb4`,
`ATTR_ERRMODE = ERRMODE_EXCEPTION`, `ATTR_EMULATE_PREPARES = false`,
`ATTR_DEFAULT_FETCH_MODE = FETCH_ASSOC`.

**Migrationen** werden in Phase 1 manuell angewandt — per phpMyAdmin-Import
oder `mysql < datei.sql` — und in der Tabelle `schema_migrations` mit
Dateinamen und Zeitpunkt vermerkt. Ein Migrationsrunner ist bewusst nicht
Teil der Phase 1: Er bräuchte eine Datenbankverbindung, die es hier noch nicht
gibt, und wäre damit ungetestet.

---

## 15. Datenbankschema (MariaDB / MySQL)

Verbindlich ist die DDL in `order-system/database/migrations/`. Hier steht,
**warum** sie so aussieht.

Global: `ENGINE=InnoDB` (Fremdschlüssel und Transaktionen),
`CHARSET=utf8mb4`, `COLLATE=utf8mb4_unicode_ci`. Alle Zeitstempel als
`DATETIME` in **UTC**, geschrieben von der Anwendung — nicht `TIMESTAMP` mit
automatischer Zeitzonenumrechnung, weil deren Verhalten von der
Serverkonfiguration abhängt und auf Shared Hosting nicht kontrollierbar ist.

### `customers`

`id` · `name` VARCHAR(120) · `contact_person` · `email` VARCHAR(190) ·
`phone` VARCHAR(40) · `delivery_street` · `delivery_postal_code` ·
`delivery_city` · `is_active` TINYINT(1) DEFAULT 1 ·
`default_fulfillment` ENUM('delivery','pickup') DEFAULT 'delivery' ·
`internal_note` TEXT · `created_at` · `updated_at`

Adresse in drei Spalten statt einem Textblock, weil eine spätere Sortierung
oder Gruppierung nach Ort sonst unmöglich wäre. Alle drei sind `NULL`-fähig,
weil ein Abholkunde keine Lieferadresse braucht; die Invariante
„Lieferkunde ⇒ Adresse" setzt die Domäne durch, nicht das Schema — sie ist
eine Regel über einen Zusammenhang von Spalten, und solche Regeln gehören in
den Code, wo sie eine verständliche Fehlermeldung erzeugen können.

`INDEX (is_active, name)` — die Kundenliste im Backoffice.

### `products`

`id` · `name` VARCHAR(120) · `description` VARCHAR(500) ·
`unit_price` DECIMAL(10,2) · `unit` VARCHAR(20) ·
`is_active` TINYINT(1) DEFAULT 1 · `sort_order` INT DEFAULT 0 ·
`created_at` · `updated_at`

`INDEX (is_active, sort_order, id)` — deckt exakt die eine Abfrage ab, die die
Bestellseite braucht: das vollständige aktive Sortiment in Anzeigereihenfolge,
in einem Zugriff. Das ist UX-Prinzip 2 als Index formuliert.

`CHECK (unit_price >= 0)`.

### `orders`

`id` · `order_number` VARCHAR(20) **UNIQUE** ·
`customer_id` → `customers(id)` **ON DELETE RESTRICT** ·
`customer_name_snapshot` VARCHAR(120) ·
`fulfillment_type` ENUM('delivery','pickup') ·
`fulfillment_date` **DATE** · `delivery_address_snapshot` VARCHAR(400) ·
`note` VARCHAR(500) ·
`status` ENUM('new','confirmed','in_production','completed','cancelled')
DEFAULT 'new' · `total_amount` DECIMAL(10,2) ·
`created_at` · `updated_at`

- `order_number` ist `UNIQUE` — die Eindeutigkeit hängt nicht am
  Anwendungscode, sondern an der Datenbank.
- `ON DELETE RESTRICT`: Ein Kunde mit Bestellungen kann nicht gelöscht werden.
  Deshalb existiert `is_active`, und deshalb ist der Weg für ein
  Löschverlangen die Anonymisierung (§13).
- `fulfillment_date` ist `DATE`, nicht `DATETIME` — siehe 7.6.
- `INDEX (fulfillment_date, status)` — „Was ist für Freitag zu produzieren?",
  die wichtigste Abfrage des Betriebs.
- `INDEX (customer_id, fulfillment_date)` — „Die letzte Bestellung dieses
  Cafés", Voraussetzung für „Bestellung wiederholen" in einer späteren Phase.

### `order_items`

`id` · `order_id` → `orders(id)` **ON DELETE CASCADE** ·
`product_id` → `products(id)` **ON DELETE RESTRICT** ·
`product_name_snapshot` VARCHAR(120) · `product_unit_snapshot` VARCHAR(20) ·
`unit_price` DECIMAL(10,2) · `quantity` INT UNSIGNED ·
`line_total` DECIMAL(10,2)

- `CASCADE` zur Bestellung: Positionen ohne Bestellung sind sinnlos.
- `RESTRICT` zum Produkt: Ein je bestelltes Produkt darf nicht verschwinden.
  Das ist der Grund für `is_active` bei Produkten — deaktivieren statt löschen.
- `CHECK (quantity > 0)` und `CHECK (line_total >= 0)`. MariaDB ab 10.2 setzt
  `CHECK` durch; ältere MySQL-Versionen ignorieren es stillschweigend.
  Deshalb erzwingt die Domäne dieselben Regeln unabhängig davon — das Schema
  ist die zweite Verteidigungslinie, nicht die erste.
- `INDEX (order_id)`, `INDEX (product_id)`.

### `order_number_sequences`

`year` SMALLINT UNSIGNED **PRIMARY KEY** · `next_value` INT UNSIGNED

Eine Zeile je Kalenderjahr. Siehe §8.

### `schema_migrations`

`filename` VARCHAR(190) **PRIMARY KEY** · `applied_at` DATETIME

Damit nach einem halben Jahr nachvollziehbar bleibt, welche Migration auf
welcher Umgebung gelaufen ist.

---

## 16. Teststrategie

**Getestet wird Geschäftsverhalten, nicht Implementierung.** Kein Test prüft,
ob eine private Methode existiert, wie oft sie aufgerufen wurde oder wie ein
Objekt intern aufgebaut ist. Jeder Test beschreibt eine Regel, die ein
Konditor nachvollziehen könnte.

**Werkzeug:** ein eigener Runner, `order-system/tests/run.php`, rund hundert
Zeilen ohne Abhängigkeiten. Er findet `tests/**/*Test.php`, instanziiert jede
Klasse, ruft jede Methode auf, die mit `test` beginnt, zählt Erfolge und
Fehlschläge und beendet sich mit Exit-Code 1, sobald ein Test fehlschlägt —
damit er später in eine Prüfkette eingebaut werden kann.

Aufruf: `php order-system/tests/run.php`

**Verbindliche Testfälle.** Diese Liste ist die Abnahmegrundlage der Phase 1:

| # | Regel | Wo |
|---|---|---|
| 1 | Bestellung ohne Positionen ist ungültig | `OrderTest` |
| 2 | Menge muss größer als 0 sein | `OrderItemTest`, `OrderDraftTest` |
| 3 | Inaktive Produkte dürfen nicht neu bestellt werden | `OrderTest` |
| 4 | Unbekannter Fulfillment-Typ ist ungültig | `FulfillmentTypeTest`, `OrderDraftTest` |
| 5 | Unbekannter Status ist ungültig | `OrderStatusTest` |
| 6 | Preise stammen aus dem Produktkatalog, nicht aus der Eingabe | `OrderTest` |
| 7 | Ein mitgesendeter Preis oder Gesamtbetrag wird nicht übernommen | `OrderDraftTest`, `OrderTest` |
| 8 | Preis-Snapshot bleibt nach Produktpreisänderung unverändert | `OrderTest` |
| 9 | Mehrere Positionen werden korrekt summiert | `OrderTest` |
| 10 | Geldbeträge sind rundungsfrei; Konvertierung `DECIMAL` ↔ Cent ist exakt | `MoneyTest` |

Ergänzend, weil es echte Regeln sind und nicht Implementierungsdetails:
Lieferung ohne Adresse ist ungültig · Fulfillment-Datum in der Vergangenheit
ist ungültig · unzulässiger Statusübergang ist ungültig · Bestellnummernformat
· Kundeninvariante „Lieferkunde braucht Adresse" · Whitelist von
`OrderDraft::fromInput()`.

**Testdaten** entstehen in kleinen Hilfsfunktionen im jeweiligen Test, nicht in
einer geteilten Fixture-Bibliothek. Ein Test, den man ohne Springen lesen kann,
ist mehr wert als ein trockener.

**Was nicht getestet wird:** die Datenbank (es gibt in Phase 1 keinen Zugriff),
`.sql`-Dateien (sie werden beim ersten Import geprüft), HTML (es gibt keines).

---

## 17. Zukünftige Erweiterungspunkte

Vorbereitet in dem Sinne, dass das Fundament sie nicht behindert — **nicht** in
dem Sinne, dass Code dafür existiert.

| Erweiterung | Was das Fundament dafür bereits richtig macht |
|---|---|
| **Bestellung wiederholen** | `orders` + `order_items` sind vollständig; Index `(customer_id, fulfillment_date)` findet die letzte Bestellung; ein `OrderDraft` lässt sich unmittelbar aus vorhandenen Positionen füllen. Keine Sonderarchitektur nötig. |
| **Kundenspezifischer Bestell-Link** | Braucht eine Spalte `public_token CHAR(32) UNIQUE` in `customers` — eine `ALTER TABLE` in Phase 2. Bewusst **nicht** jetzt angelegt: Eine ungenutzte Token-Spalte wäre genau die Sicherheitsfassade, die §11.2 ausschließt. |
| **Vorlaufzeiten, Liefertage, Feiertage** | `FulfillmentDate` ist die eine Stelle, an der Datumsregeln gelten. |
| **Umsatzsteuer, Rabatte** | Rundung wird in `Money` an genau einer Stelle ergänzt; `unitPrice` ist bereits netto/brutto-neutral, die Festlegung erfolgt bewusst später. |
| **Produktkategorien** | Additive Spalte plus Index; das UX-Prinzip „alles auf einer Seite" bleibt vorrangig. |
| **Benachrichtigung bei neuer Bestellung** | Ein Zustandsübergang `new → confirmed` ist der natürliche Aufhängepunkt. |
| **Lieferlogistik** | Bekäme dann ein eigenes Modul `src/Delivery/`, aufgesetzt auf `FulfillmentType` und `fulfillment_date`. |
| **Composer / PHPUnit** | Namespaces sind PSR-4, Testklassen sind PHPUnit-förmig. Beides ist eine Konfigurationsarbeit, keine Umschreibung. |

**Bleibt außerhalb, auch später:** Zahlungsabwicklung, Mandantenfähigkeit,
SaaS-Abhängigkeiten.

---

## 18. Definition of Done — Phase 1

Phase 1 ist abgeschlossen, wenn **alle** Punkte zutreffen:

1. `git diff` gegen `rebuild/flagship-recovery` zeigt **keine Änderung** an
   `index.html`, `en/`, `assets/`, `impressum/`, `datenschutz/`,
   `sitemap.xml`, `robots.txt`.
2. Sämtlicher neuer Code liegt unter `order-system/`, sämtliche neue
   Dokumentation unter `docs/superpowers/`.
3. Diese Spezifikation und der zugehörige Implementierungsplan existieren und
   stimmen mit dem Code überein.
4. Die Entities `Product`, `Customer`, `Order`, `OrderItem`, die Enums
   `OrderStatus`, `FulfillmentType` und die Value Objects `Money`, `Address`,
   `OrderNumber`, `FulfillmentDate` sind implementiert und erzwingen ihre
   Invarianten im Konstruktor.
5. Die Preisberechnung erfolgt ausschließlich serverseitig aus
   `ProductCatalog`; `OrderDraft` besitzt kein Preisfeld.
6. Alle zehn Regeln aus §16 sind durch Tests abgedeckt.
7. `php order-system/tests/run.php` läuft durch, meldet 0 Fehlschläge und
   endet mit Exit-Code 0. **Das Ergebnis wird belegt, nicht behauptet.**
8. `php -l` meldet für jede PHP-Datei des Subsystems „No syntax errors".
9. Das MariaDB-Schema liegt als nummerierte Migrationen vor, mit
   Fremdschlüsseln, Indizes, `DECIMAL(10,2)` für Geld und eindeutiger
   `order_number`.
10. Eine Seed-Struktur mit klar gekennzeichneten Platzhalterdaten existiert.
11. `order-system/README.md` beantwortet die Fragen aus §18 des Briefings.
12. Keine Abhängigkeit außerhalb der PHP-Standardbibliothek. Kein Composer,
    kein npm-Paket, kein SaaS, keine Zahlungsanbindung, keine Oberfläche.
13. Kein Geheimnis im Repository; `config/config.php` ist gitignored,
    `config.example.php` enthält nur Platzhalter.
14. Der Branch `feature/order-system-foundation` ist sauber, reviewbar und
    **nicht** gemergt.
