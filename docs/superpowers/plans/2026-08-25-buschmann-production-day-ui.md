# Produktions-Tagesansicht — Implementierungsplan

**Phase 3C · 2026-08-25 · Branch `feature/order-system-production-day-ui`**

Spec: `docs/superpowers/specs/2026-08-25-buschmann-production-day-ui-design.md`

---

## Ausgangslage (verifiziert am 2026-08-25)

```text
Branch     feature/order-system-production-day-ui   ✓
Tests      844 / 844 grün, 45 Dateien
Typecheck  grün (tsconfig.json + tsconfig.ui.json)
D1         tests/d1/ läuft in echter Workers-Runtime, grün
Tree       sauber (nur untracked Buschmann-Logo.png, außerhalb des Scopes)
PDFs       order-system/source-data/ ist in .gitignore, nicht in git status
```

## Wiederverwendet, nicht neu gebaut

| Baustein | Datei | Rolle in 3C |
| --- | --- | --- |
| `getProductionDay(db, day)` | `src/application/get-production-day.ts` | einzige Datenquelle |
| `isCalendarDay(v)` | `src/domain/clock.ts` | Datumsprüfung |
| `businessDay(now)` / `plusDays(day, n)` | `src/domain/clock.ts` | Default + Navigation |
| `formatGermanDate(day)` | `src/ui/format.ts` | „Dienstag, 25. August 2026" |
| `escapeHtml(v)` | `src/ui/format.ts` | **die** Escape-Funktion |
| `orderStatusLabel(s)` | `src/domain/order-status.ts` | Neu / Bestätigt / In Produktion |
| `fulfillmentLabel(t)` | `src/domain/fulfillment-type.ts` | Lieferung / Abholung |
| `requireRole(...,'admin','html')` | `src/http/guard.ts` | Auth-Grenze |
| `pageHeaders()` | `src/http/security.ts` | no-store, CSP, nosniff |
| Design-Tokens | `public/assets/app.css` | Farben, Radius, `--tap`, Fokus |

**Nicht angefasst:** Auth, Sessions, CSRF, KDF, Domain-Regeln, Migrationen,
Phase-3B-API, Marketing-Website, `source-data/`.

---

## Task 1 — View Model und Aufbereitung

**Neu:** `src/ui/production-day-view.ts`
**Test:** `tests/domain/production-day-view.test.ts` (Projekt `domain`, ohne D1)

**Interface**

```ts
export interface ProductionLineView {
  readonly name: string;          // Snapshot
  readonly unit: string;          // Snapshot
  readonly quantity: number;
  readonly renamed: boolean;      // dieselbe productId, abweichender Snapshot
}
export interface ProductionOrderItemView {
  readonly name: string; readonly unit: string; readonly quantity: number;
}
export interface ProductionOrderView {
  readonly orderNumber: string; readonly customerName: string;
  readonly statusLabel: string; readonly fulfillmentLabel: string;
  readonly note: string | null;
  readonly items: readonly ProductionOrderItemView[];
}
export interface ProductionDayView {
  readonly day: string;           // JJJJ-MM-TT
  readonly dayLabel: string;      // „Dienstag, 25. August 2026"
  readonly previousDay: string; readonly previousDayLabel: string;
  readonly nextDay: string;       readonly nextDayLabel: string;
  readonly orderCount: number;    readonly totalUnits: number;
  readonly products: readonly ProductionLineView[];
  readonly orders: readonly ProductionOrderView[];
  readonly isEmpty: boolean;
}
export function toProductionDayView(day: ProductionDay): ProductionDayView;
```

**Failing Test zuerst** — „bildet Status und Fulfillment auf deutsche Labels ab".
Erwarteter Fehler: `Cannot find module '../../src/ui/production-day-view'`.

**Weitere Tests dieses Tasks**
- Vor-/Folgetag korrekt, inkl. Monats-, Jahreswechsel, Schaltjahr
- `renamed` nur bei gleicher `productId` mit abweichendem Snapshot; die erste
  Zeile der Gruppe bleibt `false`
- zwei verschiedene `productId` mit gleichem Namen → beide `renamed: false`
- `isEmpty` genau dann, wenn `orderCount === 0 && products.length === 0`
- Snapshot-Namen werden unverändert durchgereicht
- keine Preisfelder im Ergebnis (Typ und Laufzeit)

**Minimale Implementation:** reine Abbildung, keine Datenbank, keine Uhr.
`ProductionDay` rein, `ProductionDayView` raus.

**Verification:** `npx vitest run --project domain production-day-view`
**Commit:** `feat(order-system): Ansichtsmodell des Produktionstags`

---

## Task 2 — Produktionsliste rendern

**Neu:** `src/ui/production-day-html.ts` (Teil 1)
**Test:** `tests/domain/production-day-html.test.ts`

**Interface**

```ts
export function renderProductionSummary(view: ProductionDayView): string;
```

**Failing Test zuerst** — „zeigt Produktname und Menge mit Einheit".
Erwarteter Fehler: Modul fehlt.

**Tests**
- `<table>` mit `<caption>` und `<th scope="col">`
- Menge und Einheit in einer Zelle: `11 Stück`
- Reihenfolge exakt wie im View (keine zweite Sortierung)
- kein `€`, keine Ziffernfolge aus einem Preis, keine `product_id`
- `renamed: true` → sichtbarer Hinweistext + `aria-describedby`
- `renamed: false` → kein Hinweis
- HTML in Name und Einheit wird escaped
- leerer Tag → Empty-State-Satz statt Tabelle

**Verification:** `npx vitest run --project domain production-day-html`
**Commit:** `feat(order-system): Backliste als Tabelle`

---

## Task 3 — Bestellaufschlüsselung rendern

**Datei:** `src/ui/production-day-html.ts` (Teil 2)
**Test:** dieselbe Testdatei, eigener `describe`

**Interface**

```ts
export function renderOrderBreakdown(view: ProductionDayView): string;
```

**Failing Test zuerst** — „zeigt Kundenname, Bestellnummer, Status und
Fulfillment". Erwarteter Fehler: `renderOrderBreakdown is not a function`.

**Tests**
- je Bestellung `<section>` mit `<h3>`
- Positionen als `<ul>`, `3 × Beispiel Käsekuchen`
- Notiz vorhanden → sichtbar mit Überschrift
- Notiz `null` **und** Notiz `''`/Leerraum → **kein** Notiz-Markup im String
- `<script>`, `<img onerror>`, `&`, `"`, `'` in Notiz/Name werden escaped
- keine Bestellungen → leerer String (keine Überschrift ohne Inhalt)
- kein `€`, keine E-Mail, keine Adresse

**Verification:** `npx vitest run --project domain production-day-html`
**Commit:** `feat(order-system): Bestellaufschlüsselung des Produktionstags`

---

## Task 4 — Seite und Controller

**Geändert:** `src/ui/admin-page-html.ts`, `src/http/admin-page.ts`
**Test:** `tests/http/admin-page.test.ts` erweitert,
`tests/http/admin-production-day.test.ts` neu (Projekt `worker`, echte D1)

**Interface**

```ts
// admin-page-html.ts
export interface AdminPageView {
  loginIdentifier: string;
  csrfToken: string;
  day: ProductionDayView;
}
export function renderAdminPage(view: AdminPageView): string;
export function renderInvalidDatePage(): string;
```

**Controller-Ablauf** (`src/http/admin-page.ts`)

```text
1. requireRole(..., 'admin', 'html')     ← zuerst, immer
2. readDay(request)                       → string | 'invalid' | null
3. 'invalid' → 400 renderInvalidDatePage()
4. null      → plusDays(businessDay(now), 1)
5. getProductionDay(db, day)
6. toProductionDayView → renderAdminPage → 200 pageHeaders()
```

Schritt 1 vor Schritt 2, wie in `production-api.ts`: Wer nicht darf, bekommt
403 und nicht 400.

**Failing Test zuerst** — „zeigt ohne date-Parameter den nächsten Kalendertag".
Erwarteter Fehler: Antwort enthält weiterhin „Adminbereich ist bereit."

**Tests (Auftragspunkte 1–28, 34–41)**
- Zugriff: Admin 200 · Café 403 · ohne Sitzung 303 `/login` · Café bleibt angemeldet
- Default-Tag · explizites Datum · `2026-02-30` → 400 · `date` doppelt → 400
- `?date=//evil.test` → 400, kein `Location`-Header (kein Open Redirect)
- Produkte, exakte Mengen, Einheit, `orderCount`, `totalUnits`
- Bestellungen, Name, Nummer, Status deutsch, Lieferung, Abholung, Positionen
- Notiz vorhanden/leer · Empty State bei 200
- `no-store` · `content-type: text/html; charset=utf-8` · CSP · nosniff ·
  `frame-ancestors` · `referrer-policy` · `x-robots-tag`
- Pfeile: `href="/admin?date=…"` mit korrektem Vor-/Folgetag, inkl. Monats-,
  Jahreswechsel und Schaltjahr
- `<form method="get" action="/admin">` mit `<input type="date" name="date">`
- **kein `<script>` im Dokument** → Kernbedienung ohne JavaScript

**Verification:** `npx vitest run --project worker admin`
**Commit:** `feat(order-system): Produktionstag im Adminbereich`

---

## Task 5 — Sicherheit und Datensparsamkeit

**Test:** `tests/http/admin-production-day.test.ts`, `describe('Datensparsamkeit')`

Keine neue Implementation erwartet — dieser Task **beweist** die Eigenschaften
der Tasks 1–4. Wird ein Test rot, ist das ein Befund und keine Formalie.

**Tests (22–25, 29–33)**
- Preise: Produkt mit `price_cents = 435` und `unit_price_cents` in
  `order_items` → weder `4,35` noch `435` noch `€` im HTML
- `total_amount_cents` der Bestellung erscheint nicht
- Kunde mit E-Mail/Telefon/Adresse in `customers` → nichts davon im HTML
- Sitzungstoken aus dem Cookie erscheint nicht im Dokument
- kein `credential_`, kein `salt`, kein `verifier`, kein `pepper`
- Escaping am ausgelieferten HTML: Kundenname `<b>Nord</b>`, Produktname
  `<i>Kuchen</i>`, Notiz `<script>alert(1)</script>`, Notiz
  `<img src=x onerror=alert(1)>`, Notiz `Müller & Söhne "Extra" 'fein'`
  → jeweils `&lt;`/`&amp;`/`&quot;`/`&#39;` im HTML und **kein** rohes `<script`
  oder `onerror=`

**Verification:** `npx vitest run --project worker admin`
**Commit:** `test(order-system): Datensparsamkeit der Produktionsansicht`

---

## Task 6 — Responsive CSS

**Geändert:** `public/assets/app.css` (ein abgegrenzter Abschnitt am Ende)

Keine neue Datei: Die Seite lädt bereits `app.css`, eine zweite Datei wäre ein
zweiter Request und eine zweite Stelle mit Tokens.

**Regeln (alle unter `.produktion*` / `.tagnav*`, ohne Wirkung auf
Bestellseite, Anmeldeseite oder Website)**
- Mobile First ab 375px, dann `@media (min-width: 600px)` und `(min-width: 780px)`
- Mengenspalte `white-space: nowrap` + `tabular-nums`, Namensspalte
  `overflow-wrap: anywhere`
- Pfeile und Datumsfeld ≥ `--tap`
- Bestellkarten leiser: kleinere Schrift, `--elfenbein`-Fläche, dünne Linie
- `.anmeldeseite`-Muster für `padding-bottom: 0` (keine Fußleiste)
- keine neue Farbe, kein neues Radius-Maß, keine Animation

**Verification:** Browser-Task 7. Kein separater Testlauf.
**Commit:** `style(order-system): Produktionsansicht mobil zuerst`

---

## Task 7 — Browser und Accessibility

**Werkzeug:** Chrome DevTools MCP gegen `wrangler dev` (lokal, kein Deploy),
lokale D1 mit **fiktiven** Daten (Testcafé Nord/Süd, Beispiel Käsekuchen).

**Prüfbreiten:** 375 · 390 · 430 · 768 · 1280

**Prüfpunkte**
- `document.documentElement.scrollWidth <= clientWidth` auf jeder Breite
- keine abgeschnittene Menge, keine Überlappung
- langer Kundenname, langer Produktname, lange Notiz
- 0 Bestellungen · mehrere Bestellungen · viele Produkte
- Tab-Reihenfolge: Abmelden → ← → Datumsfeld → Anzeigen → →
- Fokusring auf jedem interaktiven Element sichtbar
- Tippflächen ≥ 44px (`getBoundingClientRect()`)
- genau ein `<h1>`, keine übersprungene Ebene
- Pfeilnavigation und Datumsformular **mit deaktiviertem JavaScript**

**Nachbesserung erlaubt:** Spacing, Hierarchie, Alignment, Typografie,
Umbruchverhalten. **Keine** Funktionserweiterung.

**Commit:** `fix(order-system): Feinschliff der Produktionsansicht` (nur falls nötig)

---

## Task 8 — Mutation, Regression, Abschluss

**A. Rollenprüfung** — `requireRole` in `admin-page.ts` durch `requireSession`
ersetzen → „lehnt eine Café-Sitzung mit 403 ab" MUSS rot werden. Zurücksetzen.

**B. Notiz-Escaping** — `escapeHtml(note)` → `note` in
`production-day-html.ts` → Escaping-Test MUSS rot werden. Zurücksetzen.

**C. Preis** — `unit_price_cents` in die Bestellposition rendern →
Datensparsamkeitstest MUSS rot werden. Zurücksetzen.

**D. Empty State** — Bedingung `isEmpty` invertieren → Empty-State-Test MUSS
rot werden. Zurücksetzen.

Nach jeder Rücksetzung `git diff` prüfen: **keine Mutation bleibt zurück.**

**Abschließend frisch ausführen**
```bash
npm test          # vollständige Suite inkl. tests/d1 (D1-Integration)
npm run typecheck # beide tsconfigs
git status && git diff --stat
git diff --stat feature/order-system-production-day-data   # Website-Integrität
git status --porcelain | grep -i '\.pdf$'                  # muss leer sein
```

**Website-Integrität:** Der Diff gegen `feature/order-system-production-day-data`
darf ausschließlich `order-system/` und `docs/superpowers/` enthalten. Jede
Datei außerhalb ist ein STOP.

**Commit:** `docs(order-system): Stand nach der Produktions-Tagesansicht`

---

## Commit-Grenzen

```text
1  feat  Ansichtsmodell des Produktionstags
2  feat  Backliste als Tabelle
3  feat  Bestellaufschlüsselung des Produktionstags
4  feat  Produktionstag im Adminbereich
5  test  Datensparsamkeit der Produktionsansicht
6  style Produktionsansicht mobil zuerst
7  fix   Feinschliff der Produktionsansicht        (nur falls nötig)
8  docs  Stand nach der Produktions-Tagesansicht
```

Kein Push. Kein Merge. Kein Deployment.

## Risiken und Umgang

| Risiko | Umgang |
| --- | --- |
| `renamed`-Erkennung markiert falsch | eigener Test für zwei IDs mit gleichem Namen |
| Escaping-Lücke an einer einzelnen Stelle | Test gegen ausgeliefertes HTML, nicht gegen die Funktion |
| Default-Datum wandert in den Service | Controller-Test + Service bleibt unverändert |
| CSS beeinflusst die Bestellseite | eigener Klassenraum, Bestellseiten-Tests als Wächter |
| Preis rutscht ins HTML | Mutationsprüfung C beweist die Wirksamkeit |
