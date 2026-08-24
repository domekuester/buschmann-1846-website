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
npm run db:migrate:local     # D1-Schema lokal anlegen
npm run db:seed:cafe:local   # fiktive Cafés, Sortiment und Entwicklungszugänge
npm run dev                  # Worker auf http://localhost:8787
```

Danach ist die Bestellseite erreichbar:

```text
http://127.0.0.1:8787/o/DEV-nur-lokal-Testcafe-Nord-kein-Echtbetrieb
```

> Dieser Token steht im Klartext in `seeds/002_cafe_ordering_dev.sql` und
> damit in jedem Klon. Er ist ausschließlich für die lokale Entwicklung. Einen
> echten Zugang stellt `npm run token:issue -- --customer <id>` aus; der
> Klartext erscheint dabei **genau einmal**, in der Datenbank landet nur sein
> SHA-256-Hash.

| Befehl | Zweck |
|---|---|
| `npm test` | alle Tests (Domäne + Worker/D1) |
| `npm run test:watch` | Tests im Watch-Modus |
| `npm run typecheck` | Worker (`tsc`) **und** Client (`tsconfig.ui.json`) |
| `npm run cf-typegen` | `worker-configuration.d.ts` neu erzeugen |
| `npm run db:migrate:local` | Migrationen auf die lokale D1 anwenden |
| `npm run db:seed:local` | allgemeine Platzhalterdaten |
| `npm run db:seed:cafe:local` | Café-Bestellung: fiktive Cafés + Entwicklungszugänge |
| `npm run token:issue -- --customer <id>` | echten Zugangstoken ausstellen |

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
│   └── order.ts           das Aggregat
│   ├── access-token.ts    Web-Crypto, SHA-256 — NIE Klartext in der DB
│   └── order.ts           das Aggregat
├── application/
│   ├── place-order.ts     der Anwendungsfall aus Phase 1
│   ├── place-cafe-order.ts  Bestellung über einen Café-Zugang
│   └── catalog-view.ts    was ein Café von einem Produkt sieht
├── infrastructure/d1/     Persistenz: prepare().bind(), batch()
├── ui/                    serverseitiges HTML, Preis-/Datumsformat, Escaping
└── http/                  Routen, Sicherheitsheader, Fehlergrenze

migrations/                D1-Schema, von Wrangler angewandt
seeds/                     ausschließlich erfundene Daten
scripts/                   Zugangstoken ausstellen (schreibt NICHT selbst)
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

## Der Café-Zugang

Ein Stammcafé bekommt einen persönlichen Link und **kein Passwort**:

```text
/o/<43 Zeichen aus 32 Byte crypto.getRandomValues>
```

Wer den vollständigen Link besitzt, darf für dieses Café bestellen — ein
Capability Link, und zwar als bewusste Entscheidung: Eine Anmeldung würde das
Produktziel „schneller als WhatsApp" zunichtemachen.

Was daraus folgt:

* In D1 steht **ausschließlich** `sha256(token)`. Kein KDF und kein Salt —
  beides schützt schwache Geheimnisse gegen Offline-Raten; gegen 256 Bit
  gleichverteilten Zufall gibt es weder ein Rateverfahren noch eine Tabelle.
* Unbekannt, widerrufen, formal falsch und „Café deaktiviert" erzeugen eine
  **zeichenweise identische** Antwort. Es wird nicht preisgegeben, ob ein Café
  existiert.
* Zugänge sind widerrufbar und rotierbar; mehrere aktive Zugänge je Café sind
  erlaubt, damit ein Wechsel ohne Unterbrechung möglich ist.
* Die API authentifiziert über den Header `X-Order-Token`, nicht über ein
  Cookie. Damit gibt es keine ambiente Autorität und CSRF ist konstruktiv
  ausgeschlossen.

Vollständiges Bedrohungsmodell samt der bewusst verworfenen Alternative
(Token im URL-Fragment) und dem verbleibenden Restrisiko in den
Cloudflare-Logs: siehe [Phase-2-Spezifikation](../docs/superpowers/specs/2026-08-24-buschmann-cafe-ordering-design.md).

## Was es noch nicht gibt

Kein Admin-Dashboard · kein Kundenkonto · kein Payment · kein Mailversand ·
kein R2 · keine Wiederbestellung · keine Bestellhistorie für das Café · kein
Ändern oder Stornieren · keine Lieferplanung · keine Rechnungen · keine
Analytics · kein Rate-Limiting.

## Stand

405 Tests grün, Typecheck sauber (Worker und Client), Migrationen 0001–0007
lokal ausgeführt, Bestellfluss lokal durchgespielt.

**Es hat kein Deployment stattgefunden.** Es wurde keine entfernte
D1-Datenbank angelegt; die `database_id` in `wrangler.jsonc` ist ein
Platzhalter aus Nullen und muss vor einem entfernten Betrieb ersetzt werden.
Es liegen keine Zugangsdaten im Repository.
