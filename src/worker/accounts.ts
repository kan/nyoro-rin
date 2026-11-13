/**
 * Withdrawal from kan-game.app (DATA_CONTRACT.md 「退会」). The ID is recorded
 * as deleted in the same transaction as its records go, and src/worker/auth.ts
 * refuses its cookie from then on. A request checked just before can still
 * write once; sweepDeletedAccounts removes that later.
 */

/**
 * The tables that hold an account's records. first_ranked_plays goes first:
 * it refers to completed_plays.
 */
export const ACCOUNT_TABLES = [
  "first_ranked_plays",
  "completed_plays",
  "profiles",
  "rate_limits",
  "play_logs",
  "feedback",
] as const;

export async function deleteAccount(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?)
         ON CONFLICT(account_id) DO NOTHING`,
      )
      .bind(accountId, Date.now()),
    ...ACCOUNT_TABLES.map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).bind(accountId),
    ),
  ]);
}

/** Deletes any record of a deleted ID again (the daily scheduled run). */
export async function sweepDeletedAccounts(db: D1Database): Promise<void> {
  await db.batch(
    ACCOUNT_TABLES.map((table) =>
      db.prepare(
        `DELETE FROM ${table}
         WHERE account_id IN (SELECT account_id FROM deleted_accounts)`,
      ),
    ),
  );
}
