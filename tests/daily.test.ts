import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newAttempt } from "../src/core/attempt";
import { boardGeometry } from "../src/core/board";
import {
  CURRENT_GAME_KEY,
  type CurrentGame,
  loadCurrentGame,
  saveCurrentGame,
} from "../src/core/current-game";
import {
  DAILY_GAMES_KEY,
  DAILY_VERSION,
  dailyDate,
  dailyDateOfSeedCode,
  dailyPuzzle,
  dailySeedCode,
  isDailyDate,
  isRecordedSeedCode,
  loadDailyGame,
  nextDailyDate,
  parseDailyCompletionUpload,
  parseDailyStatus,
  saveDailyGame,
} from "../src/core/daily";
import { dailySeed, generateDailyPuzzle } from "../src/core/daily-generator";
import { GENERATOR_VERSIONS, generatePuzzle } from "../src/core/generator";
import { LINE, type Puzzle } from "../src/core/model";
import { applyEdits, emptyPlayBoard } from "../src/core/play";
import { WAITING_TIMER } from "../src/core/play-timer";
import {
  canonicalPuzzleDefinition,
  puzzleId,
} from "../src/core/puzzle-identity";
import {
  cluesOfLoop,
  isSolved,
  loopAroundCells,
  statesFromLines,
} from "../src/core/rules";
import { parseSeedCode } from "../src/core/seed-code";
import { solveCompletely } from "../src/core/solver";
import { parseFeedbackContext } from "../src/core/feedback";
import { Outbox } from "../src/core/outbox";
import { parsePlayLogUpload } from "../src/core/play-log";
import { memoryStorage } from "./helpers";

/** The key the freeze test makes its seeds with; never a deployed one. */
const TEST_SECRET = "nyoro-test-daily-secret";

function boardHash(puzzle: Puzzle): string {
  return createHash("sha256")
    .update(JSON.stringify(puzzle))
    .digest("hex")
    .slice(0, 16);
}

describe("daily dates", () => {
  it("turns at midnight in Japan", () => {
    // 2026-11-16 23:59:59.999 JST and 2026-11-17 00:00 JST.
    expect(dailyDate(Date.UTC(2026, 10, 16, 14, 59, 59, 999))).toBe(
      "2026-11-16",
    );
    expect(dailyDate(Date.UTC(2026, 10, 16, 15, 0, 0))).toBe("2026-11-17");
    // Across a year in Japan while it is still the old year in UTC.
    expect(dailyDate(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe("2027-01-01");
  });

  it("knows the next date, months and leap days included", () => {
    expect(nextDailyDate("2026-11-30")).toBe("2026-12-01");
    expect(nextDailyDate("2026-12-31")).toBe("2027-01-01");
    expect(nextDailyDate("2028-02-28")).toBe("2028-02-29");
  });

  it("accepts real dates only", () => {
    expect(isDailyDate("2026-11-16")).toBe(true);
    expect(isDailyDate("2026-02-29")).toBe(false);
    expect(isDailyDate("2026-1-16")).toBe(false);
    expect(isDailyDate("2026-11-16T00:00")).toBe(false);
    expect(isDailyDate(20261116)).toBe(false);
  });
});

describe("the daily board's name", () => {
  it("names the board by its date and is not a seed code", () => {
    const code = dailySeedCode("2026-11-16");
    expect(code).toBe("NYORO:d1:hard:2026-11-16");
    expect(dailyDateOfSeedCode(code)).toBe("2026-11-16");
    // The seed input refuses it: a daily board is never made from a code.
    expect(parseSeedCode(code)).toBeUndefined();
    expect(dailyDateOfSeedCode("NYORO:d1:hard:2026-02-30")).toBeUndefined();
    expect(dailyDateOfSeedCode("NYORO:n1:hard:2026-11-16")).toBeUndefined();
  });

  it("is accepted where records name their board", () => {
    expect(isRecordedSeedCode(dailySeedCode("2026-11-16"), "d1", "hard")).toBe(
      true,
    );
    expect(isRecordedSeedCode(dailySeedCode("2026-11-16"), "d1", "easy")).toBe(
      false,
    );
    expect(isRecordedSeedCode("NYORO:n1:easy:abc", "n1", "easy")).toBe(true);
    expect(isRecordedSeedCode("NYORO:n1:easy:abc", "d1", "hard")).toBe(false);
  });

  it("stays out of the ordinary versions", () => {
    expect(GENERATOR_VERSIONS).not.toContain(DAILY_VERSION);
  });
});

describe("daily seeds", () => {
  it("is HMAC-SHA256 of the date under the secret", async () => {
    const expected = createHmac("sha256", TEST_SECRET)
      .update("nyoro-daily:2026-11-16")
      .digest("hex");
    expect(await dailySeed(TEST_SECRET, "2026-11-16")).toBe(expected);
    expect(await dailySeed("another", "2026-11-16")).not.toBe(expected);
    await expect(dailySeed("", "2026-11-16")).rejects.toThrow();
  });
});

describe("generator d1", () => {
  const dates = ["2026-11-16", "2026-11-17"];
  const boards = Promise.all(
    dates.map(async (date) =>
      generateDailyPuzzle(await dailySeed(TEST_SECRET, date), date),
    ),
  );

  it("makes a hard 10 × 10 board with one solution", async () => {
    for (const [i, puzzle] of (await boards).entries()) {
      expect(puzzle.generatorVersion).toBe("d1");
      expect(puzzle.difficulty).toBe("hard");
      expect(puzzle.size).toBe(10);
      expect(puzzle.seed).toBe(dates[i]);
      const result = solveCompletely(boardGeometry(10), puzzle.clues);
      expect(result.status).toBe("unique");
      expect(result.solution).toEqual(puzzle.solution);
    }
  });

  it("is not an n1 board: its puzzle ID names d1", async () => {
    const [puzzle] = await boards;
    expect(canonicalPuzzleDefinition(puzzle)).toContain('"d1"');
    const seed = await dailySeed(TEST_SECRET, dates[0]);
    const n1 = generatePuzzle(seed, "hard", { size: 10 }).puzzle;
    expect(n1.clues).toEqual(puzzle.clues);
    expect(await puzzleId(n1)).not.toBe(await puzzleId(puzzle));
  });

  // d1 の盤面は凍結する。この値が変わったら、d1 を直さずに版を上げる（DESIGN.md 13.4）。
  it("keeps the frozen boards", async () => {
    expect(
      Object.fromEntries(
        (await boards).map((puzzle) => [puzzle.seed, boardHash(puzzle)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "2026-11-16": "b63d438169dd31b5",
        "2026-11-17": "76051606cbdbb497",
      }
    `);
  });
});

describe("the API's answers", () => {
  const board = {
    date: "2026-11-16",
    puzzleId: `p1:${"a".repeat(64)}`,
    generatorVersion: "d1",
    size: 10,
    clues: Array(100).fill(null),
  };

  it("reads today's board and state", () => {
    expect(parseDailyStatus({ board, attempt: "not_started" })).toEqual({
      board,
      attempt: "not_started",
    });
    const playId = "00000000-0000-4000-8000-000000000001";
    expect(parseDailyStatus({ board, attempt: "active", playId })).toEqual({
      board,
      attempt: "active",
      playId,
    });
    expect(parseDailyStatus({ board, attempt: "active" })).toBeUndefined();
    expect(
      parseDailyStatus({ board: { ...board, size: 7 }, attempt: "active" }),
    ).toBeUndefined();
    expect(
      parseDailyStatus({
        board: { ...board, generatorVersion: "n1" },
        attempt: "not_started",
      }),
    ).toBeUndefined();
  });

  it("checks a completion's shape", () => {
    const upload = {
      ...newAttempt("00000000-0000-4000-8000-000000000001", 1_000, 2),
      date: "2026-11-16",
      puzzleId: board.puzzleId,
      elapsedSeconds: 600,
      loop: [1, 2, 5],
    };
    expect(parseDailyCompletionUpload(upload)).toEqual(upload);
    expect(parseDailyCompletionUpload({ ...upload, loop: [2, 1] })).toBe(
      undefined,
    );
    expect(
      parseDailyCompletionUpload({ ...upload, date: "2026-13-01" }),
    ).toBeUndefined();
    expect(
      parseDailyCompletionUpload({ ...upload, hintsUsed: 1 }),
    ).toBeUndefined();
  });
});

describe("the daily board in play on the device", () => {
  const ACCOUNT = "11111111-1111-4111-8111-111111111111";
  const geometry = boardGeometry(10);

  /** A small daily-shaped board: a 1 × 1 loop in the corner, all clues. */
  function puzzleOf(date: string): Puzzle {
    // Around the first two cells, so no clue is 4.
    const inside = new Uint8Array(geometry.cellCount);
    inside[0] = inside[1] = 1;
    const loop = loopAroundCells(geometry, inside);
    const states = statesFromLines(geometry, loop);
    const clues = cluesOfLoop(geometry, loop);
    const puzzle = dailyPuzzle(
      {
        date,
        puzzleId: `p1:${"b".repeat(64)}`,
        generatorVersion: "d1",
        size: 10,
        clues,
      },
      loop,
    );
    expect(isSolved(geometry, clues, states)).toBe(true);
    return puzzle;
  }

  function gameOf(date: string, marked = true): CurrentGame {
    const empty = emptyPlayBoard(geometry.edgeCount);
    return {
      puzzle: puzzleOf(date),
      attempt: newAttempt("00000000-0000-4000-8000-000000000002", 5_000, 1),
      board: marked
        ? applyEdits(empty, [{ edge: geometry.cellEdges[0][0], after: LINE }])
        : empty,
      timer: WAITING_TIMER,
    };
  }

  it("keeps each ID's day apart from the ordinary board", () => {
    const { storage } = memoryStorage();
    const ordinary = gameOf("2026-11-16");
    expect(
      saveDailyGame(storage, ACCOUNT, "2026-11-16", gameOf("2026-11-16"), 0),
    ).toBe(true);
    // Nothing goes to the ordinary board's place.
    expect(storage.getItem(CURRENT_GAME_KEY)).toBeNull();
    const loaded = loadDailyGame(storage, ACCOUNT, "2026-11-16");
    expect(loaded?.puzzle.seed).toBe("2026-11-16");
    expect(loaded?.board.states[geometry.cellEdges[0][0]]).toBe(LINE);
    // Another ID or another day has none.
    expect(
      loadDailyGame(
        storage,
        "22222222-2222-4222-8222-222222222222",
        "2026-11-16",
      ),
    ).toBeUndefined();
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-17")).toBeUndefined();
    // The ordinary save refuses a daily board, and the daily one an ordinary.
    saveCurrentGame(storage, ordinary, 0);
    expect(loadCurrentGame(storage)).toBeUndefined();
  });

  it("keeps the newest days only", () => {
    const { storage } = memoryStorage();
    for (let day = 1; day <= 9; day += 1) {
      const date = `2026-11-0${day}`;
      saveDailyGame(storage, ACCOUNT, date, gameOf(date), 0);
    }
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-09")).toBeDefined();
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-03")).toBeDefined();
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-02")).toBeUndefined();
  });

  it("starts empty from broken data", () => {
    const { storage } = memoryStorage();
    storage.setItem(DAILY_GAMES_KEY, "{not json");
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-16")).toBeUndefined();
    expect(storage.getItem(`${DAILY_GAMES_KEY}.corrupt`)).toBe("{not json");
    expect(
      saveDailyGame(storage, ACCOUNT, "2026-11-16", gameOf("2026-11-16"), 0),
    ).toBe(true);
    expect(loadDailyGame(storage, ACCOUNT, "2026-11-16")).toBeDefined();
  });
});

describe("records of the daily board", () => {
  const playId = "00000000-0000-4000-8000-000000000003";
  const code = dailySeedCode("2026-11-16");

  it("are accepted in play logs and feedback by the board's name", () => {
    const log = {
      ...newAttempt(playId, 1_000, 2),
      seedCode: code,
      generatorVersion: "d1",
      difficulty: "hard",
      outcome: "abandoned",
      endedAt: 2_000,
      elapsedMs: 1_000,
      appVersion: "test",
      truncated: false,
      events: [],
    };
    expect(parsePlayLogUpload(log)?.seedCode).toBe(code);
    expect(parsePlayLogUpload({ ...log, difficulty: "easy" })).toBeUndefined();
    expect(
      parseFeedbackContext({
        from: "clear",
        playId,
        seedCode: code,
        difficulty: "hard",
        cleared: true,
        elapsedSeconds: 60,
        hintsUsed: 0,
        maxAssist: 0,
        appVersion: "test",
      })?.seedCode,
    ).toBe(code);
  });

  it("are sent again from the queue until answered, the next day too", async () => {
    const { storage } = memoryStorage();
    const ACCOUNT = "11111111-1111-4111-8111-111111111111";
    const options = {
      key: "nyoro-rin.daily-outbox.v1",
      parse: parseDailyCompletionUpload,
      idOf: (upload: { playId: string }) => upload.playId,
      limit: 20,
    };
    const upload = parseDailyCompletionUpload({
      ...newAttempt(playId, 1_000, 2),
      date: "2026-11-16",
      puzzleId: `p1:${"c".repeat(64)}`,
      elapsedSeconds: 60,
      loop: [1, 2, 3],
    })!;
    new Outbox(storage, options).add(ACCOUNT, upload);
    // Offline: kept. A reload reads the queue back from storage.
    await new Outbox(storage, options).drain(
      ACCOUNT,
      () => true,
      async () => "retry",
    );
    const sent: unknown[] = [];
    const later = new Outbox(storage, options);
    expect(later.count(ACCOUNT)).toBe(1);
    await later.drain(
      ACCOUNT,
      () => true,
      async (item) => {
        sent.push(item);
        return "sent";
      },
    );
    expect(sent).toEqual([upload]);
    expect(new Outbox(storage, options).count(ACCOUNT)).toBe(0);
  });
});
