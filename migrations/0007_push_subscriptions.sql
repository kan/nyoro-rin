-- The daily notice's Web Push subscriptions (DESIGN.md 25.8,
-- kan/nyoro-rin#8), one per device: a device that switches its ID moves its
-- subscription along. As TAKO-SEN's 0015_push_subscriptions.sql.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_p256dh TEXT NOT NULL,
  key_auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_account ON push_subscriptions (account_id);
