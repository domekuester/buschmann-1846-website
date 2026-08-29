import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Von vitest.config.ts gesetzt, siehe tests/setup/apply-migrations.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
