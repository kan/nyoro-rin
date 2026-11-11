import { CROSS, LINE, UNKNOWN, type EdgeState, type EdgeStates } from "./model";
import { type Tool } from "./settings";

/** One edge changed by a move, with its state before and after. */
export interface EdgeChange {
  readonly edge: number;
  readonly before: EdgeState;
  readonly after: EdgeState;
}

/**
 * One undoable move (DESIGN.md 16.4): a tap, a stroke, a reset or an applied
 * hint. Moves only ever hold edges that really changed.
 */
export type Move = readonly EdgeChange[];

/** Undo and redo keep this many moves each (DESIGN.md 16.4). */
export const HISTORY_LIMIT = 200;

/** The player's marks and the moves that led to them. */
export interface PlayBoard {
  readonly states: EdgeStates;
  readonly undo: readonly Move[];
  readonly redo: readonly Move[];
}

export interface EdgeEdit {
  readonly edge: number;
  readonly after: EdgeState;
}

export function emptyPlayBoard(edgeCount: number): PlayBoard {
  return { states: new Uint8Array(edgeCount), undo: [], redo: [] };
}

/**
 * What a tap on an edge makes of it (DESIGN.md 7.2).
 * - line: unknown → line → × → unknown
 * - cross: unknown or line → × → unknown
 */
export function tappedState(current: EdgeState, tool: Tool): EdgeState {
  if (tool === "line") {
    return current === UNKNOWN ? LINE : current === LINE ? CROSS : UNKNOWN;
  }
  return current === CROSS ? UNKNOWN : CROSS;
}

/**
 * Whether a stroke adds or erases, decided once by its first edge
 * (DESIGN.md 7.3) and kept for the whole stroke.
 */
export type StrokeMode = "add" | "erase";

export function strokeMode(firstEdge: EdgeState, tool: Tool): StrokeMode {
  return firstEdge === (tool === "line" ? LINE : CROSS) ? "erase" : "add";
}

/**
 * What a stroke makes of one edge it passes, or undefined to leave it.
 * - adding lines draws over × too: the player traced that edge on purpose
 * - adding × leaves lines alone, so a sweep across the board cannot wipe
 *   out drawn lines
 * - erasing clears only marks of the tool's own kind
 */
export function strokedState(
  current: EdgeState,
  tool: Tool,
  mode: StrokeMode,
): EdgeState | undefined {
  const mark = tool === "line" ? LINE : CROSS;
  if (mode === "erase") return current === mark ? UNKNOWN : undefined;
  if (tool === "cross" && current === LINE) return undefined;
  return current === mark ? undefined : mark;
}

/** A stroke in progress: the board it began on and what it did so far. */
export interface Stroke {
  readonly base: PlayBoard;
  readonly tool: Tool;
  /** Set by the stroke's first edge (DESIGN.md 7.3). */
  readonly mode?: StrokeMode;
  readonly edits: readonly EdgeEdit[];
}

export function beginStroke(board: PlayBoard, tool: Tool): Stroke {
  return { base: board, tool, edits: [] };
}

/**
 * Adds the edges a stroke passed, in order. The board comes back with the
 * whole stroke so far as one move, rebuilt from where the stroke began.
 */
export function continueStroke(
  stroke: Stroke,
  edges: readonly number[],
): { stroke: Stroke; board: PlayBoard } {
  let mode = stroke.mode;
  const edits = [...stroke.edits];
  for (const edge of edges) {
    const current = stateInStroke(stroke.base, edits, edge);
    mode ??= strokeMode(current, stroke.tool);
    const after = strokedState(current, stroke.tool, mode);
    if (after !== undefined) edits.push({ edge, after });
  }
  const next = { ...stroke, mode, edits };
  return { stroke: next, board: applyEdits(stroke.base, edits) };
}

/** An edge's state counting the edits made earlier in the stroke. */
function stateInStroke(
  base: PlayBoard,
  edits: readonly EdgeEdit[],
  edge: number,
): EdgeState {
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    if (edits[i].edge === edge) return edits[i].after;
  }
  return base.states[edge] as EdgeState;
}

/** Whether any line or × is on the board. */
export function hasMarks(board: PlayBoard): boolean {
  return board.states.some((state) => state !== UNKNOWN);
}

/**
 * Applies the edits as one move. Edits that change nothing are dropped; with
 * none left, the board is returned as it was (an untouched board is not a
 * move, DESIGN.md 16.1).
 */
export function applyEdits(
  board: PlayBoard,
  edits: readonly EdgeEdit[],
): PlayBoard {
  const states = Uint8Array.from(board.states);
  const changes: EdgeChange[] = [];
  for (const { edge, after } of edits) {
    const before = states[edge] as EdgeState;
    if (before === after) continue;
    // The same edge twice in one move keeps its first `before`.
    const earlier = changes.findIndex((change) => change.edge === edge);
    if (earlier >= 0) {
      changes[earlier] = { ...changes[earlier], after };
    } else {
      changes.push({ edge, before, after });
    }
    states[edge] = after;
  }
  const move = changes.filter((change) => change.before !== change.after);
  if (move.length === 0) return board;
  return {
    states,
    undo: [...board.undo, move].slice(-HISTORY_LIMIT),
    redo: [],
  };
}

/** Clears every line and × as one move, which undo can take back. */
export function resetMarks(board: PlayBoard): PlayBoard {
  const edits: EdgeEdit[] = [];
  board.states.forEach((state, edge) => {
    if (state !== UNKNOWN) edits.push({ edge, after: UNKNOWN });
  });
  return applyEdits(board, edits);
}

export function undoMove(board: PlayBoard): PlayBoard {
  const move = board.undo.at(-1);
  if (!move) return board;
  const states = Uint8Array.from(board.states);
  for (const change of move) states[change.edge] = change.before;
  return {
    states,
    undo: board.undo.slice(0, -1),
    redo: [...board.redo, move].slice(-HISTORY_LIMIT),
  };
}

export function redoMove(board: PlayBoard): PlayBoard {
  const move = board.redo.at(-1);
  if (!move) return board;
  const states = Uint8Array.from(board.states);
  for (const change of move) states[change.edge] = change.after;
  return {
    states,
    undo: [...board.undo, move].slice(-HISTORY_LIMIT),
    redo: board.redo.slice(0, -1),
  };
}
