/**
 * The difficulty the next puzzle is made at (DESIGN.md 13.7): chosen per
 * device, apart from the board in play, and possibly "random", which draws
 * one of the three for each new puzzle and stays "random".
 */
import { DIFFICULTIES, type Difficulty, isDifficulty } from "./model";
import { type RandomSource, randomInt } from "./random";
import { type KeyValueStorage, readJson, writeJson } from "./storage";

export const DIFFICULTY_CHOICE_KEY = "nyoro-rin.difficulty.v1";

export type DifficultyChoice = Difficulty | "random";

function isDifficultyChoice(value: unknown): value is DifficultyChoice {
  return value === "random" || isDifficulty(value);
}

/**
 * The difficulty to make the next puzzle at; each is drawn with 1/3 for
 * random. The board, its seed and its record keep the difficulty drawn,
 * never "random".
 */
export function pickDifficulty(
  choice: DifficultyChoice,
  random: RandomSource,
): Difficulty {
  return choice === "random"
    ? DIFFICULTIES[randomInt(random, DIFFICULTIES.length)]
    : choice;
}

/**
 * The choice to start with: the saved one, else the difficulty of the
 * board picked up on reload, else easy (as TAKO-SEN).
 */
export function initialChoice(
  saved: DifficultyChoice | undefined,
  board: Difficulty | undefined,
): DifficultyChoice {
  return saved ?? board ?? "easy";
}

/** Undefined when nothing (or nothing valid) is saved. */
export function loadDifficultyChoice(
  storage: KeyValueStorage,
): DifficultyChoice | undefined {
  return readJson(storage, DIFFICULTY_CHOICE_KEY, (value) =>
    isDifficultyChoice(value) ? value : undefined,
  );
}

export function saveDifficultyChoice(
  storage: KeyValueStorage,
  choice: DifficultyChoice,
): boolean {
  return writeJson(storage, DIFFICULTY_CHOICE_KEY, choice);
}
