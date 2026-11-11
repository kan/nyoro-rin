import { type BoardGeometry } from "./board";
import { propagateCrosses } from "./logical";
import { CROSS, UNKNOWN, type Clue, type EdgeStates } from "./model";
import { analyzeBoard, conflictPlaces, findConflicts } from "./rules";
import { type AssistLevel } from "./settings";

/**
 * Everything the board shows on top of the player's own marks, derived from
 * them: the UI draws these and decides nothing (AGENTS.md 「UI」).
 */
export interface BoardAnnotations {
  /** Clues with too many lines, or too many × to be reached. */
  readonly conflictCells: ReadonlySet<number>;
  /** Branches and dead ends. */
  readonly conflictVertices: ReadonlySet<number>;
  /** Lines of a small loop. */
  readonly conflictEdges: ReadonlySet<number>;
  /** Clues already met, shown faded (DESIGN.md 9.1). */
  readonly satisfiedCells: ReadonlySet<number>;
  /** The assist's ×: unknown edges it derives, never stored (DESIGN.md 8.1). */
  readonly autoCrosses: ReadonlySet<number>;
}

export interface AnnotationOptions {
  readonly showConflicts: boolean;
  readonly assist: AssistLevel;
}

export function annotateBoard(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  options: AnnotationOptions,
): BoardAnnotations {
  const analysis = analyzeBoard(geometry, states);
  const conflictCells = new Set<number>();
  const conflictVertices = new Set<number>();
  const conflictEdges = new Set<number>();
  if (options.showConflicts) {
    for (const conflict of findConflicts(geometry, clues, states, analysis)) {
      const places = conflictPlaces(conflict);
      for (const cell of places.cells) conflictCells.add(cell);
      for (const vertex of places.vertices) conflictVertices.add(vertex);
      for (const edge of places.edges) conflictEdges.add(edge);
    }
  }

  const autoCrosses = new Set<number>();
  if (options.assist >= 1) {
    // With conflicts shown, one mistake must not hide the × the rest of the
    // board still gives: the mistake is marked in red instead. With them
    // hidden, the × stop at a contradiction, so that a wrong line cannot
    // spread wrong × unnoticed.
    const derived = propagateCrosses(geometry, clues, states, {
      tolerant: options.showConflicts,
    }).states;
    derived.forEach((state, edge) => {
      if (state === CROSS && states[edge] === UNKNOWN) autoCrosses.add(edge);
    });
  }

  // A clue with a conflict is never met: too many lines miss the clue, and
  // too many × leave no room for exactly that many lines.
  // A 0 is met once all four sides are ×, the assist's included.
  const { marks } = analysis;
  const satisfiedCells = new Set<number>();
  clues.forEach((clue, cell) => {
    if (clue === null || marks.cellLines[cell] !== clue) return;
    if (clue > 0) {
      satisfiedCells.add(cell);
      return;
    }
    const crossed = geometry.cellEdges[cell].every(
      (edge) => states[edge] === CROSS || autoCrosses.has(edge),
    );
    if (crossed) satisfiedCells.add(cell);
  });

  return {
    conflictCells,
    conflictVertices,
    conflictEdges,
    satisfiedCells,
    autoCrosses,
  };
}
