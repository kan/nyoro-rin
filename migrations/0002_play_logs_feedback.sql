-- The play logs and the feedback (DATA_CONTRACT.md 「プレイログ」「感想」),
-- read only by the developer (scripts/stats.ts). Both go with withdrawal
-- (src/worker/accounts.ts).

-- One attempt's log: the events as sent, and counts made from them when they
-- arrived (src/core/play-log.ts summarizePlayLog), so that plain SQL can
-- answer most questions without replaying.
CREATE TABLE play_logs (
  account_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  seed_code TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  outcome TEXT NOT NULL CHECK (outcome IN ('cleared', 'abandoned')),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  ended_at INTEGER NOT NULL CHECK (ended_at >= started_at),
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  hints_used INTEGER NOT NULL CHECK (hints_used >= 0),
  max_hint_stage INTEGER NOT NULL CHECK (max_hint_stage BETWEEN 0 AND 3),
  max_assist INTEGER NOT NULL CHECK (max_assist BETWEEN 0 AND 2),
  reveals INTEGER NOT NULL CHECK (reveals >= 0),
  moves INTEGER NOT NULL,
  undos INTEGER NOT NULL,
  resets INTEGER NOT NULL,
  hint_steps INTEGER NOT NULL,
  pauses INTEGER NOT NULL,
  longest_gap_ms INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  -- JSON: the events of src/core/play-log.ts.
  events TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, play_id)
);

CREATE INDEX play_logs_account_received ON play_logs (account_id, received_at);
CREATE INDEX play_logs_received ON play_logs (received_at);

-- Free text from the menu or the clear card, with what the game was showing.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('menu', 'clear')),
  play_id TEXT,
  seed_code TEXT,
  difficulty TEXT CHECK (difficulty IS NULL OR difficulty IN ('easy', 'normal', 'hard')),
  cleared INTEGER NOT NULL CHECK (cleared IN (0, 1)),
  elapsed_seconds INTEGER NOT NULL,
  hints_used INTEGER NOT NULL,
  max_assist INTEGER CHECK (max_assist IS NULL OR max_assist BETWEEN 0 AND 2),
  app_version TEXT NOT NULL
);

CREATE INDEX feedback_account_created ON feedback (account_id, created_at);
CREATE INDEX feedback_created ON feedback (created_at);
