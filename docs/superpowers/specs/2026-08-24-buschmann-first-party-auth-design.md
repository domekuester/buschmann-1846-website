# Buschmann 1846 — First-Party Authentication (Phase 3A)

Stand: 2026-08-24
Branch: `feature/order-system-first-party-auth`
Vorgänger: Phase 2 (Café-Bestellung über Capability-Link), 410 Tests grün

---

## 1. Problem

Phase 2 authentifiziert ein Café über einen **Capability-Link**: Wer `/o/<token>`
besitzt, darf für dieses Café bestellen. Das war für einen Bestellfluss ohne
Anmeldung die richtige Entscheidung — es hat aber drei Eigenschaften, die auf
Dauer nicht tragen:

1. **Der Zugang ist der Link.** Weitergeleitete Nachrichten, geteilte
   Tresengeräte, Browserverläufe und Lesezeichen sind alle gleichwertige
   Kopien des Geheimnisses. Es gibt keinen Weg, einen einzelnen Zugriff zu
   beenden, ohne allen Zugriff zu beenden.
2. **Es gibt keine Rolle.** Ein Buschmann-Mitarbeiter kann sich mit diesem
   Modell überhaupt nicht ausweisen. Alles, was über „Café bestellt" hinausgeht
   — und das ist der gesamte Betriebsteil des Systems —, hat keine
   Autorisierungsgrundlage.
3. **Es gibt keine Sitzung.** Es gibt damit auch nichts, was ablaufen,
   widerrufen oder rotiert werden könnte.

Phase 3A ersetzt das durch eine **First-Party-Authentifizierung**: eine eigene
Loginseite auf `buschmann1846.de`, serverseitig bestimmte Rollen und eine
Sitzung im Cookie.

### Was ausdrücklich NICHT das Problem ist

Es geht nicht darum, möglichst viel Auth-Technik einzubauen. Es geht um die
**kleinste sichere Architektur**, die Buschmann langfristig trägt und die für
ein Café in der Frühschicht nicht im Weg steht.

---

## 2. UX-Ziele

### 2.1 Eine Domain, ein Tab, keine fremde Loginseite

Cloudflare bleibt vollständig Infrastruktur — Hosting, Worker-Runtime, D1,
Netz. Für den Benutzer ist Cloudflare unsichtbar. Es gibt **keine sichtbare
Cloudflare-Access-Oberfläche**, keine zweite Domain, kein Popup, keinen zweiten
Tab und keine Weiterleitung zu Google, Microsoft, Auth0, Clerk, Supabase oder
Firebase.

Öffentliche Struktur:

```
https://buschmann1846.de/
https://buschmann1846.de/login
https://buschmann1846.de/bestellen
https://buschmann1846.de/admin
https://buschmann1846.de/api/...
```

### 2.2 Genau eine Loginseite

`/login` zeigt ein sehr kleines Formular: Kennung, Geheimnis, Anmelden.

Es gibt **keine Auswahl** „Ich bin Café" / „Ich bin Admin". Die Rolle steht am
Account, nicht in der Anfrage. Eine Rollenauswahl im Formular wäre nicht nur
ein überflüssiger Tap — sie wäre eine Auskunft darüber, welche Rollen es gibt,
und die Versuchung, sie irgendwann zu glauben.

### 2.3 Der Café-Fluss

```
buschmann1846.de
        ↓
   Bestellen
        ↓
  Session gültig?
   ↙            ↘
 ja             nein
 ↓                ↓
/bestellen      /login
                  ↓
          Kundencode + PIN
                  ↓
             /bestellen
```

Ein Stammcafé soll sich **selten** anmelden müssen: Die Kundensitzung läuft
30 Tage. Nach dem Login steht sofort die Phase-2-Bestelloberfläche — keine
Profilseite, kein Begrüßungs-Wizard, kein zweiter Bestätigungsschritt.

### 2.4 Der Admin-Fluss

`/admin` mit gültiger Admin-Sitzung → Adminbereich. Ohne Sitzung → `/login`,
danach zurück nach `/admin`. Alles im selben Tab.

---

## 3. Architektur

### 3.1 Modulgrenzen

Die Domänenmodelle (`Money`, `Product`, `Customer`, `Order`, `OrderItem`)
wissen **nicht**, wie Login, Cookies, Sitzungen oder Credential-Speicherung
funktionieren. Sie wussten es in Phase 1 und 2 nicht und sollen es auch danach
nicht wissen.

```
src/
├── domain/
│   ├── auth-role.ts              Rolle als Wert (customer | admin)
│   ├── login-identifier.ts       Normalisierung, ohne D1, ohne HTTP
│   └── … (unverändert)
├── application/
│   ├── log-in.ts                 Anwendungsfall Anmeldung
│   ├── log-out.ts                Anwendungsfall Abmeldung
│   ├── authenticate-request.ts   Sitzung → AuthContext
│   └── place-cafe-order.ts       (angebunden an AuthContext statt Token)
├── infrastructure/
│   ├── auth/
│   │   ├── credential.ts         PBKDF2 + Pepper, Web Crypto
│   │   ├── session-token.ts      Zufall, SHA-256
│   │   └── cookie.ts             Cookie-Policy, Parsen, Setzen, Löschen
│   └── d1/
│       ├── auth-account-repository.ts
│       └── auth-session-repository.ts
├── http/
│   ├── auth-routes.ts            GET/POST /login, POST /logout
│   ├── session-api.ts            GET /api/auth/session
│   ├── guard.ts                  Rollen-Autorisierung an der HTTP-Grenze
│   ├── admin-page.ts             minimale Admin-Shell
│   ├── order-page.ts             (auf /bestellen umgestellt)
│   └── order-api.ts              (auf Session + CSRF umgestellt)
├── ui/
│   ├── login-page-html.ts
│   └── admin-page-html.ts
├── config/
│   └── app-config.ts             Env → geprüfte Konfiguration, fail closed
└── worker.ts
```

**`infrastructure/auth/` und nicht `domain/auth/`:** PBKDF2, Cookies und
SHA-256 sind Technik, keine Fachlichkeit. Was fachlich ist — was eine Rolle
ist, wie eine Kennung normalisiert wird — liegt in `domain/` und ist ohne
Worker-Runtime testbar.

### 3.2 Trust Boundaries

| Grenze | Was passiert |
|---|---|
| Browser → Worker | **Alles** aus der Anfrage ist unvertrauenswürdig: Körper, Kopfzeilen, Cookie, Pfad. Auch das Cookie — es beweist nur, dass jemand einen Sitzungstoken besitzt. |
| Worker → D1 | Ausschließlich parametrisierte Abfragen. Die Datenbank ist die zweite Verteidigungslinie (CHECK, UNIQUE, FK), nie die erste. |
| Worker → Antwort | Nichts, was aus einem Fehler, einem Hash, einem Token oder einem Pepper stammt, verlässt den Worker. Die Fehlergrenze bildet konstante Körper, sie leitet keine Meldungen weiter. |
| Session → Identität | Ein Sitzungstoken beweist **nicht**, dass der Account noch gültig ist. Rolle, Account-Aktivität und Kunden-Aktivität werden bei **jedem** geschützten Request neu aus D1 gelesen. |

Der Client ist nirgends Autorität. Er bestimmt weder Rolle noch Kunde noch
Preis.

---

## 4. Threat Model

| # | Bedrohung | Gegenmaßnahme in Phase 3A |
|---|---|---|
| T1 | **Credential-Diebstahl aus einem D1-Dump.** Angreifer erhält die Datenbank. | Kein Klartext. PBKDF2-HMAC-SHA256, 600 000 Iterationen, individueller 16-Byte-Salt, zusätzlich ein serverseitiger 256-Bit-**Pepper**, der nicht in D1 liegt. Ohne Pepper ist ein Offline-Angriff nicht durchführbar. |
| T2 | **Vollständige Serverkompromittierung** (Dump **und** Pepper). | Der Work Factor kauft Zeit, keine Sicherheit — siehe §7.4. Eingestanden und dokumentiert, nicht wegdefiniert. |
| T3 | **Online-Bruteforce gegen einen PIN.** 10⁸ Möglichkeiten. | Fehlversuchszähler je Account, ab 5 Fehlversuchen 15 Minuten Cooldown. Erfolgreicher Login setzt zurück. |
| T4 | **User Enumeration.** Existiert `CAFE27`? | Identische generische Fehlermeldung für alle sechs Ablehnungsgründe, identischer Statuscode, identische Antwortform. Für unbekannte Kennungen läuft eine **Dummy-Verifikation** mit demselben Work Factor. |
| T5 | **Session-Diebstahl über XSS.** | `HttpOnly` (JavaScript liest das Cookie nie), strikte CSP ohne `unsafe-inline`, keine Drittanbieter-Ressourcen, konsequentes HTML-Escaping (aus Phase 2 übernommen). |
| T6 | **Session-Diebstahl über das Netz.** | `Secure` in Produktion erzwungen, `__Host-`-Präfix. |
| T7 | **CSRF.** Fremde Seite löst eine Bestellung oder ein Logout aus. | Synchronizer-CSRF-Token je Sitzung + `SameSite=Lax` + Origin-Prüfung. Alle drei, nicht eines. |
| T8 | **Session Fixation.** | Nach erfolgreichem Login wird **immer** eine neue Sitzung erzeugt; eine vorhandene wird widerrufen, nie übernommen. |
| T9 | **Privilege Escalation.** Café ruft `/admin` oder eine Admin-API auf. | Rolle kommt aus D1, nie aus der Anfrage. Serverseitige Prüfung an jedem geschützten Endpunkt, nicht an der Navigation. |
| T10 | **Cross-Customer-Zugriff.** Café A bestellt für Café B. | `customer_id` kommt ausschließlich aus dem `AuthContext`. Es gibt keine Codestelle, die eine Kunden-ID aus der Anfrage liest. |
| T11 | **Open Redirect** über ein `next`-Ziel. | Es gibt **kein** `next`-Konzept. Das Redirect-Ziel ist eine Funktion der Rolle, sonst nichts. |
| T12 | **Authentifizierte Antwort im öffentlichen Cache.** | `Cache-Control: no-store` auf allen sitzungsabhängigen Antworten, getestet. |
| T13 | **Lockout-DoS.** Angreifer sperrt ein Café absichtlich aus. | Sperre ist zeitlich begrenzt (15 Min) und läuft automatisch ab. Keine manuelle Entsperrung nötig. Der Trade-off ist ausdrücklich akzeptiert — siehe §8.3. |
| T14 | **CPU-DoS über die Dummy-Verifikation.** Jeder Fehlversuch kostet 600 000 Iterationen. | In Phase 3A nur eingestanden, nicht behandelt. Cloudflare Rate Limiting / Turnstile ist die Antwort und ausdrücklich Phase 3B+ — siehe §14 Risiken. |
| T15 | **Fehlkonfiguration in Produktion** (kein Pepper, kein Origin, unsichere Cookies). | Fail closed: Ohne `AUTH_PEPPER` und `APP_ORIGIN` startet keine Anmeldung. Unsichere Cookies sind nur mit ausdrücklichem `ENVIRONMENT=development` möglich. |

---

## 5. Rollen

Genau zwei, für diese Phase und ohne Vorratshaltung:

```
customer   Ein Café. Darf /bestellen und die Kunden-APIs.
admin      Ein Buschmann-Mitarbeiter. Darf /admin und die Admin-APIs.
```

Kein `manager`, `superadmin`, `accounting`, `production`, `editor`, `owner`,
`moderator`. Es gibt heute niemanden, der eine dieser Rollen hätte, und ein
Rollenmodell auf Vorrat ist ein Rollenmodell, das niemand geprüft hat.

**Rollen sind getrennt, nicht gestuft.** Eine Admin-Sitzung ist keine
Café-Sitzung mit mehr Rechten: Ein Admin hat keinen `customer_id` und kann
deshalb `/bestellen` nicht als Kunde benutzen. Das ist Absicht — sonst gäbe es
einen Weg, im Namen eines Cafés zu bestellen, der nicht im Bestellprotokoll
sichtbar wäre.

---

## 6. Auth Account

### 6.1 Tabelle `auth_accounts`

| Spalte | Bedeutung |
|---|---|
| `id` | interne ID |
| `login_identifier_normalized` | die normalisierte Kennung, UNIQUE |
| `role` | `customer` \| `admin` |
| `customer_id` | Pflicht bei `customer`, verboten bei `admin` |
| `credential_algorithm` | `pbkdf2-sha256` |
| `credential_iterations` | Work Factor **dieser Zeile** |
| `credential_salt` | 16 Byte als 32 Hex-Zeichen |
| `credential_verifier` | 32 Byte als 64 Hex-Zeichen |
| `is_active` | 0/1 |
| `failed_attempts` | Fehlversuchszähler |
| `locked_until` | ISO-8601-UTC oder NULL |
| `created_at`, `updated_at` | ISO-8601-UTC |

**Warum Algorithmus und Iterationen je Zeile und nicht als Konstante:** Ohne
diese beiden Spalten ist eine Erhöhung des Work Factors ein Flag Day — alle
bestehenden Verifier würden ungültig, und niemand könnte sich mehr anmelden.
Mit ihnen ist sie ein Neuberechnen beim nächsten erfolgreichen Login. Zwei
Spalten sind der Preis dafür, dass diese Entscheidung je revidierbar ist. Das
Neuberechnen selbst wird in Phase 3A **nicht** implementiert (YAGNI) — die
Möglichkeit steht offen, die Mechanik nicht.

### 6.2 Invarianten in D1

```sql
CHECK (role IN ('customer', 'admin'))
CHECK (role <> 'customer' OR customer_id IS NOT NULL)
CHECK (role <> 'admin'    OR customer_id IS NULL)
CHECK (length(credential_salt) = 32     AND credential_salt     NOT GLOB '*[^0-9a-f]*')
CHECK (length(credential_verifier) = 64 AND credential_verifier NOT GLOB '*[^0-9a-f]*')
CHECK (credential_iterations >= 100000)
CHECK (failed_attempts >= 0)
UNIQUE (login_identifier_normalized)
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
```

Die Hex-Form-Prüfungen sind dieselbe Idee wie bei `customer_access_tokens`:
Eine reine Längenprüfung ließe einen versehentlich eingetragenen Klartext
gleicher Länge durch.

`ON DELETE CASCADE`, nicht `RESTRICT`: Eine Bestellung ist ein historisches
Dokument und muss einen gelöschten Kunden überleben. Ein Zugang ohne Kunden
ist dagegen kein Dokument, sondern ein Sicherheitsproblem.

---

## 7. Credential

### 7.1 Login-Identifier und Normalisierung

Café und Admin benutzen **dasselbe Feld**. Intern zählt nur
`login_identifier_normalized`.

Die Normalisierung ist genau diese, in dieser Reihenfolge, und sonst nichts:

1. Unicode-Normalisierung **NFKC**.
2. Entfernen von Unicode-Formatzeichen (Kategorie `Cf`, u. a. Zero-Width Space
   U+200B, Zero-Width Joiner, Left-to-Right Mark, BOM U+FEFF).
3. Trimmen von Whitespace, einschließlich Unicode-Whitespace (`\p{White_Space}`).
4. Kleinschreibung mit `toLowerCase()` — locale-unabhängig, ausdrücklich
   **nicht** `toLocaleLowerCase()`.
5. Ablehnung, wenn das Ergebnis leer oder länger als 190 Zeichen ist.
6. Ablehnung, wenn das Ergebnis nicht vollständig aus dem **Zeichenvorrat**
   `[a-z0-9._@+-]` besteht.

`CAFE27` → `cafe27`. `  Admin@Example.test  ` → `admin@example.test`.

**Der Zeichenvorrat ist eine Allowlist, keine Blocklist**, und das ist der
wichtigere Teil dieser Regel. Ein kyrillisches `а` (U+0430) sieht aus wie ein
lateinisches `a`; ohne Allowlist wäre `саfe27` ein zweiter Account, den
niemand vom ersten unterscheiden kann. Homoglyphen gibt es in griechischer,
armenischer und mathematischer Schrift zu Hunderten — sie aufzuzählen ist
aussichtslos, und deshalb wird stattdessen aufgezählt, was erlaubt ist.

Die Allowlist trägt zusätzlich die **Idempotenz**: Über diesem Vorrat sind
NFKC und `toLowerCase()` die Identität. Ein zweiter Durchlauf kann weder ein
kombinierendes Zeichen noch einen Großbuchstaben erzeugen. Ohne sie wäre die
Eigenschaft eine Hoffnung — `İ` (U+0130) etwa wird beim Kleinschreiben zu
`i` + U+0307 und wäre nicht stabil; mit der Allowlist wird es sauber
abgelehnt.

Der Preis ist eine abgelehnte internationalisierte E-Mail-Adresse. Das ist
hinnehmbar, weil Buschmann die Accounts selbst anlegt — und es ist eine
sichtbare Ablehnung, kein stiller Fehlgriff.

Steuerzeichen (Kategorie `Cc`) brauchen keine eigene Regel: Sie stehen nicht
im Vorrat.

**Keine Fuzzy-Matches, kein Raten.** Kein Entfernen von Punkten in
E-Mail-Adressen, kein Ignorieren von `+tag`-Suffixen, keine
Levenshtein-Nachsicht. Wer sich vertippt, bekommt eine Ablehnung — und keine
Anmeldung als jemand anderes.

Die Normalisierung ist **idempotent**: `normalize(normalize(x)) === normalize(x)`.
Das ist getestet, weil ohne diese Eigenschaft ein bei der Provisionierung
geschriebener Wert nicht zwingend gleich dem beim Login berechneten wäre.

### 7.2 Café-Credential

Kundencode (nicht geheim) + **8-stellige numerische PIN**.

Beispiel, ausdrücklich erfunden: Kundencode `TESTCAFE`, PIN `01234567`.

Die PIN wird **immer als Zeichenkette** behandelt — nie als Zahl. `01234567`
ist eine gültige PIN und muss es bleiben; als Integer wäre sie `1234567` und
damit eine andere. Es gibt im gesamten System keine Stelle, die eine PIN durch
`Number()` schickt.

Acht Ziffern statt eines Passworts, weil ein Café am Tresen keine Passwörter
verwaltet und ein erzwungenes Passwort auf einem Zettel neben der Kasse landet
— was schlechter ist als eine PIN. Die Sicherheit entsteht hier nicht aus der
Entropie des Geheimnisses, sondern aus dem Zusammenspiel: sichere Speicherung,
serverseitiger Cooldown, lange Sitzung, generische Fehler, Account-Aktivierung,
serverseitige Rollenprüfung.

### 7.3 Admin-Credential

E-Mail + starkes Passwort, **mindestens 16 Zeichen**, bei der Provisionierung
erzwungen.

Keine Regeln über Großbuchstaben, Sonderzeichen oder Ziffern. Keine
Wechselpflicht alle 30 Tage. Beides ist Security-Theater: Es senkt die
tatsächliche Entropie (Menschen erfüllen solche Regeln auf immer dieselbe
vorhersagbare Art) und erhöht die Wahrscheinlichkeit, dass das Geheimnis
irgendwo notiert wird. **Länge schlägt Zeichenklassen.**

### 7.4 Speicherung — Algorithmus und Work Factor

```
verifier = PBKDF2-HMAC-SHA256(
    password = HMAC-SHA256(key = AUTH_PEPPER, message = credential),
    salt     = 16 zufällige Byte je Account,
    c        = 600 000,
    dkLen    = 32 Byte
)
```

**Warum PBKDF2 und nicht Argon2id.** Argon2id wäre die bessere Wahl und ist es
in jeder Umgebung, die es anbietet. Cloudflare Workers bietet es nicht: Die
Web-Crypto-Implementierung von workerd kennt `PBKDF2`, `HKDF`, `AES`, `ECDSA`,
`RSA` und die Digest-Verfahren — sie kennt kein Argon2, kein scrypt und kein
bcrypt. Eine WASM-Portierung von Argon2 wäre möglich, brächte aber ein Binary
in den Worker-Bundle, das niemand hier prüfen kann, und speicherharte
Verfahren sind in einer Umgebung mit 128 MB Isolate-Speicher genau das falsche
Werkzeug. **Keine selbst erfundene Kryptografie**, und keine importierte, die
niemand liest.

**Warum der Pepper per HMAC vorgeschaltet ist und nicht angehängt.** Ein
angehängter Pepper (`PBKDF2(password + pepper, …)`) ist eine Zeichenkette in
einem Feld, das eine Zeichenkette erwartet — funktional, aber ohne Aussage.
HMAC ist die dafür gebaute Konstruktion: Der Pepper ist ein **Schlüssel**, das
Ergebnis ist von ihm ununterscheidbar zufällig, und eine spätere Pepper-Rotation
ist ein wohldefinierter Vorgang statt einer Bastelei.

**Gemessener Work Factor.** Gemessen in der echten workerd-Runtime
(`@cloudflare/vitest-plugin`, 400 Ableitungen in Folge), nicht in Node und
nicht geschätzt:

| Iterationen | gemessen (workerd, lokal) |
|---|---|
| 100 000 | ≈ 7,6 ms |
| 210 000 | ≈ 16 ms |
| **600 000** | **≈ 45 ms** |

Auf Cloudflare-Hardware ist mit 60–90 ms zu rechnen. Gewählt: **600 000**,
entsprechend der aktuellen OWASP-Guidance für PBKDF2-HMAC-SHA256.

Der Wert steht **zentral** in `src/infrastructure/auth/credential.ts` als
`PBKDF2_ITERATIONS` und wird je Account mitgeschrieben (§6.1).

**Plattformfolge, ausdrücklich festgehalten.** Der Workers-**Free**-Tarif
begrenzt auf **10 ms CPU je Invocation**. Damit ist bei diesem Work Factor —
und bei jedem anderen, der eine ernsthafte Guidance erfüllt — kein Login
möglich. Phase 3A setzt für den späteren Produktivbetrieb den
**Workers-Paid-Tarif** voraus. Das ist eine bewusste, in Absprache getroffene
Entscheidung und keine stillschweigende Annahme. Für Phase 3A selbst ist es
folgenlos: Es wird nichts deployed, und lokal gibt es kein CPU-Limit.

**Was der Work Factor leistet und was nicht.** Bei einem 8-stelligen PIN
(10⁸ Möglichkeiten) und GPU-gestütztem Raten liegt die Zeit zum vollständigen
Durchsuchen bei 600 000 Iterationen in der Größenordnung **Stunden**, bei
210 000 in der Größenordnung **einer Stunde**. Der Work Factor kauft also einen
Faktor, keine Sicherheit. Was einen Offline-Angriff tatsächlich verhindert, ist
der **Pepper**: Wer nur den D1-Dump hat, steht vor einem 256-Bit-Schlüssel und
kann überhaupt nicht anfangen. Diese Einordnung steht hier, weil eine
Iterationszahl sonst als Sicherheitsversprechen missverstanden wird, das sie
nicht ist.

### 7.5 Pepper

Binding: `AUTH_PEPPER`. Ein 256-Bit-Zufallswert, base64url kodiert.

* **Nicht** in Git.
* **Nicht** als Klartext in `wrangler.jsonc`.
* **Nicht** in Logs, Fehlermeldungen, Tests oder Dokumentation.
* Lokal: `.dev.vars` (in `.gitignore`).
* Produktion: Cloudflare Secret — **in Phase 3A noch nicht gesetzt**.

`.dev.vars.example` enthält ausschließlich einen sichtbar als Platzhalter
erkennbaren Wert und wird als einzige `.dev.vars.*`-Datei von `.gitignore`
ausgenommen.

**Fail closed:** Fehlt `AUTH_PEPPER` oder ist er kürzer als 32 Zeichen,
scheitert jede Credential-Operation mit einem Konfigurationsfehler — der als
`500` ohne Details nach außen geht. Kein Standardwert, kein „dann eben ohne".

### 7.6 Unknown-User-Timing

Eine unbekannte Kennung darf nicht daran erkennbar sein, dass die Antwort
schneller kommt. Deshalb: Ist kein Account vorhanden, läuft eine
**Dummy-Verifikation** — dieselbe PBKDF2-Ableitung mit demselben Work Factor
gegen einen festen Dummy-Salt, deren Ergebnis verworfen wird.

Es wird **nicht** versprochen, dass die Netzzeiten dadurch mathematisch
ununterscheidbar werden. D1-Latenz, Scheduling und Netz streuen ohnehin
stärker. Versprochen wird nur, dass es keinen **offensichtlichen**
Unterschied gibt — keine Antwort in 3 ms neben einer in 90 ms.

Der Vergleich des Verifiers ist **konstantzeitig** (XOR über alle Bytes, ein
Ergebnis am Ende), nicht `===`.

---

## 8. Login

### 8.1 Ablauf

```
POST /login  (application/x-www-form-urlencoded)
      ↓
1. Origin prüfen                        → 403 bei Fremd-Origin
2. Kennung normalisieren                → generischer Fehler bei Formfehler
3. Account laden
4. Cooldown prüfen (locked_until > jetzt) → generischer Fehler
5. Credential verifizieren  (bzw. Dummy) → generischer Fehler
6. Account aktiv?                        → generischer Fehler
7. Bei customer: Kunde laden, aktiv?     → generischer Fehler
8. Fehlversuche zurücksetzen
9. Vorhandene Sitzung widerrufen (Fixation)
10. Neue Sitzung erzeugen, Cookie setzen
11. 303 → /bestellen bzw. /admin
```

Schritt 4 steht **vor** Schritt 5: Ein gesperrter Account soll nicht bei jedem
Versuch 600 000 Iterationen kosten.

Schritte 6 und 7 stehen **nach** Schritt 5, nicht davor. Ein deaktivierter
Account, der ohne Credential-Prüfung abgelehnt würde, wäre am Zeitverhalten
erkennbar — und damit ein Enumerationspfad für genau die Accounts, die es
gibt.

### 8.2 Generische Fehlermeldung

Für **alle** folgenden Fälle im Browser dieselbe Meldung, derselbe Statuscode,
dieselbe Seite:

* unbekannte Kennung
* falsches Passwort
* falsche PIN
* deaktivierter Auth-Account
* deaktivierter Customer
* temporär gesperrter Account

> **Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.**

Kein „Kundencode existiert nicht", kein „PIN falsch", kein „Café deaktiviert",
kein „noch 12 Minuten gesperrt". Jede dieser Angaben wäre eine Auskunft.

Das ist eine bewusst schlechtere UX für den ehrlichen Fall — ein Café, dessen
Zugang deaktiviert wurde, erfährt den Grund nicht aus der Seite. Der Text
nennt deshalb den Weg statt des Grundes: kurz bei Buschmann melden.

### 8.3 Bruteforce-Schutz und Lockout-DoS

* **5** Fehlversuche → **15 Minuten** Cooldown.
* Erfolgreicher Login setzt `failed_attempts` auf 0 und `locked_until` auf NULL.
* Der Cooldown läuft **automatisch** ab. Es gibt keine manuelle Entsperrung
  und Phase 3A braucht keine.

Warum 15 Minuten: Lang genug, dass systematisches Raten von 10⁸ PINs
aussichtslos wird (5 Versuche je 15 Minuten sind 480 Versuche pro Tag; für 10⁸
PINs also rund 570 000 Jahre). Kurz genug, dass ein Café, dessen Mitarbeiter
sich fünfmal vertippt hat, nach einer Kaffeepause wieder arbeiten kann.

Das Zählen läuft in **einer** SQL-Anweisung, damit zwei gleichzeitige
Fehlversuche nicht denselben Zählerstand lesen und zurückschreiben:

```sql
UPDATE auth_accounts
   SET failed_attempts = failed_attempts + 1,
       locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN :until ELSE locked_until END,
       updated_at = :now
 WHERE id = :id
```

SQLite serialisiert Schreibvorgänge; ein Read-Modify-Write im Anwendungscode
täte das nicht.

**Der Lockout-DoS ist real.** Wer einen Kundencode kennt — und Kundencodes
sind ausdrücklich nicht geheim —, kann ein Café durch fünf falsche Versuche
für 15 Minuten aussperren und das beliebig wiederholen. Der Trade-off ist
bewusst zugunsten des Bruteforce-Schutzes entschieden:

* Ein erfolgreicher PIN-Bruteforce ist ein dauerhafter Fremdzugriff auf
  Bestelldaten. Ein Lockout ist eine Verzögerung, die von selbst endet.
* Die Sperre ist **nie** dauerhaft und braucht **keinen** Eingriff.
* Ein gesperrtes Café hat einen funktionierenden Ausweichweg, den es ohnehin
  seit Jahrzehnten benutzt: anrufen.

Die richtige zusätzliche Antwort ist Cloudflare Rate Limiting nach IP und
gegebenenfalls Turnstile. Beides ist ausdrücklich **nicht** Phase 3A.

### 8.4 Redirect nach Login

```
customer → 303 /bestellen
admin    → 303 /admin
```

Das Ziel ist eine **Funktion der Rolle**, sonst nichts. Es gibt **kein**
`next`-Parameter-Konzept — und damit auch keine Allowlist, die es zu pflegen
gäbe, keinen Parser, der sich täuschen ließe, und keinen Open Redirect.

Der Preis: Wer `/admin` ohne Sitzung aufruft, landet nach dem Login auf
`/admin`, weil das Adminziel ist — nicht weil ein `next` gemerkt wurde. Für
zwei Rollen mit je einem Ziel ist das identisch, und die einfachere Lösung
gewinnt.

### 8.5 Bereits angemeldeter Benutzer

`GET /login` mit gültiger Sitzung → sofort `303` auf `/bestellen` bzw.
`/admin`. Kein überflüssiges Formular.

### 8.6 Logout

`POST /logout`, nie `GET`. Ein `GET`-Logout wird von Link-Prefetch,
Bildvorschau und Virenscannern ausgelöst.

Ablauf: Sitzung in D1 widerrufen (`revoked_at` setzen), Cookie mit
`Max-Age=0` löschen, `303` auf `/login`. Keine Zombie-Session: Der
Sitzungstoken ist nach dem Widerruf auch dann wertlos, wenn er noch existiert.

---

## 9. Session

### 9.1 Token

* **32 Byte** aus `crypto.getRandomValues` = **256 Bit** Entropie.
* base64url ohne Padding, 43 Zeichen.
* Der **Rohtoken** existiert ausschließlich im Cookie.
* D1 speichert **nur** `sha256(token)` als 64 Hex-Zeichen.

**Warum SHA-256 und kein KDF für den Sitzungstoken:** Ein langsamer KDF
schützt *schwache* Geheimnisse gegen Offline-Raten. Dieses Geheimnis ist
256 Bit gleichverteilter Zufall — Raten ist unabhängig von der
Hashgeschwindigkeit unmöglich. Ein KDF kostete bei **jedem** Request
45 ms und brächte nichts. Dieselbe Begründung wie beim Access-Token in Phase 2,
und sie stimmt dort wie hier.

### 9.2 Tabelle `auth_sessions`

| Spalte | Bedeutung |
|---|---|
| `id` | interne ID |
| `account_id` | FK → `auth_accounts`, `ON DELETE CASCADE` |
| `token_hash` | `sha256(token)`, 64 Hex, UNIQUE |
| `csrf_token` | 32 Byte base64url, 43 Zeichen |
| `created_at` | ISO-8601-UTC |
| `expires_at` | ISO-8601-UTC |
| `revoked_at` | ISO-8601-UTC oder NULL |

Bewusst **nicht** enthalten: IP-Adresse, User-Agent, Geodaten, Zählerstände,
`last_seen_at`. Es gibt keinen bestätigten Bedarf, und eine IP-Adresse ist ein
personenbezogenes Datum. Datenminimierung ist Voreinstellung.
`last_seen_at` wäre zusätzlich ein Schreibvorgang bei **jedem** Request für
eine Information, die niemand auswertet.

### 9.3 Cookie

| Umgebung | Name | Flags |
|---|---|---|
| Produktion | `__Host-buschmann_session` | `HttpOnly; Secure; SameSite=Lax; Path=/`, **kein** `Domain` |
| Entwicklung | `buschmann_session_dev` | `HttpOnly; SameSite=Lax; Path=/`, **kein** `Domain`, **kein** `Secure` |

**Warum zwei Namen und nicht ein Name mit zwei Flag-Sätzen:** Der
`__Host-`-Präfix ist für den Browser eine **Zusage**: Dieses Cookie hat
`Secure`, hat `Path=/` und hat kein `Domain`. Ein `__Host-`-Cookie ohne
`Secure` wird vom Browser schlicht verworfen — es gibt also keine Fassung
dieses Namens, die über HTTP funktioniert. Statt den Präfix umgebungsabhängig
an- und abzuschalten (und damit die Zusage zur Variablen zu machen), tragen
die beiden Umgebungen verschiedene Namen. Ein Entwicklungs-Cookie kann dann
gar nicht erst in Produktion gelten, und umgekehrt.

**Fail closed (§24):** Die Cookie-Policy wird aus `ENVIRONMENT` abgeleitet.
Unsichere Cookies entstehen **nur** bei ausdrücklichem
`ENVIRONMENT=development`. Jeder andere Wert — auch ein fehlender, auch ein
Tippfehler — ergibt die Produktionspolicy mit `Secure`. Zusätzlich ist die
Kombination `ENVIRONMENT=development` **und** ein `APP_ORIGIN` mit `https:`
ein Konfigurationsfehler und wird abgewiesen: Das ist genau der versehentliche
Produktionsstart, den §24 verhindert sehen will.

**Nirgends sonst.** Die Session-ID steht nicht in einer URL, keinem
Query-String, keinem `localStorage`, keinem `sessionStorage`, keinem
HTML-Quelltext und keiner Analytics. Ein Test prüft, dass der Rohtoken in
keinem Antwortkörper vorkommt.

### 9.4 Lebensdauer

| Rolle | TTL | Begründung |
|---|---|---|
| `customer` | **30 Tage** | Ein Stammcafé bestellt zweimal die Woche. Häufigeres Anmelden wäre die eine Reibung, die den ganzen Bestellfluss entwertet. |
| `admin` | **12 Stunden** | Deckt eine Arbeitsschicht ab und läuft über Nacht ab. Ein Adminzugang ist ein Zugang zum Betrieb, kein Tresengerät. |

Zentral in `src/infrastructure/auth/session-token.ts` als `SESSION_TTL_SECONDS`
je Rolle. Keine ewigen Sitzungen.

### 9.5 Sessionprüfung bei jedem geschützten Request

```
1. Cookie lesen                         → keine Session: abweisen
2. Token hashen (SHA-256)
3. Session aus D1 laden                 → unbekannt: abweisen
4. expires_at > jetzt?                  → abgelaufen: abweisen
5. revoked_at IS NULL?                  → widerrufen: abweisen
6. Auth-Account laden                   → weg: abweisen
7. account.is_active?                   → inaktiv: abweisen
8. Rolle prüfen (Endpunkt-abhängig)     → falsch: 403
9. bei customer: Customer laden         → weg: abweisen
10.   customer.is_active?               → inaktiv: abweisen
```

Ein Sitzungstoken ist **kein** Dauerausweis. Wird ein Café deaktiviert, endet
sein Zugriff beim nächsten Request — nicht in 30 Tagen.

### 9.6 Session Fixation und Rotation

Nach jedem erfolgreichen Login wird eine **neue** Sitzung erzeugt. Eine
mitgeschickte, noch gültige Sitzung wird dabei **widerrufen**, nie übernommen.
Es gibt keinen Codepfad, der eine Sitzungs-ID aus der Anfrage weiterverwendet.

Ein periodisches Rotationssystem gibt es **nicht**. Für Phase 3A genügt die
neue Sitzung beim Login. YAGNI.

---

## 10. CSRF und Origin

### 10.1 Synchronizer-Token

Je Sitzung ein CSRF-Token (32 Byte, base64url), gespeichert in
`auth_sessions.csrf_token`.

* Der Server liefert ihn im gerenderten HTML aus — als `hidden`-Feld in
  Formularen und als `data-csrf`-Attribut für das Bestellformular.
* Der Client sendet ihn bei **jedem schreibenden Request** zurück: als
  Formularfeld `csrf_token` oder als Kopfzeile `x-csrf-token`.
* Verglichen wird **konstantzeitig** gegen den Wert aus D1.
* Er liegt **nicht** in einem `HttpOnly`-Cookie — der Client muss ihn lesen
  können. Er liegt auch in gar keinem Cookie: Ein Double-Submit-Cookie wäre
  gegen einen Subdomain-Angreifer schwächer als ein sitzungsgebundener Wert.

### 10.2 Welche Requests brauchen was

| Request | Session | CSRF | Origin |
|---|---|---|---|
| `GET /login` | – | – | – |
| `POST /login` | – | **–** (siehe unten) | **ja** |
| `POST /logout` | ja | **ja** | **ja** |
| `GET /bestellen` | ja | – | – |
| `POST /api/orders` | ja | **ja** | **ja** |
| `GET /admin` | ja | – | – |
| `GET /api/auth/session` | ja | – | – |

**`POST /login` ohne CSRF-Token, und warum das richtig ist:** Vor dem Login
gibt es keine Sitzung und damit nichts, woran ein Synchronizer-Token hängen
könnte. Ein Pre-Session-Cookie nur für den CSRF-Schutz des Logins wäre ein
zweites Cookie, ein zweiter Lebenszyklus und eine zweite Fehlerquelle. Login
CSRF ist zudem eine deutlich schwächere Bedrohung als Session CSRF: Der
Angreifer kann ein Opfer höchstens in **seinen eigenen** Account einloggen.
Gegen genau das wirken hier `SameSite=Lax` und die **Origin-Prüfung**, die für
`POST /login` verbindlich ist. §33 verlangt CSRF-Schutz für
*session-authentifizierte* schreibende Requests — `POST /login` ist keiner.

**GET braucht keinen CSRF-Token.** Ein `GET` verändert in diesem System keinen
Zustand. Künstlicher CSRF-Schutz auf `GET` wäre Aufwand ohne Wirkung — und
würde Lesezeichen brechen.

### 10.3 Origin-Prüfung

Bei jedem schreibenden Request muss `Origin` **exakt** gleich `APP_ORIGIN`
sein. Fehlt der Header oder weicht er ab: `403`.

* `APP_ORIGIN` ist konfigurierbar, nicht hartkodiert — lokal
  `http://127.0.0.1:8787`, produktiv `https://buschmann1846.de`.
* **Fail closed:** Fehlt `APP_ORIGIN`, wird **jeder** schreibende Request
  abgewiesen. Keine Ableitung aus `request.url` — die wäre vom Angreifer
  beeinflussbar und damit keine Prüfung, sondern eine Zeremonie.
* Kein Fallback auf `Referer`. Ein fehlender `Origin` bei einem
  `POST` aus einem modernen Browser kommt nicht vor.

---

## 11. Autorisierung

### 11.1 Regeln

```
customer → /bestellen, Kunden-APIs
admin    → /admin,     Admin-APIs
```

Serverseitig, an **jedem** Endpunkt, immer. Ein versteckter Button ist keine
Autorisierung. Eine Navigation, die einen Link nicht zeigt, ist keine
Autorisierung.

### 11.2 Unautorisierter Rollenwechsel

| Fall | Antwort |
|---|---|
| Customer-Session → Admin-**API** | `403`, Körper `{"error":"forbidden"}` |
| Customer-Session → `GET /admin` | `403` mit einer verständlichen HTML-Seite: „Dieser Bereich ist für dich nicht freigegeben." Ohne interne Angaben. |
| Admin-Session → `GET /bestellen` | `403` mit HTML-Seite. Ein Admin ist kein Café. |
| Admin-Session → `POST /api/orders` | `403`. |
| Keine Session → geschützte HTML-Seite | `303` auf `/login` |
| Keine Session → geschützte API | `401` |

**Warum HTML-Seiten `403` und nicht `303` auf `/login`:** Wer angemeldet ist,
hat kein Anmeldeproblem. Ein Redirect zum Login wäre für den Benutzer
verwirrend („ich bin doch eingeloggt") und für einen Angreifer eine Auskunft
darüber, dass die Route existiert und nur die Rolle fehlt. Der `403` sagt
beides nicht.

### 11.3 Customer Context

Der Kunde kommt **ausschließlich** aus dem `AuthContext` der Sitzung.

```ts
type AuthContext =
  | { role: 'customer'; accountId: number; sessionId: number; csrfToken: string; customer: Customer }
  | { role: 'admin';    accountId: number; sessionId: number; csrfToken: string };
```

Ein `customerId` im Anfragekörper wird **nicht gelesen**. Nicht „ignoriert
nach dem Lesen" — es gibt keine Codestelle, die es liest. Dasselbe gilt für
`role`: Der Typ oben lässt gar keinen anderen Ursprung zu.

Ein Test schickt ausdrücklich `{"customerId": 999, "role": "admin"}` mit einer
Café-Sitzung mit und prüft, dass die Bestellung beim richtigen Café landet und
die Rolle unverändert `customer` bleibt.

---

## 12. Migration: Capability Link → Session

### 12.1 Reihenfolge

Ausdrücklich in dieser Reihenfolge, nicht in einem Schritt:

1. First-Party-Auth implementieren (Accounts, Credentials, Sessions).
2. Customer-Session implementieren (Login, Cookie, Prüfung).
3. Bestellfluss an die Session anbinden: `/o/<token>` → `/bestellen`,
   `x-order-token` → Cookie + `x-csrf-token`.
4. **Alle** Order-Regeln erneut testen (Preisbildung, Snapshots, Idempotency,
   atomarer Write, Notizlimit, Liefertag).
5. Browser-Fluss lokal end-to-end prüfen.
6. **Erst danach** die Capability-Link-Authentifizierung aus dem aktiven Code
   entfernen.

### 12.2 Endzustand: genau ein aktiver Weg

Nach der Migration existieren **nicht** dauerhaft zwei Kundenauth-Systeme
nebeneinander. Entfernt werden:

* `src/domain/access-token.ts`
* `src/infrastructure/d1/access-token-repository.ts`
* `scripts/issue-access-token.mjs` und das npm-Skript `token:issue`
* die Route `/o/<token>` aus `worker.ts`
* die Kopfzeile `x-order-token`
* die zugehörigen Tests und die Zugangsdaten aus dem Dev-Seed

Die Historie bleibt in Git; zusätzlich ist der Phase-2-Stand im Branch
`archive/order-system-phase2-cafe-ordering` gesichert.

### 12.3 Umgang mit `customer_access_tokens`

Die Tabelle wird **nicht** durch Ändern der Migration 0006 entfernt. Migration
0006 bleibt Zeichen für Zeichen, wie sie ist.

Stattdessen entfernt eine **neue** Migration die Tabelle:

```
migrations/0010_drop_customer_access_tokens.sql
```

**Warum nicht die Historie glätten,** obwohl keine produktive Datenbank
existiert und es technisch folgenlos wäre: Eine Migrationsfolge ist ein
Protokoll darüber, wie das Schema entstanden ist. Wer in einem Jahr fragt,
warum der Bestellfluss einmal ohne Login funktionierte, findet die Antwort in
0006 und 0010 — nicht in einer Lücke. Der Preis sind zwei Dateien statt keiner.

---

## 13. Failure Modes

| Fall | Verhalten |
|---|---|
| `AUTH_PEPPER` fehlt | Jede Credential-Operation scheitert. `500`, konstanter Körper, keine Details. Kein Standardwert. |
| `APP_ORIGIN` fehlt | Jeder schreibende Request `403`. Lesen bleibt möglich. |
| `ENVIRONMENT=development` + `https:`-`APP_ORIGIN` | Konfigurationsfehler, `500`. Der versehentliche Produktionsstart mit unsicheren Cookies. |
| Cookie fehlt | HTML: `303 /login`. API: `401`. |
| Cookie vorhanden, Session unbekannt | Wie „Cookie fehlt". Cookie wird gelöscht. |
| Session abgelaufen | Wie „Cookie fehlt". Cookie wird gelöscht. |
| Session widerrufen | Wie „Cookie fehlt". Cookie wird gelöscht. |
| Account inaktiv geworden | Wie „Cookie fehlt". Der Zugriff endet beim nächsten Request. |
| Customer inaktiv geworden | Wie „Cookie fehlt". |
| Rolle passt nicht | `403`. Session bleibt gültig, Cookie bleibt. |
| CSRF fehlt/falsch | `403`. Keine Angabe, welches von beidem. |
| Origin falsch/fehlt | `403`. |
| Account gesperrt | Generische Login-Meldung. Keine Restdauer. |
| D1 nicht erreichbar | `500`, konstanter Körper. Kein SQL, kein Stacktrace. |

---

## 14. Logging

**Niemals geloggt:** Passwort, PIN, Rohtoken der Sitzung, Credential-Hash,
Salt, `AUTH_PEPPER`, CSRF-Token, vollständiger Cookie-Header,
Login-Identifier.

Login-Ereignisse dürfen enthalten: Ereignistyp (`login_failed`,
`login_succeeded`, `account_locked`), Zeitpunkt, Ergebnis. Keine IP-Adresse,
solange kein bestätigter Bedarf besteht — Datenminimierung.

Die Fehlergrenze aus Phase 2 protokolliert bewusst gar nichts: Cloudflare
erfasst unbehandelte Ausnahmen ohnehin, und ein eigenes `console.error` mit
dem Anfrageinhalt wäre der kürzeste Weg, ein Geheimnis in ein Log zu schreiben.
Das bleibt so.

---

## 15. Security Headers

Für `/login`, `/bestellen`, `/admin` und alle authentifizierten APIs:

```
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
                         connect-src 'self'; base-uri 'none'; frame-ancestors 'none';
                         form-action 'self'
```

Änderung gegenüber Phase 2: `form-action` geht von `'none'` auf `'self'`.
Phase 2 sendete ausschließlich per `fetch`; Login und Logout sind echte
Formulare mit `POST` auf die eigene Herkunft und brauchen deshalb `'self'`.
Weiter als `'self'` geht es nicht.

Keine externen Fonts, keine externen Skripte, keine externen Bilder, keine
Analytics.

---

## 16. Provisionierung

Kein Admin-UI für Benutzerverwaltung in Phase 3A.

`order-system/scripts/create-local-auth-account.mjs`:

* schreibt **nicht** selbst in eine Datenbank — es gibt Hash und fertiges
  `INSERT` aus, das bewusst von Hand angewendet wird. Ein Werkzeug, das selbst
  schreiben kann, schreibt irgendwann in die falsche Datenbank. (Dieselbe
  Entscheidung wie beim Phase-2-Token-Werkzeug, und aus demselben Grund.)
* hasht das Credential mit demselben Verfahren und Work Factor wie der Worker.
* schreibt **niemals** Klartext nach D1.
* verlangt den Pepper über die Umgebungsvariable `AUTH_PEPPER` und lehnt ab,
  wenn sie fehlt.
* erzwingt: PIN genau 8 Ziffern für `customer`, Passwort mindestens 16 Zeichen
  für `admin`.
* ist ausdrücklich für **lokale** Verwendung gedacht. Kein Production-Seeder.

---

## 17. Testdaten

Nur klar Erfundenes:

| | |
|---|---|
| Customer | `Testcafé Nord`, `Testcafé Süd`, `Ehemaliges Testcafé` |
| Kundencode | `TESTCAFE`, `TESTSUED` |
| Demo-PIN | `01234567` — führende Null ausdrücklich, als Nachweis |
| Admin | `admin@example.test` |
| Demo-Passwort | erkennbar als Demo, mindestens 16 Zeichen |

Keine echten Cafés (kein Café Schwarz, Mercy, Ferdi, Quadrat, Dos Coffee),
keine echten Buschmann-Mitarbeiterdaten, keine echten Kontaktdaten.

---

## 18. Frontend

Mobile first, Zielbreiten 375 / 390 / 430 px.

Die Loginseite entspricht der Bestelloberfläche: ruhig, hochwertig, klar, sehr
schnell. **Kein Redesign der Marketing-Website.** Keine Animation, die den
Login verzögert. Kein WebGL. Keine externen Auth-Logos. Keine Third-Party-
Skripte. Keine externen Fonts.

Formular:

* Wortmarke „Buschmann 1846" als Text — dieselbe Behandlung wie auf der
  Bestellseite, kein neues Bildasset.
* kurze Überschrift
* ein Feld Kennung, ein Feld Geheimnis, eine Schaltfläche
* kleine klare Fehlermeldung

**Nicht** enthalten: „Angemeldet bleiben", Social Login, CAPTCHA,
Passwortmanager-Blockade.

### 18.1 PIN-Eingabe

* `type="password"` — das Geheimnis steht nicht sichtbar auf einem Tresengerät.
* **Kein `inputmode="numeric"`.** Es gibt genau *ein* Geheimnisfeld für beide
  Rollen (§2.2), und dasselbe Feld nimmt eine 8-stellige PIN und ein
  16-Zeichen-Admin-Passwort auf. Eine erzwungene Zifferntastatur würde die
  Passworteingabe auf dem Smartphone unmöglich machen. Der Komfortgewinn für
  das Café wäre real, aber er ist nicht zu haben, ohne vorher nach der Rolle zu
  fragen — und genau das soll die Loginseite nicht tun.
* Serverseitig **immer** Zeichenkette. `01234567` bleibt `01234567`.

### 18.2 Barrierefreiheit

Echte `<label>`, korrekte Input-Typen, sinnvolles `autocomplete`, sichtbarer
Fokus, vollständige Tastaturbedienung, Fehlermeldung per `aria-describedby`
mit dem Feld verbunden, `role="alert"` für die Fehlerzusammenfassung,
Touchflächen ≥ 44 px, kein Fokusverlust bei einem Fehler (der Fokus geht auf
die Meldung, nicht ins Nichts).

### 18.3 Autocomplete

| Feld | Wert |
|---|---|
| Kennung | `username` |
| Geheimnis | `current-password` |

Der Passwortmanager des Browsers **darf** funktionieren — für den Admin ist er
die beste verfügbare Sicherheitsmaßnahme, und für das Café erspart er das
Zettelchen. `autocomplete="off"` täuscht Sicherheit vor, die es nicht gibt,
und wird von Browsern ohnehin weitgehend ignoriert.

### 18.4 Progressive Enhancement

Der Login funktioniert **ohne JavaScript**: echtes `<form method="post">`,
serverseitige Fehlerdarstellung, `303`-Redirect. Es gibt kein Login-Skript.

Das Bestellformular bleibt wie in Phase 2 auf `fetch` angewiesen und sagt das
per `<noscript>` — daran ändert Phase 3A nichts.

---

## 19. Testing

Vollständige Liste in `docs/superpowers/plans/2026-08-24-buschmann-first-party-auth.md`.
Die Gruppen:

| Gruppe | Inhalt |
|---|---|
| Credential Storage | kein Klartext in D1; gleiche Credentials + verschiedene Salts → verschiedene Verifier; richtiges Secret validiert; falsches nicht; Pepper ist erforderlich; unbekannter Account nutzt Dummy-Verifikation; führende Null bleibt erhalten |
| Login | Customer-Login; Admin-Login; falsches Secret; unbekannte Kennung; deaktivierter Account; deaktivierter Customer; Cooldown greift; Erfolg setzt zurück; Redirect-Ziele; keine externen Redirects |
| Session | neue zufällige Session; nur Hash in D1; HttpOnly; Secure in Produktion; SameSite; Path=/; kein Domain; Token nicht im Körper; abgelaufen; widerrufen; Logout; keine Fixation |
| Rollen | Customer auf `/bestellen`; Customer nicht auf `/admin`; Customer nicht auf Admin-API; Admin auf `/admin`; nur eigener Customer-Context; manipulierte `customerId` wirkungslos; `role` aus dem Körper wirkungslos |
| CSRF/Origin | gültig funktioniert; fehlend abgelehnt; falsch abgelehnt; falscher Origin abgelehnt; GET braucht keinen; Order-Submit funktioniert weiterhin |
| Phase-2-Regression | Produkte laden; Menge 0 ignoriert; negative Menge abgelehnt; inaktives Produkt abgelehnt; Clientpreis ignoriert; Serverpreis verwendet; Snapshot gespeichert; Gesamtbetrag korrekt; Liefertag validiert; Notizlimit; Idempotency; atomarer Write; Bestellnummer |
| Caching | `no-store` auf allen sitzungsabhängigen Antworten |
| Mutation | Rollenprüfung, Session-Expiry, Credential-Verifikation und CSRF-Prüfung werden **einzeln temporär gebrochen**; die zugehörigen Tests müssen rot werden, danach wird zurückgesetzt |

---

## 20. Non-Goals

Ausdrücklich **nicht** in Phase 3A:

* Passwort ändern, PIN ändern, Passwort vergessen, Magic Link, Recovery-Mail
* 2FA für Admins (als spätere Härtung vorgemerkt, siehe §21)
* 2FA für Cafés (für diesen Anwendungsfall unnötig)
* periodische Session-Rotation
* manuelle Admin-Entsperrung eines gesperrten Accounts
* Admin-UI für Benutzerverwaltung
* Produktions-Tagesansicht, Bestellsummen je Produkt, Bestellstatusverwaltung
* Kundenverwaltung, Produktverwaltung, PIN-/Passwort-Verwaltungs-UI
* Dashboard, Charts, Umsatz, Kosten, Marge, Rechnungen
* E-Mail, Notifications, PDF, CSV, R2
* Turnstile, WAF-Konfiguration, Cloudflare Rate Limiting
* Deployment jeder Art: `wrangler deploy`, Remote-D1, DNS, Custom Domain,
  Push, Merge, Production Secrets, Production Accounts

---

## 21. Spätere Härtung (dokumentiert, nicht gebaut)

1. **2FA für Admins** — TOTP. Die `auth_accounts`-Struktur nimmt es ohne
   Umbau auf (zwei Spalten). Sinnvoll, sobald mehr als eine Person
   Adminzugang hat.
2. **Cloudflare Rate Limiting** nach IP auf `POST /login` — die richtige
   Antwort auf Lockout-DoS (T13) und CPU-DoS (T14).
3. **Turnstile** auf `/login` nach mehreren Fehlversuchen.
4. **Rehash beim Login**, wenn `credential_iterations` unter der aktuellen
   Konstante liegt. Die Spalten dafür existieren bereits.
5. **Pepper-Rotation** — mit der HMAC-Konstruktion ein wohldefinierter Vorgang.

---

## 22. Definition of Done

Phase 3A ist fertig, wenn:

- [ ] alles First-Party auf Buschmann läuft, keine externe Loginseite nötig ist, ein Tab genügt
- [ ] `/login` existiert und Customer wie Admin dieselbe Oberfläche nutzen
- [ ] die Rolle serverseitig bestimmt wird
- [ ] Customer direkt `/bestellen`, Admin direkt `/admin` erreicht
- [ ] Credentials niemals im Klartext gespeichert sind
- [ ] individuelles Salt je Account verwendet wird
- [ ] ein serverseitiger Pepper verwendet wird und ohne ihn nichts funktioniert
- [ ] Bruteforce-Schutz existiert und greift
- [ ] User Enumeration reduziert ist (generische Meldung + Dummy-Verifikation)
- [ ] der Sitzungstoken 256 Bit kryptografischen Zufall trägt
- [ ] D1 nur den Sitzungshash speichert
- [ ] sichere Cookies existieren und Produktion `Secure` erzwingt
- [ ] die Kundensitzung 30 Tage, die Adminsitzung 12 Stunden gilt
- [ ] CSRF geschützt und der Origin validiert wird
- [ ] Rollen serverseitig autorisiert werden
- [ ] ein Customer nur den eigenen Customer-Context verwenden kann
- [ ] der bestehende Bestellfluss vollständig funktioniert
- [ ] der Capability-Link kein aktiver Auth-Weg mehr ist
- [ ] alle Phase-2-Regressionstests grün sind
- [ ] die Security-Mutationstests wirksam sind
- [ ] der Typecheck grün ist
- [ ] die lokale D1-E2E-Prüfung erfolgreich ist
- [ ] die Marketing-Website unverändert ist
- [ ] nichts deployed, gepusht oder gemergt wurde
