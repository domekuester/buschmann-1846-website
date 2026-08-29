# Implementation Plan — First-Party Authentication (Phase 3A)

Spec: `docs/superpowers/specs/2026-08-24-buschmann-first-party-auth-design.md`
Branch: `feature/order-system-first-party-auth`
Ausgangslage: 410 Tests grün, Typecheck grün, Arbeitsverzeichnis sauber

**Arbeitsweise je Task:** failing test → minimale Implementierung → relevante
Tests → vollständige Suite → Typecheck → `git diff` sichten →
Website-Integrität prüfen → ein kleiner Commit. Keine Sammelcommits.

**Website-Integrität** nach jedem Task:

```bash
git diff --name-only feature/order-system-cafe-ordering -- . ':!order-system' ':!docs/superpowers'
```

Erlaubt sind ausschließlich `order-system/`, `docs/superpowers/` und — wenn
objektiv nötig — `.gitignore`. Jede andere Datei ist ein STOP.

---

## Reihenfolge und Begründung

Die Tasks bauen von innen nach außen: erst reine Werte ohne Abhängigkeiten,
dann Technik, dann D1, dann Anwendungsfälle, dann HTTP, zuletzt die Migration
des Bestellflusses. Der Capability-Link wird **als Letztes** entfernt — bis
dahin ist der Phase-2-Weg jederzeit lauffähig und dient als Vergleichsmaßstab.

```
T1  Konfiguration ──┐
T2  Rolle/Kennung   ├─→ T6 Migrationen ─→ T7 Account-Repo ─┐
T3  Credential ─────┤                     T8 Session-Repo ─┼→ T9  logIn
T4  Session-Token ──┤                                      └→ T10 authenticateRequest
T5  Cookie ─────────┘                                            ↓
                                       T11 CSRF/Origin ─→ T12 Login-UI ─→ T13 Login-Routen
                                                                              ↓
                                                    T14 Guard ─→ T15 Admin-Shell
                                                                              ↓
                                              T16 /bestellen ─→ T17 Order-API ─→ T18 Capability-Link raus
                                                                              ↓
                                                    T19 Provisionierung ─→ T20 Verifikation
```

---

## T1 — Konfiguration, fail closed

**Dateien**
* neu `order-system/src/config/app-config.ts`
* neu `order-system/tests/domain/app-config.test.ts`
* neu `order-system/src/env.d.ts`
* neu `order-system/.dev.vars.example`
* ändern `order-system/wrangler.jsonc` (Block `vars`)
* ändern `.gitignore` (Ausnahme für `.dev.vars.example`)

**Interface**

```ts
export type Environment = 'development' | 'production';

export interface AppConfig {
  readonly environment: Environment;
  readonly appOrigin: string;
  readonly pepper: string;
}

export class ConfigurationError extends Error {}

/** Wirft ConfigurationError statt zu raten. Kein Standardwert, kein Fallback. */
export function readAppConfig(env: Env): AppConfig;
```

**Failing test** — `tests/domain/app-config.test.ts`

1. fehlender `AUTH_PEPPER` → `ConfigurationError`
2. `AUTH_PEPPER` kürzer als 32 Zeichen → `ConfigurationError`
3. fehlender `APP_ORIGIN` → `ConfigurationError`
4. `APP_ORIGIN` ohne Schema oder mit Pfad → `ConfigurationError`
5. `ENVIRONMENT` fehlt → `production` (fail closed)
6. `ENVIRONMENT` mit Tippfehler (`producton`) → `production`, nicht `development`
7. `ENVIRONMENT=development` **und** `APP_ORIGIN=https://…` → `ConfigurationError`
8. `ENVIRONMENT=development` + `http://127.0.0.1:8787` → gültig

**Erwarteter Failure:** `Cannot find module '../../src/config/app-config'`.

**Minimale Implementierung:** Lesen, prüfen, werfen. Der Origin wird über
`new URL()` geprüft und muss `origin === input` erfüllen (damit ein Pfad oder
ein Trailing Slash abgelehnt wird).

**Verification:** `npx vitest run --project domain tests/domain/app-config.test.ts`,
dann volle Suite, dann `npm run typecheck`. Zusätzlich prüfen, dass
`.dev.vars.example` von Git erfasst wird und `.dev.vars` **nicht**:
`git check-ignore -v order-system/.dev.vars order-system/.dev.vars.example`.

**Commit:** `feat(order-system): Auth-Konfiguration mit Fail-Closed-Prüfung`

---

## T2 — Rolle und Login-Identifier

**Dateien**
* neu `order-system/src/domain/auth-role.ts`
* neu `order-system/src/domain/login-identifier.ts`
* neu `order-system/tests/domain/auth-role.test.ts`
* neu `order-system/tests/domain/login-identifier.test.ts`

**Interface**

```ts
export type AuthRole = 'customer' | 'admin';
export function isAuthRole(value: unknown): value is AuthRole;

/** null, wenn die Kennung nicht normalisierbar ist. Wirft nie. */
export function normalizeLoginIdentifier(value: unknown): string | null;
```

**Failing test**

*auth-role:* `'customer'`/`'admin'` erkannt; `'manager'`, `'ADMIN'`, `''`,
`null`, `0`, `{}` nicht.

*login-identifier:*
1. `'CAFE27'` → `'cafe27'`
2. `'  admin@example.test  '` → `'admin@example.test'`
3. Zero-Width Space (U+200B) und BOM (U+FEFF) werden entfernt
4. NFKC: Vollbreiten-`ＣＡＦＥ２７` → `'cafe27'`
5. leer / nur Whitespace → `null`
6. Steuerzeichen (U+0000, U+001B) → `null`
7. über 190 Zeichen → `null`
8. Nicht-String (`null`, `42`, `{}`) → `null`
9. **Idempotenz:** `normalize(normalize(x)) === normalize(x)` für alle Beispiele
10. `toLowerCase()`, nicht `toLocaleLowerCase()` — `'I'` → `'i'`

**Erwarteter Failure:** Module nicht gefunden.

**Minimale Implementierung:** `normalize('NFKC')` → `replace(/\p{Cf}/gu, '')`
→ `replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')` → `toLowerCase()` →
Prüfungen.

**Verification:** Projekt `domain`, dann volle Suite, Typecheck.

**Commit:** `feat(order-system): Rolle und normalisierte Login-Kennung`

---

## T3 — Credential: PBKDF2, Pepper, Dummy, konstantzeitiger Vergleich

**Dateien**
* neu `order-system/src/infrastructure/auth/credential.ts`
* neu `order-system/tests/d1/credential.test.ts` (Projekt `worker` — braucht
  die echte Web-Crypto-Implementierung von workerd, nicht die von Node)

**Interface**

```ts
export const PBKDF2_ITERATIONS = 600_000;
export const CREDENTIAL_ALGORITHM = 'pbkdf2-sha256';
export const SALT_BYTES = 16;
export const VERIFIER_BYTES = 32;

export interface StoredCredential {
  readonly algorithm: string;
  readonly iterations: number;
  readonly saltHex: string;      // 32 Hex-Zeichen
  readonly verifierHex: string;  // 64 Hex-Zeichen
}

export async function deriveCredential(
  secret: string, pepper: string,
  options?: { saltHex?: string; iterations?: number },
): Promise<StoredCredential>;

export async function verifyCredential(
  secret: string, pepper: string, stored: StoredCredential,
): Promise<boolean>;

/** Verbrennt denselben Work Factor und liefert immer false. */
export async function verifyDummyCredential(pepper: string): Promise<false>;
```

**Failing test**

1. `deriveCredential` liefert 32 Hex-Zeichen Salt und 64 Hex-Zeichen Verifier
2. das Klartextgeheimnis kommt in `StoredCredential` **nirgends** vor
   (`JSON.stringify(stored)` enthält es nicht)
3. zweimal dasselbe Geheimnis → **verschiedene** Salts → verschiedene Verifier
4. richtiges Geheimnis → `verifyCredential === true`
5. falsches Geheimnis → `false`
6. **falscher Pepper → `false`** (Pepper ist für den Erfolg erforderlich)
7. PIN `'01234567'` verifiziert; `'1234567'` verifiziert **nicht**
   (führende Null bleibt erhalten)
8. `verifyDummyCredential` liefert `false` und ruft PBKDF2 tatsächlich auf
   (messbar: dauert in derselben Größenordnung wie eine echte Verifikation)
9. abweichende `iterations` in `stored` werden benutzt, nicht die Konstante
10. `verifyCredential` mit manipuliertem Verifier gleicher Länge → `false`

**Erwarteter Failure:** Modul nicht gefunden.

**Minimale Implementierung:** `HMAC-SHA256(pepper, secret)` → `importKey` als
PBKDF2-Material → `deriveBits`. Vergleich per XOR-Akkumulation über alle
Bytes, ein `=== 0` am Ende.

> **Laufzeithinweis:** Tests mit echtem Work Factor kosten je Ableitung ~45 ms.
> Tests, die den Work Factor nicht prüfen, benutzen `iterations: 1_000`. Nur
> Test 8 misst mit dem echten Wert.

**Verification:** `npx vitest run --project worker tests/d1/credential.test.ts`,
volle Suite, Typecheck.

**Commit:** `feat(order-system): Credential-Ableitung mit PBKDF2 und Pepper`

---

## T4 — Sitzungstoken

**Dateien**
* neu `order-system/src/infrastructure/auth/session-token.ts`
* neu `order-system/tests/d1/session-token.test.ts`

**Interface**

```ts
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TTL_SECONDS: Readonly<Record<AuthRole, number>> = {
  customer: 30 * 24 * 60 * 60,  // 30 Tage
  admin:    12 * 60 * 60,       // 12 Stunden
};

export function generateSessionToken(): string;   // 43 Zeichen base64url
export function generateCsrfToken(): string;      // 43 Zeichen base64url
export async function hashSessionToken(token: string): Promise<string>;  // 64 Hex
export function isWellFormedSessionToken(value: unknown): value is string;
export function sessionExpiry(role: AuthRole, now: Date): string;  // ISO-8601-UTC
```

**Failing test**

1. Token ist 43 Zeichen, nur `[A-Za-z0-9_-]`
2. 1000 Token sind paarweise verschieden
3. `hashSessionToken` ist 64 Hex-Zeichen und deterministisch
4. der Hash **enthält den Rohtoken nicht** als Teilzeichenkette
5. formal falscher Token wird abgelehnt, bevor gehasht wird
6. `sessionExpiry('customer', …)` liegt 30 Tage in der Zukunft
7. `sessionExpiry('admin', …)` liegt 12 Stunden in der Zukunft
8. das Ergebnis ist lexikografisch vergleichbar (feste Länge, `Z`-Suffix)

**Minimale Implementierung:** `crypto.getRandomValues` + die base64url-Kodierung
aus `access-token.ts` (bis zu deren Entfernung in T18 dupliziert — die
Duplikation wird dort aufgelöst, indem die Hilfsfunktion hierher wandert).

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Sitzungstoken mit 256 Bit Entropie`

---

## T5 — Cookie-Policy

**Dateien**
* neu `order-system/src/infrastructure/auth/cookie.ts`
* neu `order-system/tests/domain/cookie.test.ts`

**Interface**

```ts
export const PRODUCTION_COOKIE_NAME  = '__Host-buschmann_session';
export const DEVELOPMENT_COOKIE_NAME = 'buschmann_session_dev';

export function sessionCookieName(config: AppConfig): string;
export function serializeSessionCookie(config: AppConfig, token: string, maxAgeSeconds: number): string;
export function clearSessionCookie(config: AppConfig): string;
export function readSessionCookie(config: AppConfig, header: string | null): string | null;
```

**Failing test**

1. Produktion: Name `__Host-buschmann_session`
2. Produktion: enthält `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
3. Produktion: enthält **kein** `Domain=`
4. Entwicklung: Name `buschmann_session_dev`, **ohne** `Secure`
5. Entwicklung: trotzdem `HttpOnly`, `SameSite=Lax`, `Path=/`, kein `Domain`
6. `clearSessionCookie` setzt `Max-Age=0` und einen leeren Wert
7. `readSessionCookie` findet das Cookie zwischen anderen Cookies
8. `readSessionCookie` findet ein Cookie **nicht**, dessen Name nur ein Präfix
   ist (`buschmann_session_dev_alt`)
9. `readSessionCookie` liefert `null` bei fehlendem Header
10. das Entwicklungs-Cookie wird in Produktionskonfiguration **nicht** gelesen
    und umgekehrt

**Minimale Implementierung:** Zeichenkettenaufbau, `split('; ')`-Parsen mit
exaktem Namensvergleich.

**Verification:** Projekt `domain`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Sitzungscookie mit getrennter Produktionspolicy`

---

## T6 — D1-Migrationen für Auth

**Dateien**
* neu `order-system/migrations/0008_create_auth_accounts.sql`
* neu `order-system/migrations/0009_create_auth_sessions.sql`
* ändern `order-system/tests/d1/schema.test.ts`

**Failing test** — in `schema.test.ts` ergänzen:

1. `auth_accounts` und `auth_sessions` existieren
2. `role = 'manager'` wird abgelehnt
3. `role = 'customer'` ohne `customer_id` wird abgelehnt
4. `role = 'admin'` **mit** `customer_id` wird abgelehnt
5. zweimal dieselbe `login_identifier_normalized` wird abgelehnt
6. `credential_salt` mit 32 Nicht-Hex-Zeichen wird abgelehnt
7. `credential_verifier` mit falscher Länge wird abgelehnt
8. `credential_iterations = 1000` wird abgelehnt (Untergrenze 100 000)
9. `failed_attempts = -1` wird abgelehnt
10. `auth_sessions.token_hash` doppelt wird abgelehnt
11. `auth_sessions.token_hash` in falscher Form wird abgelehnt
12. Löschen eines Kunden entfernt seinen Auth-Account (CASCADE)
13. Löschen eines Auth-Accounts entfernt seine Sitzungen (CASCADE)

**Erwarteter Failure:** `no such table: auth_accounts`.

**Minimale Implementierung:** Die beiden Migrationen exakt nach Spec §6.2
und §9.2, mit Kommentaren im Stil der bestehenden Migrationen. Indizes:
`UNIQUE(login_identifier_normalized)`, `UNIQUE(token_hash)`,
`INDEX auth_sessions(account_id)`, `INDEX auth_sessions(expires_at)`.

**Verification:** `npx vitest run --project worker tests/d1/schema.test.ts`,
volle Suite, Typecheck.

**Commit:** `feat(order-system): D1-Schema für Auth-Accounts und Sitzungen`

---

## T7 — Auth-Account-Repository

**Dateien**
* neu `order-system/src/infrastructure/d1/auth-account-repository.ts`
* neu `order-system/tests/d1/auth-account-repository.test.ts`
* ändern `order-system/src/infrastructure/d1/rows.ts` (Zeilentypen)

**Interface**

```ts
export interface AuthAccount {
  readonly id: number;
  readonly role: AuthRole;
  readonly customerId: number | null;
  readonly credential: StoredCredential;
  readonly isActive: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: string | null;
}

export async function findAccountByIdentifier(db: D1Database, identifier: string): Promise<AuthAccount | null>;
export async function findAccountById(db: D1Database, id: number): Promise<AuthAccount | null>;
export async function recordFailedAttempt(db: D1Database, id: number, now: Date): Promise<void>;
export async function resetFailedAttempts(db: D1Database, id: number, now: Date): Promise<void>;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;
```

**Failing test**

1. bekannter Identifier wird gefunden, mit Rolle und Credential
2. unbekannter Identifier → `null`
3. **inaktiver** Account wird trotzdem geladen (die Entscheidung fällt im
   Anwendungsfall **nach** der Credential-Prüfung — sonst wäre die Ablehnung
   am Zeitverhalten erkennbar)
4. `recordFailedAttempt` erhöht den Zähler um 1
5. der 5. Fehlversuch setzt `locked_until` auf jetzt + 15 Minuten
6. der 4. setzt es **nicht**
7. ein 6. Fehlversuch verschiebt `locked_until` nicht nach hinten, wenn schon
   gesperrt — geprüft wird das dokumentierte Verhalten des `CASE`
8. `resetFailedAttempts` setzt Zähler auf 0 und `locked_until` auf NULL
9. der Zähler läuft in **einer** Anweisung: zwei `recordFailedAttempt` in Folge
   ergeben 2, nie 1
10. der Klartext eines Credentials taucht in keiner Rückgabe auf

**Minimale Implementierung:** Die SQL aus Spec §8.3 wörtlich.

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Auth-Account-Repository mit atomarem Fehlversuchszähler`

---

## T8 — Auth-Session-Repository

**Dateien**
* neu `order-system/src/infrastructure/d1/auth-session-repository.ts`
* neu `order-system/tests/d1/auth-session-repository.test.ts`

**Interface**

```ts
export interface AuthSession {
  readonly id: number;
  readonly accountId: number;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export async function createSession(
  db: D1Database, accountId: number, role: AuthRole, now: Date,
): Promise<{ token: string; csrfToken: string }>;

/** Nur gültige Sitzungen: nicht abgelaufen, nicht widerrufen. */
export async function findValidSession(db: D1Database, token: string, now: Date): Promise<AuthSession | null>;

export async function revokeSession(db: D1Database, id: number, now: Date): Promise<void>;
export async function revokeAllSessionsOfAccount(db: D1Database, accountId: number, now: Date): Promise<void>;
```

**Failing test**

1. `createSession` liefert einen 43-Zeichen-Token und einen CSRF-Token
2. **in D1 steht nur der Hash** — eine Abfrage über alle Spalten enthält den
   Rohtoken nirgends
3. `findValidSession` findet die eben erzeugte Sitzung
4. abgelaufene Sitzung → `null`
5. widerrufene Sitzung → `null`
6. unbekannter Token → `null`
7. formal falscher Token → `null` **ohne** D1-Zugriff
8. `revokeSession` macht sie sofort ungültig
9. `revokeAllSessionsOfAccount` widerruft alle, auch mehrere
10. Kundensitzung läuft 30 Tage, Adminsitzung 12 Stunden

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Sitzungs-Repository, D1 speichert nur den Hash`

---

## T9 — Anwendungsfall Anmeldung

**Dateien**
* neu `order-system/src/application/log-in.ts`
* neu `order-system/tests/d1/log-in.test.ts`

**Interface**

```ts
export interface LogInCommand {
  identifier: unknown;
  secret: unknown;
  now: Date;
  /** Eine mitgeschickte, noch gültige Sitzung — wird widerrufen, nie übernommen. */
  existingSessionToken: string | null;
}

export interface LogInSuccess {
  role: AuthRole;
  token: string;
  csrfToken: string;
  maxAgeSeconds: number;
}

/** null bedeutet: abgelehnt. Der Grund verlässt diese Funktion nicht. */
export async function logIn(db: D1Database, config: AppConfig, command: LogInCommand): Promise<LogInSuccess | null>;
```

**Failing test**

1. Customer mit richtiger Kennung + PIN → Erfolg, Rolle `customer`
2. Admin mit E-Mail + Passwort → Erfolg, Rolle `admin`
3. falsches Secret → `null`
4. unbekannte Kennung → `null`
5. deaktivierter Account → `null`
6. deaktivierter Customer → `null`
7. gesperrter Account → `null`, **ohne** dass PBKDF2 läuft (Reihenfolge:
   Cooldown vor Credential-Prüfung)
8. 5 Fehlversuche sperren; der 6. wird auch mit **richtigem** Secret abgelehnt
9. erfolgreicher Login setzt den Zähler auf 0
10. **Fixation:** eine mitgeschickte gültige Sitzung ist danach ungültig, und
    der neue Token ist ein anderer
11. der Rückgabewert enthält keine Angabe über den Ablehnungsgrund
12. unbekannte Kennung ruft die Dummy-Verifikation auf (die Ablehnung dauert
    in derselben Größenordnung wie eine echte)
13. `maxAgeSeconds` ist rollenabhängig (30 Tage / 12 Stunden)

**Minimale Implementierung:** Die Schrittfolge aus Spec §8.1, wörtlich.

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Anwendungsfall Anmeldung mit generischer Ablehnung`

---

## T10 — Anwendungsfall Sitzungsprüfung

**Dateien**
* neu `order-system/src/application/authenticate-request.ts`
* neu `order-system/tests/d1/authenticate-request.test.ts`

**Interface**

```ts
export type AuthContext =
  | { role: 'customer'; accountId: number; sessionId: number; csrfToken: string; customer: Customer }
  | { role: 'admin';    accountId: number; sessionId: number; csrfToken: string };

export async function authenticateRequest(
  db: D1Database, token: string | null, now: Date,
): Promise<AuthContext | null>;
```

**Failing test**

1. gültige Kundensitzung → `AuthContext` mit `role: 'customer'` und geladenem `Customer`
2. gültige Adminsitzung → `role: 'admin'`, **kein** `customer`-Feld
3. `null`-Token → `null`
4. abgelaufene Sitzung → `null`
5. widerrufene Sitzung → `null`
6. Account nachträglich deaktiviert → `null`
7. **Customer nachträglich deaktiviert → `null`** (kein Dauerausweis)
8. Customer gelöscht → `null`
9. der `AuthContext` enthält keinen Hash, kein Salt, keinen Rohtoken
10. die Prüfung liest die Rolle aus D1, nicht aus dem Token

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Sitzungsprüfung liest Rolle und Kunde bei jedem Request`

---

## T11 — CSRF und Origin

**Dateien**
* neu `order-system/src/http/guard.ts`
* neu `order-system/tests/http/guard.test.ts`

**Interface**

```ts
export function assertSameOrigin(request: Request, config: AppConfig): void;   // wirft ForbiddenError
export function assertCsrf(request: Request, context: AuthContext, body?: URLSearchParams): void;
export class ForbiddenError extends Error {}
export class UnauthenticatedError extends Error {}
```

**Failing test**

1. richtiger Origin → kein Fehler
2. fremder Origin → `ForbiddenError`
3. fehlender Origin → `ForbiddenError`
4. Origin mit angehängtem Suffix (`https://buschmann1846.de.angreifer.test`) → `ForbiddenError`
5. `APP_ORIGIN` nicht konfiguriert → jeder schreibende Request `ForbiddenError`
6. richtiger CSRF-Token als Kopfzeile `x-csrf-token` → kein Fehler
7. richtiger CSRF-Token als Formularfeld `csrf_token` → kein Fehler
8. fehlender CSRF-Token → `ForbiddenError`
9. falscher CSRF-Token gleicher Länge → `ForbiddenError`
10. der Vergleich ist konstantzeitig — geprüft durch einen Test, der einen
    Token mit gleichem Präfix und abweichendem Ende ablehnt

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): CSRF- und Origin-Prüfung an der HTTP-Grenze`

---

## T12 — Loginseite (HTML) und Security-Header

**Dateien**
* neu `order-system/src/ui/login-page-html.ts`
* neu `order-system/tests/domain/login-page-html.test.ts`
* ändern `order-system/src/http/security.ts` (`form-action 'self'`, gemeinsame
  Header für Auth-Seiten)
* ändern `order-system/public/assets/app.css` (Login-Block)

**Interface**

```ts
export interface LoginPageView { errorMessage: string | null; }
export function renderLoginPage(view: LoginPageView): string;
```

**Failing test**

1. enthält genau **ein** `<form method="post" action="/login">`
2. enthält ein `<label for="kennung">` und ein `<label for="geheimnis">`
3. Kennungsfeld: `autocomplete="username"`, `type="text"`
4. Geheimnisfeld: `autocomplete="current-password"`, `type="password"`
5. **keine** Rollenauswahl im Formular (kein `admin`/`customer` im Markup)
6. Fehlermeldung wird mit `role="alert"` gerendert und per `aria-describedby`
   mit dem Kennungsfeld verbunden
7. bei `errorMessage: null` ist der Fehlerbereich `hidden`
8. der Text ist exakt „Anmeldung nicht möglich. Bitte Zugangsdaten prüfen."
9. **kein** Inline-Skript, **kein** Inline-Stil, **kein** fremder Host im Markup
10. keine Zeichenkette „Remember", „CAPTCHA", „Google", „Microsoft"
11. HTML wird escaped (ein `<script>` in der Fehlermeldung erscheint nicht als Markup)

> **Zu Punkt 4:** Das Geheimnisfeld bekommt bewusst **kein** `inputmode`.
> Begründung in Spec §18.1: Ein Feld für beide Rollen kann nicht gleichzeitig
> eine Zifferntastatur erzwingen und ein Admin-Passwort aufnehmen.

**Verification:** Projekt `domain`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Loginseite, mobil zuerst und ohne Skript`

---

## T13 — Login-Routen

**Dateien**
* neu `order-system/src/http/auth-routes.ts`
* neu `order-system/tests/http/auth-routes.test.ts`
* ändern `order-system/src/worker.ts`

**Interface**

```ts
export async function loginPage(db, config, request, now): Promise<Response>;   // GET  /login
export async function loginSubmit(db, config, request, now): Promise<Response>; // POST /login
export async function logout(db, config, request, now): Promise<Response>;      // POST /logout
```

**Failing test**

1. `GET /login` ohne Sitzung → `200`, HTML, `Cache-Control: no-store`
2. `GET /login` mit gültiger Kundensitzung → `303` auf `/bestellen`
3. `GET /login` mit gültiger Adminsitzung → `303` auf `/admin`
4. `POST /login` Customer korrekt → `303` auf `/bestellen` **und** `Set-Cookie`
5. `POST /login` Admin korrekt → `303` auf `/admin`
6. das Cookie trägt `HttpOnly`, `SameSite=Lax`, `Path=/`, kein `Domain`
7. in Produktionskonfiguration trägt es zusätzlich `Secure` und heißt `__Host-…`
8. **der Rohtoken kommt im Antwortkörper nicht vor**
9. `POST /login` falsches Secret → `200` mit Loginseite und generischer Meldung
10. unbekannte Kennung → **byteweise identische Antwort** wie 9
11. deaktivierter Account → identische Antwort
12. deaktivierter Customer → identische Antwort
13. gesperrter Account → identische Antwort
14. `POST /login` mit fremdem Origin → `403`
15. `POST /login` ohne `Content-Type: application/x-www-form-urlencoded` → `415`
16. `GET /logout` → `405` (Logout ist niemals GET)
17. `POST /logout` mit gültiger Sitzung + CSRF → `303` auf `/login`, Cookie mit `Max-Age=0`
18. die Sitzung ist danach in D1 widerrufen
19. `POST /logout` ohne CSRF → `403`
20. es gibt **kein** `next`-Ziel: `POST /login?next=https://evil.test` landet
    trotzdem auf `/bestellen`

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Routen für Anmeldung und Abmeldung`

---

## T14 — Guard-Integration und Session-Endpunkt

**Dateien**
* ändern `order-system/src/http/guard.ts` (`requireRole`)
* neu `order-system/src/http/session-api.ts`
* neu `order-system/tests/http/session-api.test.ts`
* ändern `order-system/src/worker.ts`

**Interface**

```ts
export type GuardResult =
  | { ok: true; context: AuthContext }
  | { ok: false; response: Response };

export async function requireRole(
  db, config, request, now, role: AuthRole, kind: 'html' | 'api',
): Promise<GuardResult>;
```

**Failing test**

1. keine Sitzung + HTML → `303` auf `/login`
2. keine Sitzung + API → `401`
3. Customer-Sitzung + Admin-API → `403`, Körper `{"error":"forbidden"}`
4. Customer-Sitzung + Admin-HTML → `403` mit verständlicher Seite, **ohne**
   interne Angaben (kein „Rolle", kein „admin" im Text)
5. Admin-Sitzung + Customer-HTML → `403`
6. richtige Rolle → `ok: true` mit `AuthContext`
7. `GET /api/auth/session` Customer → `{"authenticated":true,"role":"customer","customer":{"name":"…"}}`
8. `GET /api/auth/session` Admin → `{"authenticated":true,"role":"admin"}`
9. die Antwort enthält **keine** Hashes, Token, Salts, Pepper,
   Fehlversuchszähler und keine internen IDs
10. `GET /api/auth/session` ohne Sitzung → `401`
11. alle Antworten tragen `Cache-Control: no-store`

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Rollen-Autorisierung und Sitzungsendpunkt`

---

## T15 — Minimale Admin-Shell

**Dateien**
* neu `order-system/src/http/admin-page.ts`
* neu `order-system/src/ui/admin-page-html.ts`
* neu `order-system/tests/http/admin-page.test.ts`
* ändern `order-system/src/worker.ts`

**Failing test**

1. `GET /admin` mit Adminsitzung → `200`, enthält „Adminbereich ist bereit."
2. zeigt die Kennung des angemeldeten Admins
3. `GET /admin` ohne Sitzung → `303` auf `/login`
4. `GET /admin` mit Kundensitzung → `403`
5. `Cache-Control: no-store`
6. enthält **keine** Bestelldaten, Produkte, Kunden, Zahlen, Charts
7. enthält einen Logout-Button als echtes `<form method="post" action="/logout">`
   mit CSRF-Feld

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): minimale geschützte Admin-Shell`

---

## T16 — Bestellseite auf `/bestellen`

**Dateien**
* ändern `order-system/src/http/order-page.ts`
* ändern `order-system/src/ui/order-page-html.ts` (CSRF ins Markup, Logout)
* ändern `order-system/tests/http/order-page.test.ts`
* ändern `order-system/src/worker.ts`

**Failing test**

1. `GET /bestellen` mit Kundensitzung → `200`, Name des **eigenen** Cafés
2. `GET /bestellen` ohne Sitzung → `303` auf `/login`
3. `GET /bestellen` mit Adminsitzung → `403`
4. das Markup enthält `data-csrf` mit dem CSRF-Token der Sitzung
5. das Markup enthält **keinen** Sitzungstoken
6. das Markup enthält weiterhin `data-submission-id`
7. deaktiviertes Café → `303` auf `/login` (Sitzung gilt nicht mehr)
8. Sortiment, Liefertagsvorbelegung und Notizfeld unverändert wie Phase 2
9. `internal_note` des Kunden erscheint **nicht**
10. `Cache-Control: no-store` und die Phase-2-Sicherheitsheader
11. `/o/<token>` funktioniert in diesem Task **weiterhin** (Parität, wird
    erst in T18 entfernt)

**Verification:** Projekt `worker`, volle Suite, Typecheck.

**Commit:** `feat(order-system): Bestellseite unter /bestellen mit Kundensitzung`

---

## T17 — Bestell-API auf Sitzung und CSRF

**Dateien**
* ändern `order-system/src/http/order-api.ts`
* ändern `order-system/src/application/place-cafe-order.ts`
* ändern `order-system/public/assets/order-form.js`
* ändern `order-system/tests/http/order-api.test.ts`
* ändern `order-system/tests/d1/place-cafe-order.test.ts`
* ändern `order-system/tests/ui/order-form.test.ts`

**Interface-Änderung**

```ts
// vorher: { token: string; submissionId; input; now }
// nachher:
export interface PlaceCafeOrderCommand {
  customer: Customer;   // aus dem AuthContext, NICHT aus der Anfrage
  submissionId: string;
  input: unknown;
  now: Date;
}
```

**Failing test**

1. `POST /api/orders` mit Sitzung + CSRF → `201`, Bestellnummer
2. ohne Sitzung → `401`
3. mit Adminsitzung → `403`
4. ohne CSRF-Token → `403`
5. mit falschem CSRF-Token → `403`
6. mit fremdem Origin → `403`
7. **`{"customerId": 999}` im Körper wird ignoriert** — die Bestellung landet
   beim Café der Sitzung
8. **`{"role":"admin"}` im Körper wirkt nicht**
9. **`{"unit_price_cents": 1}` und `{"total_cents": 1}` wirken nicht** — der
   Serverpreis gilt
10. Idempotency: dieselbe `submission_id` zweimal → `201`, dann `200`, eine
    Bestellung
11. Menge 0 wird nicht gesendet / ignoriert; negative Menge → `422`
12. inaktives Produkt → `422`
13. Notizlimit und Liefertagsprüfung unverändert
14. UI-Test: das Client-Skript sendet `x-csrf-token` und **nicht** mehr
    `x-order-token`

**Minimale Implementierung:** `createOrder` bekommt den `AuthContext`
übergeben; `placeCafeOrder` nimmt einen `Customer` statt eines Tokens. Der
Aufruf von `findCustomerByAccessToken` verschwindet aus dem Anwendungsfall.
Im Client wird `tokenFromLocation()` durch das Lesen von `data-csrf` ersetzt.

**Verification:** alle drei Projekte, volle Suite, Typecheck.

**Commit:** `feat(order-system): Bestellung über Kundensitzung und CSRF-Token`

---

## T18 — Capability-Link entfernen

**Erst wenn T16 und T17 vollständig grün sind und der Browser-Fluss aus T20
Schritt 1–11 einmal von Hand bestätigt wurde.**

**Dateien**
* löschen `order-system/src/domain/access-token.ts`
* löschen `order-system/src/infrastructure/d1/access-token-repository.ts`
* löschen `order-system/scripts/issue-access-token.mjs`
* löschen `order-system/tests/domain/access-token.test.ts`
* löschen `order-system/tests/d1/access-token-repository.test.ts`
* neu `order-system/migrations/0010_drop_customer_access_tokens.sql`
* ändern `order-system/src/worker.ts` (Route `/o/<token>` entfernen)
* ändern `order-system/package.json` (Skript `token:issue` entfernen)
* ändern `order-system/seeds/002_cafe_ordering_dev.sql` → Auth-Accounts statt Token
* ändern `order-system/tests/d1/schema.test.ts`
* ändern `order-system/README.md`

**Failing test**

1. `GET /o/<irgendwas>` → `404` (die Route existiert nicht mehr)
2. `customer_access_tokens` existiert nach den Migrationen **nicht** mehr
3. eine Suche über `src/` findet die Zeichenkette `x-order-token` nicht mehr
4. eine Suche über `src/` findet `access-token` nicht mehr
5. der gesamte Bestellfluss funktioniert weiterhin über die Sitzung

**Verification:** volle Suite, Typecheck, plus eine Suche über `src/` und
`public/`, die keine aktive Capability-Link-Spur mehr findet.

**Commit:** `refactor(order-system)!: Capability-Link durch Sitzung ersetzt`

---

## T19 — Provisionierung

**Dateien**
* neu `order-system/scripts/create-local-auth-account.mjs`
* ändern `order-system/package.json` (Skript `auth:account`)
* ändern `order-system/README.md`

**Failing test** — Das Skript ist ein Node-Werkzeug ohne Worker-Runtime und
wird über einen `domain`-Test geprüft, der seine reinen Funktionen importiert:

* neu `order-system/tests/domain/create-local-auth-account.test.ts`

1. ohne `AUTH_PEPPER` → Abbruch mit Exit-Code ungleich 0
2. `--role customer` ohne `--customer` → Abbruch
3. `--role admin` mit `--customer` → Abbruch
4. PIN mit 7 Ziffern → Abbruch
5. PIN mit Buchstaben → Abbruch
6. PIN `01234567` wird akzeptiert und als **Zeichenkette** verarbeitet
7. Admin-Passwort mit 15 Zeichen → Abbruch, mit 16 → akzeptiert
8. die Ausgabe enthält ein `INSERT` mit Hex-Salt und Hex-Verifier
9. die Ausgabe enthält **weder** den Pepper **noch** das Klartextgeheimnis
10. der erzeugte Verifier wird von `verifyCredential` akzeptiert (das Skript
    und der Worker rechnen identisch)

**Verification:** Projekt `domain`, volle Suite, Typecheck.

**Commit:** `feat(order-system): lokales Werkzeug zur Account-Provisionierung`

---

## T20 — Verifikation

Kein Commit mit Produktionscode. Ergebnis: Testergänzungen, README, Abschluss.

### 20.1 Security-Mutationstests

Jeweils einzeln, jeweils zurückgesetzt, jeweils protokolliert:

| Mutation | Erwartung |
|---|---|
| **A** `requireRole` gibt immer `ok: true` zurück | Rollen-Tests (T14.3–T14.5, T15.4, T16.3, T17.3) MÜSSEN rot werden |
| **B** `findValidSession` ignoriert `expires_at` | T8.4, T10.4 MÜSSEN rot werden |
| **C** `verifyCredential` liefert immer `true` | T3.5, T3.6, T9.3, T9.4 MÜSSEN rot werden |
| **D** `assertCsrf` tut nichts | T11.8, T11.9, T13.19, T17.4, T17.5 MÜSSEN rot werden |

Nach jeder Mutation: zurücksetzen, `git diff` muss leer sein, volle Suite
wieder grün. **Keine Mutation bleibt zurück.**

### 20.2 Lokaler End-to-End-Test gegen frische D1

```bash
rm -rf order-system/.wrangler/state
npm --prefix order-system run db:migrate:local
npm --prefix order-system run db:seed:cafe:local
npm --prefix order-system run dev
```

1. `/login` öffnen → Formular
2. Kundencode `TESTCAFE` + PIN → `303` `/bestellen`
3. Mengen setzen, Liefertag, Notiz, senden → Bestellnummer
4. Logout → `/login`
5. `/admin` öffnen → `303` `/login`
6. `admin@example.test` + Demo-Passwort → `/admin`
7. Café-Credentials auf `/admin` → Zugriff verweigert
8. Kundensitzung auf `/admin` → `403`
9. Sitzungsablauf automatisiert (T8.4, T10.4)

Kein Remote-D1.

### 20.3 Browser-UX

Breiten 375 / 390 / 430 px und Desktop. Geprüft wird: kein horizontales
Scrollen, passende Tastatur, Loginbutton gut erreichbar, Fehlermeldung
sichtbar, sinnvoller Fokus, nach Login sofort `/bestellen`, kein neuer Tab,
keine externe Domain, Logout funktioniert.

### 20.4 Abschluss

* volle Suite + Typecheck
* `git diff --name-only feature/order-system-cafe-ordering` sichten
* README aktualisieren
* Abschlussbericht nach Vorgabe §79

**Commit:** `docs(order-system): Stand nach der First-Party-Authentifizierung`

---

## Was in diesem Plan bewusst fehlt

* Passwort/PIN ändern, Recovery, Magic Link — Non-Goal §20 der Spec
* 2FA — Non-Goal, als Härtung in §21 vermerkt
* Rehash beim Login — die Spalten existieren, die Mechanik nicht
* Cloudflare Rate Limiting, Turnstile, WAF — Phase 3B+
* jede Form von Deployment — §72 der Vorgabe
