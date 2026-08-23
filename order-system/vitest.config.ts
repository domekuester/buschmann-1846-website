import { defineWorkersConfig } from '@cloudflare/vitest-plugin/config';

/**
 * Zwei Projekte, weil zwei Testarten:
 *
 *   domain — reine TypeScript-Geschäftslogik. Läuft im normalen Node-Umfeld,
 *            startet keine Worker-Runtime, braucht keine Datenbank. Genau das
 *            ist die Probe darauf, dass die Domäne unabhängig ist: Würde sie
 *            HTTP oder D1 brauchen, liefen diese Tests nicht.
 *
 *   worker — Integrationstests gegen die echte Workers-Runtime und eine echte
 *            lokale D1. Migrationen, Fremdschlüssel und Constraints werden hier
 *            tatsächlich ausgeführt, nicht statisch gelesen.
 */
export default defineWorkersConfig({
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
        extends: true,
        test: {
          name: 'worker',
          include: ['tests/d1/**/*.test.ts', 'tests/http/**/*.test.ts'],
          poolOptions: {
            workers: {
              singleWorker: true,
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                // Jede Testdatei bekommt ihre eigene, frisch migrierte D1.
                d1Databases: ['DB'],
              },
            },
          },
        },
      },
    ],
  },
});
