import { describe, expect, it } from "vitest";
import { createWideSeededRandom, shuffled } from "../src/core/random";

const take = (source: { next(): number }, count: number) =>
  Array.from({ length: count }, () => source.next());

describe("wide seeded random", () => {
  // TAKO-SEN と同じ数列であることを、TAKO-SEN のテストの固定値で確かめる。
  // n1 の盤面はこの数列で決まるので、値を変えてはいけない。
  it.each([
    ["", [0.5636194369290024, 0.7719245995394886, 0.007362341741099954]],
    [
      "g3:hard:seed:0",
      [0.3360243404749781, 0.20175102981738746, 0.8507441321853548],
    ],
    ["🐙", [0.638423765078187, 0.3253815518692136, 0.2530099528376013]],
  ] as const)("keeps the frozen sequence for %j", (seed, expected) => {
    expect(take(createWideSeededRandom(seed), 3)).toEqual(expected);
  });

  it("repeats for the same seed and stays inside [0, 1)", () => {
    const values = take(createWideSeededRandom("repeat"), 2000);
    expect(take(createWideSeededRandom("repeat"), 2000)).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("shuffles without losing or changing the input", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffled(input, createWideSeededRandom("shuffle"));
    expect([...result].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
