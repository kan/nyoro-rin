import { describe, expect, it } from "vitest";
import { annotateBoard } from "../src/core/annotations";
import { vertexIndex } from "../src/core/board";
import { cellsInsideLoop, cluesOfLoop } from "../src/core/rules";
import {
  cell,
  cluesAt,
  edge,
  edges,
  geometry,
  rectangleLoop,
  states,
} from "./helpers";

const on = { showConflicts: true, assist: 1 } as const;

describe("board annotations", () => {
  it("marks the places of each conflict", () => {
    const clues = cluesAt([[3, 3, 1]]);
    const board = states([
      ...edges("h 3 3", "h 4 3"),
      ...edges("h 0 0", "h 0 1", "v 0 1"),
    ]);
    const result = annotateBoard(geometry, clues, board, on);
    expect([...result.conflictCells]).toEqual([cell(3, 3)]);
    expect([...result.conflictVertices]).toContain(vertexIndex(7, 0, 1));
  });

  it("shows no conflicts when they are turned off", () => {
    const clues = cluesAt([[3, 3, 1]]);
    const board = states(edges("h 3 3", "h 4 3"));
    const result = annotateBoard(geometry, clues, board, {
      ...on,
      showConflicts: false,
    });
    expect(result.conflictCells.size).toBe(0);
  });

  it("fades a met clue, and a 0 once its sides are crossed", () => {
    const clues = cluesAt([
      [3, 3, 1],
      [5, 5, 0],
    ]);
    const board = states(edges("h 3 3"));
    expect(
      [...annotateBoard(geometry, clues, board, on).satisfiedCells].sort(),
    ).toEqual([cell(3, 3), cell(5, 5)].sort());
    const noAssist = annotateBoard(geometry, clues, board, {
      ...on,
      assist: 0,
    });
    expect([...noAssist.satisfiedCells]).toEqual([cell(3, 3)]);
  });

  it("derives × only with the assist on, and only on unknown edges", () => {
    const clues = cluesAt([[3, 3, 0]]);
    const board = states([], [edge("h 3 3")]);
    const auto = annotateBoard(geometry, clues, board, on).autoCrosses;
    expect([...auto].sort()).toEqual(edges("h 4 3", "v 3 3", "v 3 4").sort());
    expect(
      annotateBoard(geometry, clues, board, { ...on, assist: 0 }).autoCrosses
        .size,
    ).toBe(0);
  });

  it("keeps deriving × away from a mistake", () => {
    // 左上の 0 の隣に線を引いても、右下の 0 の × は残る。矛盾した 0 自体は
    // 赤く示すだけで、その周りには × を足さない。
    const clues = cluesAt([
      [0, 0, 0],
      [6, 6, 0],
    ]);
    const board = states([edge("h 0 0")]);
    const auto = annotateBoard(geometry, clues, board, on).autoCrosses;
    expect(auto.has(edge("h 6 6"))).toBe(true);
    expect(auto.has(edge("v 6 7"))).toBe(true);
    expect(auto.has(edge("v 0 1"))).toBe(false);
  });
});

describe("automatic × with conflicts hidden", () => {
  it("stops at a contradiction, so a wrong line spreads nothing unnoticed", () => {
    const clues = cluesAt([
      [0, 0, 0],
      [6, 6, 0],
    ]);
    const board = states([edge("h 0 0")]);
    const auto = annotateBoard(geometry, clues, board, {
      showConflicts: false,
      assist: 1,
    }).autoCrosses;
    expect(auto.size).toBe(0);
  });
});

describe("guide (DESIGN.md 8.2)", () => {
  const guide = { showConflicts: true, assist: 2 } as const;

  it("lights the threes' patterns only with ×＋ガイド", () => {
    const clues = cluesAt([
      [0, 0, 3],
      [3, 2, 3],
      [3, 3, 3],
      [5, 1, 3],
      [6, 2, 3],
    ]);
    const lit = annotateBoard(geometry, clues, states(), guide);
    expect([...lit.guideCells].sort((a, b) => a - b)).toEqual(
      [cell(0, 0), cell(3, 2), cell(3, 3), cell(5, 1), cell(6, 2)].sort(
        (a, b) => a - b,
      ),
    );
    const crossesOnly = annotateBoard(geometry, clues, states(), on);
    expect(crossesOnly.guideCells.size).toBe(0);
    expect(crossesOnly.guideVertices.size).toBe(0);
  });

  it("stops lighting a pattern once its lines are drawn", () => {
    const clues = cluesAt([[0, 0, 3]]);
    const drawn = states(edges("h 0 0", "v 0 0"));
    expect(annotateBoard(geometry, clues, drawn, guide).guideCells.size).toBe(
      0,
    );
  });

  it("lights a vertex where a line has one way on, the assist's × counted", () => {
    // A line ends at vertex (1, 2). The 0 above it crosses the ways up and
    // right, so only the way down is left, though no × is drawn.
    const clues = cluesAt([[0, 2, 0]]);
    const board = states(edges("h 1 1"));
    const lit = annotateBoard(geometry, clues, board, guide);
    expect([...lit.guideVertices]).toEqual([vertexIndex(7, 1, 2)]);
  });

  it("with conflicts hidden, lights nothing on a board that contradicts", () => {
    // A line on the corner 1's corner edge: CORNER_ONE says ×. The line's
    // end at vertex 0 has one way on, which must not light up and lead the
    // wrong line on.
    const clues = cluesAt([[0, 0, 1]]);
    const board = states(edges("h 0 0"));
    const hidden = annotateBoard(geometry, clues, board, {
      ...guide,
      showConflicts: false,
    });
    expect(hidden.autoCrosses.size).toBe(0);
    expect(hidden.guideVertices.size).toBe(0);
    expect(hidden.guideCells.size).toBe(0);
  });

  it("with conflicts shown, lights the rest of the board past a mistake", () => {
    // A × on the corner 3's corner edge contradicts CORNER_THREE; the two
    // threes elsewhere still light up.
    const clues = cluesAt([
      [0, 0, 3],
      [3, 2, 3],
      [3, 3, 3],
    ]);
    const board = states([], edges("h 0 0"));
    const shown = annotateBoard(geometry, clues, board, guide);
    expect([...shown.guideCells].sort((a, b) => a - b)).toEqual([
      cell(3, 2),
      cell(3, 3),
    ]);
  });

  it("lights a 3 a line arrives at, and the corner it arrives at", () => {
    const clues = cluesAt([[2, 2, 3]]);
    const board = states(edges("v 1 2"));
    const lit = annotateBoard(geometry, clues, board, guide);
    expect([...lit.guideCells]).toEqual([cell(2, 2)]);
    expect(lit.guideVertices.has(vertexIndex(7, 2, 2))).toBe(true);
  });

  it("does not light counting a clue's edges", () => {
    // A 2 with two sides crossed: its other two are lines (CLUE_REMAINING),
    // which the player is left to count.
    const clues = cluesAt([[3, 3, 2]]);
    const board = states([], edges("h 3 3", "v 3 3"));
    const lit = annotateBoard(geometry, clues, board, guide);
    expect(lit.guideCells.size).toBe(0);
  });
});

describe("inside of a loop", () => {
  it("finds the cells the loop encloses", () => {
    const loop = rectangleLoop(1, 2, 3, 4);
    const inside = cellsInsideLoop(geometry, loop);
    expect(inside[cell(2, 3)]).toBe(1);
    expect(inside[cell(1, 2)]).toBe(1);
    expect(inside[cell(0, 0)]).toBe(0);
    expect(inside[cell(2, 5)]).toBe(0);
    expect(inside.reduce((sum, value) => sum + value, 0)).toBe(9);
    // 数字が輪から正しく計算できることとも一致する。
    expect(cluesOfLoop(geometry, loop)[cell(2, 3)]).toBe(0);
  });
});
