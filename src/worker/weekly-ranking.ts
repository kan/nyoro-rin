import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import type { Difficulty } from "../core/model";
import type { AssistLevel } from "../core/settings";
import {
  WEEKLY_RANKING_LIMIT,
  WEEKLY_SCORE_MIN_CLEARS,
  type WeeklyMetric,
  type WeeklyRanking,
  rankingWeekOf,
} from "../core/weekly-ranking";
import { ORDINARY_VERSIONS_SQL, SCORE_SQL } from "./leaderboard";

const ORDERING: Readonly<Record<WeeklyMetric, string>> = {
  clears: "clears DESC",
  score: "average_score DESC",
};

/**
 * The week's ranking of a difficulty (DATA_CONTRACT.md 「週間ランキング」).
 * Every clear made after consent counts (ranking_eligible), not only the
 * first record of a puzzle (is_public): a puzzle cleared in an earlier week
 * counts again. Within the week, each ID's puzzle counts once, by its
 * earliest clear, so a faster replay cannot lift the average. Equal values
 * share a rank, listed by name.
 *
 * ?1 difficulty, ?2 week start, ?3 week end, ?4 now: a clear dated in the
 * future (its time is the device's) does not count before it happens. A
 * puzzle has one difficulty, so filtering it before numbering the attempts
 * leaves them the same, over the one difficulty's rows only.
 */
export function weeklyRankingSql(metric: WeeklyMetric): string {
  return `WITH trials AS (
    SELECT c.account_id, c.max_assist, ${SCORE_SQL} AS score,
      ROW_NUMBER() OVER (PARTITION BY c.account_id, c.puzzle_id
        ORDER BY c.completed_at, c.play_id) AS attempt
    FROM completed_plays c
    WHERE c.ranking_eligible = 1 AND c.difficulty = ?1
      AND c.completed_at >= ?2 AND c.completed_at < ?3 AND c.completed_at <= ?4
      AND c.generator_version IN (${ORDINARY_VERSIONS_SQL})
  ), totals AS (
    SELECT account_id, COUNT(*) AS clears, AVG(score) AS average_score,
      MAX(max_assist) AS max_assist
    FROM trials WHERE attempt = 1 GROUP BY account_id
    ${metric === "score" ? `HAVING COUNT(*) >= ${WEEKLY_SCORE_MIN_CLEARS}` : ""}
  )
  SELECT t.account_id, p.display_name, t.clears, t.average_score, t.max_assist,
    RANK() OVER (ORDER BY ${ORDERING[metric]}) AS rank
  FROM totals t JOIN profiles p ON p.account_id = t.account_id
  WHERE p.consent_version = ${RANKING_CONSENT_VERSION}
  ORDER BY rank, p.display_name LIMIT ${WEEKLY_RANKING_LIMIT}`;
}

export async function listWeeklyRanking(
  db: D1Database,
  difficulty: Difficulty,
  metric: WeeklyMetric,
  viewer?: string,
  now = Date.now(),
): Promise<WeeklyRanking> {
  const week = rankingWeekOf(now);
  const result = await db
    .prepare(weeklyRankingSql(metric))
    .bind(difficulty, week.start, week.end, now)
    .all<{
      account_id: string;
      display_name: string;
      clears: number;
      average_score: number;
      max_assist: AssistLevel;
      rank: number;
    }>();
  // The account ID is read only to mark the viewer's row; it never leaves.
  return {
    ...week,
    entries: result.results.map((row) => ({
      rank: row.rank,
      displayName: row.display_name,
      clears: row.clears,
      averageScore: row.average_score,
      maxAssist: row.max_assist,
      isSelf: viewer !== undefined && row.account_id === viewer,
    })),
  };
}
