import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RANKING_CONSENT_VERSION } from "../src/core/account-profile";
import type { Difficulty } from "../src/core/model";
import { score } from "../src/core/results";
import type { AssistLevel } from "../src/core/settings";
import { rankingWeekOf } from "../src/core/weekly-ranking";
import { listWeeklyRanking } from "../src/worker/weekly-ranking";
import { createFakeIdPlatform } from "./kan-game/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import { DB, ORIGIN, call, workerEnv } from "./worker-env";

let issuer: TestIdIssuer;
let env: Env;

/** A Wednesday noon in Japan; its week runs from Monday 2026-11-09 JST. */
const NOW = Date.UTC(2026, 10, 11, 3);
const WEEK = rankingWeekOf(NOW);

beforeAll(async () => {
  issuer = await createTestIdIssuer();
});

beforeEach(async () => {
  env = workerEnv({
    ID: createFakeIdPlatform().rpc,
    ID_COOKIE_NAME: issuer.cookieName,
    ID_ISSUER: issuer.issuer,
    ID_PUBLIC_KEYS: issuer.publicKeys,
  });
  await DB.batch([
    DB.prepare("DELETE FROM first_ranked_plays"),
    DB.prepare("DELETE FROM completed_plays"),
    DB.prepare("DELETE FROM profiles"),
  ]);
});

let nextName = 0;

/** A player with a name; consented unless told otherwise. */
async function player(consented = true): Promise<string> {
  const id = crypto.randomUUID();
  nextName += 1;
  await DB.prepare(
    `INSERT INTO profiles (account_id, display_name, consent_version, consented_at)
     VALUES (?, ?, ?, 0)`,
  )
    .bind(
      id,
      `player-${String(nextName).padStart(3, "0")}`,
      consented ? RANKING_CONSENT_VERSION : null,
    )
    .run();
  return id;
}

function board(label: string): string {
  return `p1:${label.padEnd(64, "0")}`;
}

interface Clear {
  readonly at?: number;
  readonly seconds?: number;
  readonly hints?: number;
  readonly assist?: AssistLevel;
  readonly difficulty?: Difficulty;
  readonly version?: string;
  readonly eligible?: boolean;
}

/** A clear stored as POST /api/plays stores it. */
async function clear(account: string, puzzle: string, options: Clear = {}) {
  const {
    at = WEEK.start + 60_000,
    seconds = 60,
    hints = 0,
    assist = 0,
    difficulty = "easy",
    version = "n1",
    eligible = true,
  } = options;
  await DB.prepare(
    `INSERT INTO completed_plays (account_id, play_id, puzzle_id, seed_code,
       generator_version, difficulty, started_at, completed_at,
       elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals,
       ranking_eligible)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      account,
      crypto.randomUUID(),
      puzzle,
      `NYORO:${version}:${difficulty}:secret-seed`,
      version,
      difficulty,
      at,
      seconds,
      hints,
      hints > 0 ? 1 : 0,
      assist,
      eligible ? 1 : 0,
    )
    .run();
}

const ranking = (
  difficulty: Difficulty = "easy",
  metric: "clears" | "score" = "clears",
  viewer?: string,
) => listWeeklyRanking(DB, difficulty, metric, viewer, NOW);

describe("weekly ranking", () => {
  it("covers this week in Japan time", async () => {
    const result = await ranking();
    expect(result.start).toBe(Date.UTC(2026, 10, 8, 15));
    expect(result.end).toBe(Date.UTC(2026, 10, 15, 15));
  });

  it("counts a puzzle once a week, by its first clear in the week", async () => {
    const id = await player();
    await clear(id, board("a"), { at: WEEK.start + 1000, seconds: 300 });
    // A faster replay later in the week does not lift the average.
    await clear(id, board("a"), { at: WEEK.start + 2000, seconds: 30 });
    await clear(id, board("b"), { at: WEEK.start + 3000, seconds: 300 });
    const [row] = (await ranking()).entries;
    expect(row).toMatchObject({ clears: 2 });
    expect(row?.averageScore).toBe(
      score({ elapsedSeconds: 300, hintsUsed: 0 }),
    );
  });

  it("counts again a puzzle cleared in an earlier week", async () => {
    const id = await player();
    await clear(id, board("a"), { at: WEEK.start - 1, seconds: 10 });
    await clear(id, board("a"), { at: WEEK.start, seconds: 100 });
    const [row] = (await ranking()).entries;
    expect(row?.clears).toBe(1);
    // The week's own clear, not the earlier faster one.
    expect(row?.averageScore).toBe(
      score({ elapsedSeconds: 100, hintsUsed: 0 }),
    );
  });

  it("leaves out clears outside the week, in the future or of another difficulty", async () => {
    const id = await player();
    await clear(id, board("a"), { at: WEEK.end });
    await clear(id, board("b"), { at: NOW + 1 });
    await clear(id, board("c"), { difficulty: "hard" });
    await clear(id, board("d"), { version: "x9" });
    expect((await ranking()).entries).toEqual([]);
    expect((await ranking("hard")).entries).toHaveLength(1);
  });

  it("shows only consenting players, and only clears made after consent", async () => {
    const shy = await player(false);
    await clear(shy, board("a"));
    const early = await player();
    // Before consent: ranking_eligible was 0 when it was stored.
    await clear(early, board("a"), { eligible: false });
    expect((await ranking()).entries).toEqual([]);
  });

  it("orders by clears, sharing ranks on ties", async () => {
    const [one, two, three] = [await player(), await player(), await player()];
    for (const label of ["a", "b", "c"]) await clear(two, board(label));
    for (const label of ["a", "b"]) await clear(one, board(label));
    for (const label of ["a", "b"]) await clear(three, board(label));
    const entries = (await ranking()).entries;
    expect(entries.map((e) => [e.rank, e.clears])).toEqual([
      [1, 3],
      [2, 2],
      [2, 2],
    ]);
  });

  it("ranks by average score only players with five clears", async () => {
    const fast = await player();
    const slow = await player();
    const few = await player();
    for (let i = 0; i < 5; i += 1) {
      await clear(fast, board(`f${i}`), { seconds: 60 });
      await clear(slow, board(`s${i}`), { seconds: 120, hints: i });
    }
    for (let i = 0; i < 4; i += 1)
      await clear(few, board(`w${i}`), { seconds: 10 });
    const entries = (await ranking("easy", "score")).entries;
    expect(entries.map((e) => e.rank)).toEqual([1, 2]);
    expect(entries[0]?.averageScore).toBe(
      score({ elapsedSeconds: 60, hintsUsed: 0 }),
    );
    // The mean is of the scores, each with its own no-hint bonus.
    const slowScores = [0, 1, 2, 3, 4].map((hints) =>
      score({ elapsedSeconds: 120, hintsUsed: hints }),
    );
    expect(entries[1]?.averageScore).toBeCloseTo(
      slowScores.reduce((a, b) => a + b) / 5,
    );
  });

  it("marks a row with the highest assist used in the counted clears", async () => {
    const id = await player();
    await clear(id, board("a"), { assist: 0 });
    await clear(id, board("b"), { assist: 1 });
    // Not counted: a replay of a, and a clear of last week.
    await clear(id, board("a"), { assist: 2, at: WEEK.start + 120_000 });
    await clear(id, board("c"), { assist: 2, at: WEEK.start - 1 });
    expect((await ranking()).entries[0]?.maxAssist).toBe(1);
  });

  it("shows at most 100 players", async () => {
    const statements = [];
    for (let i = 0; i < 101; i += 1) {
      const id = crypto.randomUUID();
      statements.push(
        DB.prepare(
          `INSERT INTO profiles (account_id, display_name, consent_version, consented_at)
           VALUES (?, ?, ?, 0)`,
        ).bind(id, `many-${i}`, RANKING_CONSENT_VERSION),
        DB.prepare(
          `INSERT INTO completed_plays (account_id, play_id, puzzle_id, seed_code,
             generator_version, difficulty, started_at, completed_at,
             elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals,
             ranking_eligible)
           VALUES (?, ?, ?, 'NYORO:n1:easy:s', 'n1', 'easy', 0, ?, 60, 0, 0, 0, 0, 1)`,
        ).bind(id, crypto.randomUUID(), board("a"), WEEK.start),
      );
    }
    await DB.batch(statements);
    expect((await ranking()).entries).toHaveLength(100);
  });

  it("marks only the viewer's own row", async () => {
    const me = await player();
    const other = await player();
    await clear(me, board("a"));
    await clear(other, board("a"));
    const entries = (await ranking("easy", "clears", me)).entries;
    expect(entries.filter((e) => e.isSelf)).toHaveLength(1);
    expect((await ranking()).entries.some((e) => e.isSelf)).toBe(false);
  });
});

describe("GET /api/weekly-ranking", () => {
  it("is readable without an ID and returns no IDs, seeds or records", async () => {
    const id = await player();
    await clear(id, board("a"), { at: rankingWeekOf(Date.now()).start });
    const response = await call(
      env,
      "/api/weekly-ranking?difficulty=easy&metric=clears",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    const body = JSON.parse(text) as {
      start: number;
      end: number;
      entries: Record<string, unknown>[];
    };
    expect(body.entries).toHaveLength(1);
    expect(Object.keys(body.entries[0]!).sort()).toEqual([
      "averageScore",
      "clears",
      "displayName",
      "isSelf",
      "maxAssist",
      "rank",
    ]);
    expect(text).not.toContain(id);
    expect(text).not.toContain("secret-seed");
    expect(text).not.toContain(board("a"));
  });

  it("marks the viewer's row from the ID cookie", async () => {
    const id = await player();
    await clear(id, board("a"), { at: rankingWeekOf(Date.now()).start });
    const response = await call(
      env,
      "/api/weekly-ranking?difficulty=easy&metric=score",
      { headers: { Cookie: await issuer.cookie(id) } },
    );
    // One clear is below the five the score order needs.
    expect(((await response.json()) as { entries: unknown[] }).entries).toEqual(
      [],
    );
    const clears = await call(
      env,
      "/api/weekly-ranking?difficulty=easy&metric=clears",
      { headers: { Cookie: await issuer.cookie(id) } },
    );
    const body = (await clears.json()) as { entries: { isSelf: boolean }[] };
    expect(body.entries[0]?.isSelf).toBe(true);
  });

  it("refuses unknown conditions and other methods", async () => {
    for (const query of [
      "",
      "?difficulty=easy",
      "?metric=clears",
      "?difficulty=super&metric=clears",
      "?difficulty=easy&metric=time",
    ]) {
      const response = await call(env, `/api/weekly-ranking${query}`);
      expect(response.status, query).toBe(400);
    }
    const post = await call(env, "/api/weekly-ranking", {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
  });
});
