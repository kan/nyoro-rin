-- GET /api/weekly-ranking (src/worker/weekly-ranking.ts): this week's clears
-- made after consent, with every column the count reads, so the week is
-- summed from the index alone. Only an index: no record changes.
CREATE INDEX completed_plays_weekly_eligible
  ON completed_plays (completed_at, account_id, puzzle_id, play_id, difficulty,
    elapsed_seconds, hints_used, max_assist, generator_version)
  WHERE ranking_eligible = 1;
