import { describe, expect, it } from "vitest";
import { newAttempt } from "../src/core/attempt";
import {
  CURRENT_GAME_KEY,
  type CurrentGame,
  loadCurrentGame,
  parseGame,
  saveCurrentGame,
  serializeGame,
} from "../src/core/current-game";
import { CROSS, LINE, type Puzzle } from "../src/core/model";
import {
  applyEdits,
  emptyPlayBoard,
  resetMarks,
  undoMove,
} from "../src/core/play";
import { WAITING_TIMER, finishTimer, startTimer } from "../src/core/play-timer";
import { cluesOfLoop } from "../src/core/rules";
import { edge, geometry, memoryStorage, rectangleLoop } from "./helpers";

const LOOP = rectangleLoop(1, 1, 3, 4);

const PUZZLE: Puzzle = {
  generatorVersion: "n1",
  difficulty: "easy",
  seed: "abc",
  size: 7,
  clues: cluesOfLoop(geometry, LOOP),
  solution: LOOP,
};

const ATTEMPT = newAttempt("00000000-0000-4000-8000-00000000000a", 1_000, 2);

function game(changes: Partial<CurrentGame> = {}): CurrentGame {
  return {
    puzzle: PUZZLE,
    attempt: ATTEMPT,
    board: emptyPlayBoard(geometry.edgeCount),
    timer: WAITING_TIMER,
    ...changes,
  };
}

/** A board with two moves made and one taken back. */
function playedBoard() {
  let board = emptyPlayBoard(geometry.edgeCount);
  board = applyEdits(board, [{ edge: edge("h 1 1"), after: LINE }]);
  board = applyEdits(board, [
    { edge: edge("h 0 0"), after: CROSS },
    { edge: edge("v 0 0"), after: CROSS },
  ]);
  board = applyEdits(board, [{ edge: edge("h 1 2"), after: LINE }]);
  return undoMove(board);
}

/** Saves, then edits the saved JSON. */
function savedWith(edit: (saved: Record<string, unknown>) => void): unknown {
  const saved = JSON.parse(
    JSON.stringify(serializeGame(game({ board: playedBoard() }), 0)),
  );
  edit(saved);
  return saved;
}

/** Saves at `now` and reads back. */
function roundTrip(played: CurrentGame, now = 0): CurrentGame | undefined {
  return parseGame(JSON.parse(JSON.stringify(serializeGame(played, now))));
}

describe("the saved game (DATA_CONTRACT.md 「ローカル保存と版」)", () => {
  it("reads back the puzzle, marks, history, clock and attempt", () => {
    const { storage } = memoryStorage();
    const played = game({
      board: playedBoard(),
      timer: { status: "ready", elapsedMs: 42_000 },
      attempt: { ...ATTEMPT, hintsUsed: 3, maxHintStage: 2, reveals: 1 },
    });
    expect(saveCurrentGame(storage, played, 0)).toBe(true);
    const loaded = loadCurrentGame(storage)!;
    expect(loaded.puzzle).toEqual(PUZZLE);
    expect(loaded.attempt).toEqual(played.attempt);
    expect(loaded.timer).toEqual(played.timer);
    expect(loaded.board.undo).toEqual(played.board.undo);
    expect(loaded.board.redo).toEqual(played.board.redo);
    expect([...loaded.board.states]).toEqual([...played.board.states]);
  });

  it("saves the seed code and the marks as edge lists", () => {
    const saved = serializeGame(game({ board: playedBoard() }), 0);
    expect(saved.puzzle.seedCode).toBe("NYORO:n1:easy:abc");
    expect(saved.lines).toEqual([edge("h 1 1")]);
    expect(saved.crosses).toEqual(
      [edge("h 0 0"), edge("v 0 0")].sort((a, b) => a - b),
    );
    expect(saved.redo).toEqual([[[edge("h 1 2"), 0, LINE]]]);
  });

  it("keeps a reset undoable after a reload (DESIGN.md 16.4)", () => {
    const board = resetMarks(playedBoard());
    const loaded = roundTrip(game({ board }))!;
    expect(loaded.board.states.every((state) => state === 0)).toBe(true);
    expect([...undoMove(loaded.board).states]).toEqual([
      ...playedBoard().states,
    ]);
  });

  it("restores a cleared board as finished", () => {
    const board = applyEdits(
      emptyPlayBoard(geometry.edgeCount),
      LOOP.map((e) => ({ edge: e, after: LINE })),
    );
    const timer = finishTimer(startTimer(WAITING_TIMER, 0), 61_000);
    expect(roundTrip(game({ board, timer }))?.timer).toEqual({
      status: "finished",
      elapsedMs: 61_000,
    });
  });

  it("saves a running clock as paused, so a reload waits on READY", () => {
    const running = startTimer({ status: "ready", elapsedMs: 1_000 }, 0);
    expect(roundTrip(game({ timer: running }), 3_000)?.timer).toEqual({
      status: "ready",
      elapsedMs: 4_000,
    });
  });

  it.each<[string, (saved: Record<string, unknown>) => void]>([
    ["another version", (s) => (s.version = 2)],
    [
      "a seed code of another difficulty",
      (s) => ((s.puzzle as Record<string, unknown>).difficulty = "hard"),
    ],
    [
      "a clue out of range",
      (s) => ((s.puzzle as { clues: unknown[] }).clues[0] = 4),
    ],
    [
      "an answer that does not fit the clues",
      (s) =>
        ((s.puzzle as { solution: number[] }).solution = rectangleLoop(
          0,
          0,
          1,
          1,
        )),
    ],
    ["an edge out of range", (s) => (s.lines = [geometry.edgeCount])],
    [
      "an edge both line and ×",
      (s) =>
        (s.crosses = [
          ...(s.crosses as number[]),
          ...(s.lines as number[]),
        ].sort((a, b) => a - b)),
    ],
    ["an undo history that does not lead to the marks", (s) => (s.lines = [])],
    [
      "a redo move that does not fit",
      (s) => (s.redo = [[[edge("h 1 1"), 0, LINE]]]),
    ],
    [
      "a move that changes nothing",
      (s) => (s.undo = [[[edge("h 1 1"), LINE, LINE]]]),
    ],
    ["a running clock", (s) => (s.timer = { status: "running", elapsedMs: 0 })],
    [
      "a finished clock on an open board",
      (s) => (s.timer = { status: "finished", elapsedMs: 0 }),
    ],
    ["a play ID that is not a UUID", (s) => (s.playId = "x")],
    ["more reveals than hints", (s) => (s.reveals = 1)],
  ])("starts afresh from %s, keeping the old value aside", (_, edit) => {
    const raw = JSON.stringify(savedWith(edit));
    const { storage, map } = memoryStorage({ [CURRENT_GAME_KEY]: raw });
    expect(loadCurrentGame(storage)).toBeUndefined();
    expect(map.get(`${CURRENT_GAME_KEY}.corrupt`)).toBe(raw);
  });
});
