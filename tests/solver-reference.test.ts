import { describe, expect, it } from "vitest";
import { boardGeometry } from "../src/core/board";
import { generateN1 } from "../src/core/generator-n1";
import { type Clue } from "../src/core/model";
import { createWideSeededRandom, randomInt } from "../src/core/random";
import { cluesOfLoop, loopAroundCells } from "../src/core/rules";
import { type SolveOptions, solveCompletely } from "../src/core/solver";
import { referenceSolveCompletely } from "./reference-solver";

/**
 * The complete solver against the plain search it replaced: the same
 * status, and for a solvable board the same first solution, on boards of
 * every kind (unique, several solutions, none, with the player's lines and
 * ×, some of them wrong).
 */
function randomCase(size: number, seed: string) {
  const geometry = boardGeometry(size);
  const random = createWideSeededRandom(seed);
  // Clues of a random set of cells: often one loop, sometimes several or
  // none, which the clues alone do not tell.
  const inside = Array.from({ length: geometry.cellCount }, () =>
    randomInt(random, 3) === 0 ? 1 : 0,
  );
  const loop = loopAroundCells(geometry, inside);
  const full = cluesOfLoop(geometry, loop);
  const keep = 30 + randomInt(random, 70);
  const clues: Clue[] = full.map((clue) =>
    randomInt(random, 100) < keep ? clue : null,
  );
  const options: { lines: number[]; crosses: number[] } = {
    lines: [],
    crosses: [],
  };
  const onLoop = new Set(loop);
  const marks = randomInt(random, 4);
  for (let i = 0; i < marks; i += 1) {
    const edge = randomInt(random, geometry.edgeCount);
    // Mostly true to the clues' loop, sometimes not.
    const truthful = randomInt(random, 4) !== 0;
    if (onLoop.has(edge) === truthful) options.lines.push(edge);
    else options.crosses.push(edge);
  }
  return { geometry, clues, options };
}

function expectSame(
  size: number,
  clues: readonly Clue[],
  options: SolveOptions = {},
) {
  const geometry = boardGeometry(size);
  const unlimited = { ...options, nodeLimit: Infinity };
  expect(solveCompletely(geometry, clues, unlimited)).toEqual(
    referenceSolveCompletely(geometry, clues, unlimited),
  );
}

describe("complete solver against the plain search", () => {
  it("agrees on random small boards", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i += 1) {
      const size = 3 + (i % 3);
      const { clues, options } = randomCase(size, `small-${i}`);
      const status = solveCompletely(
        boardGeometry(size),
        clues,
        options,
      ).status;
      seen.add(status);
      expectSame(size, clues, options);
    }
    // The cases cover every answer.
    expect([...seen].sort()).toEqual(["multiple", "none", "unique"]);
  });

  it("agrees on 7 × 7 boards with one loop and some of its clues", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      const geometry = boardGeometry(7);
      const random = createWideSeededRandom(`seven-${i}`);
      // A real loop: the answer of a generated board.
      const { solution } = generateN1(`seven-${i % 30}`, "easy", 7).puzzle;
      const full = cluesOfLoop(geometry, solution);
      const keep = 15 + randomInt(random, 80);
      const clues = full.map((clue) =>
        randomInt(random, 100) < keep ? clue : null,
      );
      const onLoop = new Set(solution);
      const options = { lines: [] as number[], crosses: [] as number[] };
      for (let m = randomInt(random, 4); m > 0; m -= 1) {
        const edge = randomInt(random, geometry.edgeCount);
        const truthful = randomInt(random, 4) !== 0;
        if (onLoop.has(edge) === truthful) options.lines.push(edge);
        else options.crosses.push(edge);
      }
      seen.add(solveCompletely(geometry, clues, options).status);
      expectSame(7, clues, options);
    }
    expect([...seen].sort()).toEqual(["multiple", "none", "unique"]);
  });

  it("agrees on 10 × 10 puzzles, whole and with clues taken away", () => {
    for (const seed of ["reference-0", "reference-1"]) {
      const { clues, solution } = generateN1(seed, "easy", 10).puzzle;
      expectSame(10, clues);
      expectSame(10, clues, { lines: solution.slice(0, 3) });
      // Fewer clues: several solutions or still one.
      const random = createWideSeededRandom(seed);
      const fewer = clues.map((clue) =>
        randomInt(random, 4) === 0 ? null : clue,
      );
      expectSame(10, fewer);
    }
  });
});
