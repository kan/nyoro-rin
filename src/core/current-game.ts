/**
 * The board in play, saved so a reload picks it up where it was
 * (DESIGN.md chapter 19, DATA_CONTRACT.md 「ローカル保存と版」). Results are
 * kept apart in results.ts.
 */
import { type Attempt, isCount, parseAttempt } from "./attempt";
import { type BoardGeometry, boardGeometry } from "./board";
import {
  CROSS,
  type EdgeState,
  type EdgeStates,
  LINE,
  type Puzzle,
  UNKNOWN,
  hasValidClues,
} from "./model";
import {
  type EdgeChange,
  HISTORY_LIMIT,
  type Move,
  type PlayBoard,
} from "./play";
import { type PlayTimer, pauseTimer } from "./play-timer";
import { edgesWithState, isSolved, statesFromLines } from "./rules";
import { encodeSeedCode, parseSeedCode } from "./seed-code";
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const CURRENT_GAME_KEY = "nyoro-rin.current-game.v1";

export interface CurrentGame {
  readonly puzzle: Puzzle;
  readonly attempt: Attempt;
  readonly board: PlayBoard;
  /** Read back never running: a running clock is saved as paused. */
  readonly timer: PlayTimer;
}

/** One changed edge as `[edge, before, after]`. */
type SavedChange = [number, EdgeState, EdgeState];

interface SavedGame extends Attempt {
  readonly version: 1;
  readonly puzzle: {
    readonly seedCode: string;
    readonly generatorVersion: string;
    readonly difficulty: Puzzle["difficulty"];
    readonly size: Puzzle["size"];
    readonly clues: Puzzle["clues"];
    readonly solution: Puzzle["solution"];
  };
  readonly lines: number[];
  readonly crosses: number[];
  readonly undo: SavedChange[][];
  readonly redo: SavedChange[][];
  readonly timer: {
    readonly status: "ready" | "finished";
    readonly elapsedMs: number;
  };
}

/**
 * A running clock is saved as paused at `now`, so a reload waits on READY
 * (DESIGN.md 16.3) and the time spent away is not counted.
 */
export function serializeGame(game: CurrentGame, now: number): SavedGame {
  const { puzzle, attempt, board } = game;
  const timer = pauseTimer(game.timer, now) as SavedGame["timer"];
  return {
    version: 1,
    puzzle: {
      seedCode: encodeSeedCode({
        version: puzzle.generatorVersion,
        difficulty: puzzle.difficulty,
        seed: puzzle.seed,
      }),
      generatorVersion: puzzle.generatorVersion,
      difficulty: puzzle.difficulty,
      size: puzzle.size,
      clues: puzzle.clues,
      solution: puzzle.solution,
    },
    lines: edgesWithState(board.states, LINE),
    crosses: edgesWithState(board.states, CROSS),
    undo: board.undo.map(saveMove),
    redo: board.redo.map(saveMove),
    timer: { status: timer.status, elapsedMs: timer.elapsedMs },
    ...attempt,
  };
}

function saveMove(move: Move): SavedChange[] {
  return move.map((change) => [change.edge, change.before, change.after]);
}

// --- reading ----------------------------------------------------------------

function isEdgeState(value: unknown): value is EdgeState {
  return value === UNKNOWN || value === LINE || value === CROSS;
}

function isEdgeList(
  value: unknown,
  geometry: BoardGeometry,
): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (edge, i) =>
        isCount(edge) &&
        edge < geometry.edgeCount &&
        (i === 0 || edge > value[i - 1]),
    )
  );
}

function parsePuzzle(value: unknown): Puzzle | undefined {
  if (!isRecord(value)) return undefined;
  const { seedCode, generatorVersion, difficulty, size, clues, solution } =
    value;
  if (typeof seedCode !== "string") return undefined;
  const code = parseSeedCode(seedCode);
  if (
    !code ||
    code.version !== generatorVersion ||
    code.difficulty !== difficulty ||
    !hasValidClues(size, clues)
  ) {
    return undefined;
  }
  const puzzle = {
    generatorVersion: code.version,
    difficulty: code.difficulty,
    seed: code.seed,
    size,
    clues,
  } as Omit<Puzzle, "solution">;
  const geometry = boardGeometry(puzzle.size);
  // The saved answer must still be a loop that fits the clues.
  if (
    !isEdgeList(solution, geometry) ||
    !isSolved(geometry, puzzle.clues, statesFromLines(geometry, solution))
  ) {
    return undefined;
  }
  return { ...puzzle, solution };
}

function parseMove(value: unknown, edgeCount: number): Move | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const move: EdgeChange[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return undefined;
    const [edge, before, after] = item as unknown[];
    if (
      !isCount(edge) ||
      edge >= edgeCount ||
      seen.has(edge) ||
      !isEdgeState(before) ||
      !isEdgeState(after) ||
      before === after
    ) {
      return undefined;
    }
    seen.add(edge);
    move.push({ edge, before, after });
  }
  return move;
}

function parseMoves(value: unknown, edgeCount: number): Move[] | undefined {
  if (!Array.isArray(value) || value.length > HISTORY_LIMIT) return undefined;
  const moves: Move[] = [];
  for (const item of value) {
    const move = parseMove(item, edgeCount);
    if (!move) return undefined;
    moves.push(move);
  }
  return moves;
}

/**
 * Whether the history leads to the saved marks: walking back the undo
 * moves and forward the redo moves must find each edge as the move says.
 * A history that does not fit would undo into a board that never was.
 */
function historyFits(board: PlayBoard): boolean {
  return (
    replays(board.states, board.undo, "after", "before") &&
    replays(board.states, board.redo, "before", "after")
  );
}

/** Applies the moves from the last one back, checking each edge on the way. */
function replays(
  current: EdgeStates,
  moves: readonly Move[],
  from: "before" | "after",
  to: "before" | "after",
): boolean {
  const states = Uint8Array.from(current);
  for (let i = moves.length - 1; i >= 0; i -= 1) {
    for (const change of moves[i]) {
      if (states[change.edge] !== change[from]) return false;
      states[change.edge] = change[to];
    }
  }
  return true;
}

function parseTimer(value: unknown): PlayTimer | undefined {
  if (!isRecord(value)) return undefined;
  const { status, elapsedMs } = value;
  if ((status !== "ready" && status !== "finished") || !isCount(elapsedMs)) {
    return undefined;
  }
  return { status, elapsedMs };
}

export function parseGame(value: unknown): CurrentGame | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const puzzle = parsePuzzle(value.puzzle);
  const attempt = parseAttempt(value);
  const timer = parseTimer(value.timer);
  if (!puzzle || !attempt || !timer) return undefined;
  const geometry = boardGeometry(puzzle.size);
  const { lines, crosses } = value;
  if (!isEdgeList(lines, geometry) || !isEdgeList(crosses, geometry)) {
    return undefined;
  }
  if (lines.some((edge) => crosses.includes(edge))) return undefined;
  const undo = parseMoves(value.undo, geometry.edgeCount);
  const redo = parseMoves(value.redo, geometry.edgeCount);
  if (!undo || !redo) return undefined;
  const board: PlayBoard = {
    states: statesFromLines(geometry, lines, crosses),
    undo,
    redo,
  };
  if (!historyFits(board)) return undefined;
  // The clock stops exactly when the loop closes.
  const solved = isSolved(geometry, puzzle.clues, board.states);
  if (solved !== (timer.status === "finished")) return undefined;
  return { puzzle, attempt, board, timer };
}

export function loadCurrentGame(
  storage: KeyValueStorage,
): CurrentGame | undefined {
  return readJson(storage, CURRENT_GAME_KEY, parseGame);
}

export function saveCurrentGame(
  storage: KeyValueStorage,
  game: CurrentGame,
  now: number,
): boolean {
  return writeJson(storage, CURRENT_GAME_KEY, serializeGame(game, now));
}
