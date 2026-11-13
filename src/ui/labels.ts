import { type DifficultyChoice } from "../core/difficulty-choice";
import { type Difficulty } from "../core/model";

/** The names players see (DESIGN.md 9.3 for the board, TAKO-SEN for levels). */
export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
};

export const DIFFICULTY_CHOICE_LABELS: Readonly<
  Record<DifficultyChoice, string>
> = {
  ...DIFFICULTY_LABELS,
  random: "ランダム",
};
