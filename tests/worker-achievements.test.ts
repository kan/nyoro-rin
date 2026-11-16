import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import type { Difficulty } from "../src/core/model";
import type { CompletedPlayUpload } from "../src/core/online-play";
import { puzzleId } from "../src/core/puzzle-identity";
import { encodeSeedCode } from "../src/core/seed-code";
import { deleteAccount } from "../src/worker/accounts";
import { createFakeIdPlatform } from "./kan-game/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import { DB, call, post, workerEnv } from "./worker-env";

let issuer: TestIdIssuer;
let env: Env;

const SEED = "achievement-test";
const generated = generatePuzzle(SEED, "easy").puzzle;
const seedCode = encodeSeedCode({
  version: generated.generatorVersion,
  difficulty: "easy",
  seed: SEED,
});
let boardId: string;

beforeAll(async () => {
  issuer = await createTestIdIssuer();
  boardId = await puzzleId(generated);
});

beforeEach(() => {
  env = workerEnv({
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

/** A verified clear of the easy board, sent as the screen sends it. */
function upload(
  overrides: Partial<CompletedPlayUpload> = {},
): CompletedPlayUpload {
  return {
    playId: crypto.randomUUID(),
    puzzleId: boardId,
    seedCode,
    generatorVersion: generated.generatorVersion,
    difficulty: "easy",
    startedAt: 1_000,
    completedAt: Date.now(),
    elapsedSeconds: 120,
    hintsUsed: 1,
    maxHintStage: 1,
    maxAssist: 2,
    reveals: 0,
    loop: [...generated.solution],
    ...overrides,
  };
}

async function sendPlay(headers: HeadersInit, play = upload()) {
  const response = await call(env, "/api/plays", post(play, headers));
  return {
    status: response.status,
    body: (await response.json()) as { newAchievements?: string[] },
  };
}

/** Earlier clears, stored straight into D1 (as before achievements came). */
async function storeClears(
  account: string,
  count: number,
  options: {
    difficulty?: Difficulty;
    version?: string;
    hints?: number;
    assist?: number;
    completedAt?: (index: number) => number;
  } = {},
): Promise<void> {
  const {
    difficulty = "easy",
    version = "n1",
    hints = 1,
    assist = 2,
    completedAt = () => 1_000,
  } = options;
  await DB.batch(
    Array.from({ length: count }, (_, index) =>
      DB.prepare(
        `INSERT INTO completed_plays (account_id, play_id, puzzle_id, seed_code,
           generator_version, difficulty, started_at, completed_at,
           elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 60, ?, ?, ?, 0)`,
      ).bind(
        account,
        crypto.randomUUID(),
        `p1:${String(index).padEnd(64, "0")}`,
        `NYORO:${version}:${difficulty}:s${index}`,
        version,
        difficulty,
        completedAt(index),
        hints,
        hints > 0 ? 1 : 0,
        assist,
      ),
    ),
  );
}

interface Listed {
  id: string;
  unlockedAt: number | null;
  progress: number | null;
}

async function list(headers: HeadersInit): Promise<Map<string, Listed>> {
  const response = await call(env, "/api/achievements", { headers });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { achievements: Listed[] };
  return new Map(body.achievements.map((item) => [item.id, item]));
}

const unlocked = (items: Map<string, Listed>) =>
  [...items.values()].filter((i) => i.unlockedAt !== null).map((i) => i.id);

describe("achievements after a clear", () => {
  it("announces what the clear unlocked, and nothing on a resend", async () => {
    const { headers } = await newAccount();
    const play = upload({ hintsUsed: 0, maxHintStage: 0 });
    const first = await sendPlay(headers, play);
    expect(first.status).toBe(201);
    expect(first.body.newAchievements).toEqual(["clear_first", "no_hint"]);

    const again = await sendPlay(headers, play);
    expect(again.status).toBe(200);
    expect(again.body.newAchievements).toEqual([]);
    expect(unlocked(await list(headers))).toEqual(["clear_first", "no_hint"]);
  });

  it("counts assist stage 0 and hard clears", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 1, { difficulty: "hard", hints: 0, assist: 0 });
    expect(unlocked(await list(headers))).toEqual([
      "clear_first",
      "clear_hard_first",
      "no_hint",
      "no_hint_hard",
      "no_assist",
      "no_assist_hard",
    ]);
  });

  it("stores but does not announce what earlier records already met", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 9);
    const { body } = await sendPlay(headers);
    // clear_first was met before this clear; clear_10 is this clear's.
    expect(body.newAchievements).toEqual(["clear_10"]);
    expect(unlocked(await list(headers))).toEqual(["clear_first", "clear_10"]);
  });

  it("announces a crossing even when the list stored it first", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 9);
    await list(headers);
    const { body } = await sendPlay(headers);
    expect(body.newAchievements).toEqual(["clear_10"]);
  });
});

describe("the list", () => {
  it("unlocks at each threshold, back to records before it", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 9);
    let items = await list(headers);
    expect(items.get("clear_10")).toMatchObject({
      unlockedAt: null,
      progress: 9,
    });
    expect(items.get("clear_first")?.unlockedAt).toEqual(expect.any(Number));
    await storeClears(id, 1);
    items = await list(headers);
    expect(items.get("clear_10")?.progress).toBe(10);
    expect(items.get("clear_10")?.unlockedAt).toEqual(expect.any(Number));
  });

  it("keeps the time of the first unlock", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 1);
    const first = (await list(headers)).get("clear_first")?.unlockedAt;
    const again = (await list(headers)).get("clear_first")?.unlockedAt;
    expect(again).toBe(first);
  });

  it("counts days by the date in Japan", async () => {
    const { id, headers } = await newAccount();
    // 2026-11-16 23:59:59.999 and 2026-11-17 00:00 in Japan, then six more
    // clears on the first of those days.
    const end = Date.parse("2026-11-16T15:00:00Z");
    await storeClears(id, 2, { completedAt: (i) => end - 1 + i });
    await storeClears(id, 6, { completedAt: () => end - 1 });
    expect((await list(headers)).get("days_7")?.progress).toBe(2);
    // Five more days make seven.
    await storeClears(id, 5, {
      completedAt: (i) => end + (i + 1) * 86_400_000,
    });
    expect((await list(headers)).get("days_7")?.unlockedAt).toEqual(
      expect.any(Number),
    );
  });

  it("counts only ordinary boards as clears", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 1, { version: "d9" });
    expect((await list(headers)).get("clear_first")?.progress).toBe(0);
  });

  it("hides a secret one's progress until unlocked", async () => {
    const { id, headers } = await newAccount();
    await storeClears(id, 3);
    const items = await list(headers);
    expect(items.get("clear_500")).toEqual({
      id: "clear_500",
      unlockedAt: null,
      progress: null,
    });
    expect(items.get("tutorial_complete")?.progress).toBeNull();
  });

  it("keeps accounts apart", async () => {
    const one = await newAccount();
    const other = await newAccount();
    await storeClears(one.id, 10);
    await list(one.headers);
    expect(unlocked(await list(other.headers))).toEqual([]);
  });

  it("needs the ID", async () => {
    const response = await call(env, "/api/achievements");
    expect(response.status).toBe(401);
  });
});

describe("the tutorial's achievement", () => {
  it("is unlocked once from the screen", async () => {
    const { headers } = await newAccount();
    const unlock = () =>
      call(
        env,
        "/api/achievements/unlock",
        post({ id: "tutorial_complete" }, headers),
      );
    const first = await unlock();
    expect(await first.json()).toEqual({
      newAchievements: ["tutorial_complete"],
    });
    expect(await (await unlock()).json()).toEqual({ newAchievements: [] });
    expect(unlocked(await list(headers))).toEqual(["tutorial_complete"]);
  });

  it("refuses any other id", async () => {
    const { headers } = await newAccount();
    for (const id of ["clear_first", "unknown", 3]) {
      const response = await call(
        env,
        "/api/achievements/unlock",
        post({ id }, headers),
      );
      expect(response.status, String(id)).toBe(400);
    }
    expect(unlocked(await list(headers))).toEqual([]);
  });
});

describe("withdrawal", () => {
  it("deletes the account's achievements", async () => {
    const leaving = await newAccount();
    const staying = await newAccount();
    for (const account of [leaving, staying]) {
      await storeClears(account.id, 1);
      await list(account.headers);
    }
    await deleteAccount(DB, leaving.id);
    const count = async (account: string) =>
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM achievements WHERE account_id = ?",
        )
          .bind(account)
          .first<{ n: number }>()
      )?.n;
    expect(await count(leaving.id)).toBe(0);
    expect(await count(staying.id)).toBe(1);
  });
});
