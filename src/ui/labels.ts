import { type DifficultyChoice } from "../core/difficulty-choice";
import { type Difficulty } from "../core/model";
import { type AssistLevel } from "../core/settings";

/** The names players see (DESIGN.md 9.3 for the board, TAKO-SEN for levels). */
export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
};

/**
 * The mark a ranked clear carries for the assist it used (DESIGN.md 16.2):
 * none for no assist, and the two levels told apart.
 */
export const ASSIST_MARKS: Readonly<Record<AssistLevel, string>> = {
  0: "",
  1: "×自動",
  2: "ガイド",
};

export const DIFFICULTY_CHOICE_LABELS: Readonly<
  Record<DifficultyChoice, string>
> = {
  ...DIFFICULTY_LABELS,
  random: "ランダム",
};
