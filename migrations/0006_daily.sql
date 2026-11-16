-- The daily challenge (DESIGN.md chapter 25, DATA_CONTRACT.md 「デイリー」).

-- One board per date in Japan, fixed once made: the scheduled run makes the
-- next day's, and a day it missed is made by that day's first request. The
-- solution stays here; the API hands out the clues only.
CREATE TABLE daily_puzzles (
  challenge_date TEXT PRIMARY KEY,
  generator_version TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  clues_json TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One challenge per ID and date, started when READY's OK is pressed. The
-- primary key keeps another device or a reload from starting a second one.
-- The time, hints and assist are the device's word; the loop was checked.
CREATE TABLE daily_attempts (
  account_id TEXT NOT NULL,
  challenge_date TEXT NOT NULL,
  play_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  elapsed_seconds INTEGER CHECK (elapsed_seconds >= 0),
  hints_used INTEGER CHECK (hints_used >= 0),
  max_hint_stage INTEGER CHECK (max_hint_stage BETWEEN 0 AND 3),
  max_assist INTEGER CHECK (max_assist BETWEEN 0 AND 2),
  reveals INTEGER CHECK (reveals >= 0),
  PRIMARY KEY (account_id, challenge_date),
  UNIQUE (account_id, play_id),
  FOREIGN KEY (challenge_date) REFERENCES daily_puzzles(challenge_date),
  -- Completed means every record of the result is there.
  CHECK ((completed_at IS NULL) = (elapsed_seconds IS NULL)),
  CHECK ((completed_at IS NULL) = (hints_used IS NULL)),
  CHECK ((completed_at IS NULL) = (max_hint_stage IS NULL)),
  CHECK ((completed_at IS NULL) = (max_assist IS NULL)),
  CHECK ((completed_at IS NULL) = (reveals IS NULL))
);

-- A day's ranking reads its completed challenges.
CREATE INDEX daily_attempts_ranking
  ON daily_attempts (challenge_date, completed_at);
