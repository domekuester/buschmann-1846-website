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
Keine echten Preise, keine echten Kunden. Niemals in eine produktive
Datenbank einspielen.

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

## Bestellnummern

Die laufende Nummer kommt aus `order_number_sequences`, nicht aus
`MAX(id) + 1`. Das atomare Idiom steht als Kommentar in
`migrations/006_create_order_number_sequences.sql`. Die Bestellnummer ist
fortlaufend und damit erratbar — sie darf **niemals** als Zugriffsschlüssel
dienen.
