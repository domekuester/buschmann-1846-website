# Buschmann Bestellsystem — Cloudflare-Pivot, Implementierungsplan

**Datum:** 2026-08-24
**Branch:** `refactor/order-system-cloudflare-foundation`
**Spezifikation:** `docs/superpowers/specs/2026-08-24-buschmann-order-system-cloudflare-design.md`
**Status:** ✅ abgeschlossen

Dieser Plan hält fest, was tatsächlich getan wurde — nicht, was vorgesehen
war. Er ist damit zugleich das Protokoll des Pivots.

---

## Ausgangslage

Die PHP-/MariaDB-Foundation war fachlich vollständig und mit 110 grünen Tests
belegt. Sie wurde vor Beginn der Portierung noch einmal ausgeführt (110/110),
damit die Referenz als Referenz taugt. Der vollständige Stand liegt auf
`archive/order-system-php-foundation`.

---

## Schritte

- [x] **1 — Gerüst.** `package.json`, `tsconfig.json` (`strict` plus
  `noUncheckedIndexedAccess` und `exactOptionalPropertyTypes`),
  `wrangler.jsonc` (Compatibility Date 2026-08-23, D1-Binding `DB`,
  Platzhalter-ID), `vitest.config.ts` mit zwei Projekten, `.gitignore`.
  TypeScript bewusst auf 5.9 statt 7.0: Der native Compiler ist neu, Wrangler-
  und Vitest-Typen sind gegen 5.x abgesichert.
  → `efe7875`

- [x] **2 — Money, Address, Fehlertypen.** Ganzzahlige Cent, zwei neue
  Prüfungen gegenüber PHP (Nicht-Ganzzahlen, NaN/Infinity). Die
  DECIMAL-Umwandlung entfällt ersatzlos.
  → `c57a165`

- [x] **3 — FulfillmentType, OrderStatus.** `as const`-Listen statt
  TypeScript-`enum`, damit Domänenwert und Datenbankwert dieselbe Zeichenkette
  sind. Dabei fiel auf, dass `cloudflare:test` in `tsconfig.json` nicht
  typisiert war.
  → `8e5786b`

- [x] **4 — Product, ProductCatalog, Customer, Zeitmodell.** Konstruktoren
  nehmen benannte Objekte statt sieben bis neun Stellungsparameter.
  `clock.ts` trennt Zeitpunkt (UTC) von Tag (Europe/Berlin).
  → `3bbc116`

- [x] **5 — OrderNumber, OrderItem, OrderDraft, Order.** Damit ist der
  Domänenkern vollständig: 116 Tests.
  → `b5d6279`

- [x] **6 — D1-Schema.** Fünf Migrationen, lokal ausgeführt.
  → `9845a39`

- [x] **7 — Worker, Health-Endpunkt, Schema-Tests.** Dabei zwei echte
  Schemafehler gefunden: ein zu komplexes GLOB-Muster und ein
  Datums-CHECK, das mit `=` statt `IS` wirkungslos gewesen wäre.
  → `842e583`

- [x] **8 — Repositories.** Vier Module, atomarer Schreibvorgang über
  `batch()`, Nummernvergabe über UPSERT mit RETURNING. Neu in der Domäne:
  `Order.restore` und `FulfillmentDate.restore`, weil Laden nicht Bestellen
  ist.
  → `1c047b6`

- [x] **9 — placeOrder.** End-to-End gegen echte D1. Beim Schreiben des
  Kommentars fiel eine Abweichung zwischen beschriebener und tatsächlicher
  Reihenfolge der Nummernvergabe auf; beide Fälle sind jetzt getestet und
  dokumentiert.
  → `caef750`

- [x] **10 — Seeds.** Eine Datei, Preise in Cent, ausschließlich
  Platzhalterdaten.
  → `749cd24`

- [x] **11 — PHP entfernen.** Erst nach vollständiger Verifikation, mit
  Abdeckungsvergleich Datei für Datei und vier Mutationstests.
  → `af3144f`

- [x] **12 — Dokumentation.** Neue Spezifikation, dieser Plan, überarbeitete
  README. Die beiden Dokumente vom 2026-08-23 tragen einen Hinweis, dass sie
  historisch sind, und bleiben erhalten — ihre fachlichen Festlegungen gelten
  weiter.

---

## Was beim Portieren bewusst anders gemacht wurde

| Entscheidung | Begründung |
|---|---|
| `Money.fromDecimalString()` gestrichen | Sie war eine Brücke zu `DECIMAL`. D1 speichert Cent; die Brücke hätte keinen Verkehr mehr. |
| Benannte Konstruktorobjekte | `new Product(1, 'A', null, preis, 'Stück', true, 10)` — irgendwann vertauscht man `isActive` und `sortOrder`, und beide sind zuweisbar. |
| Zeitstempel als Zeichenkette statt `Date` | Genau dieser Wert geht nach D1 und kommt zurück. Ein `Date` daneben wäre eine zweite Darstellung derselben Sache. |
| `restore` getrennt von `place` | Beim Laden gibt es keinen Kunden zu prüfen, der Status ist nicht „new", und der Liefertag darf vergangen sein. |
| Kein `Number()` in `OrderDraft` | `Number('')` ist 0, `Number(true)` ist 1, `Number([])` ist 0. Solche stillen Umwandlungen sollen an der Eingabegrenze scheitern. |
| `date(x) IS x` statt Formmuster | Prüft den Kalender statt nur die Form — und `IS` statt `=`, weil ein CHECK mit Ergebnis `NULL` in SQLite als erfüllt gilt. |

---

## Verifikation

| Prüfung | Ergebnis |
|---|---|
| Domänentests (Node, ohne Runtime/D1) | 120 grün |
| Worker- und D1-Tests (echte Runtime, echte D1) | 53 grün |
| Gesamt | **173 grün, 0 rot** |
| `tsc --noEmit` | sauber |
| `wrangler d1 migrations apply DB --local` | 5/5 angewandt |
| `PRAGMA foreign_key_check` | keine Verletzungen |
| `wrangler dev` + `/api/health` | 200, `{"status":"ok","database":"reachable"}` |
| Mutationstests | 4 von 4 erkannt |
| Abdeckung gegen PHP-Referenz | 12 von 12 Dateien gleich stark oder stärker |
| Website-Dateien geändert | keine |
| Deployment | keines |

---

## Offen für Phase 2

1. HTTP-Endpunkt für `placeOrder` samt Authentifizierung des Cafés.
2. Die Bestelloberfläche in `public/`.
3. Entfernte D1 anlegen, echte `database_id` eintragen, Migrationen entfernt
   anwenden.
4. Vorlaufzeiten für Liefertage (der Platz dafür ist `FulfillmentDate`).
5. Backoffice-Sicht „was ist für Freitag zu produzieren" — der Index dafür
   liegt bereits.
