import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

/**
 * Die Migrationen werden beim Start EINMAL von der Platte gelesen und den
 * Worker-Tests als Binding übergeben. Jede Testdatei spielt sie danach in ihre
 * eigene, leere D1 ein (tests/setup/apply-migrations.ts). Damit läuft das
 * Schema in jedem Testlauf tatsächlich durch SQLite — es wird nicht bloß
 * gelesen.
 */
const migrations = await readD1Migrations('./migrations');

/**
 * Zwei Projekte, weil es zwei Testarten gibt:
 *
 *   domain — reine TypeScript-Geschäftslogik. Läuft im normalen Node-Umfeld,
 *            ohne Worker-Runtime, ohne Datenbank, ohne Netz. Das ist zugleich
 *            die Probe darauf, dass die Domäne unabhängig ist: Hinge sie an
 *            D1 oder HTTP, liefen diese Tests nicht.
 *
 *   worker — Integrationstests gegen die echte Workers-Runtime und eine echte
 *            lokale D1. Fremdschlüssel, CHECK-Bedingungen und der atomare
 *            Schreibvorgang werden hier ausgeführt, nicht behauptet.
 *
 *   ui     — das ausgelieferte Client-Skript gegen ein DOM. Das Test-DOM wird
 *            NICHT von Hand geschrieben, sondern aus renderOrderPage() erzeugt
 *            — also aus genau dem HTML, das der Worker ausliefert. Ein
 *            Testfragment würde grün bleiben, während die echte Seite kaputt
 *            ist; das ist hier ausgeschlossen.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'domain',
          include: ['tests/domain/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: migrations,

                /**
                 * Die Auth-Konfiguration der Tests — EXPLIZIT hier und nicht
                 * aus .dev.vars.
                 *
                 * Der Unterschied ist keine Förmlichkeit: .dev.vars steht in
                 * .gitignore. Hingen die Tests daran, liefe die Suite in
                 * einem frischen Klon nicht — und zwar mit lauter
                 * 500-Antworten, deren Ursache nirgends steht. Genau das ist
                 * beim Umbau auf die Sitzungsanmeldung einmal passiert.
                 *
                 * DIESE WERTE SIND TESTWERTE UND KEINE GEHEIMNISSE. Sie
                 * stehen im Klartext in Git und in jedem Klon. Der echte
                 * Pepper kommt aus einem Cloudflare Secret und existiert
                 * nirgendwo in diesem Repository.
                 */
                AUTH_PEPPER: 'TEST-PEPPER-nur-fuer-Tests-kein-Echtwert-0123456789',
                APP_ORIGIN: 'http://127.0.0.1:8787',
                ENVIRONMENT: 'development',
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['tests/d1/**/*.test.ts', 'tests/http/**/*.test.ts'],
          setupFiles: ['./tests/setup/apply-migrations.ts'],
        },
      },
      {
        test: {
          name: 'ui',
          include: ['tests/ui/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
