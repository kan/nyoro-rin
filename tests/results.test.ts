import { describe, expect, it } from "vitest";
import { type Attempt, newAttempt, withAssist } from "../src/core/attempt";
import {
  RESULTS_KEY,
  USER_ID_KEY,
  type CompletedPlay,
  compareCompletedPlays,
  emptyHistory,
  finishPlay,
  loadResultHistory,
  recentPlays,
  saveResultHistory,
  score,
  startPlay,
  summarize,
} from "../src/core/results";
import { memoryStorage } from "./helpers";

const USER = "00000000-0000-4000-8000-000000000001";
const PLAY_A = "00000000-0000-4000-8000-00000000000a";
const PLAY_B = "00000000-0000-4000-8000-00000000000b";

const PUZZLE = {
  seedCode: "NYORO:n1:easy:abc",
  generatorVersion: "n1",
  difficulty: "easy" as const,
};

function attempt(playId: string, changes: Partial<Attempt> = {}): Attempt {
  return { ...newAttempt(playId, 1_000, 2), ...changes };
}

function completed(elapsedSeconds: number, hintsUsed: number): CompletedPlay {
  return {
    ...PUZZLE,
    ...attempt(PLAY_A, { hintsUsed }),
    status: "completed",
    completedAt: 2_000,
    elapsedSeconds,
  };
}

describe("attempt (DATA_CONTRACT.md 「段階と記録の値」)", () => {
  it("starts with the assist setting and only raises it", () => {
    const start = newAttempt(PLAY_A, 0, 1);
    expect(start.maxAssist).toBe(1);
    expect(withAssist(start, 0)).toBe(start);
    expect(withAssist(withAssist(start, 2), 0).maxAssist).toBe(2);
  });
});

describe("play history (DESIGN.md 16.1)", () => {
  it("adds an attempt once, as in progress", () => {
    const history = startPlay(emptyHistory(USER), PUZZLE, attempt(PLAY_A));
    expect(history.plays).toEqual([
      { ...PUZZLE, playId: PLAY_A, startedAt: 1_000, status: "in-progress" },
    ]);
    expect(startPlay(history, PUZZLE, attempt(PLAY_A))).toBe(history);
  });

  it("records the clear with what the attempt used", () => {
    const used = attempt(PLAY_A, { hintsUsed: 2, maxHintStage: 3 });
    let history = startPlay(emptyHistory(USER), PUZZLE, used);
    history = finishPlay(history, PUZZLE, used, 9_000, 75);
    expect(history.plays).toEqual([
      {
        ...PUZZLE,
        ...used,
        status: "completed",
        completedAt: 9_000,
        elapsedSeconds: 75,
      },
    ]);
  });

  it("does not record the same clear twice", () => {
    const history = finishPlay(
      emptyHistory(USER),
      PUZZLE,
      attempt(PLAY_A),
      9_000,
      75,
    );
    expect(finishPlay(history, PUZZLE, attempt(PLAY_A), 20_000, 99)).toBe(
      history,
    );
  });

  it("adds a clear whose start the history missed", () => {
    const history = finishPlay(
      emptyHistory(USER),
      PUZZLE,
      attempt(PLAY_A),
      9_000,
      75,
    );
    expect(history.plays).toHaveLength(1);
    expect(history.plays[0].status).toBe("completed");
  });
});

describe("score (DESIGN.md 16.2)", () => {
  it("adds speed points, 300,000 over the seconds, and 300 for no hint", () => {
    expect(score({ elapsedSeconds: 300, hintsUsed: 0 })).toBe(1_300);
    expect(score({ elapsedSeconds: 300, hintsUsed: 2 })).toBe(1_000);
    // Rounded down, like integer division in a query.
    expect(score({ elapsedSeconds: 7, hintsUsed: 1 })).toBe(42_857);
  });

  it("counts a clear in 0 seconds as 1 second", () => {
    expect(score({ elapsedSeconds: 0, hintsUsed: 1 })).toBe(300_000);
  });

  it("keeps long plays apart: an hour still earns points", () => {
    expect(score({ elapsedSeconds: 3_600, hintsUsed: 1 })).toBe(83);
    expect(
      compareCompletedPlays(completed(3_600, 1), completed(7_200, 1)),
    ).toBeLessThan(0);
  });

  it("orders by score, then time, then hints", () => {
    // Same score, 600: 1,000 s with no hint against 500 s with a hint.
    const slow = completed(1_000, 0);
    const fast = completed(500, 1);
    expect(score(slow)).toBe(score(fast));
    expect([slow, fast].sort(compareCompletedPlays)).toEqual([fast, slow]);
    // Same score and time: fewer hints first.
    expect(
      compareCompletedPlays(completed(100, 1), completed(100, 3)),
    ).toBeLessThan(0);
  });
});

describe("local records", () => {
  it("counts unfinished plays but averages clears only", () => {
    let history = emptyHistory(USER);
    history = startPlay(history, PUZZLE, attempt(PLAY_A));
    history = finishPlay(
      history,
      PUZZLE,
      attempt(PLAY_B, { hintsUsed: 1 }),
      5_000,
      60,
    );
    const easy = summarize(history, "easy");
    expect(easy).toMatchObject({
      plays: 2,
      clears: 1,
      averageSeconds: 60,
      averageHints: 1,
    });
    expect(easy.best?.playId).toBe(PLAY_B);
    const normal = summarize(history, "normal");
    expect(normal).toMatchObject({ plays: 0, clears: 0 });
    expect(normal.averageSeconds).toBeUndefined();
  });

  it("lists the newest plays first", () => {
    let history = emptyHistory(USER);
    history = startPlay(history, PUZZLE, { playId: PLAY_A, startedAt: 1 });
    history = startPlay(history, PUZZLE, { playId: PLAY_B, startedAt: 2 });
    expect(recentPlays(history, "easy", 1).map((play) => play.playId)).toEqual([
      PLAY_B,
    ]);
  });
});

describe("saving the history (DATA_CONTRACT.md 「ローカル保存と版」)", () => {
  const createId = () => USER;

  it("reads back what it saved", () => {
    const { storage } = memoryStorage();
    let history = loadResultHistory(storage, createId);
    history = startPlay(history, PUZZLE, attempt(PLAY_A));
    history = finishPlay(history, PUZZLE, attempt(PLAY_B), 5_000, 60);
    expect(saveResultHistory(storage, history)).toBe(true);
    expect(loadResultHistory(storage, () => "unused")).toEqual(history);
  });

  it("makes the local user ID once and keeps it", () => {
    const { storage, map } = memoryStorage();
    expect(loadResultHistory(storage, createId).userId).toBe(USER);
    expect(map.get(USER_ID_KEY)).toBe(USER);
    expect(loadResultHistory(storage, () => "other").userId).toBe(USER);
  });

  it("keeps the history's own user ID over a separately saved one", () => {
    const { storage, map } = memoryStorage({
      [USER_ID_KEY]: PLAY_B,
      [RESULTS_KEY]: JSON.stringify(emptyHistory(USER)),
    });
    expect(loadResultHistory(storage, createId).userId).toBe(USER);
    expect(map.get(USER_ID_KEY)).toBe(USER);
  });

  it.each([
    ["not JSON", "{"],
    ["another version", JSON.stringify({ ...emptyHistory(USER), version: 2 })],
    [
      "a play out of range",
      JSON.stringify({
        ...emptyHistory(USER),
        plays: [{ ...completed(-1, 0) }],
      }),
    ],
    [
      "a seed code of another difficulty",
      JSON.stringify({
        ...emptyHistory(USER),
        plays: [{ ...completed(10, 0), difficulty: "hard" }],
      }),
    ],
    [
      "the same play twice",
      JSON.stringify({
        ...emptyHistory(USER),
        plays: [completed(10, 0), completed(10, 0)],
      }),
    ],
  ])("starts afresh from %s, keeping the old value aside", (_, raw) => {
    const { storage, map } = memoryStorage({ [RESULTS_KEY]: raw });
    expect(loadResultHistory(storage, createId).plays).toEqual([]);
    expect(map.get(`${RESULTS_KEY}.corrupt`)).toBe(raw);
  });

  it("plays on without storage", () => {
    expect(loadResultHistory(undefined, createId)).toEqual(emptyHistory(USER));
  });
});
