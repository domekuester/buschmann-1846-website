# Produktions-Tagesdaten — Umsetzungsplan

**Phase 3B · 2026-08-25 · Branch `feature/order-system-production-day-data`**

Design: [`2026-08-25-buschmann-production-day-data-design.md`](../specs/2026-08-25-buschmann-production-day-data-design.md)

Ausgangsstand (verifiziert, nicht übernommen): 41 Testdateien, 721 Tests grün,
`npm run typecheck` grün, Arbeitsbaum identisch zu
`feature/order-system-first-party-auth`.

Jeder Task ist eine Commit-Grenze. Nach **jedem** Task läuft die
**vollständige** Suite plus Typecheck — nicht nur die neuen Tests. Ein grüner
Teillauf beweist nichts über die Auth-Regression.

---

## Task 1 — Was zählt als offene Produktion

**Dateien**

* `order-system/src/domain/order-status.ts` (erweitern)
* `order-system/tests/domain/order-status.test.ts` (erweitern)

**Schnittstelle**

```ts
export const OPEN_PRODUCTION_STATUSES: readonly OrderStatus[];
export function isOpenProduction(status: OrderStatus): boolean;
```

**Failing Test zuerst**

```ts
it('zaehlt new, confirmed und in_production zur offenen Produktion', ...)
it('zaehlt completed nicht zur offenen Produktion', ...)
it('zaehlt cancelled nicht zur offenen Produktion', ...)
it('ordnet JEDEN bekannten Status ausdruecklich ein', ...)   // Waechtertest
it('enthaelt keinen Status, den ORDER_STATUSES nicht kennt', ...)
```

Der Wächtertest iteriert über `ORDER_STATUSES` und verlangt für jeden Eintrag
eine Zuordnung aus einer im Test ausgeschriebenen Erwartungstabelle. Er
schlägt fehl, sobald jemand einen sechsten Status hinzufügt, ohne über
Produktion zu entscheiden.

**Erwarteter Fehler:** `isOpenProduction is not a function` bzw. Typfehler
„hat keinen exportierten Member 'OPEN_PRODUCTION_STATUSES'".

**Minimale Implementierung:** die Konstante und eine `includes`-Prüfung,
unmittelbar unter `ALLOWED_TARGETS`, mit der Begründung aus der Spec als
Kommentar.

**Verifikation:** `npm test`, `npm run typecheck`.

**Commit:** `feat(order-system): offene Produktionsstatus zentral definiert`

---

## Task 2 — Kalendertag prüfen, an einer Stelle

**Dateien**

* `order-system/src/domain/clock.ts` (erweitern)
* `order-system/src/domain/fulfillment-date.ts` (auf die neue Funktion umstellen)
* `order-system/tests/domain/clock.test.ts` (erweitern)

**Schnittstelle**

```ts
export function isCalendarDay(value: unknown): value is string;
```

Wahr genau dann, wenn `value` eine Zeichenkette der Form `JJJJ-MM-TT` ist und
diesen Tag im Kalender wirklich gibt. Regex, dann Parsen mit ausdrücklichem
`T00:00:00Z`, dann Rückvergleich der ersten zehn Zeichen — also exakt die
Prüfung, die `FulfillmentDate` heute zweimal wörtlich enthält.

**Failing Test zuerst:** gültige Tage · `2028-02-29` gültig · `2026-02-29`
ungültig · `2026-02-30` · `2026-13-01` · `2026-00-10` · `2026-8-26` ·
`25.08.2026` · `2026/08/25` · `tomorrow` · leere Zeichenkette · ein
Zeitstempel mit Uhrzeit · Nicht-Zeichenketten (`null`, `42`, Objekt).

**Erwarteter Fehler:** „hat keinen exportierten Member 'isCalendarDay'".

**Minimale Implementierung:** Funktion in `clock.ts`. Danach in
`FulfillmentDate.fromString()` und `FulfillmentDate.restore()` die beiden
Inline-Prüfungen durch den Aufruf ersetzen. **Nicht** verändert werden: die
Fehlermeldungen, die Prüfung auf ein Jahr vor 2000 (bleibt allein in
`fromString`) und die Vergangenheitsregel.

**Verifikation:** `npm test` — `tests/domain/fulfillment-date.test.ts` muss
**unverändert** grün bleiben. Das ist der Beleg, dass die Extraktion
verhaltensgleich ist. `npm run typecheck`.

**Commit:** `refactor(order-system): Kalendertagspruefung an einer Stelle`

---

## Task 3 — Das Lesemodell und seine Aggregation

**Dateien**

* `order-system/src/domain/production-day.ts` (neu)
* `order-system/tests/domain/production-day.test.ts` (neu)

**Schnittstelle:** die vier Typen aus der Spec und

```ts
export function aggregateProductionDay(
  day: string,
  orders: readonly ProductionOrder[],
): ProductionDay;
```

Rein. Kein D1, kein HTTP, keine Uhr. Läuft im Vitest-Projekt `domain`.

**Failing Test zuerst** (die Rechenregeln, ohne Datenbank):

* eine Bestellung wird korrekt abgebildet
* gleiche Produkte aus mehreren Bestellungen werden summiert
* verschiedene Produkte bleiben getrennt
* mehrere Positionen einer Bestellung werden summiert
* `orderCount` zählt Bestellungen, nicht Positionen
* `totalUnits` summiert Mengen (3+2+5 = 10), zählt nicht Produktarten
* leere Liste ergibt Nullen und zwei leere Listen
* das Datum wird unverändert durchgereicht
* gleiche `productId`, verschiedener Snapshot-Name ergibt **zwei** Zeilen
* gleiche `productId`, verschiedene Snapshot-Einheit ergibt **zwei** Zeilen
* Sortierung nach `sortOrder`, dann Name, dann `productId`, dann Einheit
* die Bestellliste bleibt in der übergebenen Reihenfolge
* eine Bestellung ohne Positionen zählt in `orderCount`, nicht in `totalUnits`

**Erwarteter Fehler:** Modul `production-day` nicht auflösbar.

**Minimale Implementierung:** eine `Map` über den Tripel-Schlüssel aus
`productId`, Name und Einheit, danach ein ausgeschriebener Comparator.
`sortOrder` wandert als Feld in `ProductionOrderItem` — es kommt aus der
Abfrage und wird nur zum Sortieren gebraucht; es gehört **nicht** in die
HTTP-Antwort.

**Verifikation:** `npm test`, `npm run typecheck`.

**Commit:** `feat(order-system): Lesemodell und Aggregation eines Produktionstags`

---

## Task 4 — Die beiden D1-Abfragen

**Dateien**

* `order-system/src/infrastructure/d1/rows.ts` (zwei Zeilentypen ergänzen)
* `order-system/src/infrastructure/d1/production-day-repository.ts` (neu)
* `order-system/tests/d1/production-day-repository.test.ts` (neu)

**Schnittstelle**

```ts
export async function findProductionOrders(
  db: D1Database,
  day: string,
): Promise<readonly ProductionOrder[]>;
```

**Failing Test zuerst** (gegen echte lokale D1, Migrationen durch SQLite
gespielt, fiktive Testdaten):

Ein Auftrag korrekt · mehrere Aufträge desselben Tages · **Vortag und
Folgetag werden ausgeschlossen** · `new`/`confirmed`/`in_production` zählen ·
`completed`/`cancelled` zählen nicht · `delivery` und `pickup` zählen beide ·
Notiz kommt durch · fehlende Notiz bleibt `null` · Kundenname aus dem
Snapshot · Produktname aus dem Snapshot · **Umbenennung des Produkts nach der
Bestellung ändert nichts** · Bestellung ohne Positionen erscheint mit leerer
Liste · Sortierung der Bestellungen · Sortierung der Positionen · unbekannter
Status in der Zeile führt zu `InvalidArgumentError`.

**Erwarteter Fehler:** Modul nicht auflösbar.

**Minimale Implementierung:** Q1 und Q2 aus der Spec. Die Platzhalter des
`IN` entstehen aus der Länge von `OPEN_PRODUCTION_STATUSES`, die Werte aus
derselben Liste. Positionen über eine `Map` den Bestellungen zuordnen.
Statuswerte und Fulfillment-Typen beim Lesen mit `isOrderStatus` und
`isFulfillmentType` prüfen — wie `toOrder()` es tut.

**Verifikation:** `npm test`, `npm run typecheck`.

**Commit:** `feat(order-system): D1-Abfragen fuer den Produktionstag`

---

## Task 5 — Der Anwendungsfall

**Dateien**

* `order-system/src/application/get-production-day.ts` (neu)
* `order-system/tests/d1/get-production-day.test.ts` (neu)

**Schnittstelle**

```ts
export async function getProductionDay(
  db: D1Database,
  day: string,
): Promise<ProductionDay>;
```

**Failing Test zuerst:** Summen exakt über mehrere Bestellungen, Status und
Tage hinweg (das Beispiel aus der Spec: 11 Käsekuchen, 8 Carrot Cake) · leerer
Tag ergibt Nullen · vergangener Tag lesbar · zukünftiger Tag lesbar · eine
stornierte Bestellung mit großer Menge verändert die Summen **nicht**.

**Erwarteter Fehler:** Modul nicht auflösbar.

**Minimale Implementierung:** drei Zeilen.

**Verifikation:** `npm test`, `npm run typecheck`.

**Commit:** `feat(order-system): Anwendungsfall Produktionstag`

---

## Task 6 — Der geschützte Endpunkt

**Dateien**

* `order-system/src/http/production-api.ts` (neu)
* `order-system/src/worker.ts` (eine Route)
* `order-system/tests/http/production-api.test.ts` (neu)

**Schnittstelle**

```ts
export async function productionDay(
  db: D1Database,
  config: AppConfig,
  request: Request,
  now: Date,
): Promise<Response>;
```

Reihenfolge im Worker: Methode (`GET` oder `HEAD`, sonst
`methodNotAllowed('GET')`), dann im Handler `requireRole(..., 'admin', 'api')`,
dann das Datum.

**Failing Test zuerst:** die vollständige Liste aus dem Abschnitt
„Testing Strategy" der Spec — Auth (200/403/401), Methode (405 mit `Allow`),
Datum (alle 400-Fälle einschließlich doppeltem Parameter), Schaltjahr,
Zeitzonenstabilität, leerer Tag, `no-store` auf **jeder** Antwort,
`content-type`, Rollen-Manipulation über Query und Körper, und die
Leck-Prüfungen gegen den **rohen Antworttext**.

**Erwarteter Fehler:** 404 vom Worker, weil die Route nicht existiert.

**Minimale Implementierung:** Handler mit ausgeschriebener
`toResponseBody()`-Feldliste, Route im Worker unmittelbar nach
`/api/auth/session`.

**Verifikation:** `npm test`, `npm run typecheck`.

**Commit:** `feat(order-system): Admin-Endpunkt fuer den Produktionstag`

---

## Task 7 — Query Plan gegen frische D1

**Dateien**

* `order-system/tests/d1/production-day-repository.test.ts` (ergänzen)

**Failing Test zuerst**

```ts
it('liest den Tag ueber idx_orders_day und ohne Full Table Scan', ...)
```

`EXPLAIN QUERY PLAN` für Q1 und Q2 über `db.prepare(...).all()`, dann:
`detail` enthält `idx_orders_day` und `idx_order_items_order` — und **kein**
`detail` beginnt mit `SCAN`.

Der Test läuft gegen dieselbe frisch migrierte D1 wie die übrigen
Worker-Tests. Damit ist der Query Plan nicht ein einmaliger Befund im
Protokoll, sondern eine Eigenschaft, die bei jedem Testlauf nachgewiesen wird
— und die rot wird, wenn jemand einen Index entfernt.

Zusätzlich außerhalb der Suite: frische lokale D1 anlegen, alle Migrationen
0001 bis 0010 anwenden, `EXPLAIN QUERY PLAN` über
`wrangler d1 execute --local`, Ergebnis in den Abschlussbericht.

**Ergebnis nach heutigem Stand:** kein fehlender Index nachweisbar. **Es wird
keine Migration angelegt.** Sollte sich das ändern, wäre das eine eigene
Migration `0011_...` mit erneutem Plan gegen eine erneut frische Datenbank.

**Commit:** `test(order-system): Query Plan des Produktionstags abgesichert`

---

## Task 8 — Mutationstests, Regression, Dokumentation

**Keine Produktionsdatei ändert sich in diesem Task** — außer der README.

**8a — Mutationen.** Vier Stück, einzeln, jede sofort zurückgesetzt:

| | Mutation | Datei | Erwartung |
|---|---|---|---|
| A | `cancelled` in `OPEN_PRODUCTION_STATUSES` aufnehmen | `order-status.ts` | rot |
| B | Statusfilter aus Q1 **und** Q2 entfernen | `production-day-repository.ts` | rot |
| C | Mengensumme durch Positionszählung ersetzen | `production-day.ts` | rot |
| D | Datumsfilter hart verdrahten | `production-day-repository.ts` | rot |

Nach jeder Mutation: `npm test`, Zahl der fehlgeschlagenen Tests notieren,
Datei zurücksetzen, `npm test` erneut grün.

Danach `git status` und `git diff` als Beleg, dass nichts zurückgeblieben ist.

**8b — Regression.**

* vollständige Suite, frisch
* `npm run typecheck`
* frische lokale D1: `.wrangler/state` beiseite, `db:migrate:local`,
  `db:seed:cafe:local`, Query Plan
* `git diff --stat feature/order-system-first-party-auth` — es dürfen
  ausschließlich `order-system/` und `docs/superpowers/` erscheinen
* Phase-2- und Phase-3A-Testdateien namentlich im Lauf bestätigen

**8c — Dokumentation.** `order-system/README.md`: ein Abschnitt zum
Produktionstag-Endpunkt — Route, Rolle, Parameter, welche Status zählen,
Snapshot-Semantik, `no-store`, und der ausdrückliche Hinweis, dass es noch
**keine** Oberfläche gibt und die Notiz für Phase 3C Kundeneingabe ist.

**Commit:** `docs(order-system): Produktionstag-Endpunkt dokumentiert`

---

## Was in diesem Plan bewusst fehlt

Kein Task für eine Migration, weil keine gebraucht wird. Kein Task für eine
Oberfläche, weil das Phase 3C ist. Kein Task für Login, Sitzungen oder CSRF,
weil Phase 3A funktioniert und diese Phase sie benutzt statt sie anzufassen.
Kein Task für ein Deployment, weil alles lokal bleibt.
