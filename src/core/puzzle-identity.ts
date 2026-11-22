import { boardGeometry } from "./board";
import { type Puzzle, hasValidClues } from "./model";
import { solveCompletely } from "./solver";

/**
 * The canonical form the puzzle ID hashes (DATA_CONTRACT.md). The seed,
 * difficulty and solution are left out on purpose: the identity is the
 * board a player sees.
 */
export function canonicalPuzzleDefinition(
  puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues">,
): string {
  return JSON.stringify([
    "p1",
    puzzle.generatorVersion,
    puzzle.size,
    puzzle.clues,
  ]);
}

/** Whether a value has the form of a puzzle ID. */
export function isPuzzleId(value: unknown): value is string {
  return typeof value === "string" && /^p1:[0-9a-f]{64}$/.test(value);
}

export interface PuzzleIdOptions {
  /**
   * The complete solver's node budget for the uniqueness check. The default
   * suits 7 × 7 boards; a hard 10 × 10 daily board can need several times
   * it (8M to 16M nodes, about a second), and a board that runs out is
   * refused as if it had more than one solution. Daily boards pass Infinity.
   */
  readonly nodeLimit?: number;
}

/** `p1:<SHA-256 hex>`. Refuses a board with bad clues or not exactly one solution. */
export async function puzzleId(
  puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues">,
  options: PuzzleIdOptions = {},
): Promise<string> {
  if (!hasValidClues(puzzle.size, puzzle.clues)) {
    throw new Error("Cannot identify a board with invalid clues.");
  }
  const geometry = boardGeometry(puzzle.size);
  const solved = solveCompletely(geometry, puzzle.clues, {
    nodeLimit: options.nodeLimit,
  });
  if (solved.status !== "unique") {
    throw new Error("Cannot identify a board without exactly one solution.");
  }
  return puzzleIdOfCheckedBoard(puzzle);
}

/**
 * The ID of a board the caller has just checked: valid clues and exactly one
 * solution, by its own complete solve. It spares a second solve of a board
 * that takes a second to solve; any other board goes through puzzleId.
 */
export async function puzzleIdOfCheckedBoard(
  puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues">,
): Promise<string> {
  const input = new TextEncoder().encode(canonicalPuzzleDefinition(puzzle));
  const hash = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `p1:${hex}`;
}
