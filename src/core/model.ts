/** Normal puzzles are 7 × 7 (DESIGN.md chapter 3). */
export const BOARD_SIZE = 7;
/** The daily board of the next phase. The core accepts it already. */
export const DAILY_BOARD_SIZE = 10;

export type BoardSize = typeof BOARD_SIZE | typeof DAILY_BOARD_SIZE;

export function isBoardSize(value: unknown): value is BoardSize {
  return value === BOARD_SIZE || value === DAILY_BOARD_SIZE;
}

/** A clue is the number of loop edges around its cell; null means no clue. */
export type Clue = 0 | 1 | 2 | 3 | null;

export function isClue(value: unknown): value is Clue {
  return (
    value === null || value === 0 || value === 1 || value === 2 || value === 3
  );
}

/**
 * What the player knows about an edge. The automatic × of the assist is not
 * an edge state: it is derived from these and never stored (DESIGN.md 5).
 */
export const UNKNOWN = 0;
export const LINE = 1;
export const CROSS = 2;
export type EdgeState = typeof UNKNOWN | typeof LINE | typeof CROSS;

/**
 * One state per edge, indexed by edge number. Core functions never write to
 * an array they receive; they copy it first.
 */
export type EdgeStates = Uint8Array;

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

/** A whole board of clues: the right length, every value 0-3 or null. */
export function hasValidClues(size: unknown, clues: unknown): boolean {
  if (!isBoardSize(size) || !Array.isArray(clues)) return false;
  if (clues.length !== size * size) return false;
  // A plain loop: every() skips the holes of a sparse array.
  for (let i = 0; i < clues.length; i += 1) {
    if (!isClue(clues[i])) return false;
  }
  return true;
}

export interface Puzzle {
  readonly generatorVersion: string;
  readonly difficulty: Difficulty;
  readonly seed: string;
  readonly size: BoardSize;
  /** One clue per cell, in cell order. */
  readonly clues: readonly Clue[];
  /** The edges of the loop, ascending. */
  readonly solution: readonly number[];
}

export interface GeneratedPuzzle {
  readonly puzzle: Puzzle;
  /** Trials the logical solve of the final board needs. */
  readonly trials: number;
  /** Boards discarded before this one. */
  readonly attempt: number;
}

export interface DifficultyRating {
  /** Undefined when the supported techniques cannot solve it. */
  readonly difficulty?: Difficulty;
  readonly trials: number;
}

/** Clues, vertices and edges, by number: where a hint, conflict or move is. */
export interface Places {
  readonly cells: readonly number[];
  readonly vertices: readonly number[];
  readonly edges: readonly number[];
}

export const NO_PLACES: Places = { cells: [], vertices: [], edges: [] };
