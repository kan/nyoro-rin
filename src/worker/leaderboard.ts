import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import type { HintStage } from "../core/attempt";
import type { LeaderboardEntry } from "../core/leaderboard";
import { NO_HINT_BONUS, SPEED_POINTS } from "../core/results";
import type { AssistLevel } from "../core/settings";

/**
 * The score of DESIGN.md 16.2 in SQL, matching src/core/results.ts `score`.
 * The columns are integers, so the division truncates like Math.floor.
 */
export const SCORE_SQL = `(${SPEED_POINTS} / MAX(1, c.elapsed_seconds) + CASE WHEN c.hints_used = 0 THEN ${NO_HINT_BONUS} ELSE 0 END)`;

/**
 * The puzzle's ranking: each ID's first ranked clear (the trigger marks only
 * those public), best score first, then time and hints; ties share a rank.
 */
export const LEADERBOARD_SQL = `SELECT p.display_name, c.account_id, c.elapsed_seconds, c.hints_used,
       c.max_hint_stage, c.max_assist,
       RANK() OVER (ORDER BY ${SCORE_SQL} DESC, c.elapsed_seconds, c.hints_used) AS rank
     FROM completed_plays c
     JOIN profiles p ON p.account_id = c.account_id
     WHERE c.puzzle_id = ? AND p.consent_version = ${RANKING_CONSENT_VERSION}
       AND c.is_public = 1
     ORDER BY rank, p.display_name LIMIT 100`;

export async function listLeaderboard(
  db: D1Database,
  puzzleId: string,
  viewer?: string,
): Promise<LeaderboardEntry[]> {
  const result = await db.prepare(LEADERBOARD_SQL).bind(puzzleId).all<{
    rank: number;
    display_name: string;
    account_id: string;
    elapsed_seconds: number;
    hints_used: number;
    max_hint_stage: HintStage;
    max_assist: AssistLevel;
  }>();
  // The account ID is read only to mark the viewer's row; it never leaves.
  return result.results.map((row) => ({
    rank: row.rank,
    displayName: row.display_name,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    maxHintStage: row.max_hint_stage,
    maxAssist: row.max_assist,
    isSelf: viewer !== undefined && row.account_id === viewer,
  }));
}
