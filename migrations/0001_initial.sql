-- The tables of DATA_CONTRACT.md 「D1」. TAKO-SEN reached the same shape over
-- several migrations (its 0001, 0003, 0004, 0005, 0008, 0013 and 0014); here
-- it starts in one.

-- Every verified clear of an ID, with or without a name. Only a clear made
-- after consent is eligible for the rankings (ranking_eligible), and only the
-- first record of a puzzle is shown there (is_public, set by the trigger).
CREATE TABLE completed_plays (
  account_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  seed_code TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at >= started_at),
  elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
  hints_used INTEGER NOT NULL CHECK (hints_used >= 0),
  max_hint_stage INTEGER NOT NULL CHECK (
    max_hint_stage BETWEEN 0 AND 3 AND
    ((hints_used = 0 AND max_hint_stage = 0) OR (hints_used > 0 AND max_hint_stage > 0))
  ),
  max_assist INTEGER NOT NULL CHECK (max_assist BETWEEN 0 AND 2),
  reveals INTEGER NOT NULL CHECK (reveals >= 0 AND reveals <= hints_used),
  ranking_eligible INTEGER NOT NULL DEFAULT 0 CHECK (ranking_eligible IN (0, 1)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  PRIMARY KEY (account_id, play_id)
);

CREATE INDEX completed_plays_account_completed
  ON completed_plays (account_id, completed_at DESC);

CREATE INDEX completed_plays_account_puzzle
  ON completed_plays (account_id, puzzle_id);

CREATE INDEX completed_plays_public_puzzle
  ON completed_plays (puzzle_id, elapsed_seconds, hints_used)
  WHERE is_public = 1;

-- The kan-game.app name of an ID, copied here with NYORO-RIN's own consent.
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  consent_version INTEGER,
  consented_at INTEGER
);

-- The first ranked clear of each puzzle by each ID.
CREATE TABLE first_ranked_plays (
  account_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  PRIMARY KEY (account_id, puzzle_id),
  FOREIGN KEY (account_id, play_id) REFERENCES completed_plays(account_id, play_id)
    ON DELETE CASCADE
);

CREATE INDEX first_ranked_plays_puzzle
  ON first_ranked_plays (puzzle_id, account_id, play_id);

-- IDs withdrawn from kan-game.app. Their cookies stay valid for up to 400
-- days, so requests carrying them are refused (src/worker/auth.ts).
CREATE TABLE deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

-- The upload limit of completed plays: 10 in a fixed 60-second window. The
-- Worker counts each new upload before checking it (src/worker/history.ts
-- takeUploadSlot), so even uploads that fail the check are limited: the
-- check regenerates the board, which costs CPU. A resend of a stored play is
-- answered from the table and not counted.
CREATE TABLE rate_limits (
  account_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

-- Runs in the same transaction as the insertion, including concurrent
-- uploads. Any earlier record of the puzzle, ranked or not, rules it out: a
-- puzzle solved once before consent is never ranked.
CREATE TRIGGER publish_first_clear AFTER INSERT ON completed_plays
WHEN NEW.ranking_eligible = 1
BEGIN
  INSERT INTO first_ranked_plays (account_id, puzzle_id, play_id)
    SELECT NEW.account_id, NEW.puzzle_id, NEW.play_id
    WHERE NOT EXISTS (
      SELECT 1 FROM completed_plays
      WHERE account_id = NEW.account_id AND puzzle_id = NEW.puzzle_id
        AND play_id <> NEW.play_id
    )
    ON CONFLICT(account_id, puzzle_id) DO NOTHING;
  UPDATE completed_plays SET is_public = 1
    WHERE account_id = NEW.account_id AND play_id = NEW.play_id
      AND EXISTS (SELECT 1 FROM first_ranked_plays
        WHERE account_id = NEW.account_id AND puzzle_id = NEW.puzzle_id
          AND play_id = NEW.play_id);
END;
