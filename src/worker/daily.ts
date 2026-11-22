/**
 * The daily challenge on the server (DATA_CONTRACT.md 「デイリー」): the board
 * of each date fixed in D1, the one challenge per ID and date, its check, the
 * day's ranking and the ID's history. The board is made by the core
 * (src/core/daily-generator.ts) and checked against the stored solution.
 */
import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import type { HintStage } from "../core/attempt";
import {
  type DailyAttemptStatus,
  type DailyBoard,
  type DailyCompletionUpload,
  type DailyHistoryEntry,
  type DailyStatus,
  DAILY_VERSION,
  dailyDate,
  isCompletableDailyDate,
  nextDailyDate,
} from "../core/daily";
import { dailySeed, generateDailyPuzzle } from "../core/daily-generator";
import type { LeaderboardEntry } from "../core/leaderboard";
import { DAILY_BOARD_SIZE } from "../core/model";
import { puzzleId } from "../core/puzzle-identity";
import type { AssistLevel } from "../core/settings";
import { SCORE_SQL } from "./leaderboard";

interface AttemptRow {
  readonly play_id: string;
  readonly completed_at: number | null;
}

/** The ID's challenge of the date, if one was started. */
async function readAttempt(
  db: D1Database,
  accountId: string,
  date: string,
): Promise<AttemptRow | undefined> {
  const row = await db
    .prepare(
      `SELECT play_id, completed_at FROM daily_attempts
       WHERE account_id = ? AND challenge_date = ?`,
    )
    .bind(accountId, date)
    .first<AttemptRow>();
  return row ?? undefined;
}

/**
 * The fewest seconds a 10 × 10 hard board takes without hints. The loop the
 * device sends is the solution it worked out from the clues, and the time
 * is its own count, so the server cannot see the play itself: the floor
 * keeps out a time no one can play, sent straight to the API.
 *
 * A completion with hints is not held to it: lines shown one after another
 * can close the loop fast, and such a one has no no-hint bonus to rank
 * high with. There is no ceiling: a longer time only lowers the score, and
 * the device's clock may jump ahead of the server's.
 */
export const DAILY_MIN_ELAPSED_SECONDS = 30;

interface StoredBoard {
  readonly board: DailyBoard;
  readonly solution: readonly number[];
}

async function readBoard(
  db: D1Database,
  date: string,
): Promise<StoredBoard | undefined> {
  const row = await db
    .prepare(
      `SELECT generator_version, puzzle_id, clues_json, solution_json
       FROM daily_puzzles WHERE challenge_date = ?`,
    )
    .bind(date)
    .first<{
      generator_version: string;
      puzzle_id: string;
      clues_json: string;
      solution_json: string;
    }>();
  if (!row) return undefined;
  return {
    board: {
      date,
      puzzleId: row.puzzle_id,
      // The ID covers the version: a board keeps the one it was made with.
      generatorVersion: row.generator_version,
      size: DAILY_BOARD_SIZE,
      clues: JSON.parse(row.clues_json),
    },
    solution: JSON.parse(row.solution_json),
  };
}

/**
 * The date's board, made and stored if it is not yet. Two requests making
 * it at once store one: the first insert wins, and both read it back.
 */
export async function getOrCreateDailyBoard(
  db: D1Database,
  secret: string,
  date: string,
  now: number,
): Promise<StoredBoard> {
  const existing = await readBoard(db, date);
  if (existing) return existing;
  const puzzle = generateDailyPuzzle(await dailySeed(secret, date), date);
  // Checked apart from the generator's own check, with no node budget: a
  // hard 10 × 10 board can need more search than puzzleId's default.
  const id = await puzzleId(puzzle, { nodeLimit: Infinity });
  await db
    .prepare(
      `INSERT INTO daily_puzzles
       (challenge_date, generator_version, puzzle_id, clues_json, solution_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(challenge_date) DO NOTHING`,
    )
    .bind(
      date,
      DAILY_VERSION,
      id,
      JSON.stringify(puzzle.clues),
      JSON.stringify(puzzle.solution),
      now,
    )
    .run();
  const stored = await readBoard(db, date);
  if (!stored) throw new Error("Daily board disappeared after insert.");
  return stored;
}

/**
 * The scheduled run (23:00 in Japan): tomorrow's board, made ahead of its
 * first player. A day this misses is made by that day's first request.
 */
export async function prepareNextDailyBoard(
  db: D1Database,
  secret: string,
  now: number,
): Promise<void> {
  await getOrCreateDailyBoard(db, secret, nextDailyDate(dailyDate(now)), now);
}

/** GET /api/daily: today's board, without its solution, and the ID's state. */
export async function getDailyStatus(
  db: D1Database,
  secret: string,
  accountId: string,
  now: number,
): Promise<DailyStatus> {
  const date = dailyDate(now);
  const { board } = await getOrCreateDailyBoard(db, secret, date, now);
  const attempt = await readAttempt(db, accountId, date);
  if (!attempt) return { board, attempt: "not_started" };
  const status: DailyAttemptStatus =
    attempt.completed_at === null ? "active" : "completed";
  return { board, attempt: status, playId: attempt.play_id };
}

export type StartOutcome =
  /** The challenge began now. */
  | "started"
  /** The same start again (a resend): it stands. */
  | "duplicate"
  /** Another playId started it: another device, or before a reload. */
  | "already_started"
  | "completed"
  /** Not today's date: the day turned before OK was pressed. */
  | "expired";

/**
 * READY's OK: takes the ID's one challenge of the date. The primary key
 * (account, date) keeps a second start from anywhere out.
 */
export async function startDailyAttempt(
  db: D1Database,
  secret: string,
  accountId: string,
  date: string,
  playId: string,
  now: number,
): Promise<StartOutcome> {
  if (date !== dailyDate(now)) return "expired";
  // The attempt refers to the board, which the first request of a day makes.
  await getOrCreateDailyBoard(db, secret, date, now);
  const inserted = await db
    .prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(accountId, date, playId, now)
    .run();
  if (inserted.meta.changes > 0) return "started";
  const existing = await readAttempt(db, accountId, date);
  // The playId was used for another date: refused like another device's.
  if (!existing) return "already_started";
  if (existing.completed_at !== null) return "completed";
  return existing.play_id === playId ? "duplicate" : "already_started";
}

export type CompleteOutcome =
  | "completed"
  /** The same completion again: the first one stands. */
  | "duplicate"
  /** No challenge of this playId on that date. */
  | "not_started"
  /** A date after today, or before yesterday (isCompletableDailyDate). */
  | "expired"
  /** The loop is not the board's solution, or the board is another. */
  | "invalid_solution"
  /** Without hints, a time under DAILY_MIN_ELAPSED_SECONDS. */
  | "invalid_time";

/**
 * Completes a started challenge, once: on the day, or the next day for one
 * started before midnight. Later, the day's ranking stays as it is. The loop
 * must be the stored solution, and the time one that can be played.
 */
export async function completeDailyAttempt(
  db: D1Database,
  accountId: string,
  upload: DailyCompletionUpload,
  now: number,
): Promise<CompleteOutcome> {
  if (!isCompletableDailyDate(upload.date, now)) return "expired";
  const stored = await readBoard(db, upload.date);
  if (
    !stored ||
    stored.board.puzzleId !== upload.puzzleId ||
    stored.solution.length !== upload.loop.length ||
    !stored.solution.every((edge, i) => edge === upload.loop[i])
  ) {
    return "invalid_solution";
  }
  const attempt = await readAttempt(db, accountId, upload.date);
  if (!attempt || attempt.play_id !== upload.playId) return "not_started";
  // A resend is answered before its time is judged: the first one stands.
  if (attempt.completed_at !== null) return "duplicate";
  if (
    upload.hintsUsed === 0 &&
    upload.elapsedSeconds < DAILY_MIN_ELAPSED_SECONDS
  ) {
    return "invalid_time";
  }
  const updated = await db
    .prepare(
      `UPDATE daily_attempts SET completed_at = ?, elapsed_seconds = ?,
         hints_used = ?, max_hint_stage = ?, max_assist = ?, reveals = ?
       WHERE account_id = ? AND challenge_date = ? AND play_id = ?
         AND completed_at IS NULL`,
    )
    .bind(
      now,
      upload.elapsedSeconds,
      upload.hintsUsed,
      upload.maxHintStage,
      upload.maxAssist,
      upload.reveals,
      accountId,
      upload.date,
      upload.playId,
    )
    .run();
  if (updated.meta.changes > 0) return "completed";
  // Not changed: the same completion landed meanwhile (two sends at once),
  // or the challenge went (the account was withdrawn).
  const after = await readAttempt(db, accountId, upload.date);
  return after?.play_id === upload.playId && after.completed_at !== null
    ? "duplicate"
    : "not_started";
}

/** The ranking's rows: the top 100, and the viewer's own row below them. */
export const DAILY_RANKING_LIMIT = 100;

/**
 * A day's ranking: completed challenges of consenting players, by the score
 * of DESIGN.md 16.2, then time and hints; ties share a rank.
 */
export async function listDailyRanking(
  db: D1Database,
  date: string,
  viewer: string,
): Promise<LeaderboardEntry[]> {
  const result = await db
    .prepare(
      `WITH ranked AS (
         SELECT c.account_id, p.display_name, c.elapsed_seconds, c.hints_used,
           c.max_hint_stage, c.max_assist,
           RANK() OVER (ORDER BY ${SCORE_SQL} DESC, c.elapsed_seconds, c.hints_used) AS rank,
           ROW_NUMBER() OVER (ORDER BY ${SCORE_SQL} DESC, c.elapsed_seconds, c.hints_used, p.display_name) AS place
         FROM daily_attempts c JOIN profiles p ON p.account_id = c.account_id
         WHERE c.challenge_date = ? AND c.completed_at IS NOT NULL
           AND p.consent_version = ${RANKING_CONSENT_VERSION}
       )
       SELECT * FROM ranked WHERE place <= ${DAILY_RANKING_LIMIT} OR account_id = ?
       ORDER BY place LIMIT ${DAILY_RANKING_LIMIT + 1}`,
    )
    .bind(date, viewer)
    .all<{
      account_id: string;
      display_name: string;
      elapsed_seconds: number;
      hints_used: number;
      max_hint_stage: HintStage;
      max_assist: AssistLevel;
      rank: number;
    }>();
  // The account ID is read only to mark the viewer's row; it never leaves.
  return result.results.map((row) => ({
    rank: row.rank,
    displayName: row.display_name,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    maxHintStage: row.max_hint_stage,
    maxAssist: row.max_assist,
    isSelf: row.account_id === viewer,
  }));
}

/** The ID's challenges, newest date first; started ones included. */
export const DAILY_HISTORY_LIMIT = 500;

export async function listDailyHistory(
  db: D1Database,
  accountId: string,
): Promise<DailyHistoryEntry[]> {
  const result = await db
    .prepare(
      `SELECT play_id AS playId, challenge_date AS date, started_at AS startedAt,
         completed_at AS completedAt, elapsed_seconds AS elapsedSeconds,
         hints_used AS hintsUsed, max_hint_stage AS maxHintStage,
         max_assist AS maxAssist
       FROM daily_attempts WHERE account_id = ?
       ORDER BY challenge_date DESC LIMIT ${DAILY_HISTORY_LIMIT}`,
    )
    .bind(accountId)
    .all<DailyHistoryEntry>();
  return result.results;
}
