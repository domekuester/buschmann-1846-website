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
│   ├── auth-role.ts       genau zwei Rollen: customer, admin
│   └── login-identifier.ts  Normalisierung, idempotent, mit Zeichen-Allowlist
├── config/
│   └── app-config.ts      Pepper, Origin, Umgebung — fail closed
├── application/
│   ├── place-order.ts     der Anwendungsfall aus Phase 1
│   ├── place-cafe-order.ts  Bestellung für ein Café aus der Sitzung
│   ├── log-in.ts          Anmeldung: zwei Ausgänge, ein generisches Nein
│   ├── authenticate-request.ts  Sitzung → AuthContext, bei JEDEM Request neu
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

## Was es noch nicht gibt

Kein Admin-Dashboard · keine Tagesansicht · keine Kunden- oder Produktpflege ·
kein Passwort-/PIN-Wechsel · kein „Passwort vergessen" · kein 2FA · kein
Payment · kein Mailversand · kein R2 · keine Wiederbestellung · keine
Bestellhistorie für das Café · kein Ändern oder Stornieren · keine
Lieferplanung · keine Rechnungen · keine Analytics · kein Rate-Limiting.

## Stand

Phase 3A: First-Party-Authentifizierung. Der Capability-Link aus Phase 2 ist
kein aktiver Anmeldeweg mehr — der Bestellfluss läuft vollständig über
Kundensitzung, Origin-Prüfung und CSRF-Token, und die Phase-2-Regressionstests
laufen unverändert gegen den neuen Weg.

Typecheck sauber für Worker und Client, Migrationen 0001–0010 lokal
ausgeführt, nichts deployed und nichts gepusht. Die aktuelle Testzahl steht im
Abschlussbericht der Phase.

**Es hat kein Deployment stattgefunden.** Es wurde keine entfernte
D1-Datenbank angelegt; die `database_id` in `wrangler.jsonc` ist ein
Platzhalter aus Nullen und muss vor einem entfernten Betrieb ersetzt werden.
Es liegen keine Zugangsdaten im Repository.
