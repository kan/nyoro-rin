import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RANKING_CONSENT_VERSION } from "../src/core/account-profile";
import type { Difficulty } from "../src/core/model";
import { createFakeIdPlatform } from "kan-game/testing/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "kan-game/testing/test-id-cookie";
import { DB, call, workerEnv } from "./worker-env";

let issuer: TestIdIssuer;
let env: Env;

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
  // Each test starts from no records.
  await DB.batch([
    DB.prepare("DELETE FROM first_ranked_plays"),
    DB.prepare("DELETE FROM completed_plays"),
    DB.prepare("DELETE FROM profiles"),
  ]);
});

async function newAccount() {
  const id = crypto.randomUUID();
  return { id, headers: { Cookie: await issuer.cookie(id) } };
}

/** A puzzle ID from a short label, in the p1 form. */
function board(label: string): string {
  return `p1:${label.padEnd(64, "0")}`;
}

async function named(account: string, consented = true): Promise<void> {
  await DB.prepare(
    `INSERT INTO profiles (account_id, display_name, consent_version, consented_at)
     VALUES (?, ?, ?, 0)`,
  )
    .bind(
      account,
      `p-${account.slice(0, 8)}`,
      consented ? RANKING_CONSENT_VERSION : null,
    )
    .run();
}

/**
 * A clear stored as POST /api/plays stores it; ranked ones go through the
 * trigger that marks the first record public.
 */
async function clear(
  account: string,
  puzzle: string,
  options: {
    difficulty?: Difficulty;
    version?: string;
    ranked?: boolean;
  } = {},
): Promise<void> {
  const { difficulty = "easy", version = "n1", ranked = true } = options;
  await DB.prepare(
    `INSERT INTO completed_plays (account_id, play_id, puzzle_id, seed_code,
       generator_version, difficulty, started_at, completed_at,
       elapsed_seconds, hints_used, max_hint_stage, max_assist, reveals,
       ranking_eligible)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 60, 0, 0, 2, 0, ?)`,
  )
    .bind(
      account,
      crypto.randomUUID(),
      puzzle,
      `NYORO:${version}:${difficulty}:${puzzle.slice(3, 9)}`,
      version,
      difficulty,
      ranked ? 1 : 0,
    )
    .run();
}

async function candidates(headers: HeadersInit, difficulty = "easy") {
  const response = await call(
    env,
    `/api/next-puzzle?difficulty=${difficulty}`,
    { headers },
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      candidates?: { puzzleId: string; seedCode: string; players: number }[];
    },
  };
}

/** Players who cleared a board, each with a consented name. */
async function players(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { id } = await newAccount();
    await named(id);
    ids.push(id);
  }
  return ids;
}

describe("GET /api/next-puzzle", () => {
  it("needs the ID", async () => {
    expect((await candidates({})).status).toBe(401);
  });

  it("refuses an unknown difficulty", async () => {
    const me = await newAccount();
    expect((await candidates(me.headers, "random")).status).toBe(400);
  });

  it("is GET only", async () => {
    const me = await newAccount();
    const response = await call(env, "/api/next-puzzle?difficulty=easy", {
      method: "POST",
      headers: { ...me.headers, Origin: "https://nyoro-dev.kan-game.app" },
      body: "{}",
    });
    expect(response.status).toBe(405);
  });

  it("offers boards most players have, without the ones the player solved", async () => {
    const [a, b, c] = await players(3);
    for (const id of [a, b, c]) await clear(id, board("aa"));
    for (const id of [a, b]) await clear(id, board("bb"));
    await clear(a, board("cc"));
    await clear(a, board("mine"));

    const me = await newAccount();
    await clear(me.id, board("mine"), { ranked: false });

    const { status, body } = await candidates(me.headers);
    expect(status).toBe(200);
    expect(body.candidates).toEqual([
      { puzzleId: board("aa"), seedCode: "NYORO:n1:easy:aa0000", players: 3 },
      { puzzleId: board("bb"), seedCode: "NYORO:n1:easy:bb0000", players: 2 },
      { puzzleId: board("cc"), seedCode: "NYORO:n1:easy:cc0000", players: 1 },
    ]);
  });

  it("counts only consented public first records", async () => {
    const [a] = await players(1);
    const { id: unconsented } = await newAccount();
    await named(unconsented, false);
    const { id: unnamed } = await newAccount();
    // Two clears of the same board by one player: only the first is public.
    await clear(a, board("aa"));
    await clear(a, board("aa"));
    await clear(unconsented, board("aa"));
    await clear(unnamed, board("bb"));
    await clear(a, board("cc"), { ranked: false });

    const me = await newAccount();
    expect((await candidates(me.headers)).body.candidates).toEqual([
      { puzzleId: board("aa"), seedCode: "NYORO:n1:easy:aa0000", players: 1 },
    ]);
  });

  it("offers only the difficulty asked for, of the current version", async () => {
    const [a] = await players(1);
    await clear(a, board("easy"));
    await clear(a, board("hard"), { difficulty: "hard" });
    await clear(a, board("old"), { version: "n0" });

    const me = await newAccount();
    expect(
      (await candidates(me.headers)).body.candidates?.map((c) => c.puzzleId),
    ).toEqual([board("easy")]);
    expect(
      (await candidates(me.headers, "hard")).body.candidates?.map(
        (c) => c.puzzleId,
      ),
    ).toEqual([board("hard")]);
  });

  it("returns 30 at most, and nothing about the players", async () => {
    const [a] = await players(1);
    for (let i = 0; i < 35; i += 1) {
      await clear(a, board(i.toString(16).padStart(2, "0")));
    }
    const me = await newAccount();
    const list = (await candidates(me.headers)).body.candidates!;
    expect(list).toHaveLength(30);
    for (const candidate of list) {
      expect(Object.keys(candidate).sort()).toEqual([
        "players",
        "puzzleId",
        "seedCode",
      ]);
    }
    expect(JSON.stringify(list)).not.toContain(a);
  });
});
