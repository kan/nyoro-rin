import { type Ref, readonly, ref } from "vue";
import {
  type DifficultyChoice,
  initialChoice,
  loadDifficultyChoice,
  pickDifficulty,
  saveDifficultyChoice,
} from "../core/difficulty-choice";
import { type Difficulty } from "../core/model";
import { browserStorage } from "./browser-storage";

const MATH_RANDOM = { next: Math.random };

/**
 * The device's difficulty choice. Only what the player chooses is saved:
 * the start taken from a reloaded board is not a choice (DESIGN.md 13.7).
 */
export function useDifficultyChoice(): {
  choice: Readonly<Ref<DifficultyChoice>>;
  /** The player chose: shown and saved. */
  choose(choice: DifficultyChoice): void;
  /** Sets the start once the board on reload is known; saves nothing. */
  startFrom(board: Difficulty | undefined): void;
  /** The difficulty to make the next puzzle at; draws for random. */
  next(): Difficulty;
} {
  const storage = browserStorage();
  const saved = storage && loadDifficultyChoice(storage);
  const choice = ref<DifficultyChoice>(initialChoice(saved, undefined));
  return {
    choice: readonly(choice),
    choose(value) {
      choice.value = value;
      if (storage) saveDifficultyChoice(storage, value);
    },
    startFrom(board) {
      choice.value = initialChoice(saved, board);
    },
    next: () => pickDifficulty(choice.value, MATH_RANDOM),
  };
}
