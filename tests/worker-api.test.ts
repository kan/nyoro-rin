import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import type { CompletedPlayUpload } from "../src/core/online-play";
import { puzzleId } from "../src/core/puzzle-identity";
import { encodeSeedCode } from "../src/core/seed-code";
import { deleteAccount, sweepDeletedAccounts } from "../src/worker/accounts";
import {
  createFakeIdPlatform,
  type FakeIdPlatform,
} from "./kan-game/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import {
  ORIGIN,
  call,
  post,
  startPlatform,
  workerEnv,
  type Platform,
} from "./worker-env";

let platform: Platform;
let issuer: TestIdIssuer;
let ids: FakeIdPlatform;
let env: Env;

const SEED = "worker-test";
const generated = generatePuzzle(SEED, "easy").puzzle;
const seedCode = encodeSeedCode({
  version: generated.generatorVersion,
  difficulty: "easy",
  seed: SEED,
});
let boardId: string;

beforeAll(async () => {
  platform = await startPlatform();
  issuer = await createTestIdIssuer();
  boardId = await puzzleId(generated);
});

afterAll(async () => {
  await platform?.dispose();
});

beforeEach(() => {
  ids = createFakeIdPlatform();
  env = workerEnv(platform, {
    ID: ids.rpc,
    ID_COOKIE_NAME: issuer.cookieName,
    ID_ISSUER: issuer.issuer,
    ID_PUBLIC_KEYS: issuer.publicKeys,
  });
});

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
    hintsUsed: 0,
    maxHintStage: 0,
    maxAssist: 2,
    reveals: 0,
    loop: [...generated.solution],
    ...overrides,
  };
}

/** A new ID and the headers its requests carry. */
async function newAccount() {
  const id = crypto.randomUUID();
  return { id, headers: { Cookie: await issuer.cookie(id) } };
}

async function sendPlay(headers: HeadersInit, play: CompletedPlayUpload) {
  return call(env, "/api/plays", post(play, headers));
}

async function consent(headers: HeadersInit, displayName: string) {
  return call(
    env,
    "/api/profile",
    post({ displayName, consentVersion: 1 }, headers),
  );
}

describe("completed plays", () => {
  it("stores a verified clear and answers a resend as a duplicate", async () => {
    const { headers } = await newAccount();
    const play = upload();
    const first = await sendPlay(headers, play);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "created" });
    const again = await sendPlay(headers, play);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "duplicate" });

    const list = await call(env, "/api/plays", { headers });
    const { plays } = (await list.json()) as { plays: { playId: string }[] };
    expect(plays.map((p) => p.playId)).toEqual([play.playId]);
  });

  it("refuses a different play under the same playId and keeps the first", async () => {
    const { headers } = await newAccount();
    const play = upload();
    await sendPlay(headers, play);
    const changed = await sendPlay(headers, { ...play, elapsedSeconds: 1 });
    expect(changed.status).toBe(409);
    const { plays } = (await (
      await call(env, "/api/plays", { headers })
    ).json()) as {
      plays: { elapsedSeconds: number }[];
    };
    expect(plays[0].elapsedSeconds).toBe(120);
  });

  it("refuses a loop that is not the solution", async () => {
    const { headers } = await newAccount();
    const response = await sendPlay(
      headers,
      upload({ loop: generated.solution.slice(1) }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a puzzle ID that the seed code does not make", async () => {
    const { headers } = await newAccount();
    const response = await sendPlay(
      headers,
      upload({ puzzleId: `p1:${"0".repeat(64)}` }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a seed code with padding or another difficulty", async () => {
    const { headers } = await newAccount();
    expect(
      (await sendPlay(headers, upload({ seedCode: ` ${seedCode}` }))).status,
    ).toBe(400);
    expect(
      (await sendPlay(headers, upload({ difficulty: "hard" }))).status,
    ).toBe(400);
  });

  it("needs the ID cookie and an allowed origin", async () => {
    const { headers } = await newAccount();
    expect((await call(env, "/api/plays", post(upload()))).status).toBe(401);
    const foreign = post(upload(), {
      ...headers,
      Origin: "https://example.com",
    });
    expect((await call(env, "/api/plays", foreign)).status).toBe(403);
    const noOrigin = post(upload(), headers);
    (noOrigin.headers as Record<string, string>).Origin = "";
    delete (noOrigin.headers as Record<string, string>).Origin;
    expect((await call(env, "/api/plays", noOrigin)).status).toBe(403);
  });

  it("limits new uploads to 10 a minute, but not resends", async () => {
    const { headers } = await newAccount();
    const plays = Array.from({ length: 10 }, () => upload());
    for (const play of plays)
      expect((await sendPlay(headers, play)).status).toBe(201);
    const over = await sendPlay(headers, upload());
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("60");
    expect((await sendPlay(headers, plays[0])).status).toBe(200);
  });

  it("counts uploads that fail the check, which still cost a regeneration", async () => {
    const { headers } = await newAccount();
    const wrongLoop = generated.solution.slice(1);
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await sendPlay(headers, upload({ loop: wrongLoop }))).status,
      ).toBe(400);
    }
    expect((await sendPlay(headers, upload())).status).toBe(429);
  });
});

describe("rankings", () => {
  it("ranks only clears made after consent, first clear only", async () => {
    const before = await newAccount();
    // A clear before consent stays out, and keeps the puzzle out for good.
    await sendPlay(
      before.headers,
      upload({ completedAt: Date.now() - 3_600_000 }),
    );
    expect((await consent(before.headers, "まえのひと")).status).toBe(200);
    await sendPlay(before.headers, upload());

    const ranked = await newAccount();
    expect((await consent(ranked.headers, "ヘビつかい")).status).toBe(200);
    const first = await sendPlay(
      ranked.headers,
      upload({ elapsedSeconds: 200 }),
    );
    const { entries } = (await first.json()) as { entries: unknown[] };
    expect(entries).toEqual([
      {
        rank: 1,
        displayName: "ヘビつかい",
        elapsedSeconds: 200,
        hintsUsed: 0,
        maxHintStage: 0,
        maxAssist: 2,
        isSelf: true,
      },
    ]);
    // A faster retry is history, not the ranking.
    await sendPlay(ranked.headers, upload({ elapsedSeconds: 10 }));
    const board = await call(
      env,
      `/api/leaderboards/${encodeURIComponent(boardId)}`,
    );
    const body = (await board.json()) as { entries: Record<string, unknown>[] };
    expect(
      body.entries.map((e) => [e.displayName, e.elapsedSeconds, e.isSelf]),
    ).toEqual([["ヘビつかい", 200, false]]);
  });

  it("shares a rank on a full tie and leaves out IDs, dates and the solution", async () => {
    const seed = "tie-test";
    const tie = generatePuzzle(seed, "easy").puzzle;
    const tieCode = encodeSeedCode({
      version: tie.generatorVersion,
      difficulty: "easy",
      seed,
    });
    const tieId = await puzzleId(tie);
    const names = ["あかヘビ", "あおヘビ", "きヘビ"];
    for (const [i, name] of names.entries()) {
      const { headers } = await newAccount();
      await consent(headers, name);
      await sendPlay(
        headers,
        upload({
          puzzleId: tieId,
          seedCode: tieCode,
          loop: [...tie.solution],
          elapsedSeconds: i === 2 ? 300 : 100,
        }),
      );
    }
    const response = await call(
      env,
      `/api/leaderboards/${encodeURIComponent(tieId)}`,
    );
    const { entries } = (await response.json()) as {
      entries: Record<string, unknown>[];
    };
    expect(entries.map((e) => e.rank)).toEqual([1, 1, 3]);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "displayName",
        "elapsedSeconds",
        "hintsUsed",
        "isSelf",
        "maxAssist",
        "maxHintStage",
        "rank",
      ]);
    }
  });

  it("refuses a malformed puzzle ID", async () => {
    expect((await call(env, "/api/leaderboards/p1:xyz")).status).toBe(400);
  });
});

describe("profiles", () => {
  it("keeps a name taken in another game and asks only for consent", async () => {
    const { id, headers } = await newAccount();
    ids.setName(id, "ほかのゲーム");
    const response = await consent(headers, "べつのなまえ");
    expect(await response.json()).toEqual({
      profile: { displayName: "ほかのゲーム", consentVersion: 1 },
    });
  });

  it("refuses a name another ID holds", async () => {
    const holder = await newAccount();
    await consent(holder.headers, "ひとつだけ");
    const other = await newAccount();
    expect((await consent(other.headers, "ひとつだけ")).status).toBe(409);
  });

  it("refuses a name breaking the rules or another consent version", async () => {
    const { headers } = await newAccount();
    expect((await consent(headers, "a")).status).toBe(400);
    const wrongVersion = post(
      { displayName: "ながいヘビ", consentVersion: 2 },
      headers,
    );
    expect((await call(env, "/api/profile", wrongVersion)).status).toBe(400);
  });

  it("has no profile before consent", async () => {
    const { headers } = await newAccount();
    const response = await call(env, "/api/profile", { headers });
    expect(await response.json()).toEqual({ profile: null });
  });
});

describe("withdrawal", () => {
  it("deletes only that ID's records and refuses its cookie after", async () => {
    const leaving = await newAccount();
    const staying = await newAccount();
    await consent(leaving.headers, "さようなら");
    await sendPlay(leaving.headers, upload());
    await sendPlay(staying.headers, upload());

    await deleteAccount(platform.env.DB, leaving.id);
    expect(
      (await call(env, "/api/plays", { headers: leaving.headers })).status,
    ).toBe(410);
    const kept = (await (
      await call(env, "/api/plays", { headers: staying.headers })
    ).json()) as {
      plays: unknown[];
    };
    expect(kept.plays).toHaveLength(1);
    for (const table of [
      "completed_plays",
      "profiles",
      "first_ranked_plays",
      "rate_limits",
    ]) {
      const row = await platform.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`,
      )
        .bind(leaving.id)
        .first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
  });

  it("sweeps a record written while the ID was being deleted", async () => {
    const { id } = await newAccount();
    await deleteAccount(platform.env.DB, id);
    await platform.env.DB.prepare(
      "INSERT INTO profiles (account_id, display_name) VALUES (?, ?)",
    )
      .bind(id, `late-${id}`)
      .run();
    await sweepDeletedAccounts(platform.env.DB);
    const row = await platform.env.DB.prepare(
      "SELECT 1 FROM profiles WHERE account_id = ?",
    )
      .bind(id)
      .first();
    expect(row).toBeNull();
  });
});

describe("routing", () => {
  it("serves the screen outside /api/ and 404s unknown API paths", async () => {
    expect(await (await call(env, "/")).text()).toBe("screen");
    expect((await call(env, "/api/unknown")).status).toBe(404);
  });

  it("answers no-store", async () => {
    const response = await call(env, "/api/leaderboards/p1:bad");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("passes /api/id/* to the ID platform unchanged", async () => {
    let seen: Request | undefined;
    const proxied = workerEnv(platform, {
      ID: {
        fetch: async (request: Request) => {
          seen = request;
          return new Response("id");
        },
      },
    });
    const response = await call(proxied, "/api/id/session", post({}));
    expect(await response.text()).toBe("id");
    expect(seen?.headers.get("Origin")).toBe(ORIGIN);
  });
});
