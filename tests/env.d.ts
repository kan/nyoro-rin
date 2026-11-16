import type { D1Migration } from "cloudflare:test";

/** The bindings vitest.config.ts adds for the Worker's tests. */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
