import { describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import type { Difficulty, Puzzle } from "../src/core/model";
import {
  type NextPuzzleSource,
  type RankedPuzzleCandidate,
  type SeenBoards,
  chooseNextPuzzle,
  parseCandidates,
  pickRankedPuzzle,
} from "../src/core/next-puzzle";
import { puzzleId } from "../src/core/puzzle-identity";
import type { RandomSource } from "../src/core/random";
import { encodeSeedCode } from "../src/core/seed-code";

const NONE: SeenBoards = { puzzleIds: new Set(), seedCodes: new Set() };
const FIRST: RandomSource = { next: () => 0 };
const LAST: RandomSource = { next: () => 0.999 };

function candidate(
  label: string,
  players: number,
  code = `NYORO:n1:easy:${label}`,
): RankedPuzzleCandidate {
  return { puzzleId: `p1:${label.padEnd(64, "0")}`, seedCode: code, players };
}

describe("choosing the next puzzle", () => {
  const list = [candidate("a", 1), candidate("b", 3), candidate("c", 3)];

  it("takes a board with the most players, ties drawn at random", () => {
    expect(chooseNextPuzzle(list, "easy", NONE, FIRST)?.candidate).toBe(
      list[1],
    );
    expect(chooseNextPuzzle(list, "easy", NONE, LAST)?.candidate).toBe(list[2]);
  });

  it("skips boards shown recently or in this device's history", () => {
    const seen: SeenBoards = {
      puzzleIds: new Set([list[1]!.puzzleId]),
      seedCodes: new Set([list[2]!.seedCode]),
    };
    expect(chooseNextPuzzle(list, "easy", seen, LAST)?.candidate).toBe(list[0]);
  });

  it("skips other versions, other difficulties and unreadable codes", () => {
    const others = [
      candidate("old", 9, "NYORO:n0:easy:old"),
      candidate("hard", 9, "NYORO:n1:hard:hard"),
      candidate("bad", 9, "not a code"),
    ];
    expect(chooseNextPuzzle(others, "easy", NONE, FIRST)).toBeUndefined();
    expect(
      chooseNextPuzzle([...others, list[0]!], "easy", NONE, FIRST)?.code,
    ).toEqual({ version: "n1", difficulty: "easy", seed: "a" });
  });

  it("finds nothing when no candidate is left", () => {
    expect(chooseNextPuzzle([], "easy", NONE, FIRST)).toBeUndefined();
  });

  it("drops malformed candidates from an answer", () => {
    expect(
      parseCandidates({
        candidates: [
          list[0],
          { ...list[0], puzzleId: "p1:short" },
          { ...list[0], players: 0 },
          { ...list[0], players: 1.5 },
          { ...list[0], seedCode: "x".repeat(600) },
          null,
        ],
      }),
    ).toEqual([list[0]]);
    expect(parseCandidates({})).toBeUndefined();
    expect(parseCandidates(null)).toBeUndefined();
  });
});

describe("picking a ranked puzzle", () => {
  const seed = "ranked";
  const generated = generatePuzzle(seed, "easy").puzzle;
  const code = encodeSeedCode({ version: "n1", difficulty: "easy", seed });

  function source(
    body: unknown | (() => Promise<unknown>),
    generate: (difficulty: Difficulty) => Puzzle = () => generated,
  ): NextPuzzleSource & { asked: Difficulty[] } {
    const asked: Difficulty[] = [];
    return {
      asked,
      fetchCandidates: async (difficulty) => {
        asked.push(difficulty);
        return typeof body === "function" ? (body as () => unknown)() : body;
      },
      generate: async (seedCode) => generate(seedCode.difficulty),
      identify: puzzleId,
    };
  }

  it("plays the board regenerated from the seed code when its ID matches", async () => {
    const id = await puzzleId(generated);
    const picked = await pickRankedPuzzle(
      "easy",
      NONE,
      source({ candidates: [{ puzzleId: id, seedCode: code, players: 2 }] }),
      FIRST,
    );
    expect(picked).toEqual({ puzzle: generated, puzzleId: id });
  });

  it("falls back when the regenerated board is not the one offered", async () => {
    const other = `p1:${"f".repeat(64)}`;
    expect(
      await pickRankedPuzzle(
        "easy",
        NONE,
        source({
          candidates: [{ puzzleId: other, seedCode: code, players: 2 }],
        }),
        FIRST,
      ),
    ).toBeUndefined();
  });

  it("falls back without candidates", async () => {
    expect(
      await pickRankedPuzzle("easy", NONE, source({ candidates: [] }), FIRST),
    ).toBeUndefined();
  });

  it("falls back when the candidates or the board cannot be had", async () => {
    const offline = source(() => Promise.reject(new TypeError("offline")));
    expect(
      await pickRankedPuzzle("easy", NONE, offline, FIRST),
    ).toBeUndefined();
    expect(
      await pickRankedPuzzle("easy", NONE, source({ error: "x" }), FIRST),
    ).toBeUndefined();
    const id = await puzzleId(generated);
    const broken = source(
      { candidates: [{ puzzleId: id, seedCode: code, players: 2 }] },
      () => {
        throw new Error("generation failed");
      },
    );
    expect(await pickRankedPuzzle("easy", NONE, broken, FIRST)).toBeUndefined();
  });

  it("asks for the difficulty given", async () => {
    const asked = source({ candidates: [] });
    await pickRankedPuzzle("hard", NONE, asked, FIRST);
    expect(asked.asked).toEqual(["hard"]);
  });
});
