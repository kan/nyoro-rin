import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CHOICE_KEY,
  initialChoice,
  loadDifficultyChoice,
  pickDifficulty,
  saveDifficultyChoice,
} from "../src/core/difficulty-choice";
import { memoryStorage } from "./helpers";

const fixed = (value: number) => ({ next: () => value });

describe("difficulty choice (DESIGN.md 13.7)", () => {
  it("makes a chosen difficulty as it is", () => {
    expect(pickDifficulty("normal", fixed(0.99))).toBe("normal");
  });

  it("draws each difficulty with 1/3 for random", () => {
    expect(pickDifficulty("random", fixed(0))).toBe("easy");
    expect(pickDifficulty("random", fixed(0.34))).toBe("normal");
    expect(pickDifficulty("random", fixed(0.67))).toBe("hard");
    expect(pickDifficulty("random", fixed(0.999999))).toBe("hard");
  });

  it("starts from the saved choice, else the board on reload, else easy", () => {
    expect(initialChoice("random", "hard")).toBe("random");
    expect(initialChoice(undefined, "hard")).toBe("hard");
    expect(initialChoice(undefined, undefined)).toBe("easy");
  });

  it("reads back what it saved, random included", () => {
    const { storage } = memoryStorage();
    expect(loadDifficultyChoice(storage)).toBeUndefined();
    saveDifficultyChoice(storage, "random");
    expect(loadDifficultyChoice(storage)).toBe("random");
    saveDifficultyChoice(storage, "hard");
    expect(loadDifficultyChoice(storage)).toBe("hard");
  });

  it("ignores a value that is no choice, keeping it aside", () => {
    const { storage, map } = memoryStorage({
      [DIFFICULTY_CHOICE_KEY]: '"expert"',
    });
    expect(loadDifficultyChoice(storage)).toBeUndefined();
    expect(map.get(`${DIFFICULTY_CHOICE_KEY}.corrupt`)).toBe('"expert"');
  });
});
