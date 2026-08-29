# Buschmann 1846 — Café-Bestellung (Phase 2): Implementation Plan

**Datum:** 2026-08-24
**Branch:** `feature/order-system-cafe-ordering`
**Spezifikation:** `docs/superpowers/specs/2026-08-24-buschmann-cafe-ordering-design.md`
**Ausgangsstand (verifiziert):** 173 Tests grün · Typecheck grün · Migrationen 0001–0005 lokal angewendet · `/api/health` → 200

---

## Arbeitsweise

Jeder Task ist ein vollständiger TDD-Zyklus:

1. Test schreiben → **muss aus dem erwarteten Grund scheitern**
2. minimal implementieren
3. Test grün
4. `npm test` (alle Projekte) + `npm run typecheck`
5. `git diff` prüfen · Website-Integrität prüfen
6. kleiner Commit

**Nicht pushen. Nicht deployen. Nicht mergen.**

Website-Integritätsprüfung nach jedem Commit:

```bash
git diff --name-only refactor/order-system-cloudflare-foundation \
  | grep -v '^order-system/' | grep -v '^docs/superpowers/' || echo "OK: nur erlaubte Bereiche"
```

---

## Task 0 — Werkzeuge und Projektgerüst

**Kein Testzyklus** — reine Konfiguration, abgesichert dadurch, dass die
bestehenden 173 Tests unverändert grün bleiben müssen.

Dateien:

* `order-system/package.json` — `happy-dom` als devDependency; Skripte
  `db:seed:cafe:local`, `typecheck` erweitert auf `tsc --noEmit && tsc -p tsconfig.ui.json --noEmit`
* `order-system/wrangler.jsonc` — `"assets": { "directory": "./public" }`
* `order-system/tsconfig.json` — `exclude: ["node_modules", "tests/ui"]`
* `order-system/tsconfig.ui.json` — `lib: ["ES2022","DOM","DOM.Iterable"]`,
  `allowJs`, `checkJs`, `strict`, include `public/assets/**/*.js`, `src/ui/**/*.ts`, `tests/ui/**/*.ts`
* `order-system/vitest.config.ts` — drittes Projekt `ui` (`environment: 'happy-dom'`, `include: ['tests/ui/**/*.test.ts']`)
* `order-system/public/robots.txt` — `Disallow: /`
* `order-system/public/_headers` — Header für `/assets/*`

**Verifikation:** `npm test` → 173 grün · `npm run typecheck` grün ·
`npx wrangler dev` liefert `/robots.txt`.

**Commit:** `chore(order-system): Toolchain für Bestelloberfläche (Assets, UI-Tests, Client-Typecheck)`

---

## Task 1 — `plusDays` im Zeitmodell

**Datei:** `src/domain/clock.ts` · **Test:** `tests/domain/clock.test.ts` (neu)

**Failing test:** `plusDays('2026-08-31', 1) === '2026-09-01'`
**Erwarteter Fehler:** `plusDays is not a function` / TS2305.

Fälle: Monatswechsel · Jahreswechsel · Schaltjahr (`2028-02-28` + 1 =
`2028-02-29`) · `plusDays(d, 0) === d` · `plusDays(d, 365)`.
Zusätzlich `businessDay()` an der Zeitzonengrenze: `2026-08-24T22:30:00Z` →
`2026-08-25` (Berlin ist voraus).

**Minimal:** `plusDays(day, n)` über `Date.UTC` und `toISOString().slice(0,10)`.

**Commit:** `feat(order-system): plusDays im Geschäftszeitmodell`

---

## Task 2 — Access-Token: erzeugen, hashen, prüfen

**Datei:** `src/domain/access-token.ts` · **Test:** `tests/domain/access-token.test.ts`

**Failing test:** `generateAccessToken()` liefert 43 Zeichen aus `[A-Za-z0-9_-]`.
**Erwarteter Fehler:** Modul existiert nicht.

Schnittstelle:

```ts
export function generateAccessToken(): string;              // 32 Byte → base64url
export function isWellFormedToken(v: unknown): v is string; // /^[A-Za-z0-9_-]{32,64}$/
export function hashAccessToken(token: string): Promise<string>; // sha256 hex, 64 Zeichen
```

Fälle: Länge und Zeichenvorrat · zwei Aufrufe liefern verschiedene Werte ·
Formprüfung lehnt `''`, `null`, Zahlen, 31 Zeichen, 65 Zeichen und `+`/`/`/`=` ab ·
Hash ist 64 Hex-Zeichen · Hash ist deterministisch · verschiedene Token →
verschiedene Hashes · **der Klartext kommt im Hash nicht vor** ·
`hashAccessToken` wirft bei formal ungültigem Token.

**Minimal:** `crypto.getRandomValues` + base64url-Kodierung ohne Padding;
`crypto.subtle.digest('SHA-256', …)` → Hex.

**Commit:** `feat(order-system): Access-Token mit Web-Crypto und SHA-256-Hash`

---

## Task 3 — Migration `customer_access_tokens`

**Datei:** `migrations/0006_create_customer_access_tokens.sql`
**Test:** `tests/d1/schema.test.ts` (erweitert)

**Failing test:** `INSERT` einer Token-Zeile gelingt; `INSERT` mit
64-Zeichen-Nicht-Hex scheitert; doppelter `token_hash` scheitert;
`is_active = 0` ohne `revoked_at` scheitert; `customer_id` ohne Kunden scheitert;
Löschen des Kunden löscht die Token-Zeile (CASCADE).
**Erwarteter Fehler:** `no such table: customer_access_tokens`.

**Commit:** `feat(order-system): D1-Tabelle customer_access_tokens`

---

## Task 4 — Migration `orders.submission_id`

**Datei:** `migrations/0007_add_order_submission_id.sql`
**Test:** `tests/d1/schema.test.ts` (erweitert)

**Failing test:** Zwei Bestellungen mit gleichem `(customer_id, submission_id)`
scheitern; gleiche `submission_id` bei **verschiedenen** Kunden gelingt; zwei
Bestellungen mit `submission_id IS NULL` gelingen (partieller Index).
**Erwarteter Fehler:** `no such column: submission_id`.

**Commit:** `feat(order-system): Absendekennung auf orders mit partiellem UNIQUE-Index`

---

## Task 5 — Token-Repository

**Datei:** `src/infrastructure/d1/access-token-repository.ts`
**Test:** `tests/d1/access-token-repository.test.ts`

**Failing test:** `findCustomerByAccessToken(db, 'gültiger-token')` liefert
`Customer` mit der richtigen ID.
**Erwarteter Fehler:** Modul existiert nicht.

Schnittstelle:

```ts
export async function findCustomerByAccessToken(
  db: D1Database, token: string,
): Promise<Customer | null>;
```

Fälle (Anforderung 1–4): gültiger Token → richtiger Customer · unbekannter
Token → `null` · `is_active = 0` → `null` · Kunde `is_active = 0` → `null` ·
Token von Café A liefert niemals Café B · formal ungültiger Token → `null`
**ohne Datenbankzugriff** · in D1 steht nur der Hash, nie der Klartext
(direkte Abfrage auf die Tabelle im Test).

**Minimal:** Formprüfung → Hash → ein `SELECT` mit `JOIN customers`, gefiltert
auf beide `is_active`-Spalten.

**Commit:** `feat(order-system): Kundenauflösung über Access-Token-Hash`

---

## Task 6 — Katalogprojektion

**Datei:** `src/application/catalog-view.ts` · **Test:** `tests/domain/catalog-view.test.ts`

**Failing test:** `toCatalogView(catalog)` liefert nur aktive Produkte.
**Erwarteter Fehler:** Modul existiert nicht.

Fälle (5–7): nur aktive Produkte · Sortierung `sortOrder`, dann `id` ·
Ergebnisobjekt hat **exakt** die Schlüssel
`id, name, description, priceCents, unit` — kein `isActive`, kein Zeitstempel
(geprüft über `Object.keys`).

**Commit:** `feat(order-system): Katalogprojektion für die Bestelloberfläche`

---

## Task 7 — Formatierung und Escaping

**Datei:** `src/ui/format.ts` · **Test:** `tests/domain/format.test.ts`

**Failing test:** `formatEuro(435) === '4,35 €'`.
**Erwarteter Fehler:** Modul existiert nicht.

Fälle: `formatEuro(0)`, `435`, `2400`, `123456` → `'1.234,56 €'` (kein Float im
Pfad) · `escapeHtml` behandelt `&`, `<`, `>`, `"`, `'` und lässt Umlaute
unangetastet · `escapeHtml('<script>')` erzeugt kein `<` ·
`formatGermanDate('2026-08-25') === 'Dienstag, 25. August 2026'`.

**Commit:** `feat(order-system): Preis-, Datums- und HTML-Escaping-Formatierung`

---

## Task 8 — `saveOrder` mit Absendekennung

**Dateien:** `src/infrastructure/d1/order-repository.ts`
**Test:** `tests/d1/repositories.test.ts` (erweitert)

**Failing test:** `saveOrder(db, order, 'abc-123')` schreibt `submission_id`;
`findOrderBySubmission(db, customerId, 'abc-123')` liefert die Bestellung;
unbekannte Kennung → `null`; `saveOrder(db, order)` ohne Kennung schreibt `NULL`.
**Erwarteter Fehler:** zu viele Argumente (TS) / Funktion existiert nicht.

**Wichtig:** Die Kennung wird im **selben** `INSERT INTO orders` geschrieben —
kein zweiter Schreibvorgang, kein zweiter Batch-Eintrag.

**Commit:** `feat(order-system): Absendekennung im atomaren Schreibvorgang`

---

## Task 9 — Anwendungsfall `placeCafeOrder`

**Datei:** `src/application/place-cafe-order.ts`
**Test:** `tests/d1/place-cafe-order.test.ts`

**Failing test:** gültiger Token + eine Position → Bestellung mit
`BUS-2026-000001`, Status `new`, Customer aus dem Token.
**Erwarteter Fehler:** Modul existiert nicht.

Schnittstelle:

```ts
export interface CafeOrderResult { order: Order; created: boolean }
export async function placeCafeOrder(db: D1Database, cmd: {
  token: string; submissionId: string; input: unknown; now: Date;
}): Promise<CafeOrderResult>;
```

Fälle (8–22):
ungültiger/unbekannter/widerrufener Token → `AccessDeniedError`, **keine**
Bestellung · Customer stammt aus dem Token, auch wenn `customer_id: 999`
mitgesendet wird · `fulfillment_type` aus `customers.default_fulfillment`, ein
mitgesendetes `'pickup'` wirkt nicht · keine Position → `ValidationError` ·
Menge 0 erzeugt keine Position · negative Menge → `ValidationError` ·
inaktives Produkt → `ValidationError`, nichts gespeichert · mitgesendete
Preisfelder wirken nicht · `unit_price_cents` stammt aus `products` ·
Preis-Snapshot bleibt nach Preisänderung stehen · Summe über zwei Positionen
stimmt · Datum in der Vergangenheit → `ValidationError` · Datum > 365 Tage →
`ValidationError` · Datum `2026-02-30` → `ValidationError` · Notiz > 500
Zeichen → `ValidationError` · Status `new` · Order und Items atomar ·
**Doppel-Submit mit gleicher `submissionId` erzeugt genau eine Bestellung und
liefert beim zweiten Mal `created: false`** · gleiche `submissionId` bei
verschiedenen Cafés erzeugt zwei Bestellungen · Eingabefehler verbraucht keine
Bestellnummer.

**Commit:** `feat(order-system): placeCafeOrder mit Token-Kontext und Idempotenz`

---

## Task 10 — Sicherheitsheader und Fehlergrenze

**Dateien:** `src/http/security.ts`, `src/http/error-boundary.ts`
**Tests:** `tests/http/error-boundary.test.ts`

**Failing test:** `toSafeResponse(new Error('D1_ERROR: near "x"'))` → 500,
Körper `{"error":"internal_error"}`, Körper enthält weder `D1_ERROR` noch
`near` noch `Error`.
**Erwarteter Fehler:** Modul existiert nicht.

Fälle (26): `ValidationError` → 422 mit Feldmeldungen · `AccessDeniedError` →
401 · beliebiger Fehler → 500 ohne Details · geworfener String, `null` und
Objekt mit `.message` → ebenfalls 500 ohne Details · `privateHeaders()` enthält
`no-store`, `no-referrer`, `nosniff`, `DENY`, `noindex`.

Neu: `src/domain/errors.ts` erhält `AccessDeniedError`.

**Commit:** `feat(order-system): Fehlergrenze und Sicherheitsheader der HTTP-Schicht`

---

## Task 11 — Seitengerüst rendern

**Dateien:** `src/ui/order-page-html.ts`
**Test:** `tests/domain/order-page-html.test.ts`

**Failing test:** `renderOrderPage(view)` enthält den Cafénamen und alle
Produktnamen.
**Erwarteter Fehler:** Modul existiert nicht.

Schnittstelle:

```ts
export interface OrderPageView {
  customerName: string; products: CatalogItemView[];
  submissionId: string; today: string; defaultDate: string;
}
export function renderOrderPage(view: OrderPageView): string;
export function renderInvalidLinkPage(): string;
```

Fälle: Caféname erscheint · jedes aktive Produkt erscheint mit Preis und
Einheit · `data-product-id` und `data-price-cents` je Zeile · `min` und `value`
am Datumsfeld · `data-submission-id` am Formular · **Caféname `<script>` wird
escaped** · Seite enthält keinen `http://`/`https://`-Verweis auf einen fremden
Host · Seite enthält kein `internal_note`, keine E-Mail, keine Telefonnummer,
keinen Token · `renderInvalidLinkPage()` nennt weder Café noch Grund.

**Commit:** `feat(order-system): serverseitig gerendertes Bestellformular`

---

## Task 12 — Route `GET /o/<token>`

**Dateien:** `src/http/order-page.ts`, `src/worker.ts`
**Test:** `tests/http/order-page.test.ts`

**Failing test:** `GET /o/<gültig>` → 200, `content-type: text/html`, Caféname
im Körper.
**Erwarteter Fehler:** 404.

Fälle (23, 27): gültiger Token → 200 mit Sortiment · unbekannter, widerrufener,
formal ungültiger Token und deaktivierter Kunde → **vier identische** 404 mit
identischem Körper · `POST /o/<token>` → 405 mit `Allow: GET` · Antwort trägt
`no-store`, `no-referrer`, `nosniff`, CSP ohne `'unsafe-inline'` · inaktives
Produkt taucht nicht auf · Token erscheint nicht im HTML.

**Commit:** `feat(order-system): Bestellseite unter /o/<token>`

---

## Task 13 — Route `POST /api/orders`

**Dateien:** `src/http/order-api.ts`, `src/worker.ts`
**Test:** `tests/http/order-api.test.ts`

**Failing test:** gültiger Token + gültiger Körper → 201 mit `order_number`.
**Erwarteter Fehler:** 404.

Fälle (23–27): 201 mit `order_number`, `fulfillment_date`, `total_cents`,
`items` · Antwort enthält **keine** `customer_id`, keinen `submission_id`,
keine internen Felder · fehlender Header → 401 · falscher Token → 401 · `GET`
→ 405 mit `Allow: POST` · `Content-Type: text/plain` → 415 · `{` → 400 ·
`[]` → 400 · `Content-Length: 999999` → 413 · Validierungsfehler → 422 mit
`errors` je Feld · zweiter identischer Aufruf → **200**, gleiche Bestellnummer,
genau eine Zeile in `orders` · alle Antworten tragen `no-store`.

**Commit:** `feat(order-system): Bestell-Endpunkt POST /api/orders`

---

## Task 14 — Client: Mengensteuerung und Summe

**Dateien:** `public/assets/order-form.js`, `public/assets/app.js`
**Test:** `tests/ui/order-form.test.ts`

**Failing test:** `+` erhöht die Menge von 0 auf 1.
**Erwarteter Fehler:** Modul existiert nicht.

Das Test-DOM entsteht aus `renderOrderPage(...)` — es wird gegen **genau das
HTML** getestet, das der Server ausliefert, nicht gegen ein Testfragment.

Fälle (28–31): `+` erhöht · `−` verringert · Minimum bleibt 0, `−` ist bei 0
`disabled` · Maximum 9 999 · Summe im Footer aktualisiert sich · Positionszahl
aktualisiert sich · direkte Tastatureingabe wird normalisiert · Absenden ohne
Auswahl sendet **nicht** und zeigt eine sichtbare Meldung.

**Commit:** `feat(order-system): Mengensteuerung und Live-Summe im Client`

---

## Task 15 — Client: Absenden, Erfolg, Fehler

**Datei:** `public/assets/order-form.js` (erweitert)
**Test:** `tests/ui/order-form.test.ts` (erweitert)

**Failing test:** erfolgreiches Absenden zeigt die Bestellnummer.
**Erwarteter Fehler:** Bestätigung wird nicht gerendert.

Fälle (32–34): `fetch` wird mit `X-Order-Token`, `submission_id` und **nur**
`product_id`/`quantity` je Position aufgerufen — **keine Preise im Körper** ·
Erfolg zeigt Bestellnummer, Liefertag und Positionen · Button ist während des
Absendens `disabled`, ein zweiter Klick löst **keine** zweite Anfrage aus ·
422 zeigt Feldfehler am richtigen Feld mit `aria-invalid` · 500 zeigt „wurde
**nicht** bestätigt" und aktiviert den Button wieder · Netzwerkfehler ebenso ·
`aria-live`-Region meldet Mengenänderungen.

**Commit:** `feat(order-system): Absenden, Bestätigung und Fehleranzeige im Client`

---

## Task 16 — Gestaltung

**Datei:** `public/assets/app.css`

Kein eigener Testzyklus (keine Tests auf CSS-Klassen). Geprüft wird in
Task 18 manuell im Browser.

Inhalt: Marken-Tokens · System-Schriftstapel · Zeilenlayout · Stepper 48 px ·
Sticky-Footer · `:focus-visible` · Fehler- und Erfolgsdarstellung ·
`prefers-reduced-motion` · Breakpoints 375/430/Desktop.

**Commit:** `feat(order-system): Gestaltung der Bestelloberfläche`

---

## Task 17 — Entwicklungsdaten und Token-Werkzeug

**Dateien:** `seeds/002_cafe_ordering_dev.sql`, `scripts/issue-access-token.mjs`,
`order-system/README.md`

Nur eindeutig fiktive Daten: `Testcafé Nord`, `Testcafé Süd (Abholung)`,
`Beispiel Käsekuchen`, `Beispiel Streuselblech`, `Beispiel Butterkuchen`,
`Beispiel Saisontorte (inaktiv)`. Keine echten Cafés, keine echten
Kontaktdaten, keine echten Preise.

`scripts/issue-access-token.mjs` erzeugt Token + Hash, gibt den Klartext genau
einmal aus und druckt das `INSERT`-Statement — es schreibt **nicht** selbst in
eine Datenbank.

**Verifikation:** Der Hash im Seed stimmt nachweislich mit dem dokumentierten
Entwicklungstoken überein (Prüfung über `hashAccessToken` im Test).

**Commit:** `chore(order-system): fiktive Entwicklungsdaten und Token-Werkzeug`

---

## Task 18 — Lokaler Integrations- und UX-Nachweis

Kein Code. Durchführung gemäß Spezifikation Abschnitt 23, danach manuelle
Browserprüfung bei 375 px, 390 px, 430 px und Desktop gemäß Abschnitt 19.5.

Geprüft wird: kein horizontales Scrollen · Stepper gut treffbar · Footer immer
sichtbar · Bestätigung eindeutig · Fehlermeldungen verständlich · Zählung der
tatsächlichen Taps für eine typische Bestellung.

Ergebnis wird in den Abschlussbericht übernommen.

**Commit:** `docs(order-system): Nachweis des lokalen Bestellflusses`

---

## Reihenfolge und Abhängigkeiten

```text
0 ──► 1 ──► 2 ──► 3 ──► 5 ──┐
      │           4 ──► 8 ──┼──► 9 ──► 13 ──► 15 ──► 16 ──► 17 ──► 18
      └──► 6 ──► 7 ──► 11 ──┴──► 12 ──► 14 ──┘
                    10 ──────────┘
```

Tasks 1–8 sind einzeln commit-fähig, ohne dass eine Oberfläche existiert.
Ab Task 12 ist die Seite im Browser erreichbar, ab Task 15 vollständig
benutzbar.

---

## Abbruchbedingungen

Sofort stoppen und nachfragen, wenn:

* eine Datei **außerhalb** von `order-system/` und `docs/superpowers/`
  geändert werden müsste
* eine Anforderung nur durch Lockerung einer Phase-1-Regel erfüllbar wäre
  (Preisbildung, Integer-Cents, Snapshots, Atomarität)
* ein Test grün wird, ohne dass die Ursache verstanden ist
