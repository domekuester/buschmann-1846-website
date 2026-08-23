import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * Jede Worker-Testdatei bekommt eine eigene, leere D1. Vor dem ersten Test
 * werden die echten Migrationen aus migrations/ eingespielt — dieselben
 * Dateien, die `wrangler d1 migrations apply` anwendet. Ein Schemafehler
 * fällt damit im Testlauf auf und nicht erst beim Deployment.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
