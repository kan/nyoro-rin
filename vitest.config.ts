import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** The Worker's tests, which run in the Workers runtime (workerd). */
const WORKER_TESTS = ["tests/worker-*.test.ts"];

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      // Generator tests build many boards; CI machines are slower than a laptop.
      testTimeout: 30000,
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            include: ["tests/**/*.test.ts"],
            exclude: WORKER_TESTS,
          },
        },
        {
          extends: true,
          plugins: [
            cloudflareTest({
              // The Worker with an in-memory D1, never a remote database.
              wrangler: { configPath: "./tests/wrangler.jsonc" },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: "worker",
            include: WORKER_TESTS,
            setupFiles: ["./tests/apply-migrations.ts"],
          },
        },
      ],
    },
  };
});
