# RELEASE — Inbetriebnahme des Buschmann Order System

Stand: Phase 8A (2026-08-27) · Branch `feature/order-system-release-hardening`

**In Phase 8A hat KEIN Deployment stattgefunden.** Keine entfernte D1 wurde
angelegt, kein Secret gesetzt, keine DNS-Änderung vorgenommen, keine
Produktionsbestellung erzeugt. Dieses Dokument beschreibt, wie ein Deployment
ablaufen MUSS — es ist die Voraussetzung für Phase 8B.

Jeder Befehl hier wurde gegen die tatsächlich installierte Wrangler-Version
ausprobiert. Wo eine Fähigkeit fehlt, steht das ausdrücklich dabei; es sind
keine Flags erfunden.

---

## 0. Werkzeugstand

| Werkzeug | Version (in 8A geprüft) |
|---|---|
| Wrangler | 4.125.0 |
| Node | v24.18.0 |
| Vitest | 4.1.11 |

`wrangler` wird über `npx` aus den devDependencies benutzt — nicht global
installieren. Eine andere Wrangler-Hauptversion kann andere Flags haben; dann
ist dieses Dokument vor dem Deployment erneut zu prüfen.

---

## 1. Was vor 8B noch entschieden werden muss

Zwei Dinge stehen NICHT im Repository und lassen sich aus ihm auch nicht
ableiten. Sie sind die einzigen echten Eingaben, die von außen kommen müssen.

### 1.1 Die Produktionsdomain — USER INPUT REQUIRED

`README.md` nennt `buschmann1846.de` als *gestaltete Absicht* („Alles
First-Party auf buschmann1846.de"). Das ist eine Designaussage, keine
Konfiguration:

* `wrangler.jsonc` enthält **keinen** `routes`-Eintrag und keine Custom Domain.
* Ob die Zone `buschmann1846.de` überhaupt bei Cloudflare liegt, geht aus dem
  Repository nicht hervor. Die Website läuft laut Projektstand auf GitHub
  Pages.
* Offen ist außerdem, ob das Bestellsystem auf der **Apex-Domain** oder auf
  einer **Subdomain** (z. B. `bestellen.buschmann1846.de`) laufen soll. Das ist
  keine Kosmetik: `APP_ORIGIN` muss exakt dieser Host sein, und das
  `__Host-`-Sitzungscookie gilt exakt für den setzenden Host.

**Nicht raten.** Ohne diese Entscheidung kann `APP_ORIGIN` nicht gesetzt
werden, und ohne `APP_ORIGIN` lehnt der Worker jeden schreibenden Request ab
(fail closed, so gebaut).

### 1.2 Die entfernte D1-Datenbank — USER INPUT REQUIRED

`wrangler.jsonc` trägt bewusst einen Platzhalter:

```jsonc
"database_name": "buschmann-orders-local",
"database_id": "00000000-0000-0000-0000-000000000000"
```

Vor dem Deployment muss eine echte D1 angelegt und beides ersetzt werden.

---

## 2. Umgebungsvertrag

| | LOCAL | TEST (Wegwerf) | PRODUCTION |
|---|---|---|---|
| `ENVIRONMENT` | `development` | `development` | **nicht setzen** oder alles außer `development` |
| `APP_ORIGIN` | `http://127.0.0.1:8787` | `http://127.0.0.1:<port>` | `https://<Produktionsdomain>` ← offen, siehe 1.1 |
| `AUTH_PEPPER` | öffentlicher Platzhalter aus `.dev.vars.example` | Testwert aus `vitest.config.ts` | **256-Bit-Zufall als Cloudflare Secret** |
| D1-Binding | `DB` | `DB` | `DB` |
| D1-Datenbank | lokale Miniflare-Datei | `--persist-to <tmp>` | echte D1 ← offen, siehe 1.2 |
| Cookiename | `buschmann_session_dev` | `buschmann_session_dev` | `__Host-buschmann_session` |
| Secure-Cookie | nein | nein | ja |

Die Regel, die das zusammenhält, steht in `src/config/app-config.ts`:
**genau das Wort `development` schaltet die Entwicklungspolicy frei — alles
andere, auch ein Tippfehler und auch ein fehlender Wert, ist Produktion.**
Zusätzlich bricht der Start ab, wenn `development` mit einem `https`-Origin
oder Produktion mit einem `http`-Origin kombiniert wird.

---

## 3. Benötigte Werte — NUR NAMEN

Es stehen keine Werte in diesem Dokument und keine im Repository.

| Name | Art | Pflicht | Wofür | Mindestanforderung | Fehlt er? |
|---|---|---|---|---|---|
| `AUTH_PEPPER` | **Secret** | ja | HMAC-Schlüssel vor PBKDF2 in der Credential-Verifikation | ≥ 32 Zeichen; vorgesehen ist ein base64url-kodierter 256-Bit-Zufall (43 Zeichen) | keine Anmeldung; `500` ohne Details |
| `APP_ORIGIN` | Variable | ja | erwarteter Origin JEDES schreibenden Requests | exakt ein Origin: Schema + Host + ggf. Port, kein Pfad, kein Schrägstrich am Ende | jeder Schreibzugriff `403` |
| `ENVIRONMENT` | Variable | nein* | schaltet Cookie-Policy | `development` oder gar nicht | fehlend = **Produktion** (gewollt) |

\* nicht setzen ist in Produktion der sichere Fall.

`AUTH_PEPPER` gehört als Cloudflare **Secret** gesetzt (nicht als `vars`), weil
`wrangler.jsonc` eingecheckt ist. `npm run release:guard` schlägt fehl, wenn
einer der drei Namen dort als `vars`-Eintrag auftaucht.

Pepper erzeugen (der Wert darf nirgends protokolliert oder eingecheckt werden):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

---

## 4. Release Check — vor jedem Deployment

```bash
cd order-system
npm run release:check
```

Bündelt, ohne jeden Netz- oder Produktionszugriff:

1. `npm run typecheck` — beide TypeScript-Projekte
2. `npm run test` — die vollständige Suite
3. `npm run db:verify:migrations` — vollständige Migrationskette gegen eine
   **Wegwerf-D1** unter `os.tmpdir()`; prüft Idempotenz, Schemavollständigkeit,
   `d1_migrations`-Buch, `PRAGMA foreign_key_check` und die sicheren
   Voreinstellungen in `order_policy`
4. `npm run release:guard` — `wrangler.jsonc`, keine Geheimnisse in Git, alle
   referenzierten `/assets/*` vorhanden, `git diff --check`

`db:verify:migrations` übergibt jedem Wrangler-Aufruf `--persist-to` und fasst
die persönliche Entwicklungsdatenbank unter `.wrangler/state` **nicht** an.
Keines der Skripte kennt `--remote`.

---

## 5. Backup

### 5.1 Der Befund, der das Verfahren bestimmt

**Ein `wrangler d1 export` lässt sich NICHT unverändert zurückspielen.**

Der Export schreibt die Tabellen in ihrer Entstehungsreihenfolge und hängt die
Zeilen jeder Tabelle unmittelbar hinter deren `CREATE TABLE`. Für dieses Schema
ergibt das eine Datei, die D1 zurückweist:

```
0001  CREATE TABLE customers                     ← ganz vorne
0013  ALTER TABLE customers ADD price_list_id REFERENCES price_lists
0012  CREATE TABLE price_lists                   ← viel weiter hinten
```

Die Zeilen von `customers` werden also eingefügt, bevor `price_lists`
existiert. D1 prüft Fremdschlüssel beim Einfügen und bricht ab:

```
✘ [ERROR] no such table: main.price_lists: SQLITE_ERROR
```

Dasselbe gilt für `products` → `catalog_products` aus 0014. Geprüft und
verworfen wurden beide naheliegenden Auswege: `PRAGMA foreign_keys=OFF` wird
von D1 ignoriert, und das `PRAGMA defer_foreign_keys=TRUE`, das der Export
selbst mitbringt, wirkt nur innerhalb einer Transaktion — `d1 execute --file`
führt jede Anweisung einzeln aus.

Deshalb gehört zu jedem Backup ein Umsortierschritt.

### 5.2 Sichern

```bash
cd order-system

# 1. Rohsicherung aus der entfernten D1
npx wrangler d1 export <DATENBANKNAME> --remote \
    --output "backup-$(date -u +%Y%m%dT%H%M%SZ).sql" -y

# 2. In eine einspielbare Reihenfolge bringen (verändert KEINE Anweisung,
#    sortiert nur um: erst alle CREATE TABLE, dann die INSERTs in
#    Fremdschlüsselreihenfolge, dann die Indizes)
npm run db:restore:order -- backup-<STAMP>.sql restore-<STAMP>.sql
```

Beide Dateien aufbewahren. Die Rohsicherung ist das Original; die umsortierte
ist das, was im Ernstfall eingespielt wird.

### 5.3 Sicherung verifizieren — nicht überspringen

Eine Sicherung, die niemand eingespielt hat, ist eine Vermutung. Prüfung ohne
jede Produktionsberührung, gegen eine Wegwerf-D1:

```bash
TMP=$(mktemp -d)
npx wrangler d1 execute DB --local --persist-to "$TMP" --file restore-<STAMP>.sql -y
npx wrangler d1 execute DB --local --persist-to "$TMP" \
    --command "SELECT COUNT(*) FROM orders;" --json
npx wrangler d1 execute DB --local --persist-to "$TMP" \
    --command "PRAGMA foreign_key_check;" --json   # muss results: [] liefern
rm -rf "$TMP"
```

Die Zeilenzahlen müssen zu denen der Quelle passen.

### 5.4 Was D1 nicht kann

`PRAGMA integrity_check` wird von D1 abgelehnt (`not authorized: SQLITE_AUTH`).
Er ist nur lokal auf einer Datei möglich (`sqlite3 <datei> "PRAGMA
integrity_check;"`). `PRAGMA foreign_key_check` funktioniert dagegen über
`wrangler d1 execute` und ist damit der Integritätsnachweis, der in Produktion
zur Verfügung steht.

---

## 6. Runbook: Produktions-Migration

Kein „einfach `wrangler deploy`".

1. **Release-Commit festhalten**
   ```bash
   git rev-parse HEAD        # notieren, gehört ins Deploymentprotokoll
   git status --short        # MUSS leer sein
   ```

2. **Release Check**
   ```bash
   npm run release:check
   ```

3. **Backup ziehen und umsortieren** — Abschnitt 5.2

4. **Backup verifizieren** — Abschnitt 5.3. Erst wenn das durchläuft, geht es
   weiter. Ohne verifizierte Sicherung wird nicht migriert.

5. **Sehen, was anstünde, bevor etwas passiert**
   ```bash
   npx wrangler d1 migrations list <DATENBANKNAME> --remote
   ```
   Der Befehl zeigt die **noch nicht angewandten** Migrationsdateien. Bei einer
   frischen Produktionsdatenbank sind das alle 17; bei einer bestehenden nur
   die neuen. Kommt hier etwas Unerwartetes, wird nicht migriert.

6. **Migrationen anwenden**
   ```bash
   npx wrangler d1 migrations apply <DATENBANKNAME> --remote
   ```

7. **Integrität prüfen**
   ```bash
   npx wrangler d1 execute <DATENBANKNAME> --remote \
       --command "PRAGMA foreign_key_check;" --json      # results: []
   npx wrangler d1 execute <DATENBANKNAME> --remote \
       --command "SELECT COUNT(*) FROM d1_migrations;" --json
   ```

8. **Deployen**
   ```bash
   npx wrangler deploy
   ```

9. **Secrets setzen** (einmalig bzw. bei Rotation)
   ```bash
   npx wrangler secret put AUTH_PEPPER
   ```
   `APP_ORIGIN` und `ENVIRONMENT` werden als Umgebungsvariablen der
   Produktionsumgebung gesetzt — `ENVIRONMENT` in Produktion am besten gar
   nicht.

10. **Smoke** — Abschnitt 8

11. **Abbruchkriterium.** Zurückgerollt wird, wenn eines davon eintritt:
    `/api/health` liefert nicht `{"status":"ok"}` · eine Anmeldung ist nicht
    möglich · `PRAGMA foreign_key_check` liefert Zeilen · eine bestehende
    Bestellung fehlt oder trägt einen anderen Betrag als vor der Migration.

---

## 7. Rollback und Recovery — zwei verschiedene Dinge

### 7.1 Code-Rollback (schnell, ungefährlich)

```bash
npx wrangler versions list          # die 10 jüngsten Versionen des Workers
npx wrangler rollback <VERSION_ID>  # ACHTUNG: Version-ID, nicht Deployment-ID
npx wrangler deployments list       # zur Nachschau, welches Deployment aktiv war
```

`wrangler rollback` erwartet eine **Version**-ID. Die liefert `versions list`;
`deployments list` zeigt Deployments und ist zur Einordnung nützlich, aber
seine IDs gehören nicht in `rollback`.

Setzt ausschließlich den Worker-Code zurück. **Das Schema bleibt, wie die
Migration es hinterlassen hat.** Ein Code-Rollback über eine Migration hinweg
ist nur dann unbedenklich, wenn die ältere Codefassung mit dem neueren Schema
läuft — bei 0016 und 0017 ist das der Fall, weil beide rein additiv sind
(neue Tabelle, zwei nullable Spalten).

### 7.2 Database Recovery (langsam, ernst)

**D1-Migrationen sind nicht automatisch reversibel, und es gibt in diesem
Repository bewusst keine Down-Migrationen.** Eine erfundene Down-Migration wäre
gefährlicher als keine: Sie sieht aus wie ein Rückweg und wirft dabei Daten weg.

Der einzige Rückweg ist die Sicherung:

1. Worker außer Betrieb nehmen oder Route entfernen, damit nichts
   dazwischenschreibt.
2. Aktuellen (kaputten) Stand trotzdem sichern — für die Fehlersuche.
3. Sicherung einspielen:
   ```bash
   npx wrangler d1 execute <DATENBANKNAME> --remote --file restore-<STAMP>.sql -y
   ```
   Zielt auf eine **leere** Datenbank. In eine bereits gefüllte einzuspielen
   erzeugt Konflikte mit den `UNIQUE`-Bedingungen.
4. `PRAGMA foreign_key_check` und Zeilenzahlen gegen die Sicherung vergleichen.
5. Smoke.

Der Datenverlust ist der Zeitraum zwischen Sicherung und Störung. Das ist das
Argument dafür, dass Schritt 3 des Runbooks nicht übersprungen wird.

---

## 8. Smoke Test nach dem Deployment

Reihenfolge ist Absicht: erst lesen, dann anmelden, dann schreiben.

| # | Prüfung | Erwartung |
|---|---|---|
| 1 | `GET /api/health` | `200` · `{"status":"ok","database":"reachable"}` |
| 2 | `GET /login` | `200` · `Cache-Control: no-store` · CSP-Header vorhanden |
| 3 | Admin-Anmeldung | `303` → `/admin` · `Set-Cookie: __Host-buschmann_session…; Secure; HttpOnly; SameSite=Lax` |
| 4 | `GET /admin/dashboard` | `200`, Kennzahlen des Tages |
| 5 | `GET /admin` | `200`, Produktionstag |
| 6 | `GET /admin/catalog` | `200`, Sortiment mit Preisen |
| 7 | `GET /admin/customers` | `200` |
| 8 | `GET /admin/bestellregeln` | `200`, gespeicherte Regeln |
| 9 | Café-Anmeldung | `303` → `/bestellen` |
| 10 | `GET /bestellen` | `200`, Preise der richtigen Preisgruppe |
| 11 | Testbestellung (siehe 9) | `201`, Betrag stimmt mit der Preisliste |
| 12 | Bestellung im Adminbereich sichtbar | Betrag identisch |
| 13 | Statuswechsel `new → confirmed` | `303`, Status übernommen |
| 14 | Zahlung eintragen | `303`, `payment_status` gesetzt |
| 15 | `GET /admin/production-list?date=…` | `200`, druckbar, **keine** Kosten/Kontaktdaten |
| 16 | `GET /admin/abholliste?date=…` | `200`, dito |
| 17 | Abmelden | `303` → `/login`, Sitzung serverseitig widerrufen |

Adversarial, ebenfalls nach dem Deployment:

| Prüfung | Erwartung |
|---|---|
| `/admin` ohne Sitzung | `303` → `/login` |
| Admin-API ohne Sitzung | `401` |
| Café-Sitzung auf `/admin` | `403` |
| `POST` mit fremdem `Origin` | `403` |
| `POST` ohne `Origin` | `403` |
| `POST` ohne/mit falschem CSRF-Token | `403` |
| Preis im Request manipuliert | Serverpreis gewinnt |

---

## 9. Testdatenstrategie in Produktion

**Die Entwicklungsseeds dürfen NIEMALS in Produktion.**
`seeds/002_cafe_ordering_dev.sql` enthält öffentlich bekannte Zugangsdaten im
Klartext; sie stehen in Git und in jedem Klon.

Die Punkte 1–10 und 15–17 des Smoke laufen **ohne jeden Schreibvorgang**. Nur
11–14 schreiben. Wenn dafür eine Bestellung nötig ist:

* Sie wird über ein **ausdrücklich dafür angelegtes Testcafé** aufgegeben,
  nicht über einen echten Kunden.
* Der Kunde heißt erkennbar so, z. B. `ZZ-SMOKETEST`, und ist in der
  Kundenliste sofort als Test erkennbar.
* Die Notiz der Bestellung trägt `SMOKETEST <Datum>`.
* Sie wird unmittelbar danach auf `cancelled` gesetzt. Stornierte Bestellungen
  sind aus Umsatz, Kosten, Rohertrag und Marge ausgeschlossen (in 8A
  nachgewiesen) und verfälschen die Auswertung deshalb nicht.
* Gelöscht wird nichts. Eine Bestellung ist ein Dokument; eine stornierte
  Testbestellung ist ehrlicher als eine gelöschte Zeile.

Nach dem ersten erfolgreichen Smoke sollte der Testkunde deaktiviert werden —
dann kann sich niemand mehr über ihn anmelden.

---

## 10. Was in Produktion nicht passieren darf

* Kein `--remote` in einem der Prüfskripte. Sie kennen das Flag nicht.
* Kein Einspielen von `seeds/*` in die Produktionsdatenbank.
* Kein `AUTH_PEPPER` in `wrangler.jsonc`, in `vars` oder in einer eingecheckten
  Datei. `npm run release:guard` bricht darauf ab.
* Kein `ENVIRONMENT=development` in Produktion — das stellt Sitzungscookies
  ohne `Secure` aus.
* Keine Migration ohne verifizierte Sicherung.
* Keine Änderung an `.dev.vars` mit dem Ziel, sie zu committen. Sie steht in
  `.gitignore` und bleibt dort.

---

## 11. Bekannte Betriebseigenschaften

Kein Fehler, aber gut, es vorher zu wissen:

* **Lücken in den Bestellnummern sind normal.** Die Nummer wird reserviert,
  bevor die Bestellung endgültig geschrieben ist; eine abgelehnte Bestellung
  verbraucht sie. `BUS-2026-000002` kann fehlen, ohne dass etwas kaputt ist.
  Die Spalte ist `UNIQUE`, eine Kollision ist ausgeschlossen.
* **Eine zweite Anmeldung beendet die erste.** Beim Anmelden werden alle
  bestehenden Sitzungen des Kontos widerrufen (Schutz gegen Session Fixation).
  Ein Café, das sich auf einem zweiten Gerät anmeldet, ist auf dem ersten
  abgemeldet.
* **Fünf Fehlversuche sperren ein Konto für 15 Minuten.** Ein richtiges
  Geheimnis setzt den Zähler zurück. Ein Anrufer, der dreimal falsch getippt
  hat, muss unter Umständen warten.
* **`/api/health` braucht keine Auth-Konfiguration** und antwortet auch dann,
  wenn `AUTH_PEPPER` fehlt. Das ist Absicht: Sonst wäre nicht zu unterscheiden,
  ob der Worker läuft oder nur falsch eingerichtet ist.
