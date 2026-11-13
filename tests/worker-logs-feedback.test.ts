import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FeedbackUpload } from "../src/core/feedback";
import type { PlayLogUpload } from "../src/core/play-log";
import { deleteAccount } from "../src/worker/accounts";
import { createFakeIdPlatform } from "./kan-game/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import {
  call,
  post,
  startPlatform,
  workerEnv,
  type Platform,
} from "./worker-env";

let platform: Platform;
let issuer: TestIdIssuer;
let env: Env;

beforeAll(async () => {
  platform = await startPlatform();
  issuer = await createTestIdIssuer();
});

afterAll(async () => {
  await platform?.dispose();
});

beforeEach(() => {
  env = workerEnv(platform, {
    ID: createFakeIdPlatform().rpc,
    ID_COOKIE_NAME: issuer.cookieName,
    ID_ISSUER: issuer.issuer,
    ID_PUBLIC_KEYS: issuer.publicKeys,
  });
});

async function newAccount() {
  const id = crypto.randomUUID();
  return { id, headers: { Cookie: await issuer.cookie(id) } };
}

function playLog(overrides: Partial<PlayLogUpload> = {}): PlayLogUpload {
  return {
    playId: crypto.randomUUID(),
    seedCode: "NYORO:n1:easy:abc",
    generatorVersion: "n1",
    difficulty: "easy",
    outcome: "abandoned",
    startedAt: 1_000,
    endedAt: 2_000,
    elapsedMs: 95_000,
    hintsUsed: 1,
    maxHintStage: 2,
    maxAssist: 2,
    reveals: 0,
    appVersion: "0.0.0+test",
    truncated: false,
    events: [
      ["start", 0],
      ["move", 1_000, "tap", [[3, 0, 1]]],
      ["hint", 61_000, 1, "CORNER_THREE"],
      ["hint", 63_000, 2, "CORNER_THREE"],
      ["move", 70_000, "undo", [[3, 1, 0]]],
      ["end", 95_000, "abandoned"],
    ],
    ...overrides,
  };
}

function feedback(body = "楽しかったです"): FeedbackUpload {
  return {
    body,
    context: {
      from: "clear",
      playId: crypto.randomUUID(),
      seedCode: "NYORO:n1:easy:abc",
      difficulty: "easy",
      cleared: true,
      elapsedSeconds: 120,
      hintsUsed: 0,
      maxAssist: 2,
      appVersion: "0.0.0+test",
    },
  };
}

describe("play logs", () => {
  it("stores a log with its counts and takes a resend", async () => {
    const { id, headers } = await newAccount();
    const log = playLog();
    expect((await call(env, "/api/play-logs", post(log, headers))).status).toBe(
      201,
    );
    expect((await call(env, "/api/play-logs", post(log, headers))).status).toBe(
      200,
    );
    const row = await platform.env.DB.prepare(
      "SELECT moves, undos, hint_steps, longest_gap_ms, events FROM play_logs WHERE account_id = ?",
    )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      moves: 1,
      undos: 1,
      hint_steps: 2,
      longest_gap_ms: 60_000,
    });
    expect(JSON.parse(row!.events as string)).toEqual(log.events);
  });

  it("refuses a malformed log", async () => {
    const { headers } = await newAccount();
    for (const bad of [
      playLog({ seedCode: "NYORO:n1:hard:abc" }),
      playLog({ events: [["fly", 0]] as never }),
      playLog({ events: [["move", 0, "tap", [[3, 1, 1]]]] }),
      playLog({ endedAt: 0 }),
    ]) {
      expect(
        (await call(env, "/api/play-logs", post(bad, headers))).status,
      ).toBe(400);
    }
  });

  it("needs the ID cookie", async () => {
    expect((await call(env, "/api/play-logs", post(playLog()))).status).toBe(
      401,
    );
  });

  it("limits new logs to 60 an hour", async () => {
    const { headers } = await newAccount();
    for (let i = 0; i < 60; i += 1) {
      expect(
        (await call(env, "/api/play-logs", post(playLog(), headers))).status,
      ).toBe(201);
    }
    expect(
      (await call(env, "/api/play-logs", post(playLog(), headers))).status,
    ).toBe(429);
  });
});

describe("feedback", () => {
  it("stores feedback with its context, 5 an hour", async () => {
    const { id, headers } = await newAccount();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await call(env, "/api/feedback", post(feedback(), headers))).status,
      ).toBe(201);
    }
    const over = await call(env, "/api/feedback", post(feedback(), headers));
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "too_many" });
    const row = await platform.env.DB.prepare(
      "SELECT body, source, cleared, difficulty FROM feedback WHERE account_id = ? LIMIT 1",
    )
      .bind(id)
      .first();
    expect(row).toEqual({
      body: "楽しかったです",
      source: "clear",
      cleared: 1,
      difficulty: "easy",
    });
  });

  it("refuses empty or too long text", async () => {
    const { headers } = await newAccount();
    for (const body of ["   ", "あ".repeat(1001)]) {
      expect(
        (await call(env, "/api/feedback", post(feedback(body), headers)))
          .status,
      ).toBe(400);
    }
  });

  it("refuses a seed code padded or of another difficulty", async () => {
    const { headers } = await newAccount();
    const base = feedback();
    for (const context of [
      { ...base.context, seedCode: " NYORO:n1:easy:abc " },
      { ...base.context, difficulty: "hard" as const },
      { ...base.context, seedCode: null },
    ]) {
      expect(
        (
          await call(
            env,
            "/api/feedback",
            post({ body: base.body, context }, headers),
          )
        ).status,
      ).toBe(400);
    }
  });
});

describe("withdrawal", () => {
  it("deletes the ID's logs and feedback", async () => {
    const { id, headers } = await newAccount();
    await call(env, "/api/play-logs", post(playLog(), headers));
    await call(env, "/api/feedback", post(feedback(), headers));
    await deleteAccount(platform.env.DB, id);
    for (const table of ["play_logs", "feedback"]) {
      const row = await platform.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`,
      )
        .bind(id)
        .first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
  });
});
