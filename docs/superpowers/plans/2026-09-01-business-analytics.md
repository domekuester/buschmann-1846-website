# Auswertung — Umsetzungsplan

Spec: `docs/superpowers/specs/2026-09-01-business-analytics-design.md`.
TDD durchgehend: Test zuerst, dann Code, gezielt laufen lassen.

## 1 · Zeiträume (domain)

- `tests/domain/reporting-period.test.ts` → `src/domain/reporting-period.ts`
- `ReportingPeriodKind`, `resolveReportingPeriod(kind, today, from, to)`
- Ergebnis: `{ kind, start, end, previousStart, previousEnd, trendStart,
  granularity, hasFuturePart, isEmpty }`
- Abdeckung: heute/woche/monat/jahr/zeitraum, Abschneiden bei heute+1,
  Monats-/Jahresgrenze, Schaltjahr (29.02. → 28.02.), Vormonatslänge,
  Zukunftsbereich, ungültige Eingaben.

## 2 · Kennzahlen (domain)

- `tests/domain/analytics.test.ts` → `src/domain/analytics.ts`
- Eingabe: die fünf vor-aggregierten Zeilenarten aus dem Repository.
- `aggregateAnalytics()` → `{ summary, previous, comparison, trend,
  topProducts, topCustomers, breakdowns }`
- `countsTowardsRevenue()`, `isPaid()`, `CostTally` werden benutzt, nicht
  nachgebaut.
- Vergleich: absolut + Zehntelprozent, Basis 0 → `'new'`, keine
  Vorperiodendaten → `'none'`.
- Abdeckung: Storno (Bestellung/Position), geänderte Menge, Ø ohne
  Bestellungen, offene Beträge, vollständige/unvollständige Kosten,
  Ranglisten, Umbenennung (neuester Schnappschuss gewinnt), Aufteilungen.

## 3 · Repository (d1)

- `tests/d1/analytics-repository.test.ts` →
  `src/infrastructure/d1/analytics-repository.ts`
- Fünf Abfragen als exportierte Konstanten (`ANALYTICS_QUERIES`), damit der
  Test genau diese prüft.
- Abdeckung: halboffene Grenzen, kein Statusfilter in SQL, stornierte
  Positionen fehlen, `EXPLAIN QUERY PLAN` nutzt `idx_orders_day`,
  Anzahl der Abfragen ist fünf.

## 4 · Anwendungsfall

- `src/application/get-analytics.ts` — ein `Promise.all`, keine Schleife,
  keine Abfrage je Tag.

## 5 · Ansichtsmodell + HTML

- `tests/domain/analytics-view.test.ts` → `src/ui/analytics-view.ts`
  (Etiketten, Beträge, Balkengeometrie 0–100, Leerzustände).
- `tests/domain/admin-analytics-html.test.ts` →
  `src/ui/admin-analytics-html.ts` (Struktur, Escaping, kein `style=`,
  kein `<script>`, unsichtbare Tabelle, `aria-current`).
- `AdminArea` um `'analytics'` erweitern, Navigation auf sieben Einträge;
  `tests/domain/admin-six-area-navigation.test.ts` anpassen.

## 6 · HTTP

- `tests/http/admin-analytics.test.ts` → `src/http/admin-analytics-page.ts`
  + Route in `src/worker.ts`.
- Abdeckung: admin only, unangemeldet → Anmeldung, Kunde → verboten,
  ungültige Parameter → 400 ohne stilles Zurückfallen, Kopfzeilen.

## 7 · CSS

- Abschnitt „Auswertung" in `public/assets/app.css`, an die bestehende
  Sprache angeschlossen. Breiten 375/768/1024/1440.

## 8 · Dokumentation

- Kurzer Abschnitt „Auswertung" in `docs/BETREIBER-HANDBUCH.md`.

## 9 · Abnahme (einmal am Ende)

Gezielte Tests → Regressionen (Bestellung/Bearbeitung/Storno/Zahlung/
Kosten/Produktion) → beide Typprüfungen → volle Suite → `release:check` →
`git diff --check`. Browser-QA bei 375/768/1024/1440 mit Screenshots.
Kein Deployment, kein Commit.
