import { boardGeometry } from "./board";
import { isSupportedGeneratorVersion, rateDifficulty } from "./generator";
import { type Puzzle, hasValidClues } from "./model";
import { isSolved, statesFromLines } from "./rules";
import { solveCompletely } from "./solver";

export type PuzzleProblem =
  | "unknown-version"
  | "invalid-clues"
  | "no-solution"
  | "multiple-solutions"
  | "search-aborted"
  | "solution-mismatch"
  | "not-a-loop"
  | "difficulty-mismatch";

/**
 * Checks a puzzle without trusting how it was made (DESIGN.md chapter 14).
 * An empty list means the puzzle is fit to play.
 */
export function validatePuzzle(puzzle: Puzzle): PuzzleProblem[] {
  if (!isSupportedGeneratorVersion(puzzle.generatorVersion)) {
    return ["unknown-version"];
  }
  if (!hasValidClues(puzzle.size, puzzle.clues)) return ["invalid-clues"];
  const geometry = boardGeometry(puzzle.size);
  const problems: PuzzleProblem[] = [];

  const solved = solveCompletely(geometry, puzzle.clues);
  if (solved.status === "none") return ["no-solution"];
  if (solved.status === "multiple") return ["multiple-solutions"];
  if (solved.status === "aborted") return ["search-aborted"];
  if (
    solved.solution!.join(",") !==
    [...puzzle.solution].sort((a, b) => a - b).join(",")
  ) {
    problems.push("solution-mismatch");
  }
  if (
    !isSolved(
      geometry,
      puzzle.clues,
      statesFromLines(geometry, puzzle.solution),
    )
  ) {
    problems.push("not-a-loop");
  }
  const rating = rateDifficulty(
    puzzle.generatorVersion,
    geometry,
    puzzle.clues,
  );
  if (rating.difficulty !== puzzle.difficulty) {
    problems.push("difficulty-mismatch");
  }
  return problems;
}
