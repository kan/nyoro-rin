import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import type { HintStage } from "../core/attempt";
import type { Difficulty } from "../core/model";
import type { CompletedPlayUpload, OnlinePlay } from "../core/online-play";
import type { AssistLevel } from "../core/settings";

export type SaveOutcome = "created" | "duplicate" | "conflict";

/**
 * How far a device clock may lag the server's and still rank a clear made
 * right after consent: completed_at comes from the device, consented_at from
 * the server (DATA_CONTRACT.md 「プロフィールと公開」).
 */
export const CONSENT_CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Stores a verified clear in the ID's history, with or without a name. Only a
 * clear made after the ID consented is eligible for the rankings; the
 * publish_first_clear trigger then ranks it if it is the ID's first record of
 * the puzzle. A resend of the same play is a duplicate; a different play
 * under the same playId is a conflict and changes nothing.
 */
export async function saveCompletedPlay(
  db: D1Database,
  accountId: string,
  play: CompletedPlayUpload,
): Promise<SaveOutcome> {
  const inserted = await db
    .prepare(
      `INSERT INTO completed_plays
       (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty,
        started_at, completed_at, elapsed_seconds, hints_used, max_hint_stage,
        max_assist, reveals, ranking_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         EXISTS (SELECT 1 FROM profiles
           WHERE account_id = ? AND consent_version = ${RANKING_CONSENT_VERSION}
             AND consented_at <= ?))
       ON CONFLICT(account_id, play_id) DO NOTHING`,
    )
    .bind(
      accountId,
      play.playId,
      play.puzzleId,
      play.seedCode,
      play.generatorVersion,
      play.difficulty,
      play.startedAt,
      play.completedAt,
      play.elapsedSeconds,
      play.hintsUsed,
      play.maxHintStage,
      play.maxAssist,
      play.reveals,
      accountId,
      play.completedAt + CONSENT_CLOCK_SKEW_MS,
    )
    .run();
  if (inserted.meta.changes > 0) return "created";
  // Another request stored the same playId in the meantime.
  const outcome = await compareStoredPlay(db, accountId, play);
  if (!outcome) throw new Error("Stored play disappeared after conflict.");
  return outcome;
}

/** New uploads an ID may make in a fixed window of UPLOAD_WINDOW_MS. */
export const UPLOADS_PER_WINDOW = 10;
const UPLOAD_WINDOW_MS = 60_000;

/**
 * Counts one new upload for the ID and says whether it is within the limit.
 * Done before the upload is checked, since the check regenerates the board.
 */
export async function takeUploadSlot(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (account_id, window_start, attempts)
       VALUES (?, ?, 1)
       ON CONFLICT(account_id) DO UPDATE SET
         window_start = IIF(excluded.window_start >= window_start + ${UPLOAD_WINDOW_MS},
           excluded.window_start, window_start),
         attempts = IIF(excluded.window_start >= window_start + ${UPLOAD_WINDOW_MS},
           1, attempts + 1)
       RETURNING attempts`,
    )
    .bind(accountId, now)
    .first<{ attempts: number }>();
  return (row?.attempts ?? 0) <= UPLOADS_PER_WINDOW;
}

/**
 * How an upload compares with what the ID already stored under its playId,
 * or undefined when nothing is stored. Checked before the upload's board is
 * regenerated, so a resend costs no generation.
 */
export async function compareStoredPlay(
  db: D1Database,
  accountId: string,
  play: CompletedPlayUpload,
): Promise<"duplicate" | "conflict" | undefined> {
  const existing = await db
    .prepare(
      `SELECT ${PLAY_COLUMNS} FROM completed_plays WHERE account_id = ? AND play_id = ?`,
    )
    .bind(accountId, play.playId)
    .first<StoredPlay>();
  if (!existing) return undefined;
  return samePlay(toOnlinePlay(existing), play) ? "duplicate" : "conflict";
}

/** The ID's clears, newest first, at most 500. */
export async function listCompletedPlays(
  db: D1Database,
  accountId: string,
): Promise<OnlinePlay[]> {
  const result = await db
    .prepare(
      `SELECT ${PLAY_COLUMNS} FROM completed_plays WHERE account_id = ?
       ORDER BY completed_at DESC, play_id DESC LIMIT 500`,
    )
    .bind(accountId)
    .all<StoredPlay>();
  return result.results.map(toOnlinePlay);
}

const PLAY_COLUMNS = `play_id, puzzle_id, seed_code, generator_version, difficulty,
  started_at, completed_at, elapsed_seconds, hints_used, max_hint_stage,
  max_assist, reveals, is_public`;

interface StoredPlay {
  readonly play_id: string;
  readonly puzzle_id: string;
  readonly seed_code: string;
  readonly generator_version: string;
  readonly difficulty: Difficulty;
  readonly started_at: number;
  readonly completed_at: number;
  readonly elapsed_seconds: number;
  readonly hints_used: number;
  readonly max_hint_stage: HintStage;
  readonly max_assist: AssistLevel;
  readonly reveals: number;
  readonly is_public: number;
}

function toOnlinePlay(row: StoredPlay): OnlinePlay {
  return {
    playId: row.play_id,
    puzzleId: row.puzzle_id,
    seedCode: row.seed_code,
    generatorVersion: row.generator_version,
    difficulty: row.difficulty,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    maxHintStage: row.max_hint_stage,
    maxAssist: row.max_assist,
    reveals: row.reveals,
    isPublic: row.is_public === 1,
  };
}

/** The loop is not stored: a play that passed the check had the solution. */
function samePlay(stored: OnlinePlay, play: CompletedPlayUpload): boolean {
  return (
    stored.puzzleId === play.puzzleId &&
    stored.seedCode === play.seedCode &&
    stored.generatorVersion === play.generatorVersion &&
    stored.difficulty === play.difficulty &&
    stored.startedAt === play.startedAt &&
    stored.completedAt === play.completedAt &&
    stored.elapsedSeconds === play.elapsedSeconds &&
    stored.hintsUsed === play.hintsUsed &&
    stored.maxHintStage === play.maxHintStage &&
    stored.maxAssist === play.maxAssist &&
    stored.reveals === play.reveals
  );
}
