/**
 * The daily challenge (DESIGN.md chapter 25, DATA_CONTRACT.md 「デイリー」):
 * the date, the board as the server hands it out, the records sent and read,
 * and the board in play saved on the device. Generation lives apart in
 * daily-generator.ts: only the server makes daily boards.
 */
import {
  type Attempt,
  type HintStage,
  isCount,
  isPlayId,
  isTimestamp,
  parseAttempt,
} from "./attempt";
import { type CurrentGame, parseGame, serializeGame } from "./current-game";
import type { LeaderboardEntry } from "./leaderboard";
import { DAILY_BOARD_SIZE, type Puzzle, hasValidClues } from "./model";
import { isPuzzleId, puzzleId } from "./puzzle-identity";
import { solveCompletely } from "./solver";
import { boardGeometry } from "./board";
import { DAILY_DIFFICULTY, DAILY_VERSION, isDailyDate } from "./daily-code";
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export * from "./daily-code";

// --- the board as the server hands it out -------------------------------------

/** A daily board without its solution (GET /api/daily). */
export interface DailyBoard {
  readonly date: string;
  readonly puzzleId: string;
  readonly generatorVersion: string;
  readonly size: typeof DAILY_BOARD_SIZE;
  readonly clues: Puzzle["clues"];
}

export type DailyAttemptStatus = "not_started" | "active" | "completed";

/** GET /api/daily: today's board and how far the ID got with it. */
export interface DailyStatus {
  readonly board: DailyBoard;
  readonly attempt: DailyAttemptStatus;
  /** The started attempt's playId; absent before the start. */
  readonly playId?: string;
}

export function parseDailyBoard(value: unknown): DailyBoard | undefined {
  if (!isRecord(value)) return undefined;
  const { date, puzzleId, generatorVersion, size, clues } = value;
  if (
    !isDailyDate(date) ||
    !isPuzzleId(puzzleId) ||
    generatorVersion !== DAILY_VERSION ||
    size !== DAILY_BOARD_SIZE ||
    !hasValidClues(size, clues)
  ) {
    return undefined;
  }
  return {
    date,
    puzzleId,
    generatorVersion,
    size,
    clues: clues as Puzzle["clues"],
  };
}

export function parseDailyStatus(value: unknown): DailyStatus | undefined {
  if (!isRecord(value)) return undefined;
  const board = parseDailyBoard(value.board);
  const { attempt, playId } = value;
  if (
    !board ||
    (attempt !== "not_started" &&
      attempt !== "active" &&
      attempt !== "completed") ||
    (attempt === "not_started" ? playId !== undefined : !isPlayId(playId))
  ) {
    return undefined;
  }
  return attempt === "not_started"
    ? { board, attempt }
    : { board, attempt, playId: playId as string };
}

/**
 * The board to play from the one the server handed out: the solution is
 * worked out here from the clues (the API leaves it out), and the board must
 * have the ID the server named. Undefined for a board that fails either.
 */
export async function dailyPuzzleFromBoard(
  board: DailyBoard,
): Promise<Puzzle | undefined> {
  const result = solveCompletely(boardGeometry(board.size), board.clues);
  if (result.status !== "unique") return undefined;
  const puzzle = dailyPuzzle(board, result.solution!);
  try {
    return (await puzzleId(puzzle)) === board.puzzleId ? puzzle : undefined;
  } catch {
    return undefined;
  }
}

/** The board to play, with the solution worked out from the clues. */
export function dailyPuzzle(
  board: DailyBoard,
  solution: readonly number[],
): Puzzle {
  return {
    generatorVersion: board.generatorVersion,
    difficulty: DAILY_DIFFICULTY,
    seed: board.date,
    size: board.size,
    clues: board.clues,
    solution,
  };
}

// --- completing ----------------------------------------------------------------

/**
 * POST /api/daily/complete. The time and the hints are the device's word;
 * the loop is checked against the stored solution.
 */
export interface DailyCompletionUpload extends Attempt {
  readonly date: string;
  readonly puzzleId: string;
  readonly elapsedSeconds: number;
  /** The edges of the loop, ascending. */
  readonly loop: readonly number[];
}

export function parseDailyCompletionUpload(
  value: unknown,
): DailyCompletionUpload | undefined {
  if (!isRecord(value)) return undefined;
  const attempt = parseAttempt(value);
  const { date, puzzleId, elapsedSeconds, loop } = value;
  if (
    !attempt ||
    // As for an ordinary clear: no hint, no hint stage.
    (attempt.hintsUsed === 0) !== (attempt.maxHintStage === 0) ||
    !isDailyDate(date) ||
    !isPuzzleId(puzzleId) ||
    !isCount(elapsedSeconds) ||
    !Array.isArray(loop) ||
    loop.length > 2 * DAILY_BOARD_SIZE * (DAILY_BOARD_SIZE + 1) ||
    !loop.every(
      (edge, i) => isCount(edge) && (i === 0 || edge > (loop[i - 1] as number)),
    )
  ) {
    return undefined;
  }
  return {
    ...attempt,
    date,
    puzzleId,
    elapsedSeconds,
    loop: loop as number[],
  };
}

// --- reading the records ------------------------------------------------------------

/** One day of the ID's history (GET /api/daily/history). */
export interface DailyHistoryEntry {
  readonly playId: string;
  readonly date: string;
  readonly startedAt: number;
  /** Null for a challenge started and not finished. */
  readonly completedAt: number | null;
  readonly elapsedSeconds: number | null;
  readonly hintsUsed: number | null;
  readonly maxHintStage: HintStage | null;
  readonly maxAssist: number | null;
}

export function parseDailyHistory(
  value: unknown,
): readonly DailyHistoryEntry[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.plays)) return undefined;
  const plays: DailyHistoryEntry[] = [];
  for (const item of value.plays) {
    if (!isRecord(item)) return undefined;
    const { playId, date, startedAt, completedAt } = item;
    if (
      !isPlayId(playId) ||
      !isDailyDate(date) ||
      !isTimestamp(startedAt) ||
      (completedAt !== null && !isTimestamp(completedAt))
    ) {
      return undefined;
    }
    plays.push(item as unknown as DailyHistoryEntry);
  }
  return plays;
}

/** GET /api/daily/ranking: a day's top 100, and the viewer's row below it. */
export interface DailyRanking {
  readonly date: string;
  readonly entries: readonly LeaderboardEntry[];
}

// --- the board in play, on this device ----------------------------------------------

/**
 * Where the daily boards in play are kept, apart from the ordinary board
 * (current-game.ts): one per ID and date, never synced between devices.
 */
export const DAILY_GAMES_KEY = "nyoro-rin.daily-games.v1";

/**
 * Boards kept, over all IDs on the device, newest days first. Only today
 * and yesterday can be completed (isCompletableDailyDate), but the server's
 * clock decides that, not the device's: a count, not a date, drops the old.
 */
const DAILY_GAMES_LIMIT = 7;

interface SavedDailyGame {
  readonly account: string;
  readonly date: string;
  readonly game: unknown;
}

function parseSavedDailyGames(value: unknown): SavedDailyGame[] | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.games)) {
    return undefined;
  }
  return value.games.filter(
    (item): item is SavedDailyGame =>
      isRecord(item) &&
      typeof item.account === "string" &&
      isDailyDate(item.date),
  );
}

function loadSavedDailyGames(storage: KeyValueStorage): SavedDailyGame[] {
  return readJson(storage, DAILY_GAMES_KEY, parseSavedDailyGames) ?? [];
}

/** The ID's daily board of the date, as it was left on this device. */
export function loadDailyGame(
  storage: KeyValueStorage,
  account: string,
  date: string,
): CurrentGame | undefined {
  const saved = loadSavedDailyGames(storage).find(
    (item) => item.account === account && item.date === date,
  );
  if (!saved) return undefined;
  const game = parseGame(saved.game, { daily: true });
  return game && game.puzzle.seed === date ? game : undefined;
}

/**
 * Saves the ID's daily board of the date. The newest days are kept; an older
 * one cannot be completed any more anyway.
 */
export function saveDailyGame(
  storage: KeyValueStorage,
  account: string,
  date: string,
  game: CurrentGame,
  now: number,
): boolean {
  const others = loadSavedDailyGames(storage).filter(
    (item) => !(item.account === account && item.date === date),
  );
  const games = [{ account, date, game: serializeGame(game, now) }, ...others]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, DAILY_GAMES_LIMIT);
  return writeJson(storage, DAILY_GAMES_KEY, { version: 1, games });
}
