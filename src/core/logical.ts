import { type BoardGeometry } from "./board";
import {
  CROSS,
  LINE,
  NO_PLACES,
  UNKNOWN,
  type Clue,
  type EdgeStates,
} from "./model";
import { analyzeBoard, conflictPlaces, findConflicts, isSolved } from "./rules";
import {
  BASIC_TECHNIQUES,
  BASIC_TECHNIQUE_IDS,
  CROSS_ONLY_TECHNIQUES,
  LAYOUT_TECHNIQUES,
  type BasicTechniqueId,
  type Contradiction,
  type LogicalMove,
  type TechniqueId,
  techniqueContext,
} from "./techniques";

export interface TechniqueOptions {
  /** The techniques to use, in order; every basic one by default. */
  readonly techniques?: readonly BasicTechniqueId[];
}

export interface PropagationOptions extends TechniqueOptions {
  /**
   * Go on past contradictions instead of stopping: skip rule conflicts, and
   * drop a technique's conclusion where it clashes with a decided edge.
   * For display only (the assist's ×), where one mistake of the player's
   * must not hide what the rest of the board still gives. Never for
   * solving: the result proves nothing.
   */
  readonly tolerant?: boolean;
}

export interface PropagationResult {
  /** A new array; the input is left as it was. */
  readonly states: EdgeStates;
  readonly contradiction?: Contradiction;
  /** The moves applied, in order. */
  readonly moves: readonly LogicalMove[];
}

/** The moves the techniques can make on the board as it is. */
export function availableMoves(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  options: TechniqueOptions = {},
): { moves: LogicalMove[]; contradiction?: Contradiction } {
  return movesOf(
    geometry,
    clues,
    states,
    options.techniques ?? BASIC_TECHNIQUE_IDS,
  );
}

function movesOf(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  techniques: readonly BasicTechniqueId[],
  tolerant = false,
): { moves: LogicalMove[]; contradiction?: Contradiction } {
  const analysis = analyzeBoard(geometry, states);
  const [conflict] = tolerant
    ? []
    : findConflicts(geometry, clues, states, analysis);
  if (conflict) {
    return {
      moves: [],
      contradiction: {
        reason: conflict.kind,
        places: conflictPlaces(conflict),
      },
    };
  }
  const context = techniqueContext(geometry, clues, states, analysis);
  const moves: LogicalMove[] = [];
  for (const id of techniques) {
    const result = BASIC_TECHNIQUES[id](context);
    if (result.contradiction && !tolerant) {
      return { moves: [], contradiction: result.contradiction };
    }
    moves.push(...result.moves);
  }
  return { moves };
}

/**
 * Applies the techniques until none applies any more, or until the board
 * contradicts itself.
 */
export function propagate(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  initial: EdgeStates,
  options: PropagationOptions = {},
): PropagationResult {
  const all = options.techniques ?? BASIC_TECHNIQUE_IDS;
  // After the first round the layout techniques have nothing left to add.
  const later = all.filter((id) => !LAYOUT_TECHNIQUES.has(id));
  const states = Uint8Array.from(initial);
  const applied: LogicalMove[] = [];
  // Each round decides at least one edge, so this many rounds always suffice.
  for (let round = 0; round <= geometry.edgeCount; round += 1) {
    const { moves, contradiction } = movesOf(
      geometry,
      clues,
      states,
      round === 0 ? all : later,
      options.tolerant,
    );
    if (contradiction) return { states, contradiction, moves: applied };
    let changed = false;
    for (const move of moves) {
      // An earlier move of this round may have decided the same edge.
      const clash =
        move.lines.some((edge) => states[edge] === CROSS) ||
        move.crosses.some((edge) => states[edge] === LINE);
      if (clash && options.tolerant) continue;
      if (clash) {
        return {
          states,
          contradiction: { reason: move.technique, places: move.focus },
          moves: applied,
        };
      }
      const lines = move.lines.filter((edge) => states[edge] === UNKNOWN);
      const crosses = move.crosses.filter((edge) => states[edge] === UNKNOWN);
      if (lines.length === 0 && crosses.length === 0) continue;
      for (const edge of lines) states[edge] = LINE;
      for (const edge of crosses) states[edge] = CROSS;
      applied.push({ ...move, lines, crosses });
      changed = true;
    }
    if (!changed) break;
  }
  return { states, moves: applied };
}

/** The × the assist derives: only the techniques that never draw a line. */
export function propagateCrosses(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  options: Pick<PropagationOptions, "tolerant"> = {},
): PropagationResult {
  return propagate(geometry, clues, states, {
    ...options,
    techniques: CROSS_ONLY_TECHNIQUES,
  });
}

export interface TrialOptions extends TechniqueOptions {
  /** Edges are tried from this one on, wrapping around. */
  readonly startEdge?: number;
}

/**
 * TRIAL (DESIGN.md 12.3): assume one unknown edge, propagate with the given
 * techniques (never a trial inside a trial), and if that contradicts, the
 * edge is the opposite.
 */
export function findTrialMove(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  options: TrialOptions = {},
): LogicalMove | undefined {
  const startEdge = options.startEdge ?? 0;
  for (let i = 0; i < geometry.edgeCount; i += 1) {
    const edge = (startEdge + i) % geometry.edgeCount;
    if (states[edge] !== UNKNOWN) continue;
    for (const assumed of [LINE, CROSS] as const) {
      const trial = Uint8Array.from(states);
      trial[edge] = assumed;
      const result = propagate(geometry, clues, trial, options);
      if (!result.contradiction) continue;
      return {
        technique: "TRIAL",
        lines: assumed === CROSS ? [edge] : [],
        crosses: assumed === LINE ? [edge] : [],
        focus: { ...NO_PLACES, edges: [edge] },
        premises: NO_PLACES,
        trial: {
          edge,
          assumed,
          contradiction: result.contradiction,
          steps: result.moves.length,
        },
      };
    }
  }
  return undefined;
}

export interface LogicalSolveOptions extends TechniqueOptions {
  /** How many trials may be used; none by default. */
  readonly maxTrials?: number;
}

export interface LogicalSolveResult {
  readonly solved: boolean;
  readonly trials: number;
  readonly states: EdgeStates;
  /** How many moves of each technique were used. */
  readonly usage: Readonly<Partial<Record<TechniqueId, number>>>;
}

/**
 * Solves from an empty board with the techniques alone. Solving means the
 * lines form a loop that satisfies every clue; since every technique is a
 * sound deduction, such a loop is the only solution.
 */
export function solveLogically(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  options: LogicalSolveOptions = {},
): LogicalSolveResult {
  const maxTrials = options.maxTrials ?? 0;
  const usage: Partial<Record<TechniqueId, number>> = {};
  const count = (moves: readonly LogicalMove[]) => {
    for (const move of moves) {
      usage[move.technique] = (usage[move.technique] ?? 0) + 1;
    }
  };

  let result = propagate(
    geometry,
    clues,
    new Uint8Array(geometry.edgeCount),
    options,
  );
  count(result.moves);
  let trials = 0;
  let nextEdge = 0;
  while (!result.contradiction) {
    if (isSolved(geometry, clues, result.states)) {
      return { solved: true, trials, states: result.states, usage };
    }
    if (trials >= maxTrials) break;
    const trial = findTrialMove(geometry, clues, result.states, {
      ...options,
      startEdge: nextEdge,
    });
    if (!trial) break;
    trials += 1;
    count([trial]);
    nextEdge = trial.trial!.edge + 1;
    const states = Uint8Array.from(result.states);
    for (const edge of trial.lines) states[edge] = LINE;
    for (const edge of trial.crosses) states[edge] = CROSS;
    result = propagate(geometry, clues, states, options);
    count(result.moves);
  }
  return { solved: false, trials, states: result.states, usage };
}
