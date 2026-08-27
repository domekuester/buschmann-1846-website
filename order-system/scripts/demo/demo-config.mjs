/**
 * DIE FESTEN WERTE DER VORFÜHRUNG — an einer Stelle.
 *
 * Port, Adresse, Verzeichnisse und Zugangsdaten der Demo stehen hier und
 * nirgendwo sonst. Ein zweiter Ort für den Port wäre der Tag, an dem im
 * Terminal 8790 steht und in DEMO.md 8791.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALLES HIER IST ÖFFENTLICH BEKANNT UND KEIN GEHEIMNIS.               ║
 * ║  Pepper, Kennungen, PINs und das Admin-Passwort stehen im Klartext   ║
 * ║  in Git und in jedem Klon. Sie gelten AUSSCHLIESSLICH für die        ║
 * ║  lokale Wegwerf-Demo und dürfen niemals in eine echte Datenbank      ║
 * ║  gelangen.                                                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * WARUM DIE DEMO EINE EIGENE KONFIGURATIONSDATEI HAT (demo/wrangler.demo.jsonc)
 * und nicht die wrangler.jsonc der Entwicklung:
 *
 * Wrangler sucht `.dev.vars` NEBEN DER KONFIGURATIONSDATEI, nicht im
 * Arbeitsverzeichnis — und ein `.dev.vars` überschreibt jeden `vars`-Eintrag.
 * Läge die Demokonfiguration neben der Entwicklungs-`.dev.vars`, bekäme der
 * Demo-Worker deren APP_ORIGIN mit Port 8787, und jede schreibende Aktion in
 * der Vorführung scheiterte an der Origin-Prüfung. Ein eigenes Verzeichnis
 * ist die einzige Trennung, die dabei wirklich trennt.
 *
 * Denselben Grund hat das eigene Zustandsverzeichnis: `--persist-to` zeigt auf
 * demo/.state und damit NIEMALS auf order-system/.wrangler/state, wo die
 * persönliche Entwicklungsdatenbank liegt.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** order-system/ — unabhängig davon, aus welchem Verzeichnis gestartet wurde. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** order-system/demo/ — Konfiguration, Zugangsdaten und Zustand der Vorführung. */
export const DEMO_DIR = join(PROJECT_ROOT, 'demo');

/** Die Wrangler-Konfiguration der Demo. Eingecheckt, ohne Geheimnisse. */
export const DEMO_CONFIG_FILE = join(DEMO_DIR, 'wrangler.demo.jsonc');

/**
 * Die Umgebungswerte des Demo-Workers.
 *
 * NICHT EINGECHECKT (siehe demo/.gitignore) und bei jedem Start neu
 * geschrieben. Sie stehen nicht als `vars` in der Demokonfiguration, weil ein
 * eingechecktes ENVIRONMENT=development der Standardwert eines versehentlichen
 * `wrangler deploy --config demo/...` wäre — Sitzungscookies ohne Secure, in
 * Produktion. Dieselbe Überlegung, die auch wrangler.jsonc ohne `vars` lässt.
 */
export const DEMO_DEV_VARS_FILE = join(DEMO_DIR, '.dev.vars');

/** Die Wegwerf-D1 der Demo. Wird von `npm run demo:reset` restlos gelöscht. */
export const DEMO_STATE_DIR = join(DEMO_DIR, '.state');

/**
 * Der feste Demo-Port.
 *
 * FEST UND NICHT ZUFÄLLIG. Eine Vorführung, deren Adresse sich bei jedem
 * Start ändert, ist eine Vorführung mit einer Suche im Terminal davor. Ist
 * der Port belegt, sagt das Startskript das ausdrücklich, statt heimlich
 * auszuweichen — siehe scripts/demo-start.mjs.
 */
export const DEMO_PORT = 8790;

/**
 * 127.0.0.1 UND NICHT localhost.
 *
 * Der Origin einer schreibenden Anfrage muss exakt APP_ORIGIN entsprechen.
 * 'http://localhost:8790' und 'http://127.0.0.1:8790' sind zwei verschiedene
 * Origins; wer die Demo unter der einen Adresse öffnet und die andere
 * konfiguriert hat, kann lesen und nichts speichern.
 */
export const DEMO_HOST = '127.0.0.1';
export const DEMO_URL = `http://${DEMO_HOST}:${DEMO_PORT}`;

/**
 * Der Pepper der Vorführung. ÖFFENTLICH, wie alles in dieser Datei.
 *
 * Er muss mindestens 32 Zeichen haben (src/config/app-config.ts) und ist
 * bewusst als das lesbar, was er ist. Die Verifier der Demokonten werden bei
 * jedem Seed gegen genau diesen Wert gerechnet — es gibt keine vorberechneten
 * Hashes, die auseinanderlaufen könnten.
 */
export const DEMO_PEPPER = 'DEMO-PEPPER-oeffentlich-nur-fuer-die-Vorfuehrung-kein-Echtbetrieb';

/**
 * Das Admin-Konto der Vorführung.
 *
 * Die Kennung endet auf `.test` — eine von der IANA reservierte Domain, die
 * es nicht gibt und nie geben wird. Damit kann diese Adresse niemanden
 * erreichen, auch nicht versehentlich.
 */
export const DEMO_ADMIN = Object.freeze({
  identifier: 'demo-admin@buschmann.test',
  secret: 'Vorfuehrung-Demo-2026',
});

/**
 * Die drei Kundenzugänge der Vorführung — und die drei Fälle, die sie zeigen.
 *
 * Die PIN ist immer genau achtstellig; das verlangt die Domäne. Die Muster
 * sind bewusst offensichtlich erfunden.
 */
export const DEMO_CUSTOMER_LOGINS = Object.freeze([
  Object.freeze({
    identifier: 'CAFEMORGEN',
    pin: '10101010',
    customerId: 1,
    fall: 'Preisgruppe Gastronomie, Lieferung',
  }),
  Object.freeze({
    identifier: 'KONDITOREI',
    pin: '20202020',
    customerId: 2,
    fall: 'noch keiner Preisgruppe zugeordnet — sieht keine Preise und kann nicht bestellen',
  }),
  Object.freeze({
    identifier: 'PRIVATDEMO',
    pin: '30303030',
    customerId: 3,
    fall: 'Preisgruppe Privatkunden, Abholung',
  }),
]);
