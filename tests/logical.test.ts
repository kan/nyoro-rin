import { describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import {
  findTrialMove,
  propagate,
  propagateCrosses,
  solveLogically,
} from "../src/core/logical";
import { CROSS, LINE } from "../src/core/model";
import { isSolved, lineEdges } from "../src/core/rules";
import { cell, cluesAt, edge, edges, geometry, states } from "./helpers";

const easy = generatePuzzle("logical-easy", "easy").puzzle;
const normal = generatePuzzle("logical-normal", "normal").puzzle;

describe("propagation", () => {
  it("solves an easy board with the basic techniques alone", () => {
    const result = propagate(geometry, easy.clues, states());
    expect(result.contradiction).toBeUndefined();
    expect(isSolved(geometry, easy.clues, result.states)).toBe(true);
    expect(lineEdges(result.states)).toEqual(easy.solution);
  });

  it("leaves its input as it was", () => {
    const input = states();
    propagate(geometry, easy.clues, input);
    expect(input.every((state) => state === 0)).toBe(true);
  });

  it("reports a rule conflict with its place", () => {
    const clues = cluesAt([[3, 3, 1]]);
    const result = propagate(geometry, clues, states(edges("h 3 3", "h 4 3")));
    expect(result.contradiction).toEqual({
      reason: "clue-excess",
      places: { cells: [cell(3, 3)], vertices: [], edges: [] },
    });
  });
});

describe("automatic × (DESIGN.md 8.1)", () => {
  it("never draws a line", () => {
    for (const puzzle of [easy, normal]) {
      const solution = new Set(puzzle.solution);
      // 正解の線を半分だけ引いた盤面から、× だけを導く。
      const half = puzzle.solution.filter((_, i) => i % 2 === 0);
      const result = propagateCrosses(geometry, puzzle.clues, states(half));
      expect(lineEdges(result.states)).toEqual(half);
      // 導いた × はどれも正解の輪の外にある。
      for (let e = 0; e < geometry.edgeCount; e += 1) {
        if (result.states[e] === CROSS) expect(solution.has(e)).toBe(false);
      }
    }
  });

  it("crosses around a 0 and stops where a line would be needed", () => {
    const clues = cluesAt([
      [3, 3, 0],
      [0, 0, 3],
    ]);
    const result = propagateCrosses(geometry, clues, states());
    expect(result.states[edge("h 3 3")]).toBe(CROSS);
    expect(result.states[edge("h 0 0")]).toBe(0);
  });
});

describe("TRIAL", () => {
  it("finds an edge whose assumption contradicts, and says where", () => {
    const stuck = propagate(geometry, normal.clues, states());
    expect(isSolved(geometry, normal.clues, stuck.states)).toBe(false);
    const move = findTrialMove(geometry, normal.clues, stuck.states)!;
    expect(move.technique).toBe("TRIAL");
    const { trial } = move;
    expect(trial).toBeDefined();
    const contradiction = trial!.contradiction.places;
    expect(
      contradiction.cells.length +
        contradiction.vertices.length +
        contradiction.edges.length,
    ).toBeGreaterThan(0);
    // 決まった辺は正解と一致する。
    const onLoop = normal.solution.includes(trial!.edge);
    expect(trial!.assumed).toBe(onLoop ? CROSS : LINE);
  });
});

describe("logical solve", () => {
  it("solves an easy board without trials", () => {
    const result = solveLogically(geometry, easy.clues);
    expect(result).toMatchObject({ solved: true, trials: 0 });
    expect(result.usage.TRIAL).toBeUndefined();
  });

  it("needs trials for a normal board", () => {
    expect(solveLogically(geometry, normal.clues).solved).toBe(false);
    const result = solveLogically(geometry, normal.clues, { maxTrials: 10 });
    expect(result.solved).toBe(true);
    expect(result.trials).toBeGreaterThan(0);
    expect(lineEdges(result.states)).toEqual(normal.solution);
  });

  it("does not solve a board with several solutions", () => {
    expect(solveLogically(geometry, cluesAt([]), { maxTrials: 5 }).solved).toBe(
      false,
    );
  });
});
