# Buschmann 1846 — Bestellsystem

Ein B2B-Vorbestellsystem für Buschmann 1846. Es lebt in diesem Repository
neben der Website, ist aber ein **eigenständiges Subsystem**: eigener Stack,
eigenes Deployment, keine gemeinsame Laufzeit mit den statischen Seiten.

**Es ist kein Onlineshop.** Keine Zahlungsabwicklung, kein anonymer
Endkundenverkauf, kein Marketingkatalog.

## Warum es das gibt

Buschmann beliefert überwiegend feste Cafés in Düsseldorf, die regelmäßig
bestellen — meist dieselben Positionen in wechselnden Mengen. Diese
Bestellungen laufen bisher über informelle Kanäle. Daraus folgt: keine
strukturierten Daten für die Produktionsplanung, kein nachvollziehbarer
Preisstand, viel manuelle Übertragung.

Die entscheidende Anforderung ist eine UX-Anforderung:

> Eine Bestellung über das System muss für ein Stammcafé schneller und
> angenehmer sein als dieselbe Bestellung über WhatsApp.

Zielgröße für eine typische Wiederholungsbestellung: 20–30 Sekunden.

## Stack

TypeScript (`strict`) · Cloudflare Workers · Cloudflare D1 · Vitest mit
`@cloudflare/vitest-plugin` · Wrangler.

Sonst nichts. Kein Framework, kein ORM, keine Dependency Injection. Vier
fachliche Tabellen und direkte Prepared Statements genügen.

> Bis zum 2026-08-23 lief dieses Subsystem auf PHP 8.1 und MariaDB. Die
> Fachlichkeit ist unverändert übernommen, die Plattform gewechselt. Warum,
> steht in der [Design-Spezifikation](../docs/superpowers/specs/2026-08-24-buschmann-order-system-cloudflare-design.md).
> Der alte Stand liegt auf `archive/order-system-php-foundation`.

## Loslegen

```bash
cd order-system
npm install
cp .dev.vars.example .dev.vars   # Pepper, Origin und Umgebung — nicht in Git
npm run db:migrate:local     # D1-Schema lokal anlegen
npm run db:seed:cafe:local   # fiktive Cafés, Sortiment und Demokonten
npm run dev                  # Worker auf http://localhost:8787
```

Danach führt der Weg über die Anmeldung:

```text
http://127.0.0.1:8787/login
```

| | Kennung | Geheimnis | Ziel |
|---|---|---|---|
| Café | `TESTCAFE` | `01234567` | `/bestellen` |
| Café (Abholung) | `TESTSUED` | `00000042` | `/bestellen` |
| Administration | `admin@example.test` | `demo-admin-passwort-nur-lokal` | `/admin` |

> Diese Zugangsdaten stehen im Klartext in `seeds/002_cafe_ordering_dev.sql`
> und damit in jedem Klon. Sie gelten ausschließlich lokal — und ausschließlich
> mit dem Entwicklungs-Pepper aus `.dev.vars.example`, denn ein Verifier hängt
> am Pepper.
>
> Ein eigenes Konto: `npm run auth:account -- --role customer --identifier
> TESTCAFE --customer 1 --secret 01234567`. Das Werkzeug schreibt **nicht**
> selbst in die Datenbank; es gibt ein `INSERT` aus, das bewusst von Hand
> angewendet wird. In die Datenbank kommt nur der Verifier — niemals die PIN
> und niemals der Pepper.

| Befehl | Zweck |
|---|---|
| `npm test` | alle Tests (Domäne + Worker/D1) |
| `npm run test:watch` | Tests im Watch-Modus |
| `npm run typecheck` | Worker (`tsc`) **und** Client (`tsconfig.ui.json`) |
| `npm run cf-typegen` | `worker-configuration.d.ts` neu erzeugen |
| `npm run db:migrate:local` | Migrationen auf die lokale D1 anwenden |
| `npm run db:seed:local` | allgemeine Platzhalterdaten |
| `npm run db:seed:cafe:local` | Café-Bestellung: fiktive Cafés + Demokonten |
| `npm run auth:account -- …` | Anmeldekonto ausstellen (gibt ein `INSERT` aus) |

## Aufbau

```text
src/
├── worker.ts              äußere Hülle: Pfad → Antwort, sonst nichts
├── domain/                Geschäftslogik — kennt weder HTTP noch D1
│   ├── money.ts           ganzzahlige Cent, keine Division
│   ├── clock.ts           Zeitpunkt (UTC) getrennt vom Tag (Europe/Berlin)
│   ├── address.ts  text.ts  errors.ts
│   ├── product.ts  product-catalog.ts  customer.ts
│   ├── fulfillment-type.ts  fulfillment-date.ts  order-status.ts
│   ├── order-number.ts  order-item.ts
│   ├── order-draft.ts     Eingabe-Whitelist OHNE Preisfeld
│   ├── order.ts           das Aggregat
│   ├── production-day.ts  Lesemodell: was ist an einem Tag zu backen
│   ├── auth-role.ts       genau zwei Rollen: customer, admin
│   └── login-identifier.ts  Normalisierung, idempotent, mit Zeichen-Allowlist
├── config/
│   └── app-config.ts      Pepper, Origin, Umgebung — fail closed
├── application/
│   ├── place-order.ts     der Anwendungsfall aus Phase 1
│   ├── place-cafe-order.ts  Bestellung für ein Café aus der Sitzung
│   ├── log-in.ts          Anmeldung: zwei Ausgänge, ein generisches Nein
│   ├── authenticate-request.ts  Sitzung → AuthContext, bei JEDEM Request neu
│   ├── get-production-day.ts    ein Tag: abfragen und aggregieren
│   ├── change-order-status.ts   der einzige schreibende Adminvorgang
│   └── catalog-view.ts    was ein Café von einem Produkt sieht
├── infrastructure/
│   ├── auth/              PBKDF2 + Pepper, Sitzungstoken, Cookie-Policy
│   └── d1/                Persistenz: prepare().bind(), batch()
├── ui/                    serverseitiges HTML, Preis-/Datumsformat, Escaping
└── http/                  Routen, Wache, Sicherheitsheader, Fehlergrenze

migrations/                D1-Schema, von Wrangler angewandt
seeds/                     ausschließlich erfundene Daten
scripts/                   Anmeldekonto ausstellen (schreibt NICHT selbst)
public/assets/             CSS und Client-Skript, von der Plattform geliefert
tests/domain/              laufen OHNE Worker-Runtime und OHNE D1
tests/d1/  tests/http/     laufen in der echten Runtime gegen echte D1
tests/ui/                  Client-Skript gegen das real gerenderte HTML
```

### Warum die Domäne nichts von D1 weiß

`vitest.config.ts` definiert drei Testprojekte. Das Projekt `domain` läuft in
schlichtem Node — ohne Workers-Runtime, ohne Datenbank, ohne Netz. Hinge die
Geschäftslogik an einer dieser Sachen, ließen sich ihre Tests nicht ausführen.
Die Schichtentrennung ist damit keine Absichtserklärung, sondern eine
Bedingung, die bei jedem Testlauf geprüft wird.

`worker` läuft in der echten Workers-Runtime gegen eine echte lokale D1.
`ui` läuft in happy-dom und legt das Ergebnis von `renderOrderPage()` in ein
DOM — das Client-Skript wird also gegen genau das HTML geprüft, das der Server
ausliefert, nicht gegen ein Testfragment.

## Die vier Regeln, an denen dieses System steht

**1. Geld ist immer ein ganzzahliger Cent-Betrag.** Im Modell wie in der
Datenbank. `48,00 €` sind `4800`. Kein `DECIMAL`, kein `REAL`, kein
`toFixed()`. `Money` ist die einzige Stelle mit Geldarithmetik und kennt
bewusst keine Division.

**2. Der Preis kommt vom Server.** `OrderDraft` liest aus der Anfrage nur
`fulfillment_type`, `fulfillment_date`, `note` und `items` mit `product_id`
und `quantity`. Ein mitgesendeter Betrag wird nicht geprüft und verworfen — er
wird nie gelesen. `Order.place()` nimmt Preise ausschließlich aus dem
`ProductCatalog`, der aus der Datenbank kommt.

**3. Eine Bestellung ist ein Dokument.** Name, Einheit, Preis und Adresse
stehen als Snapshot in ihren eigenen Zeilen. Ändert Buschmann morgen einen
Preis, wird die Bestellung von heute nicht teurer. Deshalb verbindet
`findOrderByNumber` auch nicht auf `products` — ein JOIN würde genau diese
Regel aushebeln.

**4. Ein Liefertag ist ein Tag in Düsseldorf.** Kein Zeitstempel. Der Worker
läuft in UTC; um 00:30 Uhr Berliner Zeit ist dort noch der Vortag. „Heute"
wird deshalb über `Europe/Berlin` bestimmt, nicht über die Uhr des Workers.

## Anmeldung

Alles First-Party auf `buschmann1846.de`. Eine Loginseite, ein Tab, keine
fremde Domain — Cloudflare bleibt Infrastruktur und wird für den Benutzer
nicht sichtbar.

```text
/login  →  Kundencode + PIN   →  /bestellen
        →  E-Mail + Passwort  →  /admin
```

Das Formular fragt **nicht**, wer davorsteht. Die Rolle steht am Konto; eine
Auswahl wäre ein überflüssiger Tap und zugleich eine Auskunft darüber, welche
Rollen es gibt.

### Credential

```text
verifier = PBKDF2-HMAC-SHA256(
    password = HMAC-SHA256(key = AUTH_PEPPER, message = geheimnis),
    salt     = 16 zufällige Byte je Konto,
    c        = 600 000,
    dkLen    = 32 Byte)
```

* **Kein Klartext in D1.** Individueller Salt je Konto, dazu ein
  serverseitiger Pepper, der nicht in der Datenbank liegt. Wer einen Dump
  erbeutet, steht vor einem fehlenden 256-Bit-Schlüssel.
* **Der Work Factor ist gemessen, nicht geschätzt:** 7,6 ms je 100 000
  Iterationen in der echten workerd-Runtime, also rund 45 ms bei 600 000.
* **Argon2id wäre besser** und steht in Workers nicht zur Verfügung — die
  Begründung samt Alternativen steht in
  `src/infrastructure/auth/credential.ts`.
* **Alle sechs Ablehnungsgründe** — unbekannte Kennung, falsches Geheimnis,
  deaktiviertes Konto, deaktiviertes Café, gesperrtes Konto, unbrauchbare
  Eingabe — erzeugen eine **byteweise identische** Antwort, und jeder von
  ihnen kostet genau eine PBKDF2-Ableitung. Auch der unbekannte Fall: sonst
  wäre die Menge der existierenden Konten am Zeitverhalten aufzählbar.
* **Fünf Fehlversuche → 15 Minuten Pause**, gezählt in einer einzigen
  SQL-Anweisung. Der Lockout-DoS ist real und dokumentiert; die Sperre läuft
  von selbst ab und braucht keinen Eingriff.

### Sitzung

* 32 Byte Zufall im Cookie, in D1 **nur** `sha256(token)`.
* `HttpOnly`, `SameSite=Lax`, `Path=/`, kein `Domain` — in Produktion
  zusätzlich `Secure` und der Name `__Host-buschmann_session`. Entwicklung und
  Produktion tragen **verschiedene Cookienamen**: Der `__Host-`-Präfix ist eine
  Zusage an den Browser, und eine Zusage, die manchmal gilt, ist keine.
* Café **30 Tage**, Admin **12 Stunden**.
* Rolle, Konto- und Café-Aktivität werden bei **jedem** geschützten Request
  frisch aus D1 gelesen. Ein Sitzungstoken ist kein Dauerausweis: Wird ein Café
  deaktiviert, endet sein Zugriff beim nächsten Request.
* Nach jeder Anmeldung entsteht eine **neue** Sitzung; eine mitgeschickte wird
  widerrufen, nie übernommen.

### CSRF und Origin

Drei Schichten statt einer: `SameSite=Lax` im Cookie, exakte Origin-Prüfung
gegen `APP_ORIGIN` und ein sitzungsgebundener Synchronizer-Token. `POST /login`
hat bewusst keinen CSRF-Token — vor der Anmeldung gibt es keine Sitzung, an der
einer hängen könnte; dort tragen SameSite und Origin.

Vollständiges Bedrohungsmodell, Trust Boundaries und die verworfenen
Alternativen: siehe
[Phase-3A-Spezifikation](../docs/superpowers/specs/2026-08-24-buschmann-first-party-auth-design.md).

### Konfiguration

| Binding | Zweck | Fehlt er? |
|---|---|---|
| `AUTH_PEPPER` | Schlüssel der Credential-Verifikation | keine Anmeldung möglich |
| `APP_ORIGIN` | erwarteter Origin schreibender Requests | jeder Schreibzugriff `403` |
| `ENVIRONMENT` | genau `development` schaltet die lokale Cookie-Policy frei | Produktion |

Alle drei stehen **bewusst nicht** in `wrangler.jsonc` — die Datei ist
eingecheckt. Lokal kommen sie aus `.dev.vars` (siehe `.dev.vars.example`),
produktiv aus Cloudflare-Secrets. Was fehlt, ist Produktion: Ein Tippfehler in
`ENVIRONMENT` führt nie zu unsicheren Cookies.

> **Der Login setzt den Workers-Paid-Tarif voraus.** Der Free-Tarif begrenzt
> auf 10 ms CPU je Invocation; damit ist kein Passwort-KDF möglich, der einer
> ernsthaften Guidance genügt. Die Entscheidung ist in der Spezifikation
> festgehalten.

## Produktionstag

Die Frage, für die dieses System gebaut wurde:

> Was muss Buschmann am 26. August produzieren?

```text
GET /api/admin/production-day?date=2026-08-26
```

Rolle `admin`, ausschließlich lesend. Eine Café-Sitzung bekommt 403, keine
Sitzung 401. `Cache-Control: no-store` auf **jeder** Antwort — welches Café
wie viel bestellt, gehört in keinen Zwischenspeicher.

Die Antwort hat zwei Ebenen aus **denselben** Daten: `products` ist die
Backliste, `orders` die Aufteilung darauf. Sie können sich nicht
widersprechen, weil die Summe aus den Bestellungen gerechnet wird.

```json
{
  "date": "2026-08-26",
  "order_count": 2,
  "total_units": 11,
  "products": [
    { "product_id": 1, "name": "Beispiel Käsekuchen", "unit": "Stück", "quantity": 11 }
  ],
  "orders": [
    {
      "order_number": "BUS-2026-000901",
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

### Was zählt

| Status | zählt | warum |
|---|---|---|
| `new`, `confirmed` | **ja** | muss gebacken werden |
| `in_production` | **ja** | bleibt bis zum Abschluss Teil der Tagesmenge — sonst schrumpfte die Liste, während gearbeitet wird |
| `completed` | nein | gehört nicht mehr zur offenen Menge |
| `cancelled` | nein | darf niemals Produktion erzeugen |

Die Liste steht **an einer Stelle**: `OPEN_PRODUCTION_STATUSES` in
`domain/order-status.ts`. Die SQL-Platzhalter entstehen aus ihrer Länge, die
Werte werden gebunden — es gibt keinen Weg, sie zu ändern, ohne dass die
Abfrage folgt.

Lieferung und Abholung zählen beide: Gebacken werden muss so oder so.

### Das Datum

Ausdrücklich und immer. Kein implizites „heute", kein „morgen", kein
„nächster Werktag" — ein Endpunkt, dessen Antwort davon abhängt, wann er
aufgerufen wird, ist um 23:59 Uhr etwas anderes als um 00:01 Uhr. Eine
spätere Oberfläche darf „morgen" vorauswählen; dann steht die Entscheidung
dort, wo sie hingehört.

Akzeptiert wird ein **gültiger Kalendertag** als `JJJJ-MM-TT`, geprüft von
`isCalendarDay` in `domain/clock.ts`. Alles andere ist `400 invalid_date` —
auch `2026-02-29`, auch ein doppelter `date`-Parameter. Vergangenheit,
Gegenwart und Zukunft sind gleichermaßen lesbar: Die Regel „nicht in der
Vergangenheit" gehört zum Bestellen, nicht zum Nachschauen.

**Der Tag wird nirgends umgerechnet.** Er kommt als Zeichenkette herein,
wird als Zeichenkette gebunden und geht als Zeichenkette hinaus. Aus dem 25.
kann deshalb nicht der 24. werden — es gibt keine Zeitzone, durch die er
laufen könnte.

### Snapshots

Kunden- und Produktname stammen aus der **Bestellung**, nicht aus den
aktuellen Stammdaten. Eine Umbenennung ändert eine Bestellung von letzter
Woche nicht rückwirkend.

Aggregiert wird deshalb über `(product_id, Name, Einheit)` und nicht über die
Produkt-ID allein. Kommen an einem Tag zwei Namensstände desselben Produkts
vor, erscheinen zwei Zeilen — Korrektheit vor kosmetischer Zusammenführung.
Dasselbe für die Einheit: „8 Blech" und „3 Stück" ergeben keine 11.

Aus `products` kommt genau eine Spalte, `sort_order`, und nur zum Sortieren.
Auf `customers` wird gar nicht verbunden — deshalb können E-Mail, Telefon und
interne Notiz auf diesem Weg nicht abfließen. Preise werden nicht einmal
geladen.

### Zwei Abfragen, kein Index

Zwei je Request, unabhängig davon, ob der Tag eine Bestellung hat oder
vierzig. Ein Test zählt die Aufrufe von `db.prepare` mit; ein später
eingeschlichenes N+1 fällt damit sofort auf.

Zwei und nicht eine: Ein einzelner JOIN würde eine Bestellung ohne Positionen
verschlucken und `order_count` verfälschen. Das Aggregat verlangt mindestens
eine Position, das Schema nicht.

Der Query Plan wird bei **jedem** Testlauf gegen echtes SQLite geprüft:

```text
SEARCH orders USING INDEX idx_orders_day (fulfillment_date=? AND status=?)
SEARCH i USING INDEX idx_order_items_order (order_id=?)
```

Kein Full Table Scan. **Keine neue Migration und kein neuer Index** —
`idx_orders_day` aus Migration 0003 deckt genau diesen Zugriff ab, so wie es
dort schon angekündigt war.

### Die Oberfläche dazu

```text
GET /admin                      der nächste Kalendertag
GET /admin?date=2026-08-26      genau dieser Tag
```

Dieselbe Frage, dieselben Daten — als Seite. Der Adminbereich, der bis
Phase 3A eine leere Schale war, zeigt jetzt die Backliste des Tages.

Die Seite wird **serverseitig** gerendert und ruft `getProductionDay()`
DIREKT auf. Kein `fetch` des Workers auf den eigenen Endpunkt: Das kostete
einen zweiten Roundtrip, müsste das Sitzungscookie weiterreichen und
verwandelte einen Typfehler in einen Laufzeitfehler. Der JSON-Endpunkt oben
bleibt daneben bestehen; er ist die maschinenlesbare Fassung.

**Die Seite trägt kein Skript.** Datumspfeile sind echte Links, die
Datumswahl ist ein echtes `<form method="get">` — die Kernbedienung
funktioniert ohne JavaScript, und der Tag steht in der URL, also im
Lesezeichen und in der Browserhistorie.

**Der Standardtag ist der nächste Kalendertag** und wird im Controller
gebildet, nicht im Anwendungsfall: `getProductionDay()` bleibt datumsbasiert
und leitet nichts ab. Kein Geschäftstag, keine Feiertage, kein Überspringen
von Sonntagen — eine solche Regel gibt es in diesem System nicht.

**Ein ungültiges Datum fällt nicht still auf den Standardtag zurück**, sondern
ergibt 400 mit einer lesbaren Seite. Sonst zeigte ein Lesezeichen mit einem
Tippfehler eine korrekt aussehende Backliste für einen anderen Tag — und
jemand backte nach der falschen Liste.

**Was die Seite nicht zeigt:** keine Preise, keine Beträge, keine Kosten,
keine Marge, keine E-Mail, keine Telefonnummer, keine Lieferadresse, keine
internen Kennungen. Nicht weil es unterdrückt würde, sondern weil das
Lesemodell nichts davon führt.

`note` ist Kundeneingabe und läuft — wie jeder dynamische Wert dieser Seite —
durch `escapeHtml()` aus `src/ui/format.ts`. Es gibt genau diese eine
Escape-Funktion im System.

READ ONLY: kein Statuswechsel, kein Bearbeiten, kein Löschen.

## Statuswechsel

`POST /api/admin/orders/:orderNumber/status` — der erste und bislang einzige
schreibende Adminvorgang. Ein angemeldeter Admin setzt den Status genau einer
bestehenden Bestellung. Mehr kann dieser Endpunkt nicht, und das ist der
Entwurf.

Die Anfrage trägt **ausschließlich den Zielstatus**:

```http
POST /api/admin/orders/BUS-2026-000042/status
Content-Type: application/json
X-CSRF-Token: <aus der Sitzung>
Origin: <APP_ORIGIN>

{"status": "confirmed"}
```

```json
{"order_number": "BUS-2026-000042", "status": "confirmed"}
```

Nicht gelesen werden: Rolle, Kunde, bisheriger Status, Preis, Positionen,
Zeitstempel. Es gibt in `http/admin-order-api.ts` keine Zeile, die sie läse —
was nicht gelesen wird, kann auch nicht geschmuggelt werden.

### Die Prüfreihenfolge

Dieselbe wie bei `POST /api/orders`, und aus demselben Grund:

1. **Origin** — kostet nichts und lehnt jede fremd ausgelöste Anfrage ab.
2. **Sitzung und Rolle `admin`** — ohne sie wird der Körper nicht gelesen und
   die Bestellung nicht gesucht.
3. **CSRF-Token** — hängt an der Sitzung, ist erst hier prüfbar.
4. **Anfrageform** — Content-Type, Größe (1 KiB), JSON.
5. **Zielstatus.**
6. **Erst danach die Bestellung.**

Wer keinen Zugang hat, erfährt nichts über die erwartete Anfrageform und
nichts darüber, ob es diese Bestellung gibt. Ein 415 für einen Fremden wäre
die Auskunft „hier ist ein JSON-Endpunkt, versuch es anders".

| Fall | Antwort |
|---|---|
| erlaubter Übergang | `200` mit Bestellnummer und neuem Status |
| unbekannter oder formal falscher Status | `400 invalid_status` |
| kaputtes JSON | `400 bad_request` |
| unbekannte **oder formal falsche** Bestellnummer | `404 not_found` |
| Übergang von der Domäne verboten | `409 invalid_transition` |
| Ausgangsstatus inzwischen verändert | `409 conflict` |
| falsche Methode | `405` mit `Allow: POST` |
| kein Zugang | `401` / `403` wie überall sonst |

Jede dieser Antworten trägt `Cache-Control: no-store` — auch die abweisenden.
Eine 409 verrät den aktuellen Zustand einer Bestellung so gut wie eine 200,
und ein Tresengerät wird geteilt.

Eine formal falsche Bestellnummer ist bewusst dieselbe Antwort wie eine
unbekannte. „Das Format stimmt nicht" gegenüber „die gibt es nicht" wäre eine
Auskunft darüber, wie eine gültige Nummer aussieht.

### Es gibt keine zweite State Machine

Welcher Übergang erlaubt ist, steht in `domain/order-status.ts` und
ausschließlich dort. Weder `http/admin-order-api.ts` noch
`application/change-order-status.ts` enthalten einen Vergleich der Form
`if (status === 'confirmed')`; sie fragen `canTransitionTo()`. Ein Test spielt
alle 25 Paare durch und holt sich den **Erwartungswert aus derselben
Funktion** — eine Kopie der Regel im Anwendungsfall fiele damit auf, sobald
sie abwiche.

Auch die Antwort verrät die Tabelle nicht: Die 409 sagt, dass es nicht geht —
nicht, was stattdessen ginge.

### Lost Update

Admin A liest „bestätigt". Admin B setzt „in Produktion". Admin A schickt
danach seinen Wechsel ab, auf Grundlage eines Standes, den es nicht mehr gibt.

Der Schutz ist eine Bedingung im `UPDATE` und kein Lock:

```sql
UPDATE orders
   SET status = ?, updated_at = ?
 WHERE order_number = ?
   AND status = ?          -- der Status, gegen den die Domäne geprüft hat
```

Ändert die Anweisung keine Zeile, ist der Ausgangsstatus nicht mehr der
erwartete — und der Aufrufer bekommt `409 conflict` statt einer
Erfolgsmeldung. Entscheidend ist `meta.changes`, nicht `success`: D1 meldet
eine erfolgreich **ausgeführte** Anweisung auch dann als erfolgreich, wenn sie
null Zeilen getroffen hat. Genau darum geht es hier.

Kein Distributed Lock, kein Durable Object, keine Queue, keine Versionsspalte
— und damit auch keine Migration.

### Was sich ändert

`status` und `updated_at`. Sonst nichts.

Der `UPDATE` nennt zwei Spalten; es gibt keinen Parameter für Kunde,
Liefertag, Notiz, Betrag oder Positionen. Eine Bestellung ist ein Dokument,
und ein Statuswechsel ist ein Vermerk darauf — keine Neuausstellung. Preis-
Snapshots und `order_items` werden von diesem Vorgang nicht einmal berührt.

NOCH KEINE OBERFLÄCHE. Phase 4A baut den Vorgang, nicht den Knopf. Für Phase
4B braucht es hier zwei Ergänzungen und keinen Umbau: einen zweiten
Content-Type (`application/x-www-form-urlencoded`, aus dem `assertCsrf` ohnehin
schon lesen kann) und statt der 200 eine 303 zurück auf den Produktionstag.

KEIN AUDIT-LOG. Wer wann was umgestellt hat, wird nicht festgehalten — das
wäre eine Tabelle, die noch niemand gebraucht hat. Die Architektur steht dem
nicht im Weg: Der Anwendungsfall ist die eine Stelle, an der ein Statuswechsel
stattfindet.

## Was es noch nicht gibt

Kein Statuswechsel aus der **Oberfläche** (der Endpunkt dafür steht, der Knopf
kommt in Phase 4B) · kein Audit-Log · kein Bearbeiten von Positionen oder
Liefertag durch den Admin · keine Wochen- oder Mehrtagesansicht · keine Kunden- oder
Produktpflege ·
kein Passwort-/PIN-Wechsel · kein „Passwort vergessen" · kein 2FA · kein
Payment · kein Mailversand · kein R2 · keine Wiederbestellung · keine
Bestellhistorie für das Café · kein Ändern oder Stornieren · keine
Lieferplanung · keine Rechnungen · keine Analytics · kein Rate-Limiting.

## Stand

Phase 4A: gesicherter Statuswechsel im Backend. Ein angemeldeter Admin kann
den Status genau einer bestehenden Bestellung ändern — über einen Endpunkt,
nicht über einen Knopf. Die Oberfläche dazu ist Phase 4B und ausdrücklich
nicht gebaut.

**1045 Tests grün** (383 Domäne, 625 Worker/D1, 37 Oberfläche), Typecheck
sauber für Worker und Client, D1-Integration gegen eine frisch migrierte
lokale Datenbank in der Workers-Runtime.

Phase 4A hat **keine** Migration, **keine** Tabelle, **keinen** Index und
**keine** Dependency hinzugefügt. Am Datenmodell, an der Aggregation des
Produktionstags, an der Auth, an der serverseitigen Preisbildung und am
Bestellfluss wurde nichts geändert. Die Statusregeln stehen unverändert in
`domain/order-status.ts`; es ist keine zweite Fassung von ihnen entstanden.

Drei bestehende Dateien wurden angefasst, und jede aus einem Grund:
`domain/order-number.ts` bekam `parse()` — dieselbe Prüfung wie
`fromString()`, nur ohne Ausnahme, weil eine Nummer aus einem URL-Pfad Eingabe
ist und keine 500 auslösen darf. `http/order-api.ts` gab seine JSON-Körper-
Helfer an `http/json-body.ts` ab, statt sie ein zweites Mal zu bekommen.
`http/responses.ts` nimmt bei `methodNotAllowed()` jetzt zusätzliche
Kopfzeilen entgegen, damit auch eine 405 dieses Endpunkts `no-store` trägt.

Der Vorgang wurde gegen eine **frisch angelegte lokale D1** durchgespielt:
alle zehn Migrationen angewandt, Testkunde, Testadmin, Testcafé-Konto und eine
Bestellung samt Position angelegt, im laufenden `wrangler dev` per `curl`
angemeldet und der Status gewechselt. Die Zeile wurde danach direkt in der
Datenbank gelesen: `status` steht auf `confirmed`, `updated_at` ist neu — und
`order_number`, `customer_id`, `customer_name_snapshot`, `fulfillment_type`,
`fulfillment_date`, `delivery_address_snapshot`, `note`, `total_amount_cents`,
`submission_id` und `created_at` sind unverändert. `order_items` samt
`unit_price_cents` und `line_total_cents` ebenso. Es ist keine zweite
Bestellung entstanden. Ein Café bekam auf denselben Endpunkt `403`, eine
Anfrage ohne Sitzung `401`, ein verbotener Übergang `409`, ein unbekannter
Status `400`, eine unbekannte Bestellung `404`, ein fehlender CSRF-Token und
ein fremder Origin je `403`, ein `GET` eine `405`. Die Produktionsansicht aus
Phase 3C zeigte anschließend den neuen Status.

Vier Eigenschaften wurden zur Probe einzeln gebrochen; die zugehörigen Tests
wurden jedes Mal rot (Adminrollenprüfung entfernt 4, `canTransitionTo()`
umgangen 7, CSRF-Prüfung entfernt 3, Bedingung im `UPDATE` entfernt 4). Jede
Mutation wurde vollständig zurückgesetzt, die Suite danach erneut vollständig
grün.

Nichts deployed, nichts gepusht, nichts gemergt.

**Es hat kein Deployment stattgefunden.** Es wurde keine entfernte
D1-Datenbank angelegt; die `database_id` in `wrangler.jsonc` ist ein
Platzhalter aus Nullen und muss vor einem entfernten Betrieb ersetzt werden.
Es liegen keine Zugangsdaten im Repository.

### Aus Phase 3A offen

Diese Punkte gehören zur Inbetriebnahme und sind durch Phase 3B, 3C und 4A
unverändert:
`AUTH_PEPPER` wird erst beim echten Deployment als Cloudflare Secret gesetzt ·
die PBKDF2-Kosten der Anmeldung sind gegen das CPU-Budget von Workers Free
noch nicht abschließend bewertet · zusätzliche Rate-Limiting-Härtung über
Cloudflare ist sinnvoll, aber nicht eingerichtet.

Der Produktionstag berührt keinen davon: Er liest, aggregiert eine
zweistellige Zahl Zeilen und braucht kein Workers Paid. Die Oberfläche aus
Phase 3C fügt dem nichts hinzu — sie rendert dieselbe Antwort als HTML,
ohne zusätzliche Abfrage und ohne Skript. Der Statuswechsel aus Phase 4A
ebenfalls nicht: eine Leseabfrage, ein `UPDATE`, kein Hashen, keine
zusätzliche CPU-Last.
