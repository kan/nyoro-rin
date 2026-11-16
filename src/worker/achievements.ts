/**
 * Achievements on the server (DESIGN.md 20.4, DATA_CONTRACT.md 「実績」). The
 * account's records are counted again every time; only the unlocks are
 * stored, in `achievements`.
 */
import {
  ACHIEVEMENTS,
  type AchievementState,
  type AchievementStats,
  achievementProgress,
  crossedAchievementIds,
  isAchievementHidden,
  longestDailyStreak,
  newlyUnlockedAchievementIds,
} from "../core/achievements";
import { GENERATOR_VERSIONS } from "../core/generator";

/** The ordinary board versions, as SQL literals (they are fixed names). */
const ORDINARY_VERSIONS = GENERATOR_VERSIONS.map((v) => `'${v}'`).join(", ");

const INSERT_ACHIEVEMENT = `INSERT INTO achievements (account_id, achievement_type, unlocked_at)
  VALUES (?, ?, ?) ON CONFLICT(account_id, achievement_type) DO NOTHING`;

/**
 * The number of a date in Japan. Japan has no daylight saving, so shifting
 * by 9 hours and dividing by a day's length is enough; completed_at is an
 * integer, so SQLite's integer division rounds down.
 */
const JST_DAY = "(completed_at + 32400000) / 86400000";

/**
 * The statement that counts an account's records. With `except` set to a
 * play's id (an ordinary clear or a daily challenge: both are UUIDs), it
 * counts without that play: the values before it was stored.
 * Null counts every play (play_id IS NOT NULL holds for all).
 */
function statsStatement(
  db: D1Database,
  accountId: string,
  except: string | null,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(ordinary), 0) AS clears,
         COALESCE(SUM(ordinary AND difficulty = 'hard'), 0) AS hard,
         COALESCE(SUM(ordinary AND hints_used = 0), 0) AS no_hint,
         COALESCE(SUM(ordinary AND hints_used = 0 AND difficulty = 'hard'), 0)
           AS no_hint_hard,
         COALESCE(SUM(ordinary AND max_assist = 0), 0) AS no_assist,
         COALESCE(SUM(ordinary AND max_assist = 0 AND difficulty = 'hard'), 0)
           AS no_assist_hard,
         (SELECT COUNT(*) FROM (
            SELECT ${JST_DAY} FROM completed_plays
            WHERE account_id = ?1 AND play_id IS NOT ?2
            UNION
            SELECT ${JST_DAY} FROM daily_attempts
            WHERE account_id = ?1 AND play_id IS NOT ?2
              AND completed_at IS NOT NULL
          )) AS days
       FROM (
         SELECT *, generator_version IN (${ORDINARY_VERSIONS}) AS ordinary
         FROM completed_plays
         WHERE account_id = ?1 AND play_id IS NOT ?2
       )`,
    )
    .bind(accountId, except);
}

interface StatsRow {
  clears: number;
  hard: number;
  no_hint: number;
  no_hint_hard: number;
  no_assist: number;
  no_assist_hard: number;
  days: number;
}

/** The account's completed daily challenges: the dates and their plays. */
function dailyStatement(
  db: D1Database,
  accountId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT challenge_date, play_id FROM daily_attempts
       WHERE account_id = ? AND completed_at IS NOT NULL`,
    )
    .bind(accountId);
}

interface DailyRow {
  challenge_date: string;
  play_id: string;
}

function toStats(
  result: D1Result,
  daily: readonly DailyRow[],
  except: string | null,
): AchievementStats {
  const row = result.results[0] as StatsRow;
  const dates = daily
    .filter((item) => item.play_id !== except)
    .map((item) => item.challenge_date);
  return {
    dailyClears: dates.length,
    dailyStreak: longestDailyStreak(dates),
    clears: row.clears,
    hardClears: row.hard,
    noHintClears: row.no_hint,
    noHintHardClears: row.no_hint_hard,
    noAssistClears: row.no_assist,
    noAssistHardClears: row.no_assist_hard,
    clearDays: row.days,
  };
}

/**
 * The account's counts and stored unlocks, in one batch. With `except`, the
 * counts without that play too.
 */
async function readAccount(
  db: D1Database,
  accountId: string,
  except: string | null = null,
): Promise<{
  stats: AchievementStats;
  before: AchievementStats | null;
  saved: Map<string, number>;
}> {
  const results = await db.batch([
    dailyStatement(db, accountId),
    statsStatement(db, accountId, null),
    ...(except === null ? [] : [statsStatement(db, accountId, except)]),
    db
      .prepare(
        "SELECT achievement_type, unlocked_at FROM achievements WHERE account_id = ?",
      )
      .bind(accountId),
  ]);
  const saved = results[results.length - 1].results as {
    achievement_type: string;
    unlocked_at: number;
  }[];
  const daily = results[0].results as DailyRow[];
  return {
    stats: toStats(results[1], daily, null),
    before: except === null ? null : toStats(results[2], daily, except),
    saved: new Map(saved.map((row) => [row.achievement_type, row.unlocked_at])),
  };
}

/** Stores the ones met but not stored yet; returns their ids. */
async function saveUnlocks(
  db: D1Database,
  accountId: string,
  stats: AchievementStats,
  saved: ReadonlyMap<string, number>,
  now: number,
): Promise<string[]> {
  const ids = newlyUnlockedAchievementIds(stats, saved.keys());
  if (ids.length > 0) {
    await db.batch(
      ids.map((id) => db.prepare(INSERT_ACHIEVEMENT).bind(accountId, id, now)),
    );
  }
  return ids;
}

/**
 * After a clear was newly stored: stores every achievement now met, and
 * returns those this clear crossed (met with it, not without it). Ones the
 * earlier records already met are stored but not returned, so the clear
 * card does not announce them; the list marks them as new. The answer does
 * not depend on which request stored them first. A failure here does not
 * fail the clear: it returns none, and the next judgement stores them.
 */
export async function judgeAfterClear(
  db: D1Database,
  accountId: string,
  playId: string,
  now: number,
): Promise<string[]> {
  try {
    const { stats, before, saved } = await readAccount(db, accountId, playId);
    await saveUnlocks(db, accountId, stats, saved, now);
    return crossedAchievementIds(before!, stats);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "achievement_evaluation_failure",
        error: String(error),
      }),
    );
    return [];
  }
}

/** GET /api/achievements: judged again, then every definition's state. */
export async function listAchievements(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<AchievementState[]> {
  const { stats, saved } = await readAccount(db, accountId);
  const unlocked = await saveUnlocks(db, accountId, stats, saved, now);
  return ACHIEVEMENTS.map((definition) => {
    const unlockedAt =
      saved.get(definition.id) ??
      (unlocked.includes(definition.id) ? now : null);
    return {
      id: definition.id,
      unlockedAt,
      progress:
        definition.metric === "client" ||
        isAchievementHidden(definition, unlockedAt !== null)
          ? null
          : achievementProgress(definition, stats),
    };
  });
}

/**
 * POST /api/achievements/unlock: stores one the screen reports. The caller
 * checks the id with isClientUnlockable. True when newly stored.
 */
export async function unlockClientAchievement(
  db: D1Database,
  accountId: string,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(INSERT_ACHIEVEMENT)
    .bind(accountId, id, now)
    .run();
  return result.meta.changes > 0;
}
