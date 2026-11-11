import { describe, expect, it } from "vitest";
import { CROSS, LINE, UNKNOWN } from "../src/core/model";
import {
  HISTORY_LIMIT,
  applyEdits,
  beginStroke,
  continueStroke,
  emptyPlayBoard,
  hasMarks,
  redoMove,
  resetMarks,
  strokeMode,
  strokedState,
  tappedState,
  undoMove,
} from "../src/core/play";
import { geometry } from "./helpers";

const empty = () => emptyPlayBoard(geometry.edgeCount);

describe("tap (DESIGN.md 7.2)", () => {
  it("cycles unknown → line → × → unknown with the line tool", () => {
    expect(tappedState(UNKNOWN, "line")).toBe(LINE);
    expect(tappedState(LINE, "line")).toBe(CROSS);
    expect(tappedState(CROSS, "line")).toBe(UNKNOWN);
  });

  it("toggles × with the × tool, over a line too", () => {
    expect(tappedState(UNKNOWN, "cross")).toBe(CROSS);
    expect(tappedState(LINE, "cross")).toBe(CROSS);
    expect(tappedState(CROSS, "cross")).toBe(UNKNOWN);
  });
});

describe("stroke (DESIGN.md 7.3)", () => {
  it("erases when the first edge already has the tool's mark", () => {
    expect(strokeMode(LINE, "line")).toBe("erase");
    expect(strokeMode(CROSS, "line")).toBe("add");
    expect(strokeMode(CROSS, "cross")).toBe("erase");
    expect(strokeMode(UNKNOWN, "cross")).toBe("add");
  });

  it("draws lines over ×, but × strokes leave lines alone", () => {
    expect(strokedState(CROSS, "line", "add")).toBe(LINE);
    expect(strokedState(LINE, "cross", "add")).toBeUndefined();
    expect(strokedState(UNKNOWN, "cross", "add")).toBe(CROSS);
  });

  it("erases only marks of its own kind", () => {
    expect(strokedState(LINE, "line", "erase")).toBe(UNKNOWN);
    expect(strokedState(CROSS, "line", "erase")).toBeUndefined();
    expect(strokedState(CROSS, "cross", "erase")).toBe(UNKNOWN);
    expect(strokedState(LINE, "cross", "erase")).toBeUndefined();
  });

  it("is one move however many edges it passes", () => {
    let stroke = beginStroke(empty(), "line");
    let board = empty();
    for (const edges of [[1], [2, 3], [4]]) {
      ({ stroke, board } = continueStroke(stroke, edges));
    }
    expect([1, 2, 3, 4].map((e) => board.states[e])).toEqual([
      LINE,
      LINE,
      LINE,
      LINE,
    ]);
    expect(board.undo).toHaveLength(1);
    expect(undoMove(board).states.every((s) => s === UNKNOWN)).toBe(true);
  });

  it("keeps the mode its first edge chose", () => {
    const start = applyEdits(empty(), [
      { edge: 1, after: LINE },
      { edge: 3, after: LINE },
    ]);
    const stroke = beginStroke(start, "line");
    // 1 本目が線なので消すなぞりになり、線のない 2 には何もしない。
    const { board } = continueStroke(stroke, [1, 2, 3]);
    expect([1, 2, 3].map((e) => board.states[e])).toEqual([
      UNKNOWN,
      UNKNOWN,
      UNKNOWN,
    ]);
  });

  it("is no move when it changes nothing", () => {
    const start = empty();
    const stroke = beginStroke(start, "line");
    expect(continueStroke(stroke, []).board).toBe(start);
  });
});

describe("moves and history (DESIGN.md 16.4)", () => {
  it("records only the edges that changed, as one move", () => {
    const board = applyEdits(empty(), [
      { edge: 3, after: LINE },
      { edge: 4, after: UNKNOWN },
      { edge: 3, after: CROSS },
    ]);
    expect(board.undo).toEqual([[{ edge: 3, before: UNKNOWN, after: CROSS }]]);
    expect(board.states[3]).toBe(CROSS);
  });

  it("is not a move when nothing changes", () => {
    const board = empty();
    expect(applyEdits(board, [{ edge: 1, after: UNKNOWN }])).toBe(board);
  });

  it("drops an edge that a move set back to where it was", () => {
    const board = applyEdits(empty(), [
      { edge: 3, after: LINE },
      { edge: 3, after: UNKNOWN },
    ]);
    expect(board.undo).toEqual([]);
  });

  it("undoes and redoes, and a new move clears redo", () => {
    const one = applyEdits(empty(), [{ edge: 1, after: LINE }]);
    const two = applyEdits(one, [{ edge: 2, after: CROSS }]);
    const back = undoMove(two);
    expect(back.states[2]).toBe(UNKNOWN);
    expect(redoMove(back).states[2]).toBe(CROSS);
    expect(applyEdits(back, [{ edge: 5, after: LINE }]).redo).toEqual([]);
  });

  it("leaves the board alone with nothing to undo or redo", () => {
    const board = empty();
    expect(undoMove(board)).toBe(board);
    expect(redoMove(board)).toBe(board);
  });

  it("keeps the last 200 moves", () => {
    let board = empty();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      board = applyEdits(board, [
        // Every pass over the first 100 edges flips them, so each is a move.
        { edge: i % 100, after: Math.floor(i / 100) % 2 ? CROSS : LINE },
      ]);
    }
    expect(board.undo).toHaveLength(HISTORY_LIMIT);
  });

  it("resets every mark as one undoable move", () => {
    const marked = applyEdits(empty(), [
      { edge: 1, after: LINE },
      { edge: 2, after: CROSS },
    ]);
    const cleared = resetMarks(marked);
    expect(hasMarks(marked)).toBe(true);
    expect(hasMarks(cleared)).toBe(false);
    expect(undoMove(cleared).states).toEqual(marked.states);
  });

  it("never changes the board it was given", () => {
    const board = empty();
    applyEdits(board, [{ edge: 1, after: LINE }]);
    expect(board.states[1]).toBe(UNKNOWN);
  });
});
