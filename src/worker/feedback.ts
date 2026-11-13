import type { FeedbackUpload } from "../core/feedback";

/** Feedback an ID may send in an hour (as pujan). */
export const FEEDBACK_PER_HOUR = 5;

/**
 * Stores one feedback; false when the ID is over the limit. The count and
 * the insert are one statement, so concurrent sends cannot pass it.
 */
export async function saveFeedback(
  db: D1Database,
  accountId: string,
  feedback: FeedbackUpload,
  now: number,
): Promise<boolean> {
  const { body, context } = feedback;
  const result = await db
    .prepare(
      `INSERT INTO feedback
       (account_id, created_at, body, source, play_id, seed_code, difficulty,
        cleared, elapsed_seconds, hints_used, max_assist, app_version)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM feedback
              WHERE account_id = ? AND created_at > ?) < ?`,
    )
    .bind(
      accountId,
      now,
      body,
      context.from,
      context.playId,
      context.seedCode,
      context.difficulty,
      context.cleared ? 1 : 0,
      context.elapsedSeconds,
      context.hintsUsed,
      context.maxAssist,
      context.appVersion,
      accountId,
      now - 3_600_000,
      FEEDBACK_PER_HOUR,
    )
    .run();
  return result.meta.changes > 0;
}
