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
npm run db:seed:local        # Platzhalterdaten (keine echten Kunden/Preise)
npm run dev                  # Worker auf http://localhost:8787
curl http://localhost:8787/api/health
```

| Befehl | Zweck |
|---|---|
| `npm test` | alle Tests (Domäne + Worker/D1) |
| `npm run test:watch` | Tests im Watch-Modus |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run cf-typegen` | `worker-configuration.d.ts` neu erzeugen |
| `npm run db:migrate:local` | Migrationen auf die lokale D1 anwenden |
| `npm run db:seed:local` | Platzhalterdaten einspielen |

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
├── application/
│   └── place-order.ts     der einzige vollständige Anwendungsfall
├── infrastructure/d1/     Persistenz: prepare().bind(), batch()
└── http/                  Response-Formen, Health

migrations/                D1-Schema, von Wrangler angewandt
seeds/                     ausschließlich Platzhalterdaten
tests/domain/              laufen OHNE Worker-Runtime und OHNE D1
tests/d1/  tests/http/     laufen in der echten Runtime gegen echte D1
public/                    Platz für die Bestelloberfläche (Phase 2)
```

### Warum die Domäne nichts von D1 weiß

`vitest.config.ts` definiert zwei Testprojekte. Das Projekt `domain` läuft in
schlichtem Node — ohne Workers-Runtime, ohne Datenbank, ohne Netz. Hinge die
Geschäftslogik an einer dieser Sachen, ließen sich ihre Tests nicht ausführen.
Die Schichtentrennung ist damit keine Absichtserklärung, sondern eine
Bedingung, die bei jedem Testlauf geprüft wird.

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

## Was Phase 1 noch nicht enthält

Keine Bestelloberfläche · keine Bestell-API · kein Admin-Dashboard · kein
Login · kein Payment · kein Mailversand · kein Turnstile · kein R2 · keine
Wiederbestellung · keine Lieferplanung · keine Rechnungen · keine Analytics.

`placeOrder` existiert als Anwendungsfall und ist gegen eine echte Datenbank
getestet, aber kein HTTP-Endpunkt ruft ihn auf. Ein Endpunkt ohne Oberfläche
wäre eine Zusage, die später eingehalten werden müsste.

## Stand

173 Tests grün (120 Domäne, 53 Worker/D1), Typecheck sauber, Migrationen lokal
ausgeführt, Worker lokal verifiziert.

**Es hat kein Deployment stattgefunden.** Es wurde keine entfernte
D1-Datenbank angelegt; die `database_id` in `wrangler.jsonc` ist ein
Platzhalter aus Nullen und muss vor einem entfernten Betrieb ersetzt werden.
Es liegen keine Zugangsdaten im Repository.
