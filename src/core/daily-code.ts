/**
 * The daily challenge's dates and the name it goes by in records
 * (DESIGN.md chapter 25). Apart from daily.ts so that the saved-game reader
 * (current-game.ts) can use it without an import cycle.
 */
import { isSeedCodeOf } from "./seed-code";

/**
 * The daily board's version. It is not an ordinary generator version: a
 * daily board is never restored from a seed code or shared (DESIGN.md 25.2).
 */
export const DAILY_VERSION = "d1";

/** Daily boards are hard (by the same trials as an ordinary hard board). */
export const DAILY_DIFFICULTY = "hard";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date in Japan, `YYYY-MM-DD`; it turns at 0:00 JST. */
export function dailyDate(now: number): string {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The date after `date`. */
export function nextDailyDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The date before `date`. */
export function previousDailyDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Whether a started challenge of `date` may still be completed: on the day,
 * and until the end of the next one, for a board finished past midnight.
 * Later, the day's ranking and the counted days stay as they are.
 */
export function isCompletableDailyDate(date: string, now: number): boolean {
  const today = dailyDate(now);
  return date === today || date === previousDailyDate(today);
}

/** A real calendar date written as `YYYY-MM-DD`. */
export function isDailyDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

/**
 * How a daily board is named where records name a board by its seed code
 * (play logs, feedback): `NYORO:d1:hard:<date>`. It is not a seed: the board
 * cannot be made from it, and the seed input refuses it.
 */
export function dailySeedCode(date: string): string {
  return `NYORO:${DAILY_VERSION}:${DAILY_DIFFICULTY}:${date}`;
}

/** The date a daily seed code names, or undefined. */
export function dailyDateOfSeedCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prefix = `NYORO:${DAILY_VERSION}:${DAILY_DIFFICULTY}:`;
  if (!value.startsWith(prefix)) return undefined;
  const date = value.slice(prefix.length);
  return isDailyDate(date) ? date : undefined;
}

/**
 * Whether a record's seed code names its board: an ordinary seed code of
 * this version and difficulty, or the daily board's name.
 */
export function isRecordedSeedCode(
  value: unknown,
  version: unknown,
  difficulty: unknown,
): value is string {
  if (version === DAILY_VERSION) {
    return (
      difficulty === DAILY_DIFFICULTY &&
      dailyDateOfSeedCode(value) !== undefined
    );
  }
  return isSeedCodeOf(value, version, difficulty);
}
