import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { boardGeometry } from "../src/core/board";
import {
  generatePuzzle,
  isSupportedGeneratorVersion,
} from "../src/core/generator";
import { cluesOfLoop } from "../src/core/rules";
import {
  type Clue,
  DIFFICULTIES,
  type Puzzle,
  hasValidClues,
} from "../src/core/model";
import {
  canonicalPuzzleDefinition,
  puzzleId,
} from "../src/core/puzzle-identity";
import { validatePuzzle } from "../src/core/validation";

const SEEDS = ["alpha", "にょろ", "🐍-2"];

const MIN_CLUES = { easy: 15, normal: 10, hard: 0 } as const;

function boardHash(puzzle: Puzzle): string {
  return createHash("sha256")
    .update(JSON.stringify(puzzle))
    .digest("hex")
    .slice(0, 16);
}

describe("generator n1", () => {
  const boards = DIFFICULTIES.flatMap((difficulty) =>
    SEEDS.map((seed) => ({
      difficulty,
      seed,
      ...generatePuzzle(seed, difficulty),
    })),
  );

  it.each(boards)(
    "makes a valid $difficulty board for $seed",
    ({ puzzle, difficulty }) => {
      expect(puzzle.difficulty).toBe(difficulty);
      expect(puzzle.size).toBe(7);
      expect(validatePuzzle(puzzle)).toEqual([]);
      const clueCount = puzzle.clues.filter((clue) => clue !== null).length;
      expect(clueCount).toBeGreaterThanOrEqual(MIN_CLUES[difficulty]);
    },
  );

  it("gives the same board for the same seed", () => {
    const first = boards.find(
      (b) => b.seed === SEEDS[0] && b.difficulty === "normal",
    )!;
    expect(generatePuzzle(SEEDS[0], "normal").puzzle).toEqual(first.puzzle);
  });

  it("gives different boards for different seeds and difficulties", () => {
    const definitions = new Set(
      boards.map((b) => canonicalPuzzleDefinition(b.puzzle)),
    );
    expect(definitions.size).toBe(boards.length);
  });

  // n1 の盤面は凍結する。この値が変わったら、n1 を直さずに版を上げる（DESIGN.md 13.4）。
  it("keeps the frozen boards", () => {
    expect(
      Object.fromEntries(
        boards.map((b) => [`${b.difficulty}:${b.seed}`, boardHash(b.puzzle)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "easy:alpha": "66c2a68a0ef3ee3c",
        "easy:にょろ": "84c1c6f2e7a5554c",
        "easy:🐍-2": "16e3b499af509ebd",
        "hard:alpha": "3d793b695ec21666",
        "hard:にょろ": "d3bfa43868602dcc",
        "hard:🐍-2": "b50dd35ce3ca6b4c",
        "normal:alpha": "0eed22b1d21e2e06",
        "normal:にょろ": "e36032150f22ef9d",
        "normal:🐍-2": "160e4eb626fc2cff",
      }
    `);
  });

  it("knows its versions", () => {
    expect(isSupportedGeneratorVersion("n1")).toBe(true);
    expect(isSupportedGeneratorVersion("n0")).toBe(false);
    expect(isSupportedGeneratorVersion("constructor")).toBe(false);
  });
});

describe("validation of generated boards", () => {
  // 枝刈りを足す前の Complete Solver は、この盤面でノード数の上限に達していた。
  it.each([
    ["x8", "easy"],
    ["x5", "normal"],
    ["x2", "hard"],
  ] as const)("confirms %s %s as unique", (seed, difficulty) => {
    expect(validatePuzzle(generatePuzzle(seed, difficulty).puzzle)).toEqual([]);
  });

  it("stops at the first fatal problem", () => {
    const { puzzle } = generatePuzzle("broken", "easy");
    const clues = puzzle.clues.map(() => null);
    expect(validatePuzzle({ ...puzzle, clues })).toEqual([
      "multiple-solutions",
    ]);
    expect(validatePuzzle({ ...puzzle, generatorVersion: "n0" })).toEqual([
      "unknown-version",
    ]);
  });
});

describe("clue validation", () => {
  it("rejects holes, wrong lengths and values out of range", () => {
    const good: Clue[] = new Array(49).fill(null);
    expect(hasValidClues(7, good)).toBe(true);
    expect(hasValidClues(7, new Array(49))).toBe(false);
    expect(hasValidClues(7, good.slice(1))).toBe(false);
    expect(hasValidClues(7, [...good.slice(1), 4])).toBe(false);
    expect(hasValidClues(8, new Array(64).fill(null))).toBe(false);
  });
});

describe("puzzle ID (DATA_CONTRACT.md)", () => {
  const { puzzle } = generatePuzzle("identity", "easy");

  it("hashes the version, size and clues", async () => {
    const id = await puzzleId(puzzle);
    expect(id).toMatch(/^p1:[0-9a-f]{64}$/);
    const expected = createHash("sha256")
      .update(JSON.stringify(["p1", "n1", 7, puzzle.clues]))
      .digest("hex");
    expect(id).toBe(`p1:${expected}`);
  });

  it("ignores the seed, difficulty and solution", async () => {
    const other = {
      ...puzzle,
      seed: "other",
      difficulty: "hard" as const,
      solution: [],
    };
    expect(await puzzleId(other)).toBe(await puzzleId(puzzle));
  });

  it("changes with the version or a clue", async () => {
    const id = await puzzleId(puzzle);
    expect(await puzzleId({ ...puzzle, generatorVersion: "n2" })).not.toBe(id);
    // 正解の数字を 1 つ足しても唯一解のままなので、ID だけが変わる。
    const fullClues = cluesOfLoop(boardGeometry(7), puzzle.solution);
    const added = puzzle.clues.findIndex((clue) => clue === null);
    const clues = puzzle.clues.map((clue, i) =>
      i === added ? fullClues[i] : clue,
    );
    expect(await puzzleId({ ...puzzle, clues })).not.toBe(id);
  });

  it("refuses invalid clues and boards without a unique solution", async () => {
    await expect(
      puzzleId({ ...puzzle, clues: [...puzzle.clues.slice(1), 4 as 3] }),
    ).rejects.toThrow();
    await expect(
      puzzleId({ ...puzzle, clues: puzzle.clues.slice(1) }),
    ).rejects.toThrow();
    await expect(
      puzzleId({ ...puzzle, clues: puzzle.clues.map(() => null) }),
    ).rejects.toThrow();
  });
});
