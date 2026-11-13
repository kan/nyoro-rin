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

/** `p1:<SHA-256 hex>`. Refuses a board with bad clues or not exactly one solution. */
export async function puzzleId(
  puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues">,
): Promise<string> {
  if (!hasValidClues(puzzle.size, puzzle.clues)) {
    throw new Error("Cannot identify a board with invalid clues.");
  }
  const geometry = boardGeometry(puzzle.size);
  if (solveCompletely(geometry, puzzle.clues).status !== "unique") {
    throw new Error("Cannot identify a board without exactly one solution.");
  }
  const input = new TextEncoder().encode(canonicalPuzzleDefinition(puzzle));
  const hash = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `p1:${hex}`;
}
