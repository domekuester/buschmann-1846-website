# Buschmann 1846 — Bestellsystem auf Cloudflare: Design-Spezifikation

**Datum:** 2026-08-24
**Branch:** `refactor/order-system-cloudflare-foundation`
**Status:** verbindliche Entwurfsgrundlage — ersetzt die PHP-/MariaDB-Fassung vom 2026-08-23
**Gilt für:** `order-system/` — nicht für die bestehende Buschmann-Website

---

## 1. Warum dieser Wechsel

Die erste Foundation war fachlich richtig und technisch am falschen Ort. Sie
lief auf PHP 8.1, MariaDB und klassischem Webhosting — einer Plattform, die
für dieses System drei Nachteile hat:

1. **Das Schema war nie ausgeführt worden.** Es gab keinen Migrationsrunner,
   weil ein Runner eine Datenbankverbindung gebraucht hätte, die das Fundament
   nicht hatte. Die SQL-Dateien waren gelesen, nicht getestet. Ein Tippfehler
   in einem Constraint wäre erst beim Deployment aufgefallen.
2. **Die Zielumgebung war nicht reproduzierbar.** Die lokale PHP-Version war
   8.5, die Zielversion 8.1, und die Datenbank existierte nur auf dem Server.
3. **Die Website liegt auf statischem Hosting.** Ein PHP-Backend danebenzu
   stellen hätte zwei Betriebsmodelle und zwei Deployment-Wege bedeutet.

Cloudflare Workers mit D1 löst alle drei Punkte: Die Migrationen laufen lokal
mit demselben Werkzeug wie später entfernt, die Laufzeitumgebung ist lokal
identisch zur entfernten, und es gibt genau ein Deployment-Werkzeug.

**Was NICHT der Grund war:** Skalierung, Geschwindigkeit oder Kosten. Das
erwartete Bestellvolumen ist sehr klein. Der Grund ist Testbarkeit.

---

## 2. Alt und Neu

| | Alt (2026-08-23) | Neu (2026-08-24) |
|---|---|---|
| Sprache | PHP 8.1 | TypeScript 5.9, `strict` |
| Laufzeit | Apache/mod_php, klassischer Webspace | Cloudflare Workers |
| Datenbank | MariaDB 10.2+/InnoDB | Cloudflare D1 (SQLite) |
| Geld | `DECIMAL(10,2)`, App rechnet in Cent | **`INTEGER` in Cent, durchgängig** |
| Zeitpunkte | `DATETIME` in UTC | `TEXT` ISO-8601-UTC |
| Tage | `DATE` | `TEXT` `JJJJ-MM-TT`, Europe/Berlin |
| Aufzählungen | `ENUM(...)` | `TEXT` + `CHECK (... IN ...)` |
| Wahrheitswerte | `TINYINT(1)` | `INTEGER` + `CHECK (... IN (0,1))` |
| Schlüssel | `AUTO_INCREMENT` | `INTEGER PRIMARY KEY` |
| Bestellnummer | `LAST_INSERT_ID(expr)`-Idiom | `UPSERT ... RETURNING` |
| Atomarität | InnoDB-Transaktion | `D1Database.batch()` |
| Migrationen | von Hand, nie ausgeführt | `wrangler d1 migrations`, **lokal ausgeführt** |
| Module | PSR-4-Autoloader | ES Modules |
| Tests | eigener Runner, 110 Tests | Vitest + `@cloudflare/vitest-plugin`, 173 Tests |
| Zugriffsschutz | `.htaccess` | entfällt — kein Webspace |
| Konfiguration | `config.php` | Worker-Bindings |

**Unverändert geblieben ist die gesamte Fachlichkeit.** Kein einziger
Geschäftsregel wurde beim Wechsel gelockert.

---

## 3. Architektur

```text
bestellen.buschmann1846.de   (noch nicht eingerichtet)
        │
        ▼
┌───────────────────────────────────────────┐
│ src/worker.ts        äußere Hülle         │  Pfad → Antwort. Sonst nichts.
├───────────────────────────────────────────┤
│ src/http/            HTTP-Grenze          │  Response-Formen, Health
├───────────────────────────────────────────┤
│ src/application/     Anwendungsfälle      │  placeOrder
├───────────────────────────────────────────┤
│ src/domain/          Geschäftslogik       │  KENNT WEDER HTTP NOCH D1
├───────────────────────────────────────────┤
│ src/infrastructure/d1/  Persistenz        │  prepare().bind(), batch()
└───────────────────────────────────────────┘
        │
        ▼
   Cloudflare D1
   customers · products · orders · order_items · order_number_sequences
```

### Die Unabhängigkeit der Domäne ist nachgewiesen, nicht behauptet

`vitest.config.ts` definiert zwei Projekte. Das Projekt `domain` läuft in
schlichtem Node **ohne Workers-Runtime, ohne D1, ohne Netz**. Hinge die
Domänenlogik an einer dieser Sachen, ließen sich ihre 120 Tests nicht
ausführen. Die Trennung ist damit kein Vorsatz, sondern eine Bedingung, die
bei jedem Testlauf geprüft wird.

---

## 4. Geld

Geld ist **ausschließlich** ein `number` mit ganzzahligen Cent — im
TypeScript-Modell wie in der Datenbank. `48,00 €` sind `4800`.

`Money` ist die einzige Stelle, an der Geldarithmetik stattfindet. Sie kennt
Addition und Multiplikation mit einer ganzzahligen Menge, aber **keine
Division**: Sobald Prozentwerte gebraucht werden (Umsatzsteuer, Rabatt), wird
die Rundungsregel genau dort ergänzt und getestet, statt sich über die
Aufrufstellen zu verteilen.

Drei Grenzen sichern die Exaktheit ab:

* `Number.isInteger` an jedem Eingang. In PHP war das der `int`-Typ; in
  TypeScript ist `number` auch `1.5`, `NaN` und `Infinity`.
* `MAX_CENTS = 9_999_999_999`. Nicht mehr die Breite von `DECIMAL(10,2)`,
  sondern der Abstand zu `Number.MAX_SAFE_INTEGER` — damit auch Summen und
  Produkte exakt bleiben.
* Überlaufprüfung **vor** der Multiplikation. Ein Produkt jenseits des sicheren
  Bereichs wäre bereits gerundet, wenn man es ansieht.

In der Datenbank kommt eine vierte hinzu: `CHECK (typeof(price_cents) =
'integer')`. SQLite betrachtet Spaltentypen nur als Empfehlung; ohne diese
Prüfung wäre `4.35` ein zulässiger Wert in einer INTEGER-Spalte.

---

## 5. Zeit

Zwei Dinge, die nicht verwechselt werden dürfen:

**Ein ZEITPUNKT** (`created_at`, `updated_at`) ist ein Augenblick auf der
Weltzeitachse. Gespeichert als ISO-8601 in UTC mit fester Länge
(`2026-08-23T07:00:00.000Z`). Die feste Länge macht die lexikografische
Ordnung zur chronologischen — `ORDER BY created_at` ist damit korrekt, ohne
dass SQLite eine Datumsfunktion aufrufen muss.

**Ein TAG** (`fulfillment_date`) ist ein Kalendertag im Geschäftskontext
Europe/Berlin. Gespeichert als `JJJJ-MM-TT`, ohne Uhrzeit und ohne Zeitzone,
weil er fachlich keine hat. Ein Café bestellt „für Freitag".

Diese Trennung ist keine Förmlichkeit. Der Worker läuft in UTC. Zwischen
Mitternacht und 02:00 Uhr Berliner Zeit ist in UTC noch der Vortag. Würde
„heute" aus der UTC-Uhr abgeleitet, lehnte das System um 00:30 Uhr eine
Bestellung für den laufenden Tag als „in der Vergangenheit" ab und ließe eine
für den Vortag durch. `businessDay()` in `src/domain/clock.ts` löst das über
`Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'`; zwei Tests halten es
fest, je einer für Sommer- und Winterzeit.

Der Vergleichszeitpunkt wird immer übergeben, nie intern aus `Date.now()`
gelesen — sonst wären die Tests am Jahreswechsel wertlos.

---

## 6. Preis-Snapshots

Die wichtigste erhaltene Geschäftsregel. Eine Bestellung ist ein **Dokument**,
keine Sicht auf den aktuellen Stammdatenbestand.

`order_items` trägt deshalb:

| Spalte | Warum |
|---|---|
| `product_id` | Bezug für Auswertungen; `ON DELETE RESTRICT` |
| `product_name_snapshot` | Die Position bleibt lesbar, wenn das Produkt umbenannt wird |
| `product_unit_snapshot` | „3 Bleche" bleibt „3 Bleche", auch wenn die Einheit später anders heißt |
| `unit_price_cents` | Der Preis zum Bestellzeitpunkt |
| `quantity` | Ganzzahlig |
| `line_total_cents` | Einmal berechnet, einmal geschrieben |

`orders` trägt zusätzlich `customer_name_snapshot`,
`delivery_address_snapshot` und `total_amount_cents`.

Die Regel ist an vier Stellen abgesichert:

1. `OrderItem` **berechnet** `lineTotal` und hat kein Feld, über das ein
   anderer Wert gesetzt werden könnte.
2. `findOrderByNumber` verbindet **nicht** auf `products`. Ein JOIN würde die
   Regel exakt aushebeln.
3. `CHECK (line_total_cents = unit_price_cents * quantity)` prüft die Rechnung
   noch einmal in der Datenbank.
4. Ein Test speichert eine Bestellung, ändert den Produktpreis von 435 auf 520
   und prüft, dass die alte Bestellung bei 1305 Cent bleibt und erst die neue
   1560 Cent kostet.

---

## 7. Serverseitige Preisbildung

Der Preis kann nicht aus der Anfrage stammen, weil es in der Anfrage nichts
gibt, aus dem er stammen könnte.

`OrderDraft` liest aus dem Anfragekörper ausschließlich `fulfillment_type`,
`fulfillment_date`, `note` und `items` mit je `product_id` und `quantity`.
Alles Weitere fällt weg, egal wie es heißt. Ein mitgesendeter Betrag wird
**nicht geprüft und verworfen — er wird nie gelesen.**

`Order.place()` bekommt `Customer` und `ProductCatalog` aus der Datenbank und
den `OrderDraft` aus der Anfrage. Der `ProductCatalog` heißt so, wie er heißt,
damit man am Typ ablesen kann, woher ein Preis kommt: Er ist die einzige
Quelle, aus der `place()` Preise nimmt.

Nachgewiesen wird das gegen eine echte Datenbank: Ein Test schickt
`unit_price_cents: 1`, `line_total_cents: 3` und `total_amount_cents: 3` mit —
gespeichert werden 435, 1305 und 1305.

`customerId` kommt aus dem Kommando, nicht aus dem Anfragekörper. Ein
mitgesendetes `customer_id` wirkt nicht.

---

## 8. Bestellnummern

Format unverändert: `BUS-JJJJ-NNNNNN`, feste Länge 15. Am Telefon vorlesbar,
gleichlange Ziffernblöcke, keine UUID.

**Die Nummer ist kein Zugriffsschlüssel.** Sie ist fortlaufend und damit
erratbar. Eine spätere Phase darf niemals „wer die Nummer kennt, darf die
Bestellung sehen" umsetzen; dafür wäre ein separates Zufallstoken nötig.

Das MariaDB-Idiom `LAST_INSERT_ID(expr)` gibt es in SQLite nicht und wurde
nicht nachgebaut, sondern ersetzt:

```sql
INSERT INTO order_number_sequences (year, next_value)
     VALUES (?, 1)
ON CONFLICT (year) DO UPDATE SET next_value = next_value + 1
  RETURNING next_value;
```

Eine Anweisung, atomar. Das ist der Kern: Ein „erst lesen, dann schreiben" —
`SELECT MAX(...)` gefolgt von `INSERT` — hat zwischen beiden Schritten eine
Lücke, in der zwei gleichzeitige Bestellungen dieselbe Nummer bekämen. Der
UPSERT hat diese Lücke nicht. Ein Test startet 25 gleichzeitige
Reservierungen und prüft, dass genau die Nummern 1 bis 25 herauskommen.

**Lücken sind zulässig.** Scheitert die fachliche Prüfung nach der
Reservierung, ist die Nummer verbraucht. Das ist hingenommen, nicht übersehen:
Lückenlosigkeit ist eine Anforderung an Rechnungsnummern, nicht an
Bestellnummern. Zwei Tests halten das Verhalten fest. Die letzte Absicherung
bleibt ohnehin `UNIQUE(order_number)`.

---

## 9. Atomare Schreibvorgänge

Es darf nicht vorkommen, dass eine Bestellung angelegt wird und die Positionen
nur zur Hälfte.

`saveOrder` übergibt alle Anweisungen an `D1Database.batch()`. D1 führt sie in
einer impliziten Transaktion aus; scheitert eine, wird keine wirksam. Eine
selbst gebaute Pseudo-Transaktion aus Einzelaufrufen wäre genau das, was hier
ausgeschlossen werden soll.

Die Positionen beziehen ihre `order_id` über ein Subselect auf die eindeutige
Bestellnummer, nicht über `last_insert_rowid()`. Das Subselect sagt
ausdrücklich, zu welcher Bestellung eine Position gehört, statt sich auf
Ausführungsreihenfolge und Verbindungszustand zu verlassen.

Der Test erzwingt den Fehlerfall: Ein Produkt wird zwischen Katalogaufbau und
Speichern gelöscht, die zweite Position scheitert am Fremdschlüssel — und
danach stehen weder Bestellung noch Positionen in der Datenbank.

---

## 10. Das Schema als zweite Verteidigungslinie

Die Geschäftslogik ist die erste. Das Schema fängt ab, was auf anderem Weg in
die Datenbank gerät.

**Fremdschlüssel** (D1 erzwingt sie):

| Von | Nach | Bei Löschung | Warum |
|---|---|---|---|
| `orders.customer_id` | `customers.id` | `RESTRICT` | Ein Kunde mit Bestellungen wird deaktiviert, nicht gelöscht. Ein Löschverlangen wird als Anonymisierung umgesetzt; der Namens-Snapshot hält die Bestellung lesbar. |
| `order_items.order_id` | `orders.id` | `CASCADE` | Positionen ohne Bestellung sind sinnlos. |
| `order_items.product_id` | `products.id` | `RESTRICT` | Ein je bestelltes Produkt darf nicht verschwinden. |

**Bemerkenswerte CHECK-Bedingungen:**

* `line_total_cents = unit_price_cents * quantity` — die Rechnung selbst als
  Constraint.
* `typeof(price_cents) = 'integer'` — kein Fließkommawert in einer Preisspalte.
* `date(fulfillment_date) IS fulfillment_date` — gültiger Kalendertag. Das
  `IS` ist wesentlich: Ein CHECK, das zu `NULL` auswertet, gilt in SQLite als
  erfüllt; mit `=` wäre die Prüfung wirkungslos gewesen. So scheitern auch
  `2026-02-30`, `2026-13-01` und `2026-8-28`.
* `UNIQUE(order_id, product_id)` — dasselbe Produkt zweimal wäre eine Position
  zu viel, keine zweite Zeile.
* Lieferung nur mit Adresse, in `customers` wie in `orders`.

**Kein GLOB mit vielen Zeichenklassen.** Ein Muster wie
`'BUS-[0-9][0-9][0-9][0-9]-[0-9]…'` lehnt SQLite zur Laufzeit als „LIKE or
GLOB pattern too complex" ab — gefunden, weil die Schema-Tests tatsächlich
laufen. Ersetzt durch `substr()` plus `NOT GLOB '*[^0-9]*'`.

**Indizes** decken die drei Abfragen ab, die es wirklich gibt: das bestellbare
Sortiment (`is_active, sort_order, id`), „was ist für Freitag zu produzieren"
(`fulfillment_date, status`) und „die letzte Bestellung dieses Cafés"
(`customer_id, fulfillment_date`).

---

## 11. Was Phase 1 ausdrücklich nicht enthält

Keine Bestelloberfläche · kein Admin-Dashboard · kein Kundenlogin · keine
persönlichen Café-Links · kein „letzte Bestellung wiederholen" · kein Payment ·
kein Mailversand · kein Turnstile · kein R2 · kein Bilderupload · keine
Umsatz- oder Margenauswertung · keine Lieferplanung · keine Warenwirtschaft ·
keine Rechnungen · keine Analytics · keine neue Marketing-Website.

Ebenfalls nicht: Durable Objects, KV, Queues, ein ORM oder ein
Backend-Framework. Vier Tabellen und direkte Prepared Statements genügen.

Die Bestell-API selbst gibt es noch nicht. `placeOrder` existiert als
Anwendungsfall und ist gegen eine echte Datenbank getestet, aber kein
HTTP-Endpunkt ruft ihn auf. Das ist Absicht: Ein Endpunkt ohne Oberfläche wäre
eine Zusage, die später eingehalten werden müsste.

---

## 12. Betrieb und Grenzen

Das System kommt ohne Workers Paid aus. Keine Architekturentscheidung setzt
Paid voraus, und ein späterer Wechsel erfordert keinen Umbau.

Die Compatibility Date ist `2026-08-23`. Ab dem 2026-08-04 ist
Node.js-Kompatibilität in Workers voreingestellt; ein zusätzliches
`nodejs_compat` wäre redundant. Der Code kommt ohnehin mit
Web-Standard-APIs aus.

Es wurde **keine entfernte D1-Datenbank angelegt**. Die `database_id` in
`wrangler.jsonc` ist ein Platzhalter aus Nullen und muss vor einem entfernten
Betrieb ersetzt werden. Es hat kein Deployment stattgefunden.

---

## 13. Spätere UX darf nicht erschwert werden

Der Zielablauf für ein Stammcafé:

```text
Bestellseite öffnen → Produkte sofort sehen → Mengen mit − / + ändern
→ Lieferdatum wählen → optionale Notiz → senden
```

Zielgröße: 20–30 Sekunden. Zwei Entscheidungen dienen ausdrücklich diesem
Ziel: `loadCatalog` holt das gesamte Sortiment in **einem** Zugriff, gedeckt
von genau einem Index, und `OrderDraft` behandelt Menge 0 als „nicht
bestellt", damit die Seite alle Produkte mitsenden kann, ohne dass der Client
mitdenken muss, welche davon bestellt sind.
