# Produktions-Tagesansicht — Design

**Phase 3C · 2026-08-25 · Branch `feature/order-system-production-day-ui`**

---

## Problem

Seit Phase 3B kann das System zuverlässig beantworten, was an einem
bestimmten Kalendertag zu produzieren ist. Die Antwort ist getestet,
aggregiert und gegen Preis- und Kontaktdaten abgedichtet — und sie ist für
Buschmann **unerreichbar**. Sie liegt hinter `GET
/api/admin/production-day?date=…` und kommt als JSON.

Ein Bäckermeister öffnet um halb fünf morgens keinen HTTP-Client. Er meldet
sich an und will sehen, was zu backen ist.

Gleichzeitig ist `/admin` seit Phase 3A eine leere Shell mit dem Satz
„Adminbereich ist bereit." Sie beweist die Auth-Grenze und sonst nichts. Ein
Admin, der sich anmeldet, landet auf einer Seite ohne jeden Nutzen.

Phase 3C verbindet beides: Die geprüften Daten aus 3B werden auf der bereits
geschützten Seite aus 3A sichtbar.

**Phase 3C schreibt nichts.** Kein Statuswechsel, kein Bearbeiten, kein
Löschen. Die Ansicht ist read-only, und das ist keine Einschränkung auf Zeit,
sondern der Umfang dieser Phase.

---

## User Goal

Die zentrale Frage der Backstube am Morgen, in genau dieser Reihenfolge:

> **1. Was muss ich heute produzieren?**
> **2. Für wen?**

Nicht umgekehrt. Wer zuerst zwölf Bestellkarten liest und daraus summiert,
hat den Nutzen des Systems verloren — das Summieren ist genau die Arbeit, die
es abnimmt.

Daraus folgt die gesamte Gestaltung dieser Seite: Die **Produktionsliste ist
der dominierende Bereich**, die Einzelbestellungen sind die Herleitung
darunter.

---

## Information Hierarchy

Von laut nach leise:

| Rang | Element | Begründung |
| --- | --- | --- |
| 1 | Produktname + Menge | die Antwort auf Frage 1 |
| 2 | Der gewählte Tag | ohne ihn ist die Menge bedeutungslos |
| 3 | Datumsnavigation | der einzige Bedienvorgang der Seite |
| 4 | Bestellungen · Einheiten | zwei Zahlen zur Einordnung |
| 5 | Einzelbestellungen | die Antwort auf Frage 2 |
| 6 | Marke, Kennung, Abmelden | Rahmen, kein Inhalt |

Die Mengen werden in einer eigenen, großen, tabellarisch ausgerichteten
Schrift gesetzt (`font-variant-numeric: tabular-nums`), damit eine Spalte aus
`11 / 8 / 5` auf einen Blick lesbar ist statt Ziffer für Ziffer.

**Keine Diagramme.** Kein Balken, kein Kreis, keine Sparkline. Bei acht
Produkten ist eine gesetzte Liste schneller zu lesen als jede Grafik — und
sie lässt sich ausdrucken und abhaken.

---

## Page Flow

```text
GET /admin
  │
  ├── keine Sitzung ──▶ 303 /login ──▶ Anmeldung ──▶ 303 /admin
  │                     (bestehender Flow aus Phase 3A, unverändert:
  │                      LANDING_BY_ROLE.admin = '/admin')
  │
  ├── Café-Sitzung ───▶ 403 renderForbiddenPage()   (unverändert)
  │
  └── Admin-Sitzung ──▶ Produktionsansicht, sofort
```

**Es gibt keine Dashboard-Zwischenseite.** Kein „Willkommen — bitte Funktion
auswählen". Das System hat genau eine Adminfunktion; eine Auswahlseite mit
einem Eintrag wäre ein Klick ohne Entscheidung.

Der Anmelde-Rücksprung existiert bereits und wird nicht angefasst:
`LANDING_BY_ROLE` in `src/http/auth-routes.ts` schickt eine Adminsitzung nach
`/admin`.

---

## Default Date

Ohne `?date=` zeigt die Seite den **nächsten Kalendertag**:

```ts
plusDays(businessDay(now), 1)
```

Beide Funktionen sind vorhanden und getestet (`src/domain/clock.ts`), und die
Bestellseite bildet ihre Vorbelegung seit Phase 2 mit demselben Ausdruck
(`src/http/order-page.ts`). Zwei Stellen, dieselbe Bedeutung von „morgen".

**Es wird keine Geschäftsregel erfunden.** Kein Überspringen von Sonntagen,
keine Feiertage, keine Öffnungszeiten. Eine solche Regel existiert in diesem
System nicht, und sie hier zum ersten Mal — in einer Oberfläche — einzuführen
hieße, sie an der falschen Stelle und ohne fachliche Klärung festzuschreiben.
Wenn Buschmann sonntags nicht produziert, zeigt die Ansicht einen leeren
Sonntag, und ein Pfeilklick ist der Weg zum Montag.

**Der Default steht ausschließlich im Controller** (`src/http/admin-page.ts`).
`getProductionDay()` bleibt ausdrücklich datumsbasiert und leitet nichts ab;
der Phase-3B-Vertrag ändert sich nicht.

Warum „morgen" und nicht „heute": Wer morgens die Tagesliste braucht, hat sie
in der Regel am Vorabend geplant. Der operative Blick geht nach vorn — und
genau diese Begründung trägt die Vorbelegung der Bestellseite bereits.

---

## URL Semantics

```text
/admin                      → nächster Kalendertag
/admin?date=2026-08-26      → genau dieser Tag
```

Der Tag steht in der URL und nirgends sonst. Damit ist die Ansicht:

- **lesezeichenfähig** — „meine Freitagsliste" ist ein Bookmark
- **reload-fest** — F5 zeigt denselben Tag
- **historienfähig** — Zurück/Vorwärts des Browsers funktionieren, ohne dass
  eine Zeile JavaScript dafür geschrieben wird
- **teilbar** innerhalb des Betriebs — der Empfänger braucht eine
  Adminsitzung, die URL allein ist kein Zugang

**Kein clientseitiger Zustand.** Ein Datum, das nur im Speicher der Seite
lebt, wäre nach einem Reload weg und in einem zweiten Tab etwas anderes.

Der Parametername ist `date` — derselbe wie in
`GET /api/admin/production-day`. Zwei Namen für denselben Wert wären einer zu
viel.

**Mehrfache `date`-Parameter werden abgelehnt**, exakt wie in
`production-api.ts`: `getAll('date').length !== 1` ist ungültig. Still den
ersten zu nehmen machte die Antwort von der Reihenfolge in der URL abhängig.

---

## SSR Architecture

```text
worker.ts
  └─ adminPage(db, config, request, now)          src/http/admin-page.ts
       ├─ requireRole(..., 'admin', 'html')       Auth-Grenze, unverändert
       ├─ readDay(request) ?? plusDays(businessDay(now), 1)
       ├─ getProductionDay(db, day)               Phase-3B-Service, direkt
       ├─ toProductionDayView(...)                src/ui/production-day-view.ts
       └─ renderAdminPage(view)                   src/ui/admin-page-html.ts
            ├─ renderProductionSummary(...)       src/ui/production-day-html.ts
            └─ renderOrderBreakdown(...)          src/ui/production-day-html.ts
```

**Der Application Service wird direkt aufgerufen.** Kein `fetch()` vom Worker
auf den eigenen API-Endpunkt: Ein HTTP-Loopback kostete einen zweiten
Roundtrip, müsste das Sitzungscookie weiterreichen, könnte an der
Origin-Prüfung scheitern und verwandelte einen Typfehler in einen
Laufzeitfehler. Die Architekturgrenze erlaubt den direkten Aufruf
ausdrücklich — `getProductionDay` kennt weder Request noch Response und ist
genau dafür gebaut.

**`GET /api/admin/production-day` bleibt unverändert bestehen.** Es ist die
maschinenlesbare Fassung derselben Frage und wird von Phase 3C weder
verändert noch abgelöst.

**Kein neues Template-Framework.** Kein Handlebars, kein JSX, kein
JSX-Runtime. Der bestehende Stil — reine Funktionen, die Template-Literale
zurückgeben — trägt diese Seite ohne Weiteres und ist der Grund, warum die
UI-Tests echtes HTML prüfen können statt einer Abstraktion darüber.

**Keine monolithische Render-Funktion.** Die Seite zerfällt in kleine,
benannte Funktionen mit je einer Verantwortung: Kopf, Datumsnavigation,
Kennzahlen, Produktionsliste, eine Produktzeile, Bestellliste, eine
Bestellkarte, Empty State. Jede ist rein und einzeln prüfbar. Ein
Komponentensystem mit Lebenszyklus und Zustand wäre für statisches HTML
Aufwand ohne Gegenwert.

**Null neue Runtime-Dependencies.** Keine Datumsbibliothek (es gibt
`clock.ts`), kein CSS-Framework (es gibt `app.css`), kein Chart-Paket (es gibt
keine Charts).

---

## Production Summary

Der dominierende Bereich. Semantisch eine **Tabelle**, weil die Daten eine
sind: zwei Spalten, gleichartige Zeilen, eine Kopfzeile, die beide benennt.
Eine Liste aus `<div>` müsste dieselbe Struktur mit ARIA nachbauen.

```text
PRODUKTION

Beispiel Käsekuchen                    11 Stück
Beispiel Carrot Cake                    8 Stück
Beispiel Schokoladentarte               5 Stück
```

- **Menge groß und rechtsbündig**, `tabular-nums`, Einheit kleiner daneben
- **Die Einheit kommt aus dem Snapshot** (`product_unit_snapshot`). Wenn dort
  „Blech" steht, steht auf der Seite „3 Blech" und nicht „3 Stück". Eine
  künstliche Vereinheitlichung wäre eine Falschaussage über die Produktion.
- **Kein Preis. Keine Beschreibung. Keine ID.** Das Lesemodell führt keine
  Preise; es gibt hier nichts zu unterdrücken, was existierte.
- **Die Reihenfolge kommt aus Phase 3B** (`sortOrder`, dann Name, dann ID,
  dann Einheit) und wird in der UI nicht noch einmal sortiert. Zwei
  Sortierungen wären zwei Meinungen darüber, wie das Sortiment geordnet ist.

Auf schmalen Geräten bleibt es dieselbe Tabelle: Zwei Spalten passen auf
375px, wenn die linke umbrechen darf. **Kein horizontales Scrollen, kein
geschrumpfter Desktop-Tabellenkörper.**

---

## Orders Breakdown

Darunter, deutlich leiser: die Herleitung.

```text
BESTELLUNGEN

┌──────────────────────────────────────┐
│ Testcafé Nord                        │
│ BUS-2026-000123                      │
│ Bestätigt · Lieferung                │
│                                      │
│ 3 × Beispiel Käsekuchen              │
│ 2 × Beispiel Carrot Cake             │
│                                      │
│ Hinweis                              │
│ Bitte vor 10 Uhr anliefern           │
└──────────────────────────────────────┘
```

Je Bestellung als eigene Sektion (Karte), nicht als Tabellenzeile: Die Daten
sind ungleichartig (ein Name, eine Nummer, zwei Merkmale, n Positionen, eine
optionale Notiz) und eine Notiz mit zwei Sätzen sprengt jede Tabellenzelle.

**Sichtbar:** Kundenname (Snapshot), Bestellnummer, Status, Fulfillment,
Positionen mit Mengen, Notiz falls vorhanden.

**Visuell untergeordnet:** kleinere Schrift, ruhigere Fläche, weniger
Kontrast als die Produktionsliste. Die Karten dürfen die Summe nicht
überstimmen.

**Status als Text, nicht nur als Farbe.** „Bestätigt" steht ausgeschrieben da.
Ein Farbpunkt allein wäre für einen Teil der Nutzenden keine Information —
dieselbe Regel, die `app.css` bei der ausgewählten Produktzeile bereits
anwendet.

Deutsche Labels kommen aus den **vorhandenen** Funktionen
`orderStatusLabel()` und `fulfillmentLabel()`. Eine zweite Übersetzungstabelle
in der UI wäre eine zweite Stelle, die irgendwann abweicht.

`completed` und `cancelled` können hier nicht auftauchen — das Lesemodell
filtert sie über `OPEN_PRODUCTION_STATUSES`. Sollten sie es doch, wäre das ein
Datenfehler und kein Anzeigefehler; die UI versteckt sie deshalb **nicht**,
sondern zeigt sie mit ihrem korrekten Label. Ein Test hält fest, dass das
Read Model sie nicht liefert.

---

## Snapshot Edge Case

Phase 3B fasst zwei Positionen **nicht** zusammen, wenn dieselbe `productId`
mit unterschiedlichen Namens- oder Einheits-Snapshots am selben Tag vorkommt.
Der Aggregationsschlüssel ist das Tripel (ID, Name, Einheit). Das ist richtig:
Eine Summe über „8 Blech" und „3 Stück" wäre eine Zahl ohne Bedeutung, und
einen von zwei Namen zu wählen benennte eine historische Bestellung
stillschweigend um.

Für die Backstube sieht das ohne Erklärung aus wie ein Fehler — zweimal
scheinbar dasselbe Produkt.

**Lösung:** Beide Zeilen bleiben stehen und die abweichende wird dezent
gekennzeichnet:

```text
Beispiel Käsekuchen                    11 Stück
Klassischer Käsekuchen                  3 Stück
  Abweichende Bezeichnung aus einer Bestellung
```

- Der Hinweis erscheint **nur**, wenn dieselbe `productId` im selben Tag
  mehrfach vorkommt — nicht bei zwei verschiedenen Produkten mit zufällig
  gleichem Namen.
- Die **erste** Zeile jeder betroffenen Gruppe (in der von 3B bestimmten
  Reihenfolge) bleibt unmarkiert; markiert werden die abweichenden.
- **Keine Produkt-ID auf dem Bildschirm.** Sie hätte für die Backstube keinen
  Nutzen und wäre eine interne Kennung ohne UI-Zweck.
- Der Hinweis ist mit `aria-describedby` an die Zeile gebunden, damit ein
  Screenreader ihn im Zusammenhang liest.
- **Snapshot-Namen werden niemals durch aktuelle Produktnamen ersetzt.** Das
  Lesemodell liefert gar keine — die UI könnte es nicht, selbst wenn sie
  wollte.

---

## Empty State

Ein Tag ohne offene Bestellungen ist ein **normaler Betriebszustand**, kein
Fehler. Ein Montag im Januar sieht so aus.

```text
Für diesen Tag sind keine offenen Bestellungen vorhanden.
```

- HTTP **200**, nicht 404. Die Frage wurde beantwortet; die Antwort ist „nichts".
- Kein Warnzeichen, keine rote Fläche, keine Illustration, keine Animation.
- **Die Datumsnavigation bleibt vollständig funktionsfähig** — sie ist genau
  jetzt das, was gebraucht wird, um zum nächsten Tag zu kommen.
- Die Kennzahlen zeigen ehrlich `0 Bestellungen · 0 Einheiten`.
- Der Bestellungsbereich wird gar nicht erst gerendert; eine leere Überschrift
  „Bestellungen" über nichts wäre eine Frage ohne Antwort.

---

## Error State

Wenn D1 nicht antwortet oder die Abfrage scheitert, greift die **bestehende**
Fehlergrenze in `src/worker.ts` → `toSafeResponse(error)`. Phase 3C baut keine
zweite.

Der Admin sieht eine verständliche deutsche Seite:

> Die Produktionsdaten konnten gerade nicht geladen werden.

**Was er niemals sieht:** SQL, `D1_ERROR`, Stacktrace, Bindingname, Dateipfad,
Tabellenname. Die Fehlergrenze aus Phase 2 stellt das bereits sicher und wird
nicht gelockert.

### Ungültiges Datum

Ein `?date=` das kein existierender Kalendertag ist (`2026-02-30`,
`gestern`, `<script>`) wird **kontrolliert** behandelt:

- **400** mit einer lesbaren deutschen Seite
- ein Weg zurück auf `/admin` (den Standardtag)
- **kein stilles Zurückfallen** auf den Standardtag: Ein Lesezeichen mit einem
  Tippfehler zeigte sonst eine korrekt aussehende Liste für einen anderen Tag,
  ohne es zu sagen. Das ist die gefährlichere Variante.
- **Der Wert wird nicht zurückgespiegelt.** Die Seite wiederholt die
  fehlerhafte Eingabe nicht — das wäre der Weg, über den ein `<script>` aus
  der Adresszeile ins Dokument käme. (Die zentrale Escape-Funktion würde ihn
  ohnehin entschärfen; ihn gar nicht erst aufzunehmen ist die Schicht davor.)

Die Prüfung ist `isCalendarDay()` aus `src/domain/clock.ts` — dieselbe
Funktion, die `production-api.ts` und `FulfillmentDate` benutzen. Es gibt im
System genau eine Stelle, die weiß, ob es einen Tag gibt.

---

## Security

Phase 3C fügt **keine** Sicherheitsmechanik hinzu und schwächt **keine** ab.

| Schicht | Herkunft | Änderung durch 3C |
| --- | --- | --- |
| Rollenprüfung | `requireRole(..., 'admin', 'html')` | keine |
| Sitzungsmodell | Phase 3A | keine |
| Credential/KDF | Phase 3A | keine |
| CSRF/Origin | Phase 3A | keine — `/admin` ist ein GET und verändert nichts |
| `Cache-Control: no-store` | `privateHeaders()` | keine |
| CSP `default-src 'none'` | `APP_CSP` | keine |
| `frame-ancestors 'none'` | `APP_CSP` | keine |
| `x-content-type-options` | `privateHeaders()` | keine |
| `referrer-policy: same-origin` | `privateHeaders()` | keine |
| `x-robots-tag: noindex` | `privateHeaders()` | keine |

Die Seite liefert weiterhin `pageHeaders()`.

**Kein JavaScript auf dieser Seite.** Kein `<script>`-Tag, kein Inline-Skript.
Das ist nicht nur CSP-konform, es macht die CSP-Frage gegenstandslos.

### Was nicht gerendert wird

**Finanzdaten** — `unit_price_cents`, `line_total_cents`,
`total_amount_cents`, Gastro-/Privatpreis, Kosten, Marge, Wareneinsatz. Das
Lesemodell führt sie nicht; die Ansicht ist finanzfrei **durch Bauart**, nicht
durch Sorgfalt beim Rendern. Tests halten das fest.

**Personendaten über den Namen hinaus** — keine E-Mail, keine Telefonnummer,
keine Lieferadresse, kein Ansprechpartner. Die Phase-3B-Abfrage berührt die
Tabelle `customers` nicht.

**Authentifizierungsdaten** — kein Sitzungstoken (er ist HttpOnly und für die
Seite unsichtbar), keine Account-ID, keine Credential-ID, kein Salt, kein
Verifier, kein Pepper.

**Interne Kennungen** — keine Bestell-ID, keine Kunden-ID, keine Positions-ID,
keine Produkt-ID, kein `sortOrder`.

Der **CSRF-Token** steht weiterhin im Abmeldeformular. Das ist kein
Widerspruch: Er ist der Synchronizer-Token, er muss dort stehen, damit die
Abmeldung ohne JavaScript funktioniert, und ohne das Cookie ist er wertlos.

---

## Escaping

**Genau eine Escape-Funktion:** `escapeHtml()` aus `src/ui/format.ts`. Sie
existiert seit Phase 2, ersetzt `& < > " '` in einem einzigen Durchlauf und
wird nicht kopiert, nicht neu geschrieben und nicht variiert. Mehrere leicht
unterschiedliche Fassungen wären mehrere Gelegenheiten, dass eine davon `'`
vergisst.

Jeder dynamische String läuft hindurch, ohne Ausnahme:

| Wert | Herkunft | Risiko |
| --- | --- | --- |
| `customerName` | Snapshot aus der Bestellung | Stammdaten, änderbar |
| `productName` | Snapshot aus der Bestellung | Stammdaten, änderbar |
| `productUnit` | Snapshot aus der Bestellung | Stammdaten, änderbar |
| `note` | **freie Kundeneingabe** | das eigentliche Ziel |
| `orderNumber` | serverseitig erzeugt | trotzdem escaped |
| Status-/Fulfillment-Label | Code-Konstante | trotzdem escaped |
| `loginIdentifier` | Kontodaten | trotzdem escaped |
| Datumswerte in Attributen | geprüft via `isCalendarDay` | trotzdem escaped |

Auch die unverdächtigen Werte laufen hindurch. Eine Ausnahme „das ist doch nur
eine Konstante" wäre die Stelle, an der später jemand eine Variable einsetzt.

**Kein `innerHTML`, kein `dangerouslySetInnerHTML`, kein DOM.** Die Seite
entsteht vollständig serverseitig als Zeichenkette.

Attributwerte stehen ausnahmslos in **doppelten** Anführungszeichen, und
`escapeHtml` ersetzt `"` — ein Ausbruch aus einem Attribut ist damit
geschlossen.

Geprüft wird gegen `<script>`, `<img onerror>`, `"`, `'`, `&` und
HTML-Entities, und zwar am **tatsächlich ausgelieferten HTML**, nicht an einer
Hilfsfunktion.

---

## Accessibility

- **Genau ein `<h1>`:** „Produktion" mit dem Tag. Die Kennzahlen, die
  Produktionsliste und die Bestellungen sind `<h2>`; jede Bestellkarte trägt
  ein `<h3>` mit dem Kundennamen. Keine Ebene wird übersprungen.
- **Semantik nach Datenform:** Die Produktionsliste ist eine `<table>` mit
  `<caption>` und `<th scope="col">`. Die Bestellungen sind `<section>`, die
  Positionen darin eine `<ul>`.
- **Datumsnavigation ist bedienbar ohne Zeigegerät:** zwei echte `<a>` (nicht
  `<div onclick>`) und ein `<form method="get">` mit `<input type="date">` und
  einem echten `<label for>`.
- **Zugängliche Namen:** „← Vorheriger Tag" / „Nächster Tag →" tragen den
  konkreten Zieltag im `aria-label` („Vorheriger Tag, Montag, 25. August
  2026"). „Zurück" allein sagt in einem Screenreader nichts.
- **Sichtbare Fokusanzeige:** die bestehende `:focus-visible`-Regel
  (3px, `--blau-hell`, 2px Versatz) gilt unverändert.
- **Tippflächen ≥ 44px:** über das vorhandene `--tap: 46px` (48px ab 600px).
  Das Projekt hat damit einen strengeren Maßstab als die WCAG-Untergrenze und
  unterschreitet ihn hier nicht.
- **Mengen screenreader-freundlich:** „11 Stück" steht als zusammenhängender
  Text in einer Zelle. Zahl und Einheit in getrennten Elementen ohne
  Zusammenhang würden als „elf" … „Stück" mit Pause dazwischen gelesen.
- **Status nie nur über Farbe** — das Label steht ausgeschrieben da.
- **Kontrast:** die vorhandenen Tokens. `--text` auf `--porzellan` und
  `--elfenbein` auf `--navy` sind aus der bestehenden Oberfläche übernommen.
- **`lang="de"`** am `<html>`, wie auf allen Seiten.
- **Kein Zoom-Verbot.** `viewport` bleibt `width=device-width,
  initial-scale=1` — kein `user-scalable=no`, kein `maximum-scale`.
  Eingabefelder behalten ≥16px Schriftgröße, damit iOS nicht selbst zoomt.
- **Keine überflüssigen ARIA-Konstruktionen.** Kein `role="table"` auf einer
  Tabelle, kein `role="button"` auf einem Button. Natives HTML zuerst; ARIA
  nur, wo es etwas hinzufügt (`aria-label` an den Pfeilen,
  `aria-describedby` am Snapshot-Hinweis).

---

## Responsive Design

**Mobile First.** Die Grundgestaltung gilt für 375px; breitere Geräte
bekommen mehr Luft, kein zweites Layout.

| Breite | Verhalten |
| --- | --- |
| 375px | eine Spalte, Produktname umbricht, Menge bleibt rechts; Pfeile und Datumsfeld untereinander |
| 390px | wie 375px, größerer Seitenrand (`--rand: 1.15rem`) |
| 430px | wie 390px |
| 768px | Datumsnavigation in einer Zeile, `--tap: 48px` |
| ≥ 780px | Inhalt in einer begrenzten Spalte, zentriert über `padding-inline` |

- **Kein horizontales Scrollen auf irgendeiner Breite.** `body, main {
  overflow-x: hidden }` ist vorhanden; die Gestaltung verlässt sich nicht
  darauf, sondern lässt lange Namen über `overflow-wrap: anywhere` umbrechen.
- **Die Menge wird nie abgeschnitten.** Die Mengenspalte hat eine feste
  Mindestbreite; die Namensspalte gibt nach.
- **Desktop wird begrenzt.** Dieselbe `44rem`-Spalte wie die Bestellseite —
  eine 1600px breite Datenwüste ist auf Papier wie auf dem Bildschirm
  schwerer zu lesen als eine Spalte.
- **Keine Sidebar.** Es gibt genau eine Adminfunktion; eine Navigation mit
  „Dashboard / Orders / Customers / Products / Analytics / Settings" wäre
  Attrappe. YAGNI.
- **Kein `position: fixed`-Balken.** Die Admin-Seite hat keine Fußleiste; der
  `padding-bottom`, den die Bestellseite dafür braucht, wird
  zurückgenommen — wie es die Anmeldeseite mit `.anmeldeseite` bereits tut.

---

## Visual Direction

Dieselbe Marke, dieselben Tokens, dasselbe Werkzeugverständnis wie Login und
Bestellseite. **Es entsteht kein zweites Buschmann-Designsystem.**

Verwendet werden ausschließlich die vorhandenen Werte: `--navy` für den Kopf,
`--porzellan` als Grund, `--champagner` als Akzent, `--leinen` für Linien,
`--radius: 10px`, `--serif` (Georgia) für Datum und Überschrift, `--sans`
(system-ui) für alles andere. **Keine Webfonts, keine externen Ressourcen,
kein CDN, kein Icon-Paket, kein Third-Party-Request** — die CSP mit
`default-src 'none'` ließe sie ohnehin nicht zu.

Gewollt: hochwertig, ruhig, handwerklich, präzise, warm.
Nicht gewollt: Bootstrap-Admin, Gradient-Karten, Glassmorphism, Neon,
zwanzig Statusfarben, Dribbble.

Die Backstube braucht Klarheit. Der Bildschirm hängt neben einem Ofen und wird
mit mehligen Händen bedient.

---

## Performance

- **Ein Roundtrip.** HTML kommt fertig; die Seite lädt nichts nach.
- **Zwei D1-Abfragen** — genau die aus Phase 3B, unverändert. Phase 3C fügt
  **keine** hinzu und schreibt **keinen** neuen Datenbankcode.
- **Kein JavaScript.** Kein `<script>`, keine Hydration, kein Framework.
- **Null neue Runtime-Dependencies.** Erwartung und Ergebnis.
- Das CSS wächst um einen begrenzten Abschnitt in der bestehenden `app.css`,
  ohne die Regeln der Marketing-Website oder der Bestellseite zu berühren.

---

## Testing

Alle Tests laufen gegen das **tatsächlich ausgelieferte HTML** über
`worker.fetch()` — nicht gegen Hilfsfunktionen. Ein Test auf einem
Implementierungsdetail bliebe grün, während die Seite kaputt ist.

**Zugriff und Transport (1–3, 26–28):** Admin sieht die Seite; ein Café
bekommt 403; ohne Sitzung 303 auf `/login`; `no-store`; Content-Type;
CSP/Security-Header vollständig vorhanden.

**Datum (4–6):** ohne `date` der Standardtag; explizites Datum wird verwendet;
ungültiges Datum → 400 mit lesbarer Meldung.

**Inhalt (7–20):** Produkte dargestellt; Mengen exakt; Einheit aus dem
Snapshot; `orderCount`; `totalUnits`; Bestellungen; Kundenname;
Bestellnummer; Status auf Deutsch; Lieferung; Abholung; Positionen je
Bestellung; Notiz vorhanden → sichtbar; Notiz leer/null → **kein** leerer
Notizblock im HTML.

**Empty State (21):** ein Tag ohne Bestellungen zeigt den verständlichen Satz,
Status 200, Navigation intakt.

**Datensparsamkeit (22–25):** keine Preise, keine E-Mail, keine Authdaten,
kein Sitzungstoken im Dokument.

**Escaping (29–33):** Kundenname mit HTML; Produktname mit HTML; Notiz mit
`<script>`; Notiz mit `<img onerror>`; `&` und Anführungszeichen — jeweils
geprüft am ausgelieferten HTML.

**Navigation (34–41):** vorheriger Tag; nächster Tag; Monatswechsel;
Jahreswechsel; Schaltjahr (2028-02-28 → 2028-02-29 → 2028-03-01); das
Datumsformular erzeugt eine sichere interne URL; kein Open Redirect
(`?date=//evil.test` ist kein Kalendertag → 400); Kernnavigation ohne
JavaScript.

**Snapshot (42–45):** zwei verschiedene Produkt-IDs mit gleichem Namen bleiben
korrekt und **unmarkiert**; gleiche ID mit verschiedenen Snapshot-Namen bleibt
getrennt; dieser Fall wird sichtbar gekennzeichnet; Snapshot-Namen werden
nicht durch aktuelle Produktnamen ersetzt (Umbenennung in `products` ändert
die Ansicht nicht).

**Regression:** Die vollständige bestehende Suite bleibt grün — Café-Login,
Admin-Login, Bestellseite, Bestellanlage, serverseitige Preisbildung,
Idempotency, CSRF, Sessions, Production-Day-API, Aggregation,
Kundentrennung.

**Mutationsprüfung:** Vier gezielte Eingriffe müssen je einen Test rot machen
— Rollenprüfung entfernt, Notiz-Escaping entfernt, Preis gerendert,
Empty-State-Bedingung gebrochen. Ein Test, der eine entfernte Prüfung nicht
bemerkt, prüft nichts.

**Browser:** 375 / 390 / 430 / 768 / Desktop, mit langen Namen, langer Notiz,
null Bestellungen, mehreren Bestellungen, vielen Produkten;
Tastaturbedienung und Fokussichtbarkeit.

---

## Non-Goals

Phase 3C baut **nicht**:

Status ändern · Bestellung bearbeiten · Bestellung löschen · Produkt
bearbeiten · Kunde bearbeiten · Preise bearbeiten · Umsatz · Kosten · Marge ·
Wareneinsatz · Ausgaben · Rechnungen · CSV · PDF · E-Mail · Push ·
Benachrichtigungen · Charts · Analytics · Lieferrouten · Fahrerplanung ·
Sidebar-Navigation · Dashboard-Startseite · Mehrtagesansicht · Wochenansicht ·
Drucklayout · Suche · Filter · Sortierumschaltung · Dark Mode.

Ebenfalls nicht:

- keine Änderung an der Marketing-Website
- keine Änderung an Phase-3B-Datenlogik oder -API
- keine Änderung an Phase-3A-Auth, Sessions, CSRF oder KDF
- keine Migration
- kein Zugriff auf `order-system/source-data/`
- kein Deployment, kein Push, kein Merge

---

## Definition of Done

- [ ] `/admin` zeigt einem Admin sofort den Produktionstag
- [ ] Ohne `date` erscheint der nächste Kalendertag
- [ ] `?date=` wird verwendet, ist lesezeichen- und reload-fest
- [ ] Ungültiges `date` → 400 mit lesbarer Meldung, ohne Rückspiegelung
- [ ] Vorheriger/nächster Tag funktionieren über echte Links
- [ ] Datumsfeld funktioniert als `<form method="get">`
- [ ] Kernbedienung funktioniert **ohne JavaScript**
- [ ] Produktionsmengen sind visuell dominant
- [ ] Einheit stammt aus dem Snapshot
- [ ] Kennzahlen zeigen Bestellungen und Einheiten
- [ ] Bestellungen zeigen Name, Nummer, Status, Fulfillment, Positionen
- [ ] Notiz sichtbar wenn vorhanden, **kein** leerer Block wenn nicht
- [ ] Leerer Tag zeigt verständlichen Empty State bei Status 200
- [ ] Snapshot-Umbenennungsfall ist getrennt und verständlich gekennzeichnet
- [ ] Keine Preise, keine Kosten, keine Marge im HTML
- [ ] Keine E-Mail, keine Telefonnummer, keine Adresse im HTML
- [ ] Keine Authdaten, kein Sitzungstoken im HTML
- [ ] Jeder dynamische Wert läuft durch `escapeHtml()`
- [ ] Ein Café bekommt 403, ohne abgemeldet zu werden
- [ ] `Cache-Control: no-store`
- [ ] CSP, Referrer-Policy, nosniff, frame-ancestors unverändert vorhanden
- [ ] Kein horizontales Scrollen auf 375 / 390 / 430 / 768 / Desktop
- [ ] Tippflächen ≥ 44px, Fokus sichtbar, Tastatur vollständig
- [ ] Genau ein `<h1>`, saubere Überschriftenhierarchie
- [ ] Null neue Runtime-Dependencies
- [ ] Phase 3B, 3A und 2 unverändert und grün
- [ ] Vollständige Suite grün, Typecheck grün, D1-Integration grün
- [ ] Vier Mutationsprüfungen wirksam und zurückgesetzt
- [ ] Marketing-Website unverändert
- [ ] Keine Preislisten-PDFs committed
- [ ] Kein Deployment, kein Push, kein Merge
