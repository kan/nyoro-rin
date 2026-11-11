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
