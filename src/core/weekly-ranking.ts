/**
 * The weekly player ranking (DESIGN.md 20.3, DATA_CONTRACT.md 「週間ランキング」).
 * The counting is done by the Worker in SQL; this module holds the week, the
 * shapes and the limits, shared by the Worker, the screen and the tests.
 */
import type { AssistLevel } from "./settings";

export const WEEKLY_METRICS = ["clears", "score"] as const;
/** clears: most counted clears first. score: best average score first. */
export type WeeklyMetric = (typeof WEEKLY_METRICS)[number];

export function isWeeklyMetric(value: unknown): value is WeeklyMetric {
  return (WEEKLY_METRICS as readonly unknown[]).includes(value);
}

/** The order by average score ranks only players with this many clears. */
export const WEEKLY_SCORE_MIN_CLEARS = 5;
/** Rows in one ranking. */
export const WEEKLY_RANKING_LIMIT = 100;

/** One player's row. No account ID, seed or single record leaves the Worker. */
export interface WeeklyEntry {
  readonly rank: number;
  readonly displayName: string;
  /** Distinct puzzles cleared this week (first clear of each in the week). */
  readonly clears: number;
  /** The mean of those clears' scores (DESIGN.md 16.2), not rounded. */
  readonly averageScore: number;
  /** The highest assist level among those clears: the row's assist mark. */
  readonly maxAssist: AssistLevel;
  /** True only for the requester's own row, when it sent its ID cookie. */
  readonly isSelf: boolean;
}

export interface WeeklyRanking {
  /** The week's start and end, epoch milliseconds (end excluded). */
  readonly start: number;
  readonly end: number;
  readonly entries: readonly WeeklyEntry[];
}

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

/**
 * The week holding `now`: Monday 00:00 to the next Monday 00:00 in Japan
 * time, whatever the time zone of the browser or the Worker. Japan has no
 * daylight saving time, so a fixed offset is exact.
 */
export function rankingWeekOf(now: number): {
  readonly start: number;
  readonly end: number;
} {
  const jst = new Date(now + JST_OFFSET_MS);
  const midnight = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate(),
  );
  // getUTCDay: Sunday is 0. Days since Monday:
  const sinceMonday = (jst.getUTCDay() + 6) % 7;
  const start = midnight - sinceMonday * DAY_MS - JST_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}
