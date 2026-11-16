/**
 * Achievements (DESIGN.md 20.4, DATA_CONTRACT.md 「実績」): their definitions
 * and the rule that unlocks them. The Worker counts an account's records in
 * D1 (AchievementStats) and judges them again every time; progress is never
 * stored, so a new definition needs no migration of values. The order here
 * is the order of the tiles. An id is stored in D1: once released, it stays.
 */
import { nextDailyDate } from "./daily-code";
import { type KeyValueStorage, readJson, writeJson } from "./storage";

/** What the Worker counts from an account's records. */
export type AchievementMetric =
  /** Clears of ordinary boards (any difficulty; replays and seeds too). */
  | "clears"
  /** Clears of hard ordinary boards. */
  | "hardClears"
  /** Clears with no hint: the score's no-hint bonus (DESIGN.md 16.2). */
  | "noHintClears"
  /** Hard clears with no hint. */
  | "noHintHardClears"
  /** Clears with the assist off all the way (stage 0). */
  | "noAssistClears"
  /** Hard clears with the assist off all the way. */
  | "noAssistHardClears"
  /**
   * The days with a clear, as dates in Japan: ordinary boards of any version
   * and the daily challenge.
   */
  | "clearDays"
  /** Completed daily challenges (DESIGN.md chapter 25). */
  | "dailyClears"
  /** The longest run of daily challenges completed on consecutive dates. */
  | "dailyStreak";

export type AchievementStats = Readonly<Record<AchievementMetric, number>>;

export type AchievementCategory =
  "first" | "clears" | "no-hint" | "no-assist" | "days" | "daily";

interface AchievementBase {
  readonly id: string;
  readonly category: AchievementCategory;
  readonly name: string;
  readonly description: string;
  /** Its name, condition, progress and icon stay hidden until unlocked. */
  readonly secret?: boolean;
}

/** Unlocked by the records: when `metric` reaches `threshold`. */
export interface RecordAchievement extends AchievementBase {
  readonly metric: AchievementMetric;
  readonly threshold: number;
}

/**
 * Not judged from the records: the screen reports it (the tutorial's end).
 * Only these may be unlocked by a request from the screen.
 */
export interface ClientAchievement extends AchievementBase {
  readonly metric: "client";
}

export type AchievementDefinition = RecordAchievement | ClientAchievement;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: "tutorial_complete",
    category: "first",
    metric: "client",
    name: "はじめの一歩",
    description: "遊び方を最後まで終える",
  },
  {
    id: "clear_first",
    category: "first",
    metric: "clears",
    threshold: 1,
    name: "初クリア",
    description: "問題を初めてクリアする",
  },
  {
    id: "clear_hard_first",
    category: "first",
    metric: "hardClears",
    threshold: 1,
    name: "上級デビュー",
    description: "上級を初めてクリアする",
  },
  {
    id: "clear_10",
    category: "clears",
    metric: "clears",
    threshold: 10,
    name: "10回クリア",
    description: "問題を10回クリアする",
  },
  {
    id: "clear_50",
    category: "clears",
    metric: "clears",
    threshold: 50,
    name: "50回クリア",
    description: "問題を50回クリアする",
  },
  {
    id: "clear_100",
    category: "clears",
    metric: "clears",
    threshold: 100,
    name: "100回クリア",
    description: "問題を100回クリアする",
  },
  {
    id: "clear_500",
    category: "clears",
    metric: "clears",
    threshold: 500,
    name: "500回クリア",
    description: "問題を500回クリアする",
    secret: true,
  },
  {
    id: "no_hint",
    category: "no-hint",
    metric: "noHintClears",
    threshold: 1,
    name: "ヒントなし",
    description: "ヒントを使わずにクリアする",
  },
  {
    id: "no_hint_hard",
    category: "no-hint",
    metric: "noHintHardClears",
    threshold: 1,
    name: "上級ヒントなし",
    description: "上級をヒントを使わずにクリアする",
  },
  {
    id: "no_assist",
    category: "no-assist",
    metric: "noAssistClears",
    threshold: 1,
    name: "アシストなし",
    description: "アシストを「なし」にしたままクリアする",
  },
  {
    id: "no_assist_hard",
    category: "no-assist",
    metric: "noAssistHardClears",
    threshold: 1,
    name: "上級アシストなし",
    description: "上級を、アシストを「なし」にしたままクリアする",
  },
  {
    id: "days_7",
    category: "days",
    metric: "clearDays",
    threshold: 7,
    name: "7日クリア",
    description: "クリアした日が7日になる",
  },
  {
    id: "days_30",
    category: "days",
    metric: "clearDays",
    threshold: 30,
    name: "30日クリア",
    description: "クリアした日が30日になる",
  },
  {
    id: "days_100",
    category: "days",
    metric: "clearDays",
    threshold: 100,
    name: "100日クリア",
    description: "クリアした日が100日になる",
  },
  {
    id: "daily_first",
    category: "daily",
    metric: "dailyClears",
    threshold: 1,
    name: "デイリー初クリア",
    description: "デイリーを初めてクリアする",
  },
  {
    id: "daily_7",
    category: "daily",
    metric: "dailyClears",
    threshold: 7,
    name: "デイリー7回",
    description: "デイリーを7回クリアする",
  },
  {
    id: "daily_30",
    category: "daily",
    metric: "dailyClears",
    threshold: 30,
    name: "デイリー30回",
    description: "デイリーを30回クリアする",
  },
  {
    id: "daily_100",
    category: "daily",
    metric: "dailyClears",
    threshold: 100,
    name: "デイリー100回",
    description: "デイリーを100回クリアする",
  },
  {
    id: "daily_streak_7",
    category: "daily",
    metric: "dailyStreak",
    threshold: 7,
    name: "デイリー7日連続",
    description: "デイリーを7日続けてクリアする",
  },
];

/**
 * The longest run of consecutive dates among the daily challenges
 * completed (a date counts once). Only completed ones are given: a day only
 * started breaks the run.
 */
export function longestDailyStreak(dates: Iterable<string>): number {
  const days = new Set(dates);
  let longest = 0;
  for (const date of days) {
    // Count from the first date of each run only.
    if (days.has(previousDate(date))) continue;
    let length = 1;
    for (
      let next = nextDailyDate(date);
      days.has(next);
      next = nextDailyDate(next)
    ) {
      length += 1;
    }
    longest = Math.max(longest, length);
  }
  return longest;
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function achievementDefinition(
  id: string,
): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((item) => item.id === id);
}

/** Whether the screen may report this one as unlocked. */
export function isClientUnlockable(id: unknown): boolean {
  return (
    typeof id === "string" && achievementDefinition(id)?.metric === "client"
  );
}

/**
 * Whether its name, condition, progress and icon are hidden (a secret one
 * not yet unlocked). The Worker's answer and the screen both follow this.
 */
export function isAchievementHidden(
  definition: AchievementDefinition,
  unlocked: boolean,
): boolean {
  return definition.secret === true && !unlocked;
}

/** Whether the records meet it. One the screen reports is never met here. */
export function isAchievementUnlocked(
  definition: AchievementDefinition,
  stats: AchievementStats,
): boolean {
  return (
    definition.metric !== "client" &&
    stats[definition.metric] >= definition.threshold
  );
}

/** The ids met but not yet stored, in definition order. */
export function newlyUnlockedAchievementIds(
  stats: AchievementStats,
  alreadyUnlocked: Iterable<string>,
): string[] {
  const known = new Set(alreadyUnlocked);
  return ACHIEVEMENTS.filter(
    (item) => !known.has(item.id) && isAchievementUnlocked(item, stats),
  ).map((item) => item.id);
}

/**
 * The ids a record crossed: met with it and not without it. Only these are
 * announced on the clear card; ones the earlier records already met are
 * stored too, but shown in the list as new instead.
 */
export function crossedAchievementIds(
  before: AchievementStats,
  after: AchievementStats,
): string[] {
  return ACHIEVEMENTS.filter(
    (item) =>
      isAchievementUnlocked(item, after) &&
      !isAchievementUnlocked(item, before),
  ).map((item) => item.id);
}

/** The progress to show, capped at the threshold. */
export function achievementProgress(
  definition: RecordAchievement,
  stats: AchievementStats,
): number {
  return Math.min(stats[definition.metric], definition.threshold);
}

/** One achievement as GET /api/achievements answers it. */
export interface AchievementState {
  readonly id: string;
  /** When it was unlocked (epoch ms), or null. */
  readonly unlockedAt: number | null;
  /** The records' value for it, or null (screen-reported, or hidden). */
  readonly progress: number | null;
}

/** One achievement with its definition, as the screen shows it. */
export interface AchievementStatus extends Omit<AchievementState, "id"> {
  readonly definition: AchievementDefinition;
}

/**
 * The list from GET /api/achievements, checked: unknown ids are dropped
 * and every definition is listed, in its order. Null when malformed.
 */
export function parseAchievementList(
  value: unknown,
): AchievementStatus[] | null {
  const items = (value as { achievements?: unknown } | null)?.achievements;
  if (!Array.isArray(items)) return null;
  const byId = new Map<string, Omit<AchievementState, "id">>();
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const { id, unlockedAt, progress } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !(unlockedAt === null || Number.isSafeInteger(unlockedAt)) ||
      !(progress === null || Number.isSafeInteger(progress))
    )
      return null;
    byId.set(id, {
      unlockedAt: unlockedAt as number | null,
      progress: progress as number | null,
    });
  }
  return ACHIEVEMENTS.map((definition) => ({
    definition,
    ...(byId.get(definition.id) ?? { unlockedAt: null, progress: null }),
  }));
}

/** The known achievement ids in an answer's newAchievements. */
export function parseNewAchievements(value: unknown): string[] {
  const ids = (value as { newAchievements?: unknown } | null)?.newAchievements;
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(
      ids.filter(
        (id): id is string =>
          typeof id === "string" && achievementDefinition(id) !== undefined,
      ),
    ),
  ];
}

// --- on the device ------------------------------------------------------------

const seenKey = (accountId: string) =>
  `nyoro-rin.achievements-seen.v1:${accountId}`;

function parseIds(value: unknown): Set<string> | undefined {
  return Array.isArray(value)
    ? new Set(value.filter((id): id is string => typeof id === "string"))
    : undefined;
}

/**
 * The unlocked achievements the device has already shown to this ID: the
 * ones announced on the clear card, and the tiles opened in the list. The
 * rest of the unlocked ones are marked new.
 */
export function loadSeenAchievements(
  storage: KeyValueStorage,
  accountId: string,
): Set<string> {
  return readJson(storage, seenKey(accountId), parseIds) ?? new Set();
}

/**
 * Adds ids to the shown ones. What is stored is read again first, so a tab
 * that marked others meanwhile keeps them.
 */
export function markAchievementsSeen(
  storage: KeyValueStorage,
  accountId: string,
  ids: Iterable<string>,
): Set<string> {
  const seen = loadSeenAchievements(storage, accountId);
  for (const id of ids) seen.add(id);
  writeJson(storage, seenKey(accountId), [...seen]);
  return seen;
}

/**
 * The tutorial's achievement waiting to be sent: the ID it was finished
 * with, or "" when it was finished before the device had one (the next ID
 * known takes it). Another ID that later uses the device does not get it.
 * Apart from core/tutorial.ts's key, which a declined tutorial sets too.
 */
const TUTORIAL_PENDING_KEY = "nyoro-rin.tutorial-achievement.v1";

export function loadTutorialPending(
  storage: KeyValueStorage,
): string | undefined {
  const value = readJson(storage, TUTORIAL_PENDING_KEY, (raw) =>
    typeof raw === "string" || raw === null ? raw : undefined,
  );
  return value ?? undefined;
}

export function saveTutorialPending(
  storage: KeyValueStorage,
  accountId: string | null | undefined,
): void {
  writeJson(storage, TUTORIAL_PENDING_KEY, accountId ?? null);
}

/**
 * The ID to send the tutorial's achievement for, now that `accountId` is
 * known, or undefined when nothing waits for it.
 */
export function tutorialPendingFor(
  pending: string | undefined,
  accountId: string,
): string | undefined {
  return pending === "" || pending === accountId ? accountId : undefined;
}
