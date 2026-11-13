/**
 * The Worker under test: an in-memory D1 with every migration applied, and
 * the env the Worker reads. Each test file gets its own database.
 */
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import worker from "../src/worker/index";

export const ORIGIN = "https://nyoro-dev.kan-game.app";

export type Platform = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

export async function startPlatform(): Promise<Platform> {
  const platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  return platform;
}

/** Applies migrations/ in order, split as the wrangler CLI splits them. */
export async function migrateTestDatabase(db: D1Database): Promise<void> {
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, directory), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) {
      await db.prepare(statement).run();
    }
  }
}

/** The env of the Worker; `overrides` replaces any part. */
export function workerEnv(
  platform: Platform,
  overrides: Partial<Record<keyof Env, unknown>> = {},
): Env {
  return {
    DB: platform.env.DB,
    ALLOWED_ORIGINS: ORIGIN,
    ID_COOKIE_NAME: "__Secure-kgdev_id",
    ID_ISSUER: "localhost",
    ID_PUBLIC_KEYS: "[]",
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
