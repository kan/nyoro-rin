/**
 * Helpers for the Worker under test. The tests run in the Workers runtime
 * (vitest.config.ts): `env.DB` is an in-memory D1 with every migration
 * applied (tests/apply-migrations.ts), and each test file gets its own.
 */
import { env } from "cloudflare:workers";
import worker from "../src/worker/index";

export const ORIGIN = "https://nyoro-dev.kan-game.app";

/** The daily seeds' key in tests; never a deployed one. */
export const TEST_DAILY_SEED_SECRET = "nyoro-test-daily-secret";

/** The test D1. */
export const DB: D1Database = env.DB;

/** The env of the Worker; `overrides` replaces any part. */
export function workerEnv(
  overrides: Partial<Record<keyof Env, unknown>> = {},
): Env {
  return {
    DB,
    ALLOWED_ORIGINS: ORIGIN,
    ID_COOKIE_NAME: "__Secure-kgdev_id",
    ID_ISSUER: "localhost",
    ID_PUBLIC_KEYS: "[]",
    DAILY_SEED_SECRET: TEST_DAILY_SEED_SECRET,
    ASSETS: { fetch: async () => new Response("screen") },
    ...overrides,
  } as unknown as Env;
}

/** Sends a request to the Worker. */
export function call(env: Env, path: string, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, init) as Parameters<typeof worker.fetch>[0],
    env,
  );
}

/** A POST of JSON from the allowed origin. */
export function post(body: unknown, headers: HeadersInit = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  };
}
