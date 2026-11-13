import {
  RANKING_CONSENT_VERSION,
  type AccountProfile,
} from "../core/account-profile";

/** NYORO-RIN's copy of the ID's name, once it consented here. */
export async function getAccountProfile(
  db: D1Database,
  accountId: string,
): Promise<AccountProfile | null> {
  const row = await db
    .prepare(
      "SELECT display_name FROM profiles WHERE account_id = ? AND consent_version = ?",
    )
    .bind(accountId, RANKING_CONSENT_VERSION)
    .first<{ display_name: string }>();
  return row
    ? { displayName: row.display_name, consentVersion: RANKING_CONSENT_VERSION }
    : null;
}

/** Stores the name the ID platform gave and the consent, at server time. */
export async function registerAccountProfile(
  db: D1Database,
  accountId: string,
  name: string,
): Promise<AccountProfile> {
  // A retry cannot rename a profile or silently alter existing consent.
  await db
    .prepare(
      `INSERT INTO profiles (account_id, display_name, consent_version, consented_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name,
         consent_version = excluded.consent_version, consented_at = excluded.consented_at
       WHERE profiles.consent_version IS NULL`,
    )
    .bind(accountId, name, RANKING_CONSENT_VERSION, Date.now())
    .run();
  const profile = await getAccountProfile(db, accountId);
  if (!profile) throw new Error("Profile not registered.");
  return profile;
}
