# Auswertung — Design Spec (Phase Business Analytics)

Stand: 2026-09-01. Branch `feature/order-system-business-analytics`.

## Zweck

Ein siebter Adminbereich „Auswertung". Kein Buchhaltungswerkzeug. Er
beantwortet in zehn Sekunden: Wie viel haben wir verkauft, mehr oder weniger
als vorher, wie viele Bestellungen, was verkauft sich, wer bestellt, wie viel
ist offen, sind die Kosten vollständig, was bleibt übrig.

Navigation: Übersicht · Bestellungen · Produktion · Angebot · Kunden ·
**Auswertung** · Einstellungen. Route `/admin/auswertung`, Bereich
`analytics`.

## Kanonisches Berichtsdatum

**`orders.fulfillment_date`** — der Liefer-/Abholtag. Begründung: Es ist das
Datum, an dem der Betrieb leistet, und es ist bereits das kanonische
Betriebsdatum von Produktionsansicht, Tagesüberblick und Wochenübersicht.
`created_at` wird in dieser Phase an **keiner** Kennzahl verwendet.

Zeitzone: Europe/Berlin, ausschließlich über `businessDay()` aus
`domain/clock.ts`. Bereiche sind **halboffen `[start, end)`**.

## Zeitraumwahl

`?period=heute|woche|monat|jahr|zeitraum` (+ `from`/`to` für `zeitraum`,
+ `metric=umsatz|bestellungen` für die Kurve).

Der **wirksame Bereich wird bei „heute+1" abgeschnitten**: Eine Auswertung
berichtet, was gewesen ist. Ein laufender Monat ist damit „bis heute", und
der Vergleich ist automatisch fair. Das Etikett sagt es ausdrücklich
(„September 2026 (bis heute)"). Liegt der ganze gewählte Bereich in der
Zukunft, erscheint ein ruhiger Hinweis statt Nullen.

| Auswahl | Bereich | Vergleich |
|---|---|---|
| Heute | [heute, heute+1) | Gestern |
| Woche | [Montag, min(Montag+7, heute+1)) | Vorwoche, gleich lange Anfangsspanne |
| Monat | [Monatsanfang, min(Folgemonat, heute+1)) | Vormonat, gleiche Tagesspanne (auf Monatslänge geklemmt) |
| Jahr | [Jahresanfang, min(Folgejahr, heute+1)) | Vorjahr, gleiche Spanne (29.02. → 28.02.) |
| Zeitraum | [von, min(bis+1, heute+1)) | unmittelbar davor, gleiche Länge |

Vergleich ohne Basis (Vorwert 0 bzw. gar keine Vorperiodendaten): **„Neu"**
bzw. **„Noch keine Vorjahresdaten"** — niemals `Infinity`, `NaN`, `0 %`
oder `-100 %`.

## Kennzahlen (genau sechs)

| Kennzahl | Definition |
|---|---|
| Bestellumsatz | `SUM(orders.total_amount_cents)` über nicht stornierte Bestellungen. `total_amount_cents` wird bei jeder Positionsänderung aus `SUM(line_total_cents) WHERE cancelled_at IS NULL` neu gebildet (Phase Bestellung-bearbeiten) — er IST damit der aktuelle aktive Betrag aus unveränderlichen Preisschnappschüssen. |
| Bestellungen | Anzahl nicht stornierter Bestellungen. |
| Verkaufte Stück | `SUM(order_items.quantity)` mit `cancelled_at IS NULL`, Bestellung nicht storniert. |
| Ø pro Bestellung | Bestellumsatz / Bestellungen. Bei 0 Bestellungen: kein Wert, „—". |
| Noch offen | Umsatz der eingeschlossenen Bestellungen mit `payment_status = 'unpaid'` (`isPaid()`). Keine neue Zahlungssemantik. |
| Deckungsbeitrag | `CostTally`/`CostSummary` aus `domain/cost-summary.ts`. Vollständig → Umsatz − bekannte Herstellkosten + Marge. Unvollständig → **kein Wert**, stattdessen „Noch nicht vollständig" und „Bei N Positionen fehlen Kosten". Unbekannte Kosten sind niemals 0. |

„Zählt diese Bestellung?" beantwortet ausschließlich
`countsTowardsRevenue()` aus `domain/order-status.ts`. Es gibt **keinen**
Statusfilter in SQL: Die Abfragen gruppieren **nach** Status, die Domäne
entscheidet. Produktionsstatus-Semantik (`OPEN_PRODUCTION_STATUSES`) wird
hier nicht verwendet.

Stornierte Position, geänderte Menge, stornierte Bestellung: über
`cancelled_at`/`total_amount_cents` bereits im aktuellen Stand abgebildet.
`order_item_changes` wird **nirgends** gelesen.

## Abschnitte

1. **So hat es sich entwickelt** — ein SVG-Balkendiagramm, Umschalter
   Bestellumsatz/Bestellungen als zwei Links. Körnung: Heute → die letzten
   7 Tage; Woche → Tage; Monat → Tage; Jahr → Monate; Zeitraum → Tage
   (≤ 31), Wochen (≤ 120), sonst Monate. Kein Hover nötig; eine
   unsichtbare Tabelle trägt beide Reihen als Text.
2. **Das verkauft sich am besten** — Top 6 Produkte: Produkt, Stück,
   Bestellumsatz. Aus Positionsschnappschüssen, nie aus dem heutigen Katalog.
3. **Diese Kunden bestellen am meisten** — Top 6 Kunden: Name, Bestellungen,
   Bestellumsatz. Keine IDs in der Ausgabe.
4. **Vergleich** — drei Karten (Umsatz, Bestellungen, Stück) mit absolutem
   und prozentualem Unterschied und ausgeschriebenen Zeitraumnamen.
5. **Leise Aufteilungen** — Gastro/Privat (über `customers.price_list_id` →
   `price_lists.code`) und Lieferung/Abholung. Waagerechte Balken, keine
   Ringe, keine Kopfkennzahlen.

## Abfragen (fünf, feste Zahl)

Ein Bereich `[queryStart, queryEnd)` deckt Trend + aktuellen + vorherigen
Zeitraum ab; die Domäne verteilt die Tage.

1. `orders` gruppiert nach `(fulfillment_date, status, payment_status)` →
   Anzahl + Betrag.
2. `order_items JOIN orders` gruppiert je Bestellung, dann nach
   `(fulfillment_date, status)` → Stück, bekannte Kosten, Positionen,
   fehlende Positionen, Bestellungen, Bestellungen mit Lücke.
3. Top-Produkte: `(product_id, name_snapshot, unit_snapshot, status)`.
4. Top-Kunden: `(customer_id, name_snapshot, status)`.
5. Aufteilungen: `(fulfillment_type, price_list_code, status)`.

3–5 nur über den aktuellen Bereich. Keine neue Tabelle, **keine Migration**,
kein neuer Index (`idx_orders_day (fulfillment_date, status)` trägt die
Bereichsabfragen).

## Schichten

- `domain/reporting-period.ts` — Zeiträume, Vergleichszeiträume, Körnung, Etiketten.
- `domain/analytics.ts` — Kennzahlen, Vergleich, Trend, Toplisten, Aufteilungen.
- `infrastructure/d1/analytics-repository.ts` — die fünf Abfragen.
- `application/get-analytics.ts` — lädt und aggregiert.
- `ui/analytics-view.ts` — Formatierung, Etiketten, Balkengeometrie.
- `ui/admin-analytics-html.ts` — Darstellung.
- `http/admin-analytics-page.ts` — Wache, Parameter, Antwort.

## Oberfläche

Bestehende Sprache des Operator Centers: Porzellan-Grund, weiße Flächen,
Haarlinien statt Kartenrändern, Navy-Serife für Zahlen, gesperrte
Versalien für Beschriftungen, Champagner nur als Akzent. Kein neues
Layoutsystem, keine Bibliothek, kein Skript, keine Inline-Stile
(`style-src 'self'`). Geometrie steht als Attribut.

Zeitraumwahl als segmentierte Leiste aus echten Links in derselben
`.tagleiste`-Rolle wie auf der Übersicht; `aria-current="page"` markiert die
aktive Wahl, Farbe ist nie die einzige Auskunft.

Barrierefreiheit: semantische Überschriften, sichtbarer Fokus,
`--tap`-Tippflächen, Vorzeichen und Pfeile als Text, unsichtbare Tabelle zum
Diagramm, `prefers-reduced-motion` respektiert.

## Ausdrücklich nicht

Buchhaltung, Steuer, DATEV, Rechnungen, Prognosen, Empfehlungen, Bestand,
Export, PDF, CSV, mehrere Standorte, Mitarbeiterauswertung,
Berichtsbaukasten, Kundenansicht, Cron, Queues, fremde Dienste.
