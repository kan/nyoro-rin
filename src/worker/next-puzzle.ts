import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import { CURRENT_GENERATOR_VERSION } from "../core/generator";
import type { Difficulty } from "../core/model";
import {
  MAX_CANDIDATES,
  type RankedPuzzleCandidate,
} from "../core/next-puzzle";

/**
 * Boards of the difficulty with other players' public first records
 * (is_public, set by the trigger only on a consented first clear), that the
 * account has never completed, most players first. Only the current
 * generator's boards: older ones keep their rankings but would crowd out
 * every new board. Nothing about the players leaves: only the count.
 */
export const NEXT_PUZZLE_SQL = `SELECT c.puzzle_id AS puzzleId, MIN(c.seed_code) AS seedCode,
       COUNT(*) AS players
     FROM completed_plays c
     JOIN profiles p ON p.account_id = c.account_id
     WHERE c.is_public = 1 AND c.difficulty = ? AND c.generator_version = ?
       AND p.consent_version = ${RANKING_CONSENT_VERSION}
       AND NOT EXISTS (
         SELECT 1 FROM completed_plays own
         WHERE own.account_id = ? AND own.puzzle_id = c.puzzle_id
       )
     GROUP BY c.puzzle_id
     ORDER BY players DESC, RANDOM()
     LIMIT ${MAX_CANDIDATES}`;

export async function listNextPuzzleCandidates(
  db: D1Database,
  accountId: string,
  difficulty: Difficulty,
): Promise<RankedPuzzleCandidate[]> {
  const result = await db
    .prepare(NEXT_PUZZLE_SQL)
    .bind(difficulty, CURRENT_GENERATOR_VERSION, accountId)
    .all<RankedPuzzleCandidate>();
  return result.results.map(({ puzzleId, seedCode, players }) => ({
    puzzleId,
    seedCode,
    players,
  }));
}
