# Produktions-Tagesdaten — Design

**Phase 3B · 2026-08-25 · Branch `feature/order-system-production-day-data`**

---

## Problem

Buschmann kann seit Phase 2 Bestellungen von Stammcafés entgegennehmen und
seit Phase 3A Cafés und Administration voneinander unterscheiden. Was das
System bis heute **nicht** kann, ist die Frage zu beantworten, für die es
gebaut wurde:

> Was muss Buschmann für den 26. August produzieren?

Die Daten dafür liegen vollständig in D1 — in `orders` und `order_items`. Es
gibt bloß keinen Weg, sie zu lesen. Ein Admin kann sich anmelden und bekommt
eine leere Shell.

Phase 3B schließt genau diese Lücke, und zwar ausschließlich auf der Daten-
und API-Ebene.

---

## Business Question

Für einen ausdrücklich genannten Kalendertag liefert das System zwei Ebenen:

**A — Was ist insgesamt zu produzieren.** Die Backstube braucht eine
Gesamtmenge je Produkt, nicht zwölf Einzelbestellungen:

```text
Beispiel Käsekuchen     11 Stück
Beispiel Carrot Cake     8 Stück
```

**B — Woraus diese Menge entsteht.** Die Auslieferung braucht die Aufteilung,
und ein Rückfrage-Anruf braucht die Bestellnummer:

```text
Testcafé Nord   ·  BUS-2026-000123  ·  Lieferung  ·  „Bitte vor 10 Uhr"
    3 × Beispiel Käsekuchen
    2 × Beispiel Carrot Cake

Testcafé Süd    ·  BUS-2026-000124  ·  Abholung
    8 × Beispiel Käsekuchen
    6 × Beispiel Carrot Cake
```

Beide Ebenen stammen aus **derselben** Abfrage desselben Requests. Sie können
sich damit nicht widersprechen — die Summen sind aus den Bestellungen
gerechnet und nicht getrennt ermittelt.

---

## Scope

1. Ein Lesemodell für einen Produktionstag (`src/domain/production-day.ts`).
2. Zwei D1-Leseabfragen (`src/infrastructure/d1/production-day-repository.ts`).
3. Ein Anwendungsfall, der beides zusammenführt (`src/application/get-production-day.ts`).
4. Ein geschützter Admin-Endpunkt (`src/http/production-api.ts`).
5. Tests: Domäne, D1, HTTP, Sicherheit, Regression, Mutation.
6. Diese Spezifikation, der Umsetzungsplan und die README-Ergänzung.

---

## Non-Goals

Ausdrücklich **nicht** Bestandteil dieser Phase — jeder Punkt einzeln, damit
niemand ihn später für ein Versehen hält:

| Nicht gebaut | Warum nicht |
|---|---|
| Produktionsdashboard, Tabelle, Kalender, Charts | Phase 3C. Ein Endpunkt ohne Oberfläche ist prüfbar; eine Oberfläche ohne geprüften Endpunkt ist eine Vermutung mit CSS. |
| Statuswechsel, Bestellbearbeitung, Produkt-/Kundeneditor | Phase 3B ist **read only**. Es entsteht keine einzige neue schreibende Route. |
| Umsatz, Kosten, Margen, Einkaufspreise | Controlling ist eine eigene Domäne. Sie an die Produktionsansicht zu koppeln, hieße sie später aus ihr herauslösen zu müssen. |
| Zeitraum-, Monats-, Jahresberichte | Ein Datum pro Request. Ein `from`/`to` wäre eine unbeschränkte Abfrage mit einem Parameter davor. |
| CSV, PDF, Drucken | Ausgabeformate gehören zu einer Oberfläche, die es noch nicht gibt. |
| Cron, Queues, Scheduled Workers, KV-Cache, Durable Objects, Summentabellen | Das Volumen ist eine Handvoll Bestellungen je Tag. Vorberechnung wäre eine zweite Quelle der Wahrheit für Daten, die in Millisekunden ableitbar sind. |
| Pagination | Ein Produktionstag passt in eine Antwort. YAGNI. |
| Änderungen an Login, Sitzungen, KDF, Pepper, Cookies, CSRF | Phase 3A funktioniert. Diese Phase benutzt sie und fasst sie nicht an. |
| Neue externe Dependency | Es wird keine gebraucht. |
| Deployment, Push, Merge, Remote-D1 | Alles bleibt lokal. |

---

## Production-Relevant Statuses

Das System kennt fünf Status. Für die Frage „was steht für diesen Tag **noch**
zur Produktion an?" zählen genau drei:

| Status | Zählt | Begründung |
|---|---|---|
| `new` | **ja** | Bestellt und noch nicht angefasst. Muss gebacken werden. |
| `confirmed` | **ja** | Bestätigt. Muss gebacken werden. |
| `in_production` | **ja** | Wird gerade gebacken — und ist bis zum Abschluss Teil der Tagesmenge. Sie hier herauszunehmen hieße, dass die Tagesliste schrumpft, während gearbeitet wird, und die Backstube nicht mehr sähe, was sie gerade tut. |
| `completed` | **nein** | Erledigt. Gehört nicht mehr zur **offenen** Produktionsmenge. |
| `cancelled` | **nein** | Storniert. Darf niemals Produktion erzeugen. Das ist die Regel, deren Verletzung echten Schaden anrichtet: weggeworfener Kuchen. |

**Die Liste steht an genau einer Stelle** — `OPEN_PRODUCTION_STATUSES` in
`src/domain/order-status.ts`, unmittelbar neben `ORDER_STATUSES`. Nicht in
einem SQL-String, nicht doppelt in Repository und Service.

Der Ort ist mit Absicht gewählt: Wer künftig einen sechsten Status hinzufügt,
steht beim Bearbeiten von `ORDER_STATUSES` unvermeidlich vor der zweiten
Liste und muss entscheiden, ob der neue Status Produktion erzeugt. Läge die
Liste in einem anderen Modul, wäre diese Entscheidung übersehbar.

Der SQL-`IN (...)`-Ausdruck wird **aus dieser Liste erzeugt** — Platzhalter
nach Länge, Werte über `.bind(...)`. Es gibt keinen Weg, die Liste zu ändern,
ohne dass die Abfrage folgt.

Die API liefert den Status jeder Bestellung mit. Phase 3C kann damit später
`new` von `in_production` unterscheiden. Die **Summen** enthalten
ausschließlich offene produktionsrelevante Bestellungen.

---

## Date Semantics

### Der Kalendertag ist kein Zeitpunkt

`orders.fulfillment_date` ist ein Kalendertag im Geschäftskontext
Europe/Berlin, gespeichert als `'JJJJ-MM-TT'`, ohne Uhrzeit und ohne Zone —
so, wie Phase 1 ihn definiert hat und wie `src/domain/clock.ts` es begründet.
Ein Café bestellt „für Freitag".

**Daraus folgt die zentrale Regel dieser Phase:**

> Der angefragte Tag wird als Zeichenkette validiert und als Zeichenkette
> gebunden. Er wird **nirgends** in ein `Date` überführt, um daraus wieder
> einen Tag zu machen.

`'2026-08-25'` darf unter keinen Umständen zu `'2026-08-24'` oder
`'2026-08-26'` werden. Genau das passiert, sobald ein Kalendertag durch eine
Zeitzonenrechnung läuft: Der Worker läuft in UTC, Berlin ist im Sommer zwei
Stunden voraus, und `new Date('2026-08-25').toLocaleDateString(...)` liefert
je nach Zone einen anderen Tag.

Die einzige Stelle, an der ein `Date` überhaupt vorkommt, ist die
Gültigkeitsprüfung des Kalenderdatums (`isCalendarDay`, siehe unten) — und
dort ausschließlich mit explizitem `T00:00:00Z` und Rückvergleich, also ohne
Zonenanteil.

Ein `Date`-Objekt wird für diesen Endpunkt an keiner Stelle gebraucht, um zu
entscheiden, **welcher** Tag gemeint ist: Der Tag steht in der Anfrage.

### Kein implizites „heute"

Der Endpunkt verlangt `?date=JJJJ-MM-TT` und hat **keinen** Vorgabewert.

Der Grund ist der Vertrag, nicht die Bequemlichkeit: Ein Endpunkt, dessen
Antwort davon abhängt, wann er aufgerufen wird, ist nicht deterministisch
testbar und um 23:59 Uhr etwas anderes als um 00:01 Uhr. Phase 3C darf in der
Oberfläche gern „morgen" vorauswählen — dann steht die Entscheidung dort, wo
sie hingehört, und die berechnete Vorauswahl geht als expliziter Parameter in
die Anfrage.

### Vergangenheit ist erlaubt

Die Abfrage liest Vergangenheit, Gegenwart und Zukunft ohne Unterschied.

`FulfillmentDate.fromString()` lehnt vergangene Tage ab — das ist die Regel
für das **Bestellen**. Für das **Lesen** gilt sie nicht: Ein Admin muss den
letzten Freitag nachvollziehen können. Phase 3B schreibt nichts; es gibt
keinen Grund, den Blick zurück zu versperren.

### Validierung

Akzeptiert wird ausschließlich ein **gültiger Kalendertag** im Format
`JJJJ-MM-TT`:

| Eingabe | Ergebnis | Grund |
|---|---|---|
| `2026-08-26` | akzeptiert | |
| `2028-02-29` | akzeptiert | Schaltjahr |
| `2026-02-29` | **400** | kein Schaltjahr |
| `2026-02-30`, `2026-13-01`, `2026-00-10` | **400** | kein Kalendertag |
| `2026-8-26` | **400** | nicht zweistellig |
| `25.08.2026`, `2026/08/25` | **400** | falsches Format |
| `tomorrow`, `today` | **400** | keine Datumssprache im Datenvertrag |
| `` (leer) | **400** | |
| Parameter fehlt | **400** | |
| `?date=A&date=B` | **400** | siehe unten |

**Mehrfacher `date`-Parameter wird abgelehnt**, statt still den ersten Wert zu
nehmen. `URLSearchParams.get()` liefert den ersten Treffer; welcher das ist,
hängt an der Reihenfolge in der URL. Ein Endpunkt, dessen Antwort von einer
solchen Feinheit abhängt, lädt zu Parameter-Schmuggel ein. Geprüft wird
`getAll('date').length === 1`.

Die Prüffunktion `isCalendarDay(value)` zieht in `src/domain/clock.ts` ein —
dort, wo das Zeitmodell des Systems ohnehin beschrieben ist. `FulfillmentDate`
trägt dieselbe Prüfung heute zweimal wörtlich in sich (`fromString` und
`restore`); beide Stellen werden auf die neue Funktion umgestellt. Das ist
kein Umbau der Bestellregeln: Die Semantik ist identisch, die Prüfung auf
`Jahr < 2000` bleibt dort, wo sie ist (nur `fromString`), und die
Bestellabnahme verhält sich unverändert. Eine Regel an drei Orten wäre eine
Regel, von der irgendwann zwei Fassungen existieren.

---

## Architecture

Die vorhandene Schichtung wird benutzt, nicht erweitert. Es entsteht keine
neue Ebene.

```text
  HTTP            src/http/production-api.ts
                  · Methode · Rolle · Datum · Antwortform · Kopfzeilen
                        │
                        ▼  validierter Tag als 'JJJJ-MM-TT'
  Application     src/application/get-production-day.ts
                  · Repository fragen · Domäne aggregieren lassen
                        │
                        ▼
  Infrastructure  src/infrastructure/d1/production-day-repository.ts
                  · zwei Prepared Statements · Zeilen → Lesemodell
                        │
                        ▼
  Domain          src/domain/production-day.ts   (Aggregation, rein)
                  src/domain/order-status.ts     (was zählt)
                  src/domain/clock.ts            (was ein Tag ist)
```

Die **Domänenschicht ist frei von D1, HTTP und Zeit**. Sie wird deshalb im
Vitest-Projekt `domain` getestet, das ohne Worker-Runtime und ohne Datenbank
läuft — dass diese Tests laufen, ist zugleich der Beweis der Unabhängigkeit.

---

## Repository Boundary

`src/infrastructure/d1/production-day-repository.ts`

```ts
export async function findProductionOrders(
  db: D1Database,
  day: string,
): Promise<readonly ProductionOrder[]>
```

Was diese Schnittstelle **tut**: Sie liefert die produktionsrelevanten
Bestellungen eines Tages samt Positionen, in der endgültigen Reihenfolge.

Was sie **nicht** tut, und zwar keines davon:

* kein HTML,
* keine Autorisierung — sie sieht weder Request noch Sitzung noch Cookie,
* keine Kenntnis von HTTP, Status-Codes oder Kopfzeilen,
* keine Aggregation — Summen sind eine fachliche Regel und gehören in die
  Domäne, wo sie ohne Datenbank prüfbar sind,
* keine Validierung des Tages — sie bekommt einen bereits geprüften Wert.

Der Parameter heißt `day` und nicht `date`, weil er ein Kalendertag ist und
kein Zeitpunkt. Das ist dieselbe Unterscheidung, die `clock.ts` trifft.

---

## Application Flow

`src/application/get-production-day.ts`

```ts
export async function getProductionDay(
  db: D1Database,
  day: string,
): Promise<ProductionDay>
```

Drei Zeilen Ablauf: Bestellungen laden, aggregieren, zurückgeben. Der
Anwendungsfall kennt keine `Response`, keinen Status-Code, kein Cookie und
keinen `Request`.

Eine eigene Datei für so wenig Ablauf ist Absicht: Sie ist die Stelle, an der
Phase 3C ansetzt, ohne die HTTP-Schicht anfassen zu müssen — und sie ist ohne
HTTP testbar.

---

## D1 Queries

**Zwei** Abfragen. Nicht eine, nicht fünf.

### Q1 — die Bestellungen des Tages

```sql
SELECT id, order_number, customer_name_snapshot, fulfillment_type, note, status
  FROM orders
 WHERE fulfillment_date = ?
   AND status IN (?, ?, ?)
 ORDER BY customer_name_snapshot, order_number
```

### Q2 — die Positionen dieser Bestellungen

```sql
SELECT i.order_id, i.product_id, i.product_name_snapshot,
       i.product_unit_snapshot, i.quantity
  FROM order_items i
  JOIN orders   o ON o.id = i.order_id
  JOIN products p ON p.id = i.product_id
 WHERE o.fulfillment_date = ?
   AND o.status IN (?, ?, ?)
 ORDER BY i.order_id, p.sort_order, i.product_name_snapshot, i.product_id
```

### Warum zwei und nicht eine

Eine einzige Abfrage über den Join würde Bestellungen **ohne** Positionen
verschlucken — und damit `order_count` verfälschen. Das Aggregat `Order`
verlangt zwar mindestens eine Position, aber das **Schema** verlangt es
nicht; eine spätere Erfassung im Backoffice oder eine Korrektur von Hand kann
eine positionslose Bestellung erzeugen. Eine Tagesübersicht, die eine
Bestellung stillschweigend verschwinden lässt, ist schlimmer als eine, die
sie mit null Positionen zeigt.

Q1 ist deshalb die Wahrheit über **welche Bestellungen** es gibt, Q2 die
Wahrheit über **was darin steht**.

### Warum zwei und nicht N+1

Q2 filtert über denselben Tagesausdruck wie Q1 und lädt damit **alle**
Positionen **aller** Bestellungen des Tages in einem Zugriff. Es gibt keine
Schleife über Bestellungen, keine Abfrage je Position, keine Abfrage je
Produkt und keine je Kunde. Die Zuordnung Position → Bestellung geschieht im
Anwendungscode über `order_id`, in einer `Map`, in linearer Zeit.

Die Alternative — Q2 mit `WHERE i.order_id IN (…)` und den IDs aus Q1 — wäre
ebenfalls zwei Abfragen, aber mit einer variablen Zahl Platzhalter und einer
Abhängigkeit von Q1. Der Tagesausdruck ist dieselbe Bedingung, benutzt
denselben Index und braucht diese Kopplung nicht.

Ein SQL-JSON-Generator, der alles in einer Zeile zurückgibt, wäre eine dritte
Möglichkeit — und ein Stück Code, das niemand ohne Handbuch liest. Bei
zweistelligen Zeilenzahlen je Tag ist die Ersparnis null.

### Warum `JOIN products` — und warum das die Snapshots nicht bricht

Aus `products` wird **ausschließlich `sort_order`** gelesen, und zwar
ausschließlich zum Sortieren. Name, Einheit und Preis kommen aus den
Snapshot-Spalten der Position. Die Sortierreihenfolge ist eine
Anzeigeeigenschaft der Gegenwart („so ist unser Sortiment geordnet") und keine
Eigenschaft der historischen Bestellung; sie aus dem aktuellen Stammdatensatz
zu nehmen ist richtig und ändert an keinem gespeicherten Wert etwas.

Der Join ist ein **INNER JOIN** und kann trotzdem keine Zeile verlieren:
`order_items.product_id` hat einen Fremdschlüssel mit `ON DELETE RESTRICT`
(Migration 0004). Ein je bestelltes Produkt kann nicht verschwinden. Ein
`LEFT JOIN` hätte ein `NULL` in `sort_order` möglich gemacht, das dann in der
Sortierung hätte behandelt werden müssen — eine Fallunterscheidung für einen
Fall, den das Schema ausschließt.

### Warum kein Join auf `customers`

Weil es keinen braucht. `orders.customer_name_snapshot` trägt den Namen zum
Bestellzeitpunkt (Migration 0003). Das ist zugleich der bessere Wert: Benennt
sich ein Café um, soll die Bestellung von letzter Woche nicht rückwirkend
anders heißen.

Der angenehme Nebeneffekt ist Datenminimierung durch Bauart: Die Abfrage
**berührt die Tabelle `customers` nicht**. E-Mail, Telefon, Ansprechpartner
und interne Notiz können auf diesem Weg nicht abfließen, weil sie nicht
gelesen werden. Ebenso wenig wird `auth_accounts` oder `auth_sessions`
berührt.

### SQL Injection

Der Tag und die Statuswerte gehen als gebundene Parameter in vorbereitete
Statements. Es wird **keine** Zeichenkette in SQL konkateniert. Die
Platzhalter des `IN (…)` entstehen aus der **Länge** der
`OPEN_PRODUCTION_STATUSES`-Liste (`OPEN_PRODUCTION_STATUSES.map(() => '?')`),
die Werte kommen aus derselben Liste — also aus Code, nie aus einer Anfrage.
Der einzige Wert aus Benutzerhand ist der Tag, und der ist vorher gegen
`isCalendarDay` geprüft **und** gebunden.

---

## Aggregation Rules

Rein, ohne Datenbank, in `src/domain/production-day.ts`:

```ts
aggregateProductionDay(day: string, orders: readonly ProductionOrder[]): ProductionDay
```

| Feld | Regel |
|---|---|
| `date` | der angefragte Tag, unverändert durchgereicht |
| `orderCount` | Anzahl der **Bestellungen** in `orders`. Nicht Positionen, nicht Produkte. Storniert und abgeschlossen sind gar nicht erst enthalten. |
| `totalUnits` | Summe **aller** `quantity` über **alle** Positionen **aller** Bestellungen. 3 Käsekuchen + 2 Carrot Cake + 5 Tartes = **10**. Nicht 3 (Produktarten), nicht 1 (Bestellungen). |
| `products` | Mengen je Produktidentität, siehe unten |
| `orders` | die Bestellungen selbst, unverändert in Reihenfolge und Inhalt |

Der leere Tag ist kein Sonderfall im Code: Über eine leere Liste zu summieren
ergibt `0`, und `products` ist dann eben leer. Es gibt keinen `if`-Zweig für
„nichts da".

---

## Snapshot Semantics

### Der Aggregationsschlüssel

Zusammengefasst wird über das Tripel

```text
(product_id, product_name_snapshot, product_unit_snapshot)
```

und nicht über `product_id` allein.

**Warum der Name zum Schlüssel gehört.** Eine Bestellung ist ein Dokument.
Wird „Käsekuchen" später in „Klassischer Käsekuchen" umbenannt, dann steht in
der alten Bestellung weiterhin „Käsekuchen" — genau dafür gibt es die
Snapshot-Spalte. Würde die Produktionsansicht über `product_id` aggregieren
und irgendeinen der beiden Namen anzeigen, benennte sie eine historische
Bestellung stillschweigend um. Das ist die eine Sache, die Snapshots
verhindern sollen.

Der Preis dieser Regel: Kommen an einem Tag beide Namen desselben Produkts
vor, erscheinen **zwei Zeilen** in `products`. Das ist die richtige Wahl —
Korrektheit vor kosmetischer Zusammenführung. Die `product_id` steht in beiden
Zeilen, eine spätere Oberfläche kann den Zusammenhang also sichtbar machen,
ohne dass die Daten ihn behaupten.

Praktisch ist der Fall selten: Er verlangt eine Umbenennung zwischen zwei
Bestellungen für **denselben** Liefertag.

**Warum die Einheit zum Schlüssel gehört.** `product_unit_snapshot` ist für
eine Backstube keine Kosmetik: „8 Blech" und „8 Stück" sind verschiedene
Arbeitstage. Würde ein Produkt seine Einheit ändern, wäre eine Summe über
beide Einheiten eine Zahl ohne Bedeutung. Dieselbe Regel wie beim Namen,
derselbe Grund.

Deshalb trägt jede Produktzeile und jede Position die Einheit mit. Sie ist
kein Feld ohne Nutzen, sondern die Maßeinheit der einzigen Zahl, um die es in
dieser API geht.

### Der Kundenname

Aus `orders.customer_name_snapshot`. Kein Zugriff auf `customers`. Begründung
oben unter „Warum kein Join auf `customers`".

### Die Notiz

`orders.note` wird **unverändert** als JSON-Zeichenkette geliefert. Keine
HTML-Interpretation, keine Umwandlung, kein Kürzen — die Länge ist beim
Bestellen auf 500 Zeichen begrenzt (`Order`), und diese Prüfung bleibt
maßgeblich. `null` bleibt `null` und wird nicht zu `""`.

> Für Phase 3C: Diese Zeichenkette ist **Kundeneingabe**. Wer sie in HTML
> rendert, escapet sie. Das System liefert sie als Datum, nicht als Markup.

---

## DTO

### Intern (TypeScript, camelCase)

```ts
interface ProductionOrderItem {
  readonly productId: number;
  readonly productName: string;    // Snapshot
  readonly productUnit: string;    // Snapshot
  readonly quantity: number;
}

interface ProductionOrder {
  readonly orderNumber: string;
  readonly customerName: string;   // Snapshot
  readonly status: OrderStatus;
  readonly fulfillmentType: FulfillmentType;
  readonly note: string | null;
  readonly items: readonly ProductionOrderItem[];
}

interface ProductionLine {
  readonly productId: number;
  readonly productName: string;
  readonly productUnit: string;
  readonly quantity: number;
}

interface ProductionDay {
  readonly date: string;
  readonly orderCount: number;
  readonly totalUnits: number;
  readonly products: readonly ProductionLine[];
  readonly orders: readonly ProductionOrder[];
}
```

### Auf der Leitung (JSON, snake_case)

```json
{
  "date": "2026-08-26",
  "order_count": 2,
  "total_units": 19,
  "products": [
    { "product_id": 1, "name": "Beispiel Käsekuchen",  "unit": "Stück", "quantity": 11 },
    { "product_id": 2, "name": "Beispiel Carrot Cake", "unit": "Stück", "quantity": 8 }
  ],
  "orders": [
    {
      "order_number": "BUS-2026-000123",
      "customer_name": "Testcafé Nord",
      "status": "confirmed",
      "fulfillment_type": "delivery",
      "note": "Bitte vor 10 Uhr",
      "items": [
        { "product_id": 1, "name": "Beispiel Käsekuchen", "unit": "Stück", "quantity": 3 }
      ]
    }
  ]
}
```

`snake_case` auf der Leitung folgt `POST /api/orders`, das bereits
`order_number`, `fulfillment_date` und `total_cents` liefert. Zwei
Namenskonventionen in einer API wären eine Konvention zu viel.

Die Umwandlung camelCase → snake_case geschieht an **einer** Stelle in
`production-api.ts`, in einer Funktion mit ausgeschriebener Feldliste — wie
`toCatalogView()` und `confirmation()` es bereits vormachen. Das ist der Grund
für den zusätzlichen Handgriff: Ein neues Feld im Lesemodell erscheint
**nicht** automatisch in der Antwort. Ein Test kann darauf bestehen, dass die
Feldliste exakt diese ist, und ein versehentlich durchgereichter Preis wäre
ein roter Test statt einer stillen Preisgabe.

### Was die Antwort nicht enthält

Nichts davon fehlt aus Versehen:

* **keine Preise** — kein `unit_price_cents`, kein `line_total_cents`, kein
  `total_amount_cents`. Phase 3B beantwortet Produktionsfragen. Geld gehört in
  eine Controlling-Domäne, die es noch nicht gibt, und bis dahin nicht in
  diese Antwort.
* **keine Kundenkontaktdaten** — keine E-Mail, kein Telefon, kein
  Ansprechpartner, keine interne Notiz zum Kunden, keine Lieferadresse. Für
  „was ist zu backen" braucht es davon nichts. (Die Lieferadresse wird eine
  Tourenplanung brauchen — das ist dann ihre Anforderung, mit ihrer eigenen
  Begründung.)
* **keine internen Kennungen** — keine `orders.id`, keine `customer_id`, keine
  `order_items.id`, keine `submission_id`, keine `account_id`, keine
  `session_id`. Fortlaufende Zähler sagen aus, wie viele Kunden es gibt.
  `product_id` ist die einzige Ausnahme, und sie hat einen Zweck: Ohne sie
  könnte Phase 3C zwei gleichnamige Zeilen nicht auseinanderhalten.
* **keine Auth-Daten** — kein Credential-Hash, kein Salt, kein Pepper, kein
  Sitzungstoken, kein CSRF-Token, kein Fehlversuchszähler. Die Abfragen lesen
  die Tabellen `auth_accounts` und `auth_sessions` gar nicht.
* **keine Zeitstempel** — `created_at`/`updated_at` beantworten keine
  Produktionsfrage.
* **keine DB-Metadaten** — keine Zeilenzahlen, keine Ausführungsdauer, keine
  Bindings.

---

## HTTP API

```text
GET /api/admin/production-day?date=JJJJ-MM-TT
```

Der Pfad folgt den vorhandenen: `/api/health`, `/api/auth/session`,
`/api/orders`. Das Segment `admin` sagt, wem der Endpunkt gehört, und macht
später `/api/admin/…` als Gruppe erkennbar.

### Reihenfolge der Prüfungen

```text
1. Methode          ─ GET (und HEAD) oder 405
2. Rolle            ─ requireRole(..., 'admin', 'api')
3. date-Parameter   ─ genau einer, gültiger Kalendertag, sonst 400
4. Abfrage
```

**Rolle vor Datum** ist Absicht und folgt derselben Überlegung wie
`order-api.ts`: Wer keinen gültigen Zugang hat, soll keine Rückmeldung über
die erwartete Parameterform bekommen. Ein `400 invalid_date` für einen
Fremden wäre die Auskunft „hier ist ein Endpunkt, und er will ein Datum".
Ohne Sitzung und mit kaputtem Datum ist die Antwort deshalb **401**, nicht
400.

**Methode vor Rolle** ebenfalls: Das entspricht `/admin` und `/api/orders` im
Worker, und ein `405` verrät nichts, was die Route nicht schon dadurch
verrät, dass sie existiert.

### Keine Origin- und keine CSRF-Prüfung

Beide gehören zu zustandsverändernden Anfragen, und diese Anfrage verändert
nichts. Die vorhandenen GET-Endpunkte (`/admin`, `/api/auth/session`)
verfahren genauso.

Das ist kein Verzicht auf Schutz: Das Sitzungscookie ist `SameSite=Lax`, eine
fremde Seite kann die Antwort mangels CORS-Kopfzeilen nicht lesen, und
`Cache-Control: no-store` verhindert, dass sie irgendwo liegen bleibt. Eine
CSRF-Prüfung auf einem GET hätte den einzigen Effekt, dass die spätere
Oberfläche einen Token mitschicken müsste, um etwas zu lesen.

---

## Auth Boundary

Die Autorisierung ist **eine Zeile** und benutzt ausschließlich die geprüfte
Phase-3A-Wache:

```ts
const wache = await requireRole(db, config, request, now, 'admin', 'api');
if (!wache.ok) return wache.response;
```

Es entsteht **kein** neuer Auth-Code. Keine zweite Rollenprüfung im Anschluss
— der Ergebnistyp der Wache trägt die Rolle bereits, und eine zweite Prüfung
wäre eine zweite Stelle, die irgendwann von der ersten abweicht.

| Aufrufer | Antwort |
|---|---|
| Admin-Sitzung, gültig | 200 |
| **Café-Sitzung** | **403** `{"error":"forbidden"}` — und die Sitzung bleibt bestehen |
| keine Sitzung | **401** `{"error":"unauthorized"}`, Cookie wird gelöscht |
| abgelaufene Sitzung | 401 |
| widerrufene Sitzung | 401 |
| deaktiviertes Konto | 401 |

Die Rolle wird bei **jedem** Request neu aus D1 gelesen
(`authenticateRequest`) — ein Sitzungstoken ist kein Dauerausweis. Wird ein
Admin-Konto deaktiviert, endet der Zugriff auf Produktionsdaten beim nächsten
Request.

**Was keine Wirkung hat**, und was dazu geprüft wird:

* `?role=admin` in der Query — die Rolle kommt aus D1, nicht aus der URL.
* `{"role":"admin"}` im Körper — ein GET hat keinen ausgewerteten Körper.
* ein manipuliertes `customer_id` irgendwo — der Endpunkt liest keinen
  Kundenparameter; er filtert ausschließlich nach Tag und Status.
* ein geratenes Sitzungscookie — der gespeicherte Wert ist ein Hash.

---

## Cache Security

Jede Antwort dieses Endpunkts — 200, 400, 401, 403, 405, 500 — trägt
`Cache-Control: no-store`, über `privateHeaders()`.

Produktionsdaten sagen, welches Café wie viel bestellt. Das ist eine
Geschäftsbeziehung und gehört in keinen Zwischenspeicher: nicht in einen
Cloudflare-Edge-Cache, nicht in einen Firmen-Proxy und nicht in den Browser
eines geteilten Tresengeräts.

`no-store` und nicht `no-cache`: `no-cache` erlaubt das Ablegen und verlangt
nur eine Rückfrage. Diese Antworten sollen gar nicht erst irgendwo liegen.

Mit `privateHeaders()` kommen außerdem `x-content-type-options: nosniff`,
`x-frame-options: DENY`, `x-robots-tag: noindex, nofollow` und
`referrer-policy: same-origin`. Der Content-Type ist
`application/json; charset=utf-8` (aus `json()`).

---

## Error Handling

| Fall | Status | Körper |
|---|---|---|
| Erfolg (auch leerer Tag) | 200 | Produktionstag |
| `date` fehlt / leer / mehrfach / ungültig | 400 | `{"error":"invalid_date"}` |
| keine Sitzung | 401 | `{"error":"unauthorized"}` |
| Café-Sitzung | 403 | `{"error":"forbidden"}` |
| falsche Methode | 405 | `{"error":"method_not_allowed"}` + `Allow: GET` |
| D1-Ausfall, Queryfehler, alles Übrige | 500 | `{"error":"internal_error"}` |

Ein **einziger** Fehlercode für alle Datumsfehler. „Format falsch" gegenüber
„Tag existiert nicht" wäre eine Auskunft ohne Zweck: Der Aufrufer ist ein
Admin mit einem Datumsfeld, und die Oberfläche kennt das erwartete Format.

Der 500er-Fall läuft durch die vorhandene Fehlergrenze `toSafeResponse()` im
Worker. Der Körper wird dort nicht aus dem Fehler **gebildet**, er ist eine
Konstante. Damit verlässt weder ein SQL-Fragment noch ein Stacktrace noch ein
Dateipfad noch ein D1-Interna den Worker — auch dann nicht, wenn die
Fehlermeldung von SQLite den Tabellennamen und die Bedingung enthält.

### Logging

Es wird **nichts** protokolliert. Das ist die Fortführung der Entscheidung aus
`error-boundary.ts`: Cloudflare erfasst unbehandelte Ausnahmen ohnehin, und
ein eigenes `console.error` mit dem Anfrageinhalt wäre der kürzeste Weg, ein
Cookie in ein Log zu schreiben.

Sollte später doch protokolliert werden, gilt die Grenze: Ereignisart,
angefragter Tag, Fehlerkategorie. Niemals Sitzungscookie, Credentials,
CSRF-Token, Kundenkontaktdaten oder vollständige Bestelldaten.

---

## Query Plan / Index Strategy

Gemessen gegen eine lokale, frisch migrierte D1 (`EXPLAIN QUERY PLAN`,
Migrationen 0001–0010):

**Q1 — Bestellungen des Tages**

```text
SEARCH orders USING INDEX idx_orders_day (fulfillment_date=? AND status=?)
USE TEMP B-TREE FOR ORDER BY
```

**Q2 — Positionen des Tages**

```text
SEARCH o USING COVERING INDEX idx_orders_day (fulfillment_date=? AND status=?)
SEARCH i USING INDEX idx_order_items_order (order_id=?)
SEARCH p USING INTEGER PRIMARY KEY (rowid=?)
USE TEMP B-TREE FOR ORDER BY
```

**Befund:**

* Zuerst gesucht wird in **beiden** Abfragen `orders`, über
  `idx_orders_day (fulfillment_date, status)` — genau den Index, den
  Migration 0003 mit dem Kommentar „Was ist für Freitag zu produzieren? — die
  wichtigste Abfrage des Betriebs" angelegt hat. Er passt exakt, weil der
  Präfix `fulfillment_date` gleichheitsgeprüft wird und `status` als zweite
  Spalte den `IN`-Filter bedient.
* In Q2 ist er sogar ein **COVERING INDEX**: Aus `orders` wird dort nur die
  Zeilenkennung gebraucht, und die steht im Index. Die Tabelle wird nicht
  angefasst.
* `order_items` über `idx_order_items_order (order_id)`.
* `products` über den Primärschlüssel.
* **Kein Full Table Scan** in keiner der beiden Abfragen.

**Das `USE TEMP B-TREE FOR ORDER BY`** bleibt bestehen und ist in Ordnung: Es
sortiert das bereits auf einen Tag eingeschränkte Ergebnis — eine Handvoll
Bestellungen, ein paar Dutzend Positionen. Ein zusätzlicher Index auf
`customer_name_snapshot` würde eine Sortierung von zehn Zeilen beschleunigen
und wäre bei jedem einzelnen Bestellvorgang mitzuschreiben. Das ist kein
Handel.

**Es wird keine neue Migration angelegt und kein neuer Index erstellt.**
Kein Index „zur Sicherheit". Die Prüfung wird am Ende gegen eine frisch
migrierte Datenbank wiederholt.

---

## Keine neue Tabelle, keine Vorberechnung

`orders` und `order_items` tragen die Frage vollständig. Es entsteht **keine**
`production_days`, keine `production_items`, keine `daily_totals`, keine
materialisierte Sicht und keine Cache-Tabelle.

Der Grund ist nicht Aufwand, sondern Wahrheit: Eine zweite Tabelle wäre eine
zweite Quelle derselben Aussage, und zwei Quellen weichen irgendwann
voneinander ab. Dann steht die Frage im Raum, welche recht hat — und die
Antwort ist immer „die Bestellungen", also die, die man sich hätte sparen
können.

Ebenso wenig entstehen Cron, Queues, Scheduled Workers, KV-Cache oder Durable
Objects. Die Aggregation ist eine Schleife über zweistellige Zeilenzahlen.

---

## Sortierung

Deterministisch, vollständig, ohne Rest.

**`products` (aggregiert)** — sortiert im Anwendungscode, weil es zu dieser
abgeleiteten Liste keine SQL-Zeilen gibt:

1. `sort_order` des Produkts (aus `products`) — die Reihenfolge, in der
   Buschmann sein Sortiment ordnet, dieselbe wie auf der Bestellseite,
2. dann `product_name_snapshot`,
3. dann `product_id`.

Zwei Zeilen können sich nur unterscheiden, wenn mindestens eines der drei
Merkmale abweicht — der Schlüssel besteht aus `product_id`, Name und Einheit,
und `sort_order` hängt an `product_id`. Bei gleicher `product_id` und gleichem
Namen unterscheidet sich nur noch die Einheit; als letztes Kriterium
entscheidet dann `product_unit_snapshot`. Damit ist die Reihenfolge
vollständig bestimmt.

**`orders`** — sortiert in SQL:

1. `customer_name_snapshot`,
2. dann `order_number`.

`order_number` ist `UNIQUE` (Migration 0003). Damit gibt es keine zwei
Bestellungen mit identischem Sortierschlüssel; die Reihenfolge ist eindeutig.

**Positionen innerhalb einer Bestellung** — sortiert in SQL, nach denselben
Kriterien wie die aggregierte Liste: `sort_order`, Name, `product_id`.
`UNIQUE (order_id, product_id)` (Migration 0004) schließt aus, dass zwei
Positionen einer Bestellung denselben Schlüssel haben.

**Zeichenkettenvergleich ist Codepunkt-Vergleich**, in SQL wie in TypeScript
(`BINARY`-Kollation bzw. `<`/`>`). Ausdrücklich **kein** `localeCompare`: Das
Ergebnis hängt an den ICU-Daten der Laufzeit und könnte zwischen lokalem Test
und Cloudflare-Edge abweichen — das wäre ein Test, der irgendwo rot wird und
nirgends reproduzierbar. Die fachliche Reihenfolge trägt ohnehin `sort_order`;
der Namensvergleich ist nur der Gleichstandsbrecher.

---

## Testing Strategy

### `tests/domain/production-day.test.ts` — Aggregation, ohne D1, ohne HTTP

Diese Datei prüft die Rechenregeln. Sie läuft im Projekt `domain`, also ohne
Worker-Runtime und ohne Datenbank — dass sie das kann, ist zugleich der
Beweis, dass die Aggregation frei von Infrastruktur ist.

Gleiche Produkte aus mehreren Bestellungen summieren · verschiedene Produkte
bleiben getrennt · mehrere Positionen einer Bestellung summieren ·
`order_count` zählt Bestellungen und nicht Positionen · `total_units` summiert
Mengen und zählt nicht Produktarten · leerer Tag ergibt Nullen und leere
Listen · Sortierung nach `sort_order`, Name, ID · gleicher `product_id` unter
verschiedenen Namen bleibt getrennt · gleicher `product_id` unter
verschiedenen Einheiten bleibt getrennt · das Datum wird unverändert
durchgereicht.

### `tests/domain/order-status.test.ts` (Erweiterung)

`new`, `confirmed`, `in_production` sind offene Produktion · `completed` und
`cancelled` sind es nicht · die Liste enthält keinen Status, den
`ORDER_STATUSES` nicht kennt · **jeder** Status in `ORDER_STATUSES` ist
ausdrücklich eingeordnet (dieser Test schlägt fehl, wenn jemand einen sechsten
Status hinzufügt, ohne über Produktion zu entscheiden).

### `tests/domain/clock.test.ts` (Erweiterung)

`isCalendarDay`: gültige Tage · Schaltjahr `2028-02-29` gültig ·
`2026-02-29` ungültig · `2026-02-30`, `2026-13-01` ungültig · `2026-8-26`
ungültig · Punktformat, Schrägstrichformat, `tomorrow`, leer ungültig ·
Zeitstempel mit Uhrzeit ungültig.

### `tests/d1/production-day-repository.test.ts` — gegen echte D1

Frische lokale D1, Migrationen 0001–0010 durch SQLite gespielt, fiktive
Testdaten.

Eine Bestellung wird korrekt geliefert · mehrere Bestellungen desselben Tages
· Bestellungen anderer Tage werden ausgeschlossen (Vortag und Folgetag, damit
eine Zonenverschiebung um ±1 Tag auffiele) · `new` zählt · `confirmed` zählt ·
`in_production` zählt · `completed` zählt nicht · `cancelled` zählt nicht ·
`delivery` zählt · `pickup` zählt · Notiz kommt durch · `null`-Notiz bleibt
`null` · Kundenname stammt aus dem Snapshot · Produktname stammt aus dem
Snapshot · eine Umbenennung des Produkts **nach** der Bestellung ändert den
gelieferten Namen nicht · Bestellung ohne Positionen erscheint mit leerer
Positionsliste · Sortierung der Bestellungen · Sortierung der Positionen ·
Fremdschlüssel greifen weiterhin · **Query Plan** enthält `idx_orders_day` und
kein `SCAN`.

### `tests/d1/get-production-day.test.ts` — Anwendungsfall gegen echte D1

Summen exakt über mehrere Bestellungen, Status und Tage hinweg · leerer Tag ·
vergangener Tag lesbar · zukünftiger Tag lesbar.

### `tests/http/production-api.test.ts` — Endpunkt

Admin → 200 · Café-Sitzung → 403 · keine Sitzung → 401 · abgelaufene Sitzung →
401 · widerrufenes Konto → 401 · POST/PUT/PATCH/DELETE → 405 mit `Allow: GET`
· fehlendes Datum → 400 · leeres Datum → 400 · falsches Format → 400 ·
unmöglicher Kalendertag → 400 · doppelter `date`-Parameter → 400 ·
`2028-02-29` → 200 · `2026-02-29` → 400 · Vergangenheit/heute/Zukunft → 200 ·
leerer Tag → 200 mit Nullen · `Cache-Control: no-store` auf **jeder** Antwort
· `content-type: application/json` · `?role=admin` ohne Sitzung wirkt nicht ·
Körper mit `role: admin` wirkt nicht · **kein** `cents`, `price`, `total`,
`unit_price` im rohen Antworttext · **keine** Kunden-E-Mail, kein Telefon,
keine Adresse im Antworttext · **kein** Sitzungstoken, kein CSRF-Token, kein
Credential-Hash im Antworttext · Antwortschlüssel sind exakt die vereinbarten
· ein D1-Fehler wird zu 500 ohne SQL-Fragment.

### Regression nach jedem Task

Die vollständige Suite. `tests/http/auth-routes.test.ts`,
`tests/http/guard.test.ts`, `tests/d1/log-in.test.ts`,
`tests/d1/authenticate-request.test.ts` und
`tests/d1/place-cafe-order.test.ts` müssen unverändert grün bleiben — Phase 3B
darf Login, Sitzungen, CSRF, Cookie-Policy und den Café-Bestellfluss nicht
berühren.

### Mutationstests

Nach grüner Implementierung, jede Mutation einzeln, jede zurückgesetzt:

| | Mutation | Erwartung |
|---|---|---|
| A | `cancelled` in `OPEN_PRODUCTION_STATUSES` aufnehmen | rot |
| B | Statusfilter aus der Abfrage entfernen | rot |
| C | `sum(quantity)` durch `count(items)` ersetzen | rot |
| D | Datumsfilter entfernen bzw. hart verdrahten | rot |

Danach die vollständige Suite erneut grün, mit `git diff` als Beleg, dass
keine Mutation zurückgeblieben ist.

### Testdaten

Ausschließlich fiktiv: `Testcafé Nord`, `Testcafé Süd`, `Beispiel Käsekuchen`,
`Beispiel Carrot Cake`, `Beispiel Schokoladentarte`. Keine echten Cafés, keine
echten Kundendaten — wie in allen vorhandenen Testdateien.

---

## Definition of Done

* [ ] Ein Admin liest Produktionsdaten für einen ausdrücklich genannten Tag.
* [ ] Ein Café kann sie nicht lesen (403).
* [ ] Ein nicht angemeldeter Aufrufer kann sie nicht lesen (401).
* [ ] Nur `new`, `confirmed`, `in_production` gehen in die Summen ein.
* [ ] `cancelled` ist ausgeschlossen.
* [ ] `completed` ist ausgeschlossen.
* [ ] `delivery` und `pickup` werden beide berücksichtigt.
* [ ] Mehrere Bestellungen werden korrekt aggregiert.
* [ ] Produkt-Snapshot-Semantik bleibt erhalten; eine Umbenennung wirkt nicht rückwirkend.
* [ ] Der Kundenname stammt aus dem Bestellungs-Snapshot.
* [ ] Notizen werden unverändert geliefert.
* [ ] Keine Preise in der Antwort.
* [ ] Keine Auth-, Sitzungs- oder Kontaktdaten in der Antwort.
* [ ] Leerer Tag ist 200 mit Nullen und leeren Listen.
* [ ] Datum ist strikt validiert; alle Fehlerfälle sind 400.
* [ ] Kalendertag-Semantik ist zeitzonenstabil und getestet.
* [ ] Sortierung ist vollständig deterministisch.
* [ ] Kein N+1: genau zwei Abfragen je Request.
* [ ] Query Plan gegen frische D1 geprüft, kein Full Table Scan.
* [ ] Keine neue Tabelle, keine neue Migration, kein neuer Index.
* [ ] Keine schreibende Funktion hinzugefügt.
* [ ] Phase-3A-Auth vollständig intakt.
* [ ] Phase-2-Bestellfluss vollständig intakt.
* [ ] Vollständige Testsuite grün.
* [ ] Typecheck grün.
* [ ] Mutationstests durchgeführt und zurückgesetzt.
* [ ] Marketing-Website unverändert.
* [ ] Keine neue externe Dependency.
* [ ] Kein Deployment, kein Push, kein Merge.
