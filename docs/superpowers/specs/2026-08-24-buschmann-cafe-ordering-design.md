# Buschmann 1846 — Café-Bestellung (Phase 2): Design-Spezifikation

**Datum:** 2026-08-24
**Branch:** `feature/order-system-cafe-ordering`
**Status:** verbindliche Entwurfsgrundlage für Phase 2
**Baut auf:** `docs/superpowers/specs/2026-08-24-buschmann-order-system-cloudflare-design.md`
**Gilt für:** `order-system/` — nicht für die bestehende Buschmann-Website

---

## 1. Problem

Buschmanns Stammcafés bestellen heute per WhatsApp. Das funktioniert, hat aber
drei Kosten, die alle beim Betrieb landen:

1. **Die Bestellung ist unstrukturiert.** „Wie letzte Woche, aber zwei Bleche
   mehr" muss von einem Menschen gelesen, gedeutet und übertragen werden.
2. **Es gibt keinen Preis zum Bestellzeitpunkt.** Was berechnet wird, entsteht
   später aus Erinnerung und Stammdaten.
3. **Es gibt keine belastbare Tagesliste.** „Was ist für Freitag zu
   produzieren?" ist eine Suche durch Chatverläufe.

Phase 1 hat die Fachlichkeit dafür gebaut — Kunde, Produkt, Bestellung,
Preis-Snapshot, Bestellnummer, atomares Speichern — aber ohne jede
Oberfläche. Ein Café kann derzeit nicht bestellen.

**Phase 2 schließt genau diese Lücke und nur diese.**

---

## 2. Zielgruppe

Ausschließlich die **regelmäßigen Geschäftskunden (Cafés)**.

Nicht Privatkunden. Nicht Laufkundschaft. Nicht das Backoffice.

Ein typischer Nutzer:

* bestellt wöchentlich bis mehrmals wöchentlich
* kennt das Sortiment auswendig
* bedient ein Smartphone, oft im Betrieb, oft einhändig, oft in Eile
* hat kein Interesse an einem Konto, einem Passwort oder einem Warenkorb

---

## 3. UX-Ziel

> Die Bestellung muss für ein Stammcafé subjektiv schneller und einfacher sein
> als eine WhatsApp-Nachricht.

Operationalisiert:

| Größe | Zielwert |
|---|---|
| Zeit für eine typische Bestellung (bekannter Kunde) | 20–30 s |
| Notwendige Aktionen (Taps) bei 3 Produkten | ≤ 6 |
| Pflichteingaben mit Tastatur | 0 |
| Bildschirme / Schritte | 1 |
| Anmeldevorgänge | 0 |

Jede Anforderung in diesem Dokument, die diesem Ziel widerspricht, ist ein
Fehler in diesem Dokument.

---

## 4. Flow

```text
Persönlichen Link öffnen        GET /o/<token>
        │                        Server erkennt Café, rendert Seite fertig
        ▼
Café und Sortiment sofort sichtbar
        │
        ▼
Mengen mit − / + einstellen      rein clientseitig, kein Netzverkehr
        │
        ▼
Lieferdatum                      vorbelegt auf morgen (Europe/Berlin)
        │
        ▼
Notiz (optional)
        │
        ▼
„Bestellung senden"              POST /api/orders  (Token im Header)
        │
        ▼
Bestätigung im selben Bildschirm  Bestellnummer · Liefertag · Positionen
```

Es gibt keinen Warenkorb, keinen Checkout, keine Zwischenseite und keine
Weiterleitung. Die Bestätigung ersetzt das Formular an Ort und Stelle.

---

## 5. Access-Token-Modell

### 5.1 Form

Jedes Café erhält einen langlebigen, persönlichen Link:

```text
https://bestellen.buschmann1846.de/o/8mQ2r7Kx…   (43 Zeichen)
```

* **32 Byte** aus `crypto.getRandomValues` → **256 Bit Entropie**
* kodiert als **base64url** (`[A-Za-z0-9_-]`), 43 Zeichen, kein Padding
* **nicht** aus Caféname, ID, laufender Nummer, E-Mail oder Telefonnummer
  ableitbar — der Wert enthält keinerlei Kundenbezug
* nicht sequenziell, nicht erratbar, nicht aufzählbar

Akzeptiertes Eingabeformat serverseitig: `/^[A-Za-z0-9_-]{32,64}$/`. Die
Spanne statt der exakten 43 ist Absicht: Eine spätere Verlängerung des Tokens
soll keine Codeänderung an der Prüfung erzwingen.

### 5.2 Speicherung — nur der Hash

In D1 liegt **niemals der Klartext-Token**, sondern ausschließlich
`sha256(token)` als 64 Zeichen Hex.

```text
Client besitzt:      8mQ2r7Kx…            (Klartext, nur im Link)
Datenbank besitzt:   a3f1…c92              (SHA-256, hex)
Anfrage:  Token → SHA-256 → Nachschlagen über UNIQUE-Index
```

**Warum SHA-256 und kein PBKDF2/Argon2/bcrypt:**

Ein langsamer KDF schützt *schwache* Geheimnisse gegen Offline-Raten. Dieses
Geheimnis ist 256 Bit gleichverteilter Zufall — Raten ist unabhängig von der
Hashgeschwindigkeit unmöglich. Ein KDF brächte hier keinen Sicherheitsgewinn,
kostete aber bei jedem Seitenaufruf Rechenzeit.

**Warum ohne Salt:**

Ein Salt verhindert Rainbow-Tables gegen *ratbare* Werte. Gegen 2²⁵⁶ gibt es
keine Tabelle. Ein Salt pro Zeile würde außerdem die Suche über den
UNIQUE-Index unmöglich machen und jede Anfrage zu einem Tabellenscan mit
Hashberechnung pro Zeile machen — schlechter in jeder Hinsicht.

**Warum kein konstantzeitiger Vergleich:**

Der Vergleich findet im B-Tree-Index von SQLite über einen Hashwert statt.
Ein Timing-Orakel müsste dem Angreifer erlauben, den Token *zeichenweise* zu
erraten; das setzt voraus, dass er den zugehörigen Hash-Präfix kennt, wozu er
den Token bereits bräuchte. Der Angriff schließt sich selbst aus.

### 5.3 Lebenszyklus

| Vorgang | Umsetzung |
|---|---|
| Ausstellen | `scripts/issue-access-token.mjs` erzeugt Token + Hash, gibt den Klartext **genau einmal** aus |
| Prüfen | Hash nachschlagen; Token muss `is_active = 1` sein UND der Kunde muss `is_active = 1` sein |
| Deaktivieren | `UPDATE customer_access_tokens SET is_active = 0, revoked_at = …` |
| Rotieren | neuen Token ausstellen, alten deaktivieren — beide Zeilen bleiben erhalten |
| Mehrere Links je Café | erlaubt (mehrere aktive Zeilen je `customer_id`) |

Der Klartext ist nach dem Ausstellen nicht rekonstruierbar. Geht er verloren,
wird ein neuer ausgestellt.

---

## 6. Threat Model für den persönlichen Link

Der Link ist ein **Capability Link**: Wer ihn vollständig besitzt, darf für
dieses Café bestellen. Das ist eine bewusste Entscheidung gegen ein Passwort
und für das UX-Ziel aus Abschnitt 3.

| # | Bedrohung | Bewertung | Maßnahme |
|---|---|---|---|
| 1 | **Erraten / Aufzählen** | ausgeschlossen | 256 Bit Entropie; kein Aufzählungspfad, weil es keine öffentliche Kunden-ID gibt |
| 2 | **Referer-Leak an Dritte** | real | `Referrer-Policy: no-referrer`; **null** Drittanbieter-Ressourcen auf der Seite (keine Fonts, keine Bilder, keine Analytics, keine externen Links) |
| 3 | **Weitergabe des Links** (Screenshot, Chat, Ausdruck) | real, nicht technisch lösbar | Link ist widerrufbar; Schaden begrenzt auf „bestellt Kuchen auf Rechnung dieses Cafés" — keine Zahlungsdaten, keine Personendaten, keine Änderung von Stammdaten |
| 4 | **Token in Server-Logs** | real, **Restrisiko** | Der eigene Code protokolliert nichts. Cloudflare protokolliert jedoch Anfrage-URLs. Siehe 6.1 |
| 5 | **Token im Browserverlauf / in der Adressleiste** | real | inhärent an Capability Links; siehe 6.1 |
| 6 | **CSRF** | ausgeschlossen | Authentifizierung über **Header** `X-Order-Token`, nicht über Cookie. Es gibt keine ambiente Autorität; ein fremdes Formular kann keinen benutzerdefinierten Header setzen, und ein Cross-Origin-`fetch` scheitert am Preflight (es werden keine CORS-Header gesendet) |
| 7 | **XSS** | adressiert | strikte CSP (`default-src 'none'`), serverseitiges HTML-Escaping aller Kundendaten, clientseitig ausschließlich `textContent`, kein `innerHTML` |
| 8 | **Clickjacking** | adressiert | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| 9 | **Preismanipulation** | ausgeschlossen | siehe Abschnitt 10 |
| 10 | **Bestellen für ein fremdes Café** | ausgeschlossen | Customer stammt **ausschließlich** aus dem Token-Kontext; ein `customer_id` im Anfragekörper wird nie gelesen |
| 11 | **Doppelte Bestellung** | adressiert | serverseitige Idempotenz, siehe Abschnitt 13 |
| 12 | **Öffentliches Caching privater Antworten** | adressiert | `Cache-Control: no-store` auf allen tokenbezogenen Antworten |
| 13 | **Erschöpfungsangriff auf die Bestellnummer** | Restrisiko | nur mit gültigem Token möglich; Nummernkreis 999.999/Jahr; kein Rate-Limit in Phase 2 |

### 6.1 Bewusst verworfene Alternative: Token im URL-Fragment

`/o/#<token>` würde den Token **niemals** an einen Server senden — weder an
Cloudflare-Logs noch als Referer. Er wurde geprüft und verworfen:

* Die Seite könnte dann nicht mehr serverseitig gerendert werden. Café und
  Sortiment kämen erst nach einem zweiten Roundtrip — gegen Abschnitt 3.
* Der Token stünde weiterhin im Browserverlauf und in Lesezeichen; der
  Gewinn beträfe nur serverseitige Logs.
* Die Anforderung nennt ausdrücklich die Pfadform `/o/<token>`.

**Restrisiko bleibt bestehen und ist dokumentiert:** Wer Zugriff auf die
Cloudflare-Logs des Workers hat, sieht vollständige Bestell-Links. Vor einem
produktiven Betrieb ist entweder `observability` für diesen Worker zu
deaktivieren oder der Zugriff auf das Cloudflare-Konto entsprechend zu
beschränken. Das ist eine Betriebs-, keine Codeentscheidung.

---

## 7. Datenmodell-Erweiterung

Zwei Migrationen. Keine bestehende Spalte ändert ihre Bedeutung.

### 7.1 `0006_create_customer_access_tokens.sql`

```sql
CREATE TABLE customer_access_tokens (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    token_hash  TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    revoked_at  TEXT,

    CONSTRAINT uq_cat_token_hash UNIQUE (token_hash),
    CONSTRAINT chk_cat_hash_form CHECK (
        length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT chk_cat_is_active_boolean CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_cat_revoked_consistent CHECK (is_active = 1 OR revoked_at IS NOT NULL),

    CONSTRAINT fk_cat_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_cat_customer ON customer_access_tokens (customer_id, is_active);
```

Bewusst **nicht** enthalten:

* `token` im Klartext — siehe 5.2
* `label` / `device_name` — niemand hat danach gefragt
* `last_used_at` — ein Schreibvorgang bei jedem Seitenaufruf für eine
  Information, die niemand auswertet
* `expires_at` — ein Stammcafé bestellt seit Jahren; ein Ablaufdatum wäre
  eine Störung ohne Nutzen. Widerruf ist der vorgesehene Weg.

`ON DELETE CASCADE` (im Unterschied zu `RESTRICT` bei `orders`): Ein Zugang
ohne Kunden ist ein Sicherheitsproblem, kein Dokument.

### 7.2 `0007_add_order_submission_id.sql`

```sql
ALTER TABLE orders ADD COLUMN submission_id TEXT;

CREATE UNIQUE INDEX uq_orders_submission
    ON orders (customer_id, submission_id)
    WHERE submission_id IS NOT NULL;
```

Ein **partieller** UNIQUE-Index: Bestellungen ohne Absendekennung (der
Phase-1-Pfad, spätere Backoffice-Erfassung) bleiben unbeschränkt, während je
Kunde und Absendevorgang höchstens eine Bestellung existieren kann. Die
Eindeutigkeit hängt damit an der Datenbank, nicht an Anwendungscode.

Die Spalte liegt auf `orders` und nicht in einer eigenen Tabelle, weil sie
dadurch **im selben INSERT** wie die Bestellung geschrieben wird. Eine eigene
Tabelle hätte einen zweiten Schreibvorgang und damit ein zweites Zeitfenster
bedeutet.

### 7.3 Keine Produktionsdaten

Phase 2 legt **keine** echte Café-Datenbank an. Es gibt ausschließlich
eindeutig fiktive Entwicklungsdaten (`seeds/002_cafe_ordering_dev.sql`):
`Testcafé Nord`, `Beispiel Käsekuchen` usw. Der dort enthaltene Token ist
ausdrücklich als Entwicklungswert gekennzeichnet und darf niemals produktiv
verwendet werden.

---

## 8. Catalog

### 8.1 Entscheidung: serverseitig gerendert statt eigener JSON-Endpunkt

Die Anforderung lautet: *„Ein autorisiertes Café soll sofort die bestellbaren
Produkte bekommen."* Der genannte Endpunkt `GET /api/order/catalog` ist
ausdrücklich als konzeptioneller Vorschlag markiert.

**Umgesetzt wird die Anforderung stärker als der Vorschlag:** Das Sortiment
wird direkt in die Seite `GET /o/<token>` gerendert. Ein Café hat die Produkte
nach **einem** Roundtrip auf dem Schirm, nicht nach zweien. Ein zusätzlicher
JSON-Endpunkt hätte in Phase 2 keinen Aufrufer, wäre aber zusätzliche
Angriffsfläche.

Die Projektion selbst existiert als eigenständige, direkt getestete Funktion
`toCatalogView(catalog)` in `src/application/catalog-view.ts` — sie ist damit
genauso prüfbar wie ein Endpunkt und kann in Phase 3 ohne Umbau exponiert
werden.

### 8.2 Projektion

Ausgeliefert wird je Produkt **ausschließlich**:

| Feld | Quelle |
|---|---|
| `id` | `products.id` |
| `name` | `products.name` |
| `description` | `products.description` (optional) |
| `priceCents` | `products.price_cents` |
| `unit` | `products.unit` |
| `sortOrder` | `products.sort_order` |

Es werden **nur aktive** Produkte projiziert (`ProductCatalog.orderable()`),
sortiert nach `sortOrder`, bei Gleichstand nach `id`.

**Niemals ausgeliefert:** `created_at`, `updated_at`, `is_active`, sowie
sämtliche Kundenfelder außer dem Namen — insbesondere nicht
`customers.internal_note`, `email`, `phone`, `contact_person` und nicht die
Adressbestandteile.

---

## 9. HTTP / API

| Methode | Pfad | Auth | Antwort |
|---|---|---|---|
| `GET` | `/api/health` | keine | JSON, unverändert aus Phase 1 |
| `GET` | `/o/<token>` | Token im Pfad | HTML (Bestellseite) bzw. HTML (ungültiger Link, 404) |
| `POST` | `/api/orders` | Header `X-Order-Token` | JSON |
| `GET` | `/assets/*` | keine | statisch über Workers Assets (CSS/JS, enthalten keine Kundendaten) |
| sonst | — | — | JSON `404` |

### 9.1 `GET /o/<token>`

| Fall | Status | Antwort |
|---|---|---|
| Token gültig, Kunde aktiv | `200` | Bestellseite |
| Token unbekannt | `404` | „Dieser Bestelllink ist nicht mehr gültig." |
| Token widerrufen | `404` | **exakt dieselbe** Seite |
| Kunde deaktiviert | `404` | **exakt dieselbe** Seite |
| Token formal ungültig | `404` | **exakt dieselbe** Seite |
| Methode ≠ GET | `405` | `Allow: GET` |

Die vier Ablehnungsfälle sind **nicht unterscheidbar** — weder im Status, noch
im Text, noch in der Antwortlänge. Es wird nicht preisgegeben, ob ein Café
existiert.

### 9.2 `POST /api/orders`

**Anfrage**

```http
POST /api/orders
Content-Type: application/json
X-Order-Token: 8mQ2r7Kx…

{
  "submission_id": "3f2b…",
  "fulfillment_date": "2026-08-25",
  "note": "Bitte an der Rückseite anliefern",
  "items": [
    { "product_id": 1, "quantity": 3 },
    { "product_id": 2, "quantity": 2 }
  ]
}
```

Der Körper enthält **keinen** `customer_id`, **keinen** `fulfillment_type`,
**keine** Preise und **keinen** Status. Wird eines dieser Felder trotzdem
gesendet, wird es nicht gelesen (siehe Abschnitt 10).

**Erfolgsantwort**

```jsonc
// 201 bei neu angelegter Bestellung, 200 bei idempotenter Wiederholung
{
  "order_number": "BUS-2026-000001",
  "fulfillment_date": "2026-08-25",
  "total_cents": 1865,
  "items": [
    { "name": "Beispiel Käsekuchen", "quantity": 3, "unit": "Stück" },
    { "name": "Beispiel Streuselblech", "quantity": 2, "unit": "Blech" }
  ]
}
```

Die Positionen stammen aus der **gespeicherten** Bestellung, nicht aus der
Anfrage. Die Bestätigung zeigt damit, was tatsächlich in der Datenbank steht.

**Fehlerantworten**

| Status | Körper | Auslöser |
|---|---|---|
| `400` | `{"error":"bad_request"}` | kein lesbares JSON, kein Objekt |
| `401` | `{"error":"unauthorized"}` | Token fehlt, formal ungültig, unbekannt, widerrufen, Kunde inaktiv |
| `405` | `{"error":"method_not_allowed"}` | Methode ≠ POST |
| `413` | `{"error":"payload_too_large"}` | Körper > 64 KiB |
| `415` | `{"error":"unsupported_media_type"}` | `Content-Type` nicht `application/json` |
| `422` | `{"error":"validation_failed","errors":{…}}` | fachliche Eingabefehler, feldweise |
| `500` | `{"error":"internal_error"}` | alles Übrige |

---

## 10. Client darf Preise niemals kontrollieren

Die Regel aus Phase 1 bleibt unverändert und wird nicht aufgeweicht.

```text
Anfrage  ──►  OrderDraft.fromInput()   liest NUR product_id + quantity
                     │                  (die Klasse hat kein Preisfeld)
                     ▼
              Order.place(customer, catalog, draft)
                     │
                     ▼
              OrderItem.forProduct(product, quantity)
                     │                  unitPrice := product.unitPrice  (aus D1)
                     ▼                  lineTotal := unitPrice × quantity
              Order.total()             Summe der Positionen
```

Ein mitgesendetes `unit_price_cents`, `line_total_cents`, `total_amount_cents`
oder `price` wird nicht verworfen, sondern **nie gelesen** — es gibt im
gesamten Pfad keine Stelle, die es lesen könnte. Das ist der Unterschied
zwischen einer Regel, die eingehalten werden soll, und einer, die nicht
gebrochen werden kann.

Gleiches gilt für `customer_id` (kommt aus dem Token), `fulfillment_type`
(kommt aus `customers.default_fulfillment`), `status` (immer `new`) und
`order_number` (aus der Sequenztabelle).

Ganzzahlige Cent und Preis-Snapshots bleiben in jedem Schritt erhalten.

---

## 11. Order Creation

Ablauf in `placeCafeOrder`:

```text
1. Token formal prüfen           → 401 bei Formfehler, ohne DB-Zugriff
2. sha256(token) nachschlagen    → Customer + Token-Zeile (ein JOIN)
                                   → 401 bei unbekannt/widerrufen/Kunde inaktiv
3. Idempotenz-Vorabprüfung       → SELECT auf (customer_id, submission_id)
                                   → Treffer: gespeicherte Bestellung, HTTP 200
4. Entwurf lesen                 → OrderDraft.fromInput(input, now)
                                   fulfillment_type wird ERSETZT durch
                                   customer.defaultFulfillment
                                   → 422 bei Eingabefehlern, ohne Nummernverbrauch
5. Katalog laden                 → loadCatalog(db)
6. Bestellnummer ziehen          → UPSERT … RETURNING
7. Order.place(...)              → rechnet mit Katalogpreisen
8. saveOrder(db, order, submissionId)  → EIN db.batch(): Order + alle Items
9. UNIQUE-Verletzung auf         → gespeicherte Bestellung nachladen, HTTP 200
   (customer_id, submission_id)
```

Schritt 4 liegt vor Schritt 6, damit ein Eingabefehler keine Bestellnummer
verbraucht. Schritt 3 liegt vor Schritt 6 aus demselben Grund.

**`fulfillment_type` (Abschnitt 13 der Anforderung):** Die Bestelloberfläche
fragt nicht „Lieferung oder Abholung?". Der Wert stammt aus
`customers.default_fulfillment`. Ein vom Client gesendeter Wert wird
überschrieben, nicht übernommen — sonst könnte ein Lieferkunde versehentlich
oder absichtlich eine Abholung erzeugen. Der Domänenkern unterstützt `pickup`
unverändert weiter.

---

## 12. Atomare Speicherung

Unverändert gegenüber Phase 1: **ein** `D1Database.batch()`. D1 führt einen
Batch in einer einzigen impliziten Transaktion aus; scheitert eine Anweisung,
wird keine wirksam.

Neu ist nur, dass `submission_id` als Spalte im **selben** `INSERT INTO orders`
mitgeschrieben wird. Es gibt damit keinen Zustand, in dem eine Bestellung ohne
ihre Absendekennung oder eine Absendekennung ohne ihre Bestellung existiert.

Nach erfolgreichem Schreiben gilt: Order existiert **und** alle OrderItems
existieren **und** die Absendekennung ist belegt — oder nichts davon.

---

## 13. Idempotency

**Das Problem:** Ein Daumen auf einem Smartphone tippt „Bestellung senden"
zweimal. Ohne Schutz entstehen zwei identische Bestellungen und Buschmann
backt doppelt.

**Die Lösung, dreifach gestaffelt:**

| Ebene | Maßnahme | Schützt gegen |
|---|---|---|
| Client | Button wird beim Absenden sofort `disabled` + `aria-busy` | den häufigsten Fall |
| Server (schnell) | `SELECT` auf `(customer_id, submission_id)` vor dem Anlegen | Wiederholung nach abgebrochener Verbindung |
| Datenbank | partieller UNIQUE-Index `(customer_id, submission_id)` | echte Gleichzeitigkeit |

**Woher kommt `submission_id`?**

Vom **Server**, beim Rendern der Seite (`crypto.randomUUID()`), eingebettet
als `data-submission-id` im Formular. Nicht vom Client — ein Client, der bei
jedem Klick eine neue Kennung erzeugte, wäre gegen Doppelklicks ungeschützt.
Nach einer erfolgreichen Bestellung führt „Neue Bestellung" zu einem
Neuladen der Seite und damit zu einer neuen Kennung.

**Verhalten bei Wiederholung:** Die bereits gespeicherte Bestellung wird
geladen und mit **HTTP 200** zurückgegeben (statt `201`). Der Nutzer sieht
dieselbe Bestätigung mit derselben Bestellnummer. Er erfährt nicht, dass er
doppelt getippt hat — er braucht es nicht zu wissen.

Serverseitige Prüfung der Kennung: `/^[A-Za-z0-9-]{8,64}$/`. Kein
Idempotency-Framework, kein KV, keine TTL-Verwaltung.

---

## 14. Validierung

| Feld | Regel | Ort |
|---|---|---|
| `submission_id` | vorhanden, `[A-Za-z0-9-]{8,64}` | HTTP-Grenze |
| `items` | Array, ≤ 200 Einträge, ≥ 1 Position mit Menge > 0 | `OrderDraft` |
| `items[].product_id` | ganze Zahl > 0, im Katalog, `is_active = 1` | `OrderDraft` / `Order.place` |
| `items[].quantity` | ganze Zahl ≥ 0, ≤ 9 999; **0 = nicht bestellt** (keine Position); negativ = Fehler | `OrderDraft` |
| doppelte `product_id` | Fehler | `OrderDraft` |
| `fulfillment_date` | `JJJJ-MM-TT`, echter Kalendertag, **nicht vor heute (Europe/Berlin)**, höchstens 365 Tage in der Zukunft | `FulfillmentDate` / `placeCafeOrder` |
| `note` | optional, getrimmt, ≤ 500 Zeichen, reiner Text | `OrderDraft` / `Order` |
| Kunde | aktiv | `Order.place` |

**Der 365-Tage-Horizont** ist neu in Phase 2 und ausdrücklich **keine**
Lieferkalender-Regel: Er ist eine Plausibilitätsgrenze gegen Tippfehler
(`2036` statt `2026`), die sonst dauerhaft in der Produktionsliste stünden.
Kundenspezifische Liefertage bleiben ausgeschlossen, bis dafür bestätigte
Fachanforderungen vorliegen; die Architektur verhindert sie nicht.

**Zeitzone:** „heute" ist immer `businessDay(now)` in `Europe/Berlin`, nie die
UTC-Uhr des Workers. Ohne das würde das System zwischen 00:00 und 02:00
Berliner Zeit eine Bestellung für den laufenden Tag ablehnen.

**Alle** Eingabefehler werden gesammelt und gemeinsam zurückgegeben — ein Café
soll nicht fünfmal absenden müssen, um fünf Hinweise zu bekommen.

---

## 15. Fehlerzustände

Der Kunde sieht **niemals** `D1_ERROR`, `foreign key constraint`, `500`,
`JSON parse failed`, einen Stacktrace oder einen SQL-Ausschnitt.

| Zustand | Anzeige | Verhalten |
|---|---|---|
| Link ungültig / widerrufen | Eigene ruhige Seite: „Dieser Bestelllink ist nicht mehr gültig. Bitte melde dich bei Buschmann 1846, dann bekommst du einen neuen." | keine Details, keine Aussage über Existenz eines Cafés |
| Kein Produkt ausgewählt | Inline über dem Absenden-Button: „Bitte mindestens ein Produkt auswählen." | Submit wird verhindert, Fokus springt zur Produktliste |
| Datum ungültig / in der Vergangenheit | Direkt am Datumsfeld, mit `aria-describedby` verknüpft | Feld erhält `aria-invalid`, Fokus springt dorthin |
| Notiz zu lang | Direkt am Notizfeld | wie oben |
| Netz-/Serverproblem | „Die Bestellung wurde **nicht** bestätigt. Bitte noch einmal senden oder bei Buschmann anrufen." | Button wird wieder aktiv, Eingaben bleiben vollständig erhalten |

**Der gefährliche Zustand** — „Kunde weiß nicht, ob die Bestellung angekommen
ist" — wird ausdrücklich verhindert: Es gibt nur zwei sichtbare Endzustände.
Entweder die Bestätigung mit Bestellnummer, oder eine Meldung, die
unmissverständlich sagt, dass **nicht** bestellt wurde. Es gibt keinen dritten,
mehrdeutigen Zustand.

---

## 16. Erfolgszustand

Nach `201`/`200` wird das Formular durch eine Bestätigung im selben Bildschirm
ersetzt (`role="status"`, Fokus wandert dorthin):

```text
✓  Bestellung ist angekommen.

   BUS-2026-000001

   Lieferung
   Dienstag, 25. August 2026

   3 × Beispiel Käsekuchen
   2 × Beispiel Streuselblech

   Summe 18,65 €

   Wir haben deine Bestellung erhalten.

   [ Neue Bestellung ]
```

* Bestellnummer groß und auswählbar
* Liefertag ausgeschrieben mit Wochentag (der Wochentag ist die Information,
  die ein Café tatsächlich prüft)
* keine Weiterleitung, kein Timer, kein automatisches Schließen
* „Neue Bestellung" lädt die Seite neu (neue Absendekennung)

---

## 17. Security

### 17.1 Header

Auf **jeder** tokenbezogenen Antwort (`/o/<token>`, `/api/orders`):

```http
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow
```

Zusätzlich auf der HTML-Seite:

```http
Content-Security-Policy: default-src 'none'; script-src 'self';
    style-src 'self'; connect-src 'self'; form-action 'none';
    base-uri 'none'; frame-ancestors 'none'
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
```

`default-src 'none'` als Ausgangspunkt bedeutet: Alles, was nicht ausdrücklich
erlaubt ist, ist verboten — Bilder, Schriften, Frames, Medien, Verbindungen zu
fremden Hosts. Es gibt keine `'unsafe-inline'`-Ausnahme, weil CSS und JS als
eigene Dateien unter `/assets/` ausgeliefert werden.

`form-action 'none'`: Das Formular wird ausschließlich per `fetch` abgesendet.
Eine native Formularabsendung ist damit auch dann unmöglich, wenn ein Fehler
den Interzeptor umgeht — der Zustand des Formulars kann nicht verloren gehen.

`/assets/*` erhält über `public/_headers` `nosniff`, `no-referrer` und eine
kurze öffentliche Cachedauer. Diese Dateien enthalten keine Kundendaten.

### 17.2 Eingangsprüfungen an der HTTP-Grenze

* Methode je Route explizit geprüft, sonst `405` mit `Allow`
* `Content-Type` muss `application/json` sein, sonst `415`
* `Content-Length` > 64 KiB → `413` **vor** dem Lesen; zusätzlich Kappung nach
  dem Lesen für Anfragen ohne `Content-Length`
* JSON-Parsefehler → `400`, kontrolliert, ohne Parserdetails
* Alle in HTML eingesetzten Werte werden escaped (`&`, `<`, `>`, `"`, `'`)

### 17.3 Fehlergrenze

Ein einziger `try/catch` um jede Route:

| Geworfen | Antwort |
|---|---|
| `ValidationError` | `422` mit den feldweisen Meldungen (sie sind für Nutzer geschrieben) |
| `AccessDeniedError` | `401` bzw. `404` (Seite) |
| alles Übrige | `500` `{"error":"internal_error"}` — Nachricht, Typ und Stacktrace verlassen den Worker nicht |

---

## 18. Cache- und Referrer-Schutz

| Antwort | `Cache-Control` | Begründung |
|---|---|---|
| `/o/<token>` | `no-store` | enthält Cafénamen und Sortiment; darf weder im Browser noch in einem Zwischenspeicher liegen bleiben |
| `/api/orders` | `no-store` | enthält Bestelldaten |
| `/o/<token>` bei ungültigem Link | `no-store` | eine gecachte Ablehnung würde einen später reaktivierten Link blockieren |
| `/assets/*` | `public, max-age=300` | enthält keine Kundendaten; erspart dem Stammkunden bei jedem Besuch zwei Downloads |
| `/api/health` | unverändert | — |

**Referrer:** `no-referrer` auf allen Antworten. Da die Seite außerdem
**keine** Ressource von einem fremden Host lädt und keinen externen Link
enthält, gibt es keinen Empfänger, an den ein Referer überhaupt gehen könnte —
die Kopfzeile ist die zweite, nicht die erste Verteidigungslinie.

**Keine Analytics.** Keine Schriftarten von fremden Hosts. Keine Bilder von
fremden Hosts. Keine externen Skripte. Kein CDN außer Cloudflare selbst.

---

## 19. Frontend-Struktur

### 19.1 Technik

Kein React, kein Vue, kein Framework, kein Bundler, kein Build-Schritt.

| Teil | Datei | Ausgeliefert als |
|---|---|---|
| Seitengerüst | `src/ui/order-page-html.ts` | serverseitig gerendertes HTML |
| Formatierung | `src/ui/format.ts` | serverseitig (Preis, Datum, Escaping) |
| Gestaltung | `public/assets/app.css` | statisch, `/assets/app.css` |
| Verhalten | `public/assets/order-form.js` | statisch, natives ES-Modul |
| Start | `public/assets/app.js` | statisch, `<script type="module">` |

Die beiden JS-Dateien sind **natives ES2022** und werden vom Browser direkt
geladen — kein Transpilat, kein Bundle, kein Sourcemap-Problem. Sie werden
über `tsconfig.ui.json` (`checkJs`, `lib: DOM`) von `tsc` mitgeprüft und über
ein eigenes Vitest-Projekt (`happy-dom`) gegen **genau das HTML** getestet,
das der Server rendert.

Erwartete Größe: HTML ~6 kB, CSS ~4 kB, JS ~5 kB — unkomprimiert, vor
Cloudflares Brotli.

### 19.2 Seitenaufbau — ein Bildschirm

```html
<header>   Buschmann 1846  ·  „Bestellung für Testcafé Nord"        </header>
<main>
  <form data-order-form data-submission-id="…">
    <ul>            <!-- je Produkt eine Zeile mit − 0 + -->
    <fieldset>      <!-- Lieferdatum -->
    <fieldset>      <!-- Notiz (optional) -->
  </form>
</main>
<footer>   „2 Positionen · 18,65 €"        [ Bestellung senden ]     </footer>
```

Der Footer ist `position: sticky` am unteren Rand und damit auf dem Smartphone
immer erreichbar, ohne ans Seitenende zu scrollen. `main` bekommt einen
unteren Innenabstand in Footerhöhe, damit nichts verdeckt wird.

Keine Schritte, keine Fortschrittsanzeige, keine Navigation, keine
Produktdetailseiten, kein Warenkorb.

### 19.3 Mengensteuerung

```html
<button type="button" data-step="-1" aria-label="Käsekuchen: eins weniger">−</button>
<input type="number" inputmode="numeric" min="0" max="9999" value="0"
       data-product-id="1" data-price-cents="435" aria-label="Menge Käsekuchen">
<button type="button" data-step="1"  aria-label="Käsekuchen: eins mehr">+</button>
```

* `+` erhöht um 1, `−` verringert um 1, Minimum 0, Maximum 9 999
* bei 0 ist `−` `disabled` — es gibt keine negative Menge
* die Zahl ist auch direkt eingebbar (Tastatur), ungültige Eingaben werden
  beim Verlassen auf eine gültige ganze Zahl normalisiert
* Zeilen mit Menge > 0 werden hervorgehoben — durch Rahmen **und** Fettung,
  nicht allein durch Farbe
* keine Gesten, kein Drücken-und-Halten, kein Wischen: ein Tap = eine Aktion

### 19.4 Design

Die Marke wird über Farbe, Fläche und Zurückhaltung getragen, nicht über
Effekte: Navy `#0A2139`, Porzellan `#FCF9F3`, Champagner `#C59A52` — dieselben
Werte wie auf der Website, hier aber als ruhiges Arbeitswerkzeug.

**Bewusst keine Webfonts.** `Instrument Sans` (30 kB) und `Newsreader` (129 kB)
liegen im Repository der Website. Sie werden nicht übernommen: Für eine
Oberfläche, die ein Café fünfzig Mal im Jahr in zwanzig Sekunden bedient, ist
eine Schriftdatei Ballast. Die Seite nutzt den System-Schriftstapel; die
Wortmarke steht in einer System-Serife.

Keine Intro-Animation. Keine Scroll-Effekte. Keine WebGL. Übergänge
ausschließlich für Zustandswechsel (Menge, Fehler, Bestätigung), jeweils
≤ 150 ms, und vollständig abgeschaltet unter `prefers-reduced-motion: reduce`.

### 19.5 Mobile First

Entworfen für **375–430 px**, danach Tablet und Desktop.

* Touch-Ziele ≥ 44 × 44 px (`+`/`−` sind 48 px)
* kein horizontales Scrollen bei 320 px
* Grundschrift 16 px (verhindert außerdem den iOS-Zoom beim Fokus)
* Bedienbarkeit mit einem Daumen: Mengen und Absenden liegen im unteren
  Bildschirmdrittel
* Desktop: dieselbe Spalte, auf `max-width: 44rem` zentriert — keine zweite
  Gestaltung

---

## 20. Accessibility

| Anforderung | Umsetzung |
|---|---|
| Semantik | `<header> <main> <form> <fieldset> <legend> <ul>/<li> <footer>`, echte `<button type="button">` |
| Beschriftungen | jedes Feld hat ein `<label>` oder ein sprechendes `aria-label` inklusive Produktname |
| Tastatur | vollständige Bedienbarkeit; Tab-Reihenfolge folgt der Leserichtung; kein Tastaturfallen |
| Fokus | `:focus-visible` mit 2 px Kontur, deutlich sichtbar auf hellem **und** dunklem Grund |
| Mengenänderung | eine gemeinsame `aria-live="polite"`-Region meldet „Käsekuchen: 3 Stück" |
| Fehler | `aria-invalid` am Feld + `aria-describedby` auf den Fehlertext; Fokus springt zum ersten Fehler |
| Statusmeldungen | Bestätigung als `role="status"`, Fehlerbanner als `role="alert"` |
| Farbe | Zustände nie allein über Farbe (Menge > 0: Rahmen + Fettung; Fehler: Symbol + Text) |
| Kontrast | alle Text-/Hintergrundpaare ≥ 4,5 : 1, Bedienelemente ≥ 3 : 1 |
| Bewegung | `prefers-reduced-motion: reduce` schaltet alle Übergänge ab |
| Kein JS | `<noscript>` erklärt, dass ohne JavaScript nicht bestellt werden kann und nennt den Weg über Buschmann |

Keine ARIA-Konstruktionen, wo HTML genügt.

---

## 21. Performance

| Ziel | Maßnahme |
|---|---|
| sofortiger First Paint | serverseitig gerendertes HTML, kein clientseitiger Aufbau |
| kleines Initial Payload | ~15 kB gesamt, unkomprimiert |
| keine Drittanfragen | 0 externe Hosts |
| keine Layout Shifts | feste Zeilenhöhen, keine nachgeladenen Schriften, keine Bilder |
| schnelle Interaktion | Mengenänderung ist reine DOM-Arbeit ohne Netzverkehr |
| Wiederbesuch | CSS/JS aus dem Browsercache, HTML immer frisch (`no-store`) |

Keine Bilder in der Bestelloberfläche. Kein Logo als Datei — die Wortmarke ist
Text.

---

## 22. Teststrategie

Vier Vitest-Projekte:

| Projekt | Umgebung | Inhalt |
|---|---|---|
| `domain` | node | reine Logik, keine Runtime, keine DB |
| `worker` | workerd + echte lokale D1 | HTTP-Grenze, Repositories, Anwendungsfälle |
| `ui` | happy-dom | Client-Skript gegen **das real gerenderte HTML** |

Abgedeckt werden mindestens die 34 in der Anforderung genannten Fälle:

**Access Token (1–4)** — gültiger Token findet den richtigen Customer;
unbekannter Token wird abgelehnt; deaktivierter Token wird abgelehnt; der
Token von Café A lädt niemals Café B; zusätzlich: deaktivierter *Kunde* mit
gültigem Token wird abgelehnt.

**Catalog (5–7)** — nur aktive Produkte; Sortierung nach `sortOrder`, dann
`id`; weder `is_active`, `created_at`, `updated_at` noch
`customers.internal_note` erscheinen in der Antwort.

**Order Creation (8–22)** — Bestellung ohne Position abgelehnt; Menge 0 erzeugt
keine Position; negative Menge abgelehnt; inaktives Produkt abgelehnt;
Client-Preis wird nie verwendet; Serverpreis kommt aus D1; Preis-Snapshot wird
gespeichert; Summe mehrerer Positionen stimmt; Customer stammt aus dem
Token-Kontext (auch bei mitgesendetem `customer_id`); Datum in der
Vergangenheit abgelehnt; ungültiges Datum abgelehnt; Notiz-Limit erzwungen;
Status beginnt bei `new`; Order und Items atomar; Doppel-Submit erzeugt keine
zweite Bestellung.

**HTTP (23–27)** — falsche Methode → 405 mit `Allow`; falscher `Content-Type`
→ 415; ungültiges JSON → 400 ohne Parserdetails; interne Fehler → 500 ohne
Nachricht, Typ oder Stacktrace; private Antworten tragen `no-store`.

**UI (28–34)** — `+` erhöht; `−` verringert; Minimum bleibt 0; Absenden ohne
Auswahl wird verhindert und erklärt; erfolgreiches Absenden zeigt die
Bestellnummer; während des Absendens ist der Button gesperrt und ein zweiter
Klick löst keine zweite Anfrage aus; ein Fehler ist sichtbar und verständlich.

Getestet wird **Geschäftsverhalten**. Es gibt keine Tests auf CSS-Klassen,
keine Snapshot-Tests von Markup und keine Tests, die nur eine Implementierung
nachzeichnen.

---

## 23. Lokaler Integrationstest

Ohne Remote-Datenbank, ohne Deployment:

```bash
cd order-system
npm run db:migrate:local        # 0001–0007
npm run db:seed:cafe:local      # Testcafé Nord + fiktives Sortiment + Dev-Token
npm run dev                     # http://127.0.0.1:8787
```

Nachgewiesen wird: Seite lädt mit Token · Café erkannt · Produkte sichtbar ·
Mengen setzbar · Datum setzbar · Bestellung wird gesendet · `orders`-Zeile
vorhanden · `order_items`-Zeilen vorhanden · `total_amount_cents` korrekt ·
`unit_price_cents` entspricht dem Produktpreis zum Bestellzeitpunkt ·
zweiter Klick erzeugt keine zweite Zeile · ungültiger Token wird abgewiesen.

---

## 24. Non-Goals

Ausdrücklich **nicht** Teil von Phase 2:

Warenkorb · mehrstufiger Checkout · Login mit E-Mail und Passwort ·
Registrierung · Kundenkonto · Produktdetailseiten · Checkout-Wizard ·
Payment · Stripe · PayPal · Rechnungen · Admin-Dashboard · Umsatzauswertung ·
Kostenkontrolle · R2 · Bilderupload · E-Mail-Versand · WhatsApp-Anbindung ·
Lieferfahrer-System · Karten · CRM · Newsletter · Treuesystem ·
Multi-Tenant-SaaS · „Bestellung wiederholen" · Bestellhistorie für das Café ·
Bestellung ändern oder stornieren · Lieferkalender pro Kunde · Vorlaufzeiten ·
Mindestbestellwert · Rate-Limiting · Deployment · Push · Offline-Betrieb.

Nicht verändert werden: die bestehende Buschmann-Marketing-Website und die
gesamte Phase-1-Fachlichkeit.

---

## 25. Definition of Done

Phase 2 ist fertig, wenn **alle** Punkte zutreffen:

- [ ] Persönliche, sichere Café-Zugänge funktionieren; kein Passwort nötig
- [ ] Token wird ausschließlich als SHA-256-Hash gespeichert
- [ ] Gültiger Link lädt den korrekten Customer; fremder Token lädt ihn nie
- [ ] Unbekannter, widerrufener und deaktivierter Zugang sind ununterscheidbar
- [ ] Produkte sind ohne zweiten Roundtrip sichtbar
- [ ] Mengen mit −/+ funktionieren, Minimum 0, Tastatur bedienbar
- [ ] Keine Bestellung ohne mindestens ein Produkt möglich
- [ ] Lieferdatum funktioniert, Vergangenheit serverseitig abgelehnt
- [ ] Optionale Notiz funktioniert, Länge serverseitig begrenzt
- [ ] Order wird serverseitig erstellt, Status beginnt bei `new`
- [ ] Preise ausschließlich serverseitig aus D1, Integer-Cents durchgängig
- [ ] Preis-Snapshots werden gespeichert
- [ ] Order und Items atomar in einem `batch()`
- [ ] Doppel-Submit serverseitig durch UNIQUE-Index geschützt
- [ ] Bestätigung zeigt Bestellnummer, Liefertag und Positionen
- [ ] Kein Leak von Token, Hash, SQL, Stacktrace oder internen Kundenfeldern
- [ ] `Cache-Control: no-store` auf allen privaten Antworten
- [ ] `Referrer-Policy: no-referrer`, CSP ohne `'unsafe-inline'`, 0 Drittanfragen
- [ ] Tests grün, Typecheck grün (Worker **und** Client)
- [ ] Lokale D1-Migration und lokaler Bestellfluss nachgewiesen
- [ ] Mobiler Flow bei 375/390/430 px manuell geprüft
- [ ] Bestehende Buschmann-Website unverändert
- [ ] Kein Deployment, kein Push, kein Merge
