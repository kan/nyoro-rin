import { type PlayLogUpload, summarizePlayLog } from "../core/play-log";

/** New logs an ID may send in an hour; a resend does not count. */
export const PLAY_LOGS_PER_HOUR = 60;

export type PlayLogOutcome = "created" | "duplicate" | "rate_limited";

/**
 * Stores a play log. The count and the insert are one statement, so
 * concurrent sends cannot pass the limit (pujan's feedback does the same).
 * The board is not regenerated here: the log is for reading, not for
 * ranking, and the reader (scripts/stats.ts) checks it against the board.
 */
export async function savePlayLog(
  db: D1Database,
  accountId: string,
  log: PlayLogUpload,
  now: number,
): Promise<PlayLogOutcome> {
  const summary = summarizePlayLog(log.events);
  const inserted = await db
    .prepare(
      `INSERT INTO play_logs
       (account_id, play_id, seed_code, generator_version, difficulty, outcome,
        started_at, ended_at, elapsed_ms, hints_used, max_hint_stage, max_assist,
        reveals, moves, undos, resets, hint_steps, pauses, longest_gap_ms,
        app_version, truncated, events, received_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM play_logs
              WHERE account_id = ? AND received_at > ?) < ?
       ON CONFLICT(account_id, play_id) DO NOTHING`,
    )
    .bind(
      accountId,
      log.playId,
      log.seedCode,
      log.generatorVersion,
      log.difficulty,
      log.outcome,
      log.startedAt,
      log.endedAt,
      log.elapsedMs,
      log.hintsUsed,
      log.maxHintStage,
      log.maxAssist,
      log.reveals,
      summary.moves,
      summary.undos,
      summary.resets,
      summary.hintSteps,
      summary.pauses,
      summary.longestGapMs,
      log.appVersion,
      log.truncated ? 1 : 0,
      JSON.stringify(log.events),
      now,
      accountId,
      now - 3_600_000,
      PLAY_LOGS_PER_HOUR,
    )
    .run();
  if (inserted.meta.changes > 0) return "created";
  const existing = await db
    .prepare("SELECT 1 FROM play_logs WHERE account_id = ? AND play_id = ?")
    .bind(accountId, log.playId)
    .first();
  return existing ? "duplicate" : "rate_limited";
}
