import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newAttempt } from "../src/core/attempt";
import {
  type DailyCompletionUpload,
  type DailyStatus,
  dailyDate,
  nextDailyDate,
  previousDailyDate,
} from "../src/core/daily";
import { dailySeed, generateDailyPuzzle } from "../src/core/daily-generator";
import { deleteAccount } from "../src/worker/accounts";
import {
  DAILY_MIN_ELAPSED_SECONDS,
  completeDailyAttempt,
  getOrCreateDailyBoard,
} from "../src/worker/daily";
import worker, { DAILY_CRON, DAILY_RETRY_CRON } from "../src/worker/index";
import { createFakeIdPlatform } from "./kan-game/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import {
  DB,
  TEST_DAILY_SEED_SECRET,
  call,
  post,
  workerEnv,
} from "./worker-env";

let issuer: TestIdIssuer;
let env: Env;
let today: string;
/** Today's board as stored, solution included, made once for the file. */
let solution: readonly number[];
let todayId: string;

function testEnv(): Env {
  return workerEnv({
    ID: createFakeIdPlatform().rpc,
    ID_COOKIE_NAME: issuer.cookieName,
    ID_ISSUER: issuer.issuer,
    ID_PUBLIC_KEYS: issuer.publicKeys,
  });
}

beforeAll(async () => {
  issuer = await createTestIdIssuer();
  env = testEnv();
  today = dailyDate(Date.now());
  // No board is stored yet: the day's first request makes it.
  const first = await call(env, "/api/daily", {
    headers: { Cookie: await issuer.cookie(crypto.randomUUID()) },
  });
  expect(first.status).toBe(200);
  const stored = await getOrCreateDailyBoard(
    DB,
    TEST_DAILY_SEED_SECRET,
    today,
    Date.now(),
  );
  solution = stored.solution;
  todayId = stored.board.puzzleId;
});

beforeEach(() => {
  env = testEnv();
});

async function newAccount() {
  const id = crypto.randomUUID();
  return { id, headers: { Cookie: await issuer.cookie(id) } };
}

let names = 0;
/** A named player who consented to the ranking. */
async function namedAccount() {
  const account = await newAccount();
  names += 1;
  const response = await call(
    env,
    "/api/profile",
    post({ displayName: `にょろ${names}`, consentVersion: 1 }, account.headers),
  );
  expect(response.status).toBe(200);
  return account;
}

async function status(headers: HeadersInit): Promise<DailyStatus> {
  const response = await call(env, "/api/daily", { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as DailyStatus;
}

function start(headers: HeadersInit, playId: string, date = today) {
  return call(env, "/api/daily/start", post({ date, playId }, headers));
}

function completion(
  playId: string,
  overrides: Partial<DailyCompletionUpload> = {},
): DailyCompletionUpload {
  return {
    ...newAttempt(playId, 1_000, 2),
    date: today,
    puzzleId: todayId,
    elapsedSeconds: 600,
    loop: [...solution],
    ...overrides,
  };
}

function complete(headers: HeadersInit, upload: DailyCompletionUpload) {
  return call(env, "/api/daily/complete", post(upload, headers));
}

describe("today's board", () => {
  it("is the same for everyone and carries no solution", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const first = await status(a.headers);
    const second = await status(b.headers);
    expect(first.board).toEqual(second.board);
    expect(first).toEqual({ board: first.board, attempt: "not_started" });
    expect(first.board).toMatchObject({
      date: today,
      puzzleId: todayId,
      generatorVersion: "d1",
      size: 10,
    });
    const text = JSON.stringify(first);
    expect(text).not.toContain("solution");
    expect(text).not.toContain(await dailySeed(TEST_DAILY_SEED_SECRET, today));
  });

  it("needs an ID", async () => {
    expect((await call(env, "/api/daily")).status).toBe(401);
  });

  it("is unavailable without the seed key", async () => {
    const { headers } = await newAccount();
    const without = workerEnv({ ...env, DAILY_SEED_SECRET: "" });
    expect((await call(without, "/api/daily", { headers })).status).toBe(503);
  });
});

describe("starting", () => {
  it("takes the day's one challenge at READY's OK", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    expect((await start(headers, playId)).status).toBe(201);
    expect(await status(headers)).toMatchObject({ attempt: "active", playId });
    // The same start again (a resend) stands.
    expect((await start(headers, playId)).status).toBe(200);
    // Another device, or a reload, cannot start a second one.
    const again = await start(headers, crypto.randomUUID());
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ status: "already_started" });
  });

  it("needs a name and consent", async () => {
    const { headers } = await newAccount();
    expect((await start(headers, crypto.randomUUID())).status).toBe(403);
    expect((await status(headers)).attempt).toBe("not_started");
  });

  it("is today's only", async () => {
    const { headers } = await namedAccount();
    for (const date of [nextDailyDate(today), "2026-01-01"]) {
      const response = await start(headers, crypto.randomUUID(), date);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ status: "expired" });
    }
    expect((await start(headers, "not-a-uuid")).status).toBe(400);
  });
});

describe("completing", () => {
  it("refuses a time no one can play without hints", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    await start(headers, playId);
    const tooFast = await complete(
      headers,
      completion(playId, {
        elapsedSeconds: DAILY_MIN_ELAPSED_SECONDS - 1,
        hintsUsed: 0,
      }),
    );
    expect(tooFast.status).toBe(400);
    expect(await tooFast.json()).toMatchObject({ error: "invalid_time" });
    // At the floor it counts.
    const done = await complete(
      headers,
      completion(playId, {
        elapsedSeconds: DAILY_MIN_ELAPSED_SECONDS,
        hintsUsed: 0,
      }),
    );
    expect(done.status).toBe(201);
  });

  it("takes a fast time with hints, and a time past the server's clock", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    await start(headers, playId);
    // Lines shown one after another can close the loop fast; and a device
    // clock that jumped ahead may count more than has passed.
    const done = await complete(
      headers,
      completion(playId, {
        elapsedSeconds: 5,
        hintsUsed: 40,
        maxHintStage: 2,
        reveals: 40,
      }),
    );
    expect(done.status).toBe(201);
    const other = await namedAccount();
    const otherPlayId = crypto.randomUUID();
    await start(other.headers, otherPlayId);
    const long = await complete(
      other.headers,
      completion(otherPlayId, { elapsedSeconds: 10 * 60 * 60 }),
    );
    expect(long.status).toBe(201);
  });

  it("checks the loop and records the result once", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    await start(headers, playId);

    const wrong = await complete(
      headers,
      completion(playId, { loop: solution.slice(1) }),
    );
    expect(wrong.status).toBe(400);
    expect(
      (
        await complete(
          headers,
          completion(playId, { puzzleId: `p1:${"0".repeat(64)}` }),
        )
      ).status,
    ).toBe(400);

    const done = await complete(headers, completion(playId));
    expect(done.status).toBe(201);
    const body = (await done.json()) as {
      status: string;
      entries: { isSelf: boolean; elapsedSeconds: number }[];
    };
    expect(body.status).toBe("completed");
    expect(body.entries.find((entry) => entry.isSelf)?.elapsedSeconds).toBe(
      600,
    );
    // A resend is a duplicate and changes nothing.
    const resend = await complete(
      headers,
      completion(playId, { elapsedSeconds: 1 }),
    );
    expect(resend.status).toBe(200);
    expect(await resend.json()).toMatchObject({ status: "duplicate" });
    expect(await status(headers)).toMatchObject({ attempt: "completed" });
    const restart = await start(headers, crypto.randomUUID());
    expect(await restart.json()).toMatchObject({ status: "completed" });
  });

  it("refuses a challenge that was not started", async () => {
    const { headers } = await namedAccount();
    const response = await complete(headers, completion(crypto.randomUUID()));
    expect(response.status).toBe(409);
    // Nor another playId than the started one.
    await start(headers, crypto.randomUUID());
    expect(
      (await complete(headers, completion(crypto.randomUUID()))).status,
    ).toBe(409);
  });

  /** A started, unfinished challenge of `date`, and its completion. */
  async function startedOn(date: string) {
    const { id } = await namedAccount();
    const stored = await getOrCreateDailyBoard(
      DB,
      TEST_DAILY_SEED_SECRET,
      date,
      Date.now(),
    );
    const playId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(id, date, playId, Date.now())
      .run();
    const upload = completion(playId, {
      date,
      puzzleId: stored.board.puzzleId,
      loop: [...stored.solution],
    });
    return { id, upload };
  }

  /** Noon in Japan of `today`: the run may cross midnight meanwhile. */
  const noonOfToday = () => Date.parse(`${today}T03:00:00Z`);

  it("accepts yesterday's challenge started before midnight", async () => {
    const { id, upload } = await startedOn(previousDailyDate(today));
    expect(await completeDailyAttempt(DB, id, upload, noonOfToday())).toBe(
      "completed",
    );
    // A date after today is refused, whatever it carries.
    expect(
      await completeDailyAttempt(
        DB,
        id,
        { ...upload, date: nextDailyDate(today) },
        noonOfToday(),
      ),
    ).toBe("expired");
  });

  it("refuses a challenge two days old: the day's ranking stays", async () => {
    const date = previousDailyDate(previousDailyDate(today));
    const { id, upload } = await startedOn(date);
    expect(await completeDailyAttempt(DB, id, upload, noonOfToday())).toBe(
      "expired",
    );
    const row = await DB.prepare(
      `SELECT completed_at FROM daily_attempts
       WHERE account_id = ? AND challenge_date = ?`,
    )
      .bind(id, date)
      .first<{ completed_at: number | null }>();
    expect(row?.completed_at).toBeNull();
  });
});

describe("the day's ranking", () => {
  it("lists the top 100, the viewer below them, and no IDs", async () => {
    const date = "2026-10-01";
    await getOrCreateDailyBoard(DB, TEST_DAILY_SEED_SECRET, date, Date.now());
    const insert = DB.prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at,
         completed_at, elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals)
       VALUES (?, ?, ?, 0, 1, ?, 0, 0, ?, 0)`,
    );
    const profile = DB.prepare(
      `INSERT INTO profiles (account_id, display_name, consent_version, consented_at)
       VALUES (?, ?, 1, 0)`,
    );
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 101; i += 1) {
      const id = crypto.randomUUID();
      statements.push(profile.bind(id, `上位${i}`));
      statements.push(insert.bind(id, date, crypto.randomUUID(), 100 + i, 1));
    }
    // One who did not consent is never listed.
    const hidden = crypto.randomUUID();
    statements.push(
      DB.prepare(
        "INSERT INTO profiles (account_id, display_name) VALUES (?, ?)",
      ).bind(hidden, "非公開"),
      insert.bind(hidden, date, crypto.randomUUID(), 1, 0),
    );
    await DB.batch(statements);
    const viewer = await namedAccount();
    await DB.prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at,
         completed_at, elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals)
       VALUES (?, ?, ?, 0, 1, 9999, 2, 1, 2, 0)`,
    )
      .bind(viewer.id, date, crypto.randomUUID())
      .run();

    const response = await call(env, `/api/daily/ranking?date=${date}`, {
      headers: viewer.headers,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      date: string;
      entries: { rank: number; displayName: string; isSelf: boolean }[];
    };
    expect(body.date).toBe(date);
    expect(body.entries).toHaveLength(101);
    expect(body.entries[0]).toMatchObject({ rank: 1, displayName: "上位0" });
    expect(body.entries.slice(0, 100).some((entry) => entry.isSelf)).toBe(
      false,
    );
    expect(body.entries[100]).toMatchObject({ rank: 102, isSelf: true });
    expect(body.entries.map((entry) => entry.displayName)).not.toContain(
      "非公開",
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain(viewer.id);
    expect(text).not.toContain("playId");
  });

  it("is for days up to today", async () => {
    const { headers } = await newAccount();
    for (const date of [nextDailyDate(today), "2026-02-30", ""]) {
      const response = await call(env, `/api/daily/ranking?date=${date}`, {
        headers,
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("history", () => {
  it("lists the ID's challenges, unfinished ones included", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    await start(headers, playId);
    const response = await call(env, "/api/daily/history", { headers });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plays: unknown[] };
    expect(body.plays).toEqual([
      {
        playId,
        date: today,
        startedAt: expect.any(Number),
        completedAt: null,
        elapsedSeconds: null,
        hintsUsed: null,
        maxHintStage: null,
        maxAssist: null,
      },
    ]);
    // Another ID sees none of it.
    const other = await newAccount();
    const theirs = await call(env, "/api/daily/history", {
      headers: other.headers,
    });
    expect(await theirs.json()).toEqual({ plays: [] });
  });
});

describe("withdrawal", () => {
  it("deletes the ID's challenges", async () => {
    const { id, headers } = await namedAccount();
    await start(headers, crypto.randomUUID());
    await deleteAccount(DB, id);
    const row = await DB.prepare(
      "SELECT COUNT(*) AS n FROM daily_attempts WHERE account_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("making the boards", () => {
  it("makes tomorrow's board in the scheduled run, fixed once made", async () => {
    const now = Date.now();
    const tomorrow = nextDailyDate(dailyDate(now));
    await worker.scheduled(
      { cron: DAILY_CRON, scheduledTime: now } as ScheduledController,
      env,
    );
    const row = await DB.prepare(
      "SELECT puzzle_id, clues_json FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(tomorrow)
      .first<{ puzzle_id: string; clues_json: string }>();
    expect(row).not.toBeNull();
    const expected = generateDailyPuzzle(
      await dailySeed(TEST_DAILY_SEED_SECRET, tomorrow),
      tomorrow,
    );
    expect(JSON.parse(row!.clues_json)).toEqual(expected.clues);
    // A second run keeps the stored board.
    await DB.prepare(
      "UPDATE daily_puzzles SET created_at = 1 WHERE challenge_date = ?",
    )
      .bind(tomorrow)
      .run();
    await worker.scheduled(
      { cron: DAILY_CRON, scheduledTime: now } as ScheduledController,
      env,
    );
    // So does the 23:30 run, which is there for a failed 23:00 one.
    await worker.scheduled(
      { cron: DAILY_RETRY_CRON, scheduledTime: now } as ScheduledController,
      env,
    );
    const again = await DB.prepare(
      "SELECT created_at FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(tomorrow)
      .first<{ created_at: number }>();
    expect(again?.created_at).toBe(1);
  });

  it("makes a missed day's board at its first request", async () => {
    // beforeAll's request was the day's first: it made today's board.
    const row = await DB.prepare(
      "SELECT puzzle_id FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(today)
      .first<{ puzzle_id: string }>();
    expect(row?.puzzle_id).toBe(todayId);
  });
});

describe("daily achievements", () => {
  /** Stand-in boards and completed challenges on past dates. */
  async function completedOn(accountId: string, dates: readonly string[]) {
    await DB.batch(
      dates.flatMap((date) => [
        DB.prepare(
          `INSERT INTO daily_puzzles (challenge_date, generator_version, puzzle_id,
             clues_json, solution_json, created_at)
           VALUES (?, 'd1', 'p1:test', '[]', '[]', 0) ON CONFLICT DO NOTHING`,
        ).bind(date),
        DB.prepare(
          `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at,
             completed_at, elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals)
           VALUES (?, ?, ?, ?, ?, 60, 0, 0, 0, 0)`,
        ).bind(
          accountId,
          date,
          crypto.randomUUID(),
          Date.parse(`${date}T03:00:00Z`),
          Date.parse(`${date}T03:00:00Z`),
        ),
      ]),
    );
  }

  async function progress(headers: HeadersInit) {
    const response = await call(env, "/api/achievements", { headers });
    const body = (await response.json()) as {
      achievements: {
        id: string;
        unlockedAt: number | null;
        progress: number | null;
      }[];
    };
    return new Map(body.achievements.map((item) => [item.id, item]));
  }

  it("announces the first daily clear with the completion, once", async () => {
    const { headers } = await namedAccount();
    const playId = crypto.randomUUID();
    await start(headers, playId);
    const done = await complete(headers, completion(playId));
    expect(await done.json()).toMatchObject({
      newAchievements: ["daily_first"],
    });
    const resend = await complete(headers, completion(playId));
    expect(await resend.json()).toMatchObject({ newAchievements: [] });
  });

  it("counts completed days in a row, and the days with a clear", async () => {
    const { id, headers } = await namedAccount();
    // Six days in a row, a gap, then one more.
    await completedOn(id, [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-08",
    ]);
    let listed = await progress(headers);
    expect(listed.get("daily_7")?.unlockedAt).not.toBeNull();
    expect(listed.get("daily_streak_7")).toMatchObject({
      unlockedAt: null,
      progress: 6,
    });
    // The daily clears are days with a clear too.
    expect(listed.get("days_7")?.unlockedAt).not.toBeNull();

    // A challenge only started does not fill the gap. Its board is
    // another player's completed day.
    await completedOn(crypto.randomUUID(), ["2026-09-07"]);
    await DB.prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at)
       VALUES (?, '2026-09-07', ?, 0)`,
    )
      .bind(id, crypto.randomUUID())
      .run();
    listed = await progress(headers);
    expect(listed.get("daily_streak_7")?.progress).toBe(6);

    await completedOn(id, ["2026-09-09"]);
    listed = await progress(headers);
    expect(listed.get("daily_streak_7")?.progress).toBe(6);
    await DB.prepare(
      `UPDATE daily_attempts SET completed_at = 1, elapsed_seconds = 60,
         hints_used = 0, max_hint_stage = 0, max_assist = 0, reveals = 0
       WHERE account_id = ? AND challenge_date = '2026-09-07'`,
    )
      .bind(id)
      .run();
    listed = await progress(headers);
    expect(listed.get("daily_streak_7")?.unlockedAt).not.toBeNull();
  });

  it("does not count the daily as ordinary clears", async () => {
    const { id, headers } = await namedAccount();
    await completedOn(id, ["2026-08-01"]);
    const listed = await progress(headers);
    expect(listed.get("clear_first")?.unlockedAt).toBeNull();
    expect(listed.get("daily_first")?.unlockedAt).not.toBeNull();
  });
});
