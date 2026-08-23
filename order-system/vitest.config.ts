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
              bindings: { TEST_MIGRATIONS: migrations },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['tests/d1/**/*.test.ts', 'tests/http/**/*.test.ts'],
          setupFiles: ['./tests/setup/apply-migrations.ts'],
        },
      },
    ],
  },
});
