-- GET /api/next-puzzle (src/worker/next-puzzle.ts): the public first
-- records of a difficulty and version, grouped by puzzle.
CREATE INDEX completed_plays_public_difficulty
  ON completed_plays (difficulty, generator_version, puzzle_id)
  WHERE is_public = 1;
