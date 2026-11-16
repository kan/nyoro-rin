-- Unlocked achievements (DESIGN.md 20.4, DATA_CONTRACT.md 「実績」). They are
-- judged from the records every time, so only the unlock and its time are
-- kept, never the progress. Only a new table: the Worker before it runs on
-- unchanged. Withdrawal deletes the rows (src/worker/accounts.ts
-- ACCOUNT_TABLES).
CREATE TABLE achievements (
  account_id TEXT NOT NULL,
  achievement_type TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL CHECK (unlocked_at >= 0),
  PRIMARY KEY (account_id, achievement_type)
);
