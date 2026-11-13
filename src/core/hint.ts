/**
 * Hints (DESIGN.md chapter 11): what the next hint points at, found from the
 * player's lines and × alone. How a hint is worded and drawn is the UI's.
 */
import { type Attempt, type HintStage } from "./attempt";
import { type BoardGeometry } from "./board";
import { availableMoves, findTrialMove, propagateCrosses } from "./logical";
import {
  CROSS,
  LINE,
  NO_PLACES,
  UNKNOWN,
  type EdgeStates,
  type Places,
  type Puzzle,
} from "./model";
import { type EdgeEdit } from "./play";
import { edgesWithState, isSolved } from "./rules";
import { solveCompletely } from "./solver";
import { STEP_TECHNIQUE_IDS, type LogicalMove } from "./techniques";

/** A step the techniques explain, with the × its reason relies on. */
export interface MoveHint {
  readonly kind: "move";
  readonly move: LogicalMove;
  /**
   * Every × the hint shows and writes, ascending: the move's own, and the
   * known ones its reason rests on that are not on the board yet
   * (DESIGN.md 11.1).
   */
  readonly crosses: readonly number[];
}

/** The lines and × contradict the clues (DESIGN.md 11.3). */
export interface MistakeHint {
  readonly kind: "mistake";
  /** Lines off the answer's loop, ascending. */
  readonly wrongLines: readonly number[];
  /** × on the answer's loop, ascending. */
  readonly wrongCrosses: readonly number[];
  /** Around the first of them: what stage 2 shows. */
  readonly area: Places;
}

/** No technique explains a step: one line of the answer (DESIGN.md 11.4). */
export interface RevealHint {
  readonly kind: "reveal";
  readonly edge: number;
}

export type Hint = MoveHint | MistakeHint | RevealHint;

/**
 * Focus, reason, apply (DESIGN.md 11.2); for a mistake, that there is one,
 * where, and which marks.
 */
export type HintStep = Exclude<HintStage, 0>;

export const LAST_HINT_STEP: HintStep = 3;

/**
 * The next hint for the board, in the order of DESIGN.md 11.1. Undefined
 * only when the board is solved, or the search for a mistake gave up.
 */
export function findHint(
  geometry: BoardGeometry,
  puzzle: Pick<Puzzle, "clues" | "solution">,
  states: EdgeStates,
): Hint | undefined {
  const { clues } = puzzle;
  if (isSolved(geometry, clues, states)) return undefined;

  const mistake = findMistake(geometry, puzzle, states);
  if (mistake !== null) return mistake;

  // The × the assist gives count as known, whatever the assist setting,
  // so a hint is never spent on one of them.
  const known = propagateCrosses(geometry, clues, states).states;
  const withCrosses = (move: LogicalMove): MoveHint => ({
    kind: "move",
    move,
    crosses: [
      ...new Set([
        ...move.crosses,
        ...relatedCrosses(geometry, move, states, known),
      ]),
    ].sort((a, b) => a - b),
  });

  // Hints reason with every technique, intermediate ones included, and
  // with them inside a trial too (DESIGN.md 12.3).
  const techniques = STEP_TECHNIQUE_IDS;
  const { moves } = availableMoves(geometry, clues, known, { techniques });
  const line =
    moves.find((move) => move.lines.length > 0) ??
    findTrialMove(geometry, clues, known, {
      techniques,
      assumptions: [CROSS],
    });
  if (line) return withCrosses(line);
  const cross =
    moves.find((move) => move.crosses.length > 0) ??
    findTrialMove(geometry, clues, known, {
      techniques,
      assumptions: [LINE],
    });
  if (cross) return withCrosses(cross);

  for (const edge of puzzle.solution) {
    if (states[edge] === UNKNOWN) return { kind: "reveal", edge };
  }
  return undefined;
}

/**
 * Whether the marks leave the clues a solution, decided by the complete
 * solver rather than by comparing with the answer; if not, the marks that
 * differ from the answer of the bare clues (the puzzle's, checked unique
 * when it was made) are the mistakes. Null when there is no mistake,
 * undefined when the search gave up.
 */
function findMistake(
  geometry: BoardGeometry,
  puzzle: Pick<Puzzle, "clues" | "solution">,
  states: EdgeStates,
): MistakeHint | null | undefined {
  const lines = edgesWithState(states, LINE);
  const crosses = edgesWithState(states, CROSS);
  if (lines.length === 0 && crosses.length === 0) return null;
  const marked = solveCompletely(geometry, puzzle.clues, { lines, crosses });
  const solution = new Set(puzzle.solution);
  if (marked.status === "aborted") return undefined;
  if (marked.status !== "none") return null;
  const wrongLines = lines.filter((edge) => !solution.has(edge));
  const wrongCrosses = crosses.filter((edge) => solution.has(edge));
  const first = Math.min(...wrongLines, ...wrongCrosses);
  // Every mark agrees with an answer the clues do not allow: the saved
  // answer is not this puzzle's, and there is nothing true to point at.
  if (!Number.isFinite(first)) return undefined;
  return {
    kind: "mistake",
    wrongLines,
    wrongCrosses,
    area: areaAround(geometry, first),
  };
}

/** The cells that touch either end of the edge. */
function areaAround(geometry: BoardGeometry, edge: number): Places {
  const cells = new Set<number>();
  for (const vertex of geometry.edgeVertices[edge]) {
    for (const side of geometry.vertexEdges[vertex]) {
      for (const cell of geometry.edgeCells[side]) cells.add(cell);
    }
  }
  return {
    ...NO_PLACES,
    cells: [...cells].sort((a, b) => a - b),
  };
}

/**
 * The known × around the places the move's reason names: its focus, its
 * premises and, for a trial, where the trial went wrong.
 */
function relatedCrosses(
  geometry: BoardGeometry,
  move: LogicalMove,
  states: EdgeStates,
  known: EdgeStates,
): number[] {
  const near = new Set<number>();
  const add = (places: Places) => {
    for (const cell of places.cells) {
      for (const edge of geometry.cellEdges[cell]) near.add(edge);
    }
    for (const vertex of places.vertices) {
      for (const edge of geometry.vertexEdges[vertex]) near.add(edge);
    }
    for (const edge of places.edges) near.add(edge);
  };
  add(move.focus);
  add(move.premises);
  if (move.trial) add(move.trial.contradiction.places);
  return [...near]
    .filter((edge) => known[edge] === CROSS && states[edge] === UNKNOWN)
    .sort((a, b) => a - b);
}

/**
 * What showing this step writes onto the board, as one move: the lines and
 * × of a move or the revealed line, at step 3 only. A mistake's step 3 only
 * shows the marks.
 */
export function hintStepEdits(hint: Hint, step: HintStep): EdgeEdit[] {
  if (step !== LAST_HINT_STEP || hint.kind === "mistake") return [];
  if (hint.kind === "reveal") return [{ edge: hint.edge, after: LINE }];
  return [
    ...hint.move.lines.map((edge): EdgeEdit => ({ edge, after: LINE })),
    ...hint.crosses.map((edge): EdgeEdit => ({ edge, after: CROSS })),
  ];
}

/**
 * What a hint is about, as the play log names it: the technique's ID, or
 * MISTAKE or REVEAL (src/core/play-log.ts).
 */
export function hintLabel(hint: Hint): string {
  switch (hint.kind) {
    case "move":
      return hint.move.technique;
    case "mistake":
      return "MISTAKE";
    case "reveal":
      return "REVEAL";
  }
}

/**
 * Records a hint step shown (DATA_CONTRACT.md 「段階と記録の値」): a hint
 * counts once, at its first step; later steps only raise the maximum; the
 * line a reveal shows at step 2 counts as a reveal too (DESIGN.md 11.4).
 */
export function withHintStep(
  attempt: Attempt,
  hint: Hint,
  step: HintStep,
): Attempt {
  return {
    ...attempt,
    hintsUsed: attempt.hintsUsed + (step === 1 ? 1 : 0),
    maxHintStage: Math.max(attempt.maxHintStage, step) as HintStage,
    reveals: attempt.reveals + (hint.kind === "reveal" && step === 2 ? 1 : 0),
  };
}
