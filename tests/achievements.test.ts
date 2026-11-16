import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  type AchievementStats,
  achievementProgress,
  crossedAchievementIds,
  isAchievementHidden,
  isAchievementUnlocked,
  isClientUnlockable,
  loadSeenAchievements,
  loadTutorialPending,
  markAchievementsSeen,
  newlyUnlockedAchievementIds,
  parseAchievementList,
  parseNewAchievements,
  saveTutorialPending,
  tutorialPendingFor,
  type RecordAchievement,
} from "../src/core/achievements";
import type { KeyValueStorage } from "../src/core/storage";

const NONE: AchievementStats = {
  clears: 0,
  hardClears: 0,
  noHintClears: 0,
  noHintHardClears: 0,
  noAssistClears: 0,
  noAssistHardClears: 0,
  clearDays: 0,
};

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("achievement definitions", () => {
  it("is the approved list, in tile order", () => {
    expect(ACHIEVEMENTS.map((item) => item.id)).toEqual([
      "tutorial_complete",
      "clear_first",
      "clear_hard_first",
      "clear_10",
      "clear_50",
      "clear_100",
      "clear_500",
      "no_hint",
      "no_hint_hard",
      "no_assist",
      "no_assist_hard",
      "days_7",
      "days_30",
      "days_100",
    ]);
  });

  it("has unique ids and names", () => {
    expect(new Set(ACHIEVEMENTS.map((item) => item.id)).size).toBe(
      ACHIEVEMENTS.length,
    );
    expect(new Set(ACHIEVEMENTS.map((item) => item.name)).size).toBe(
      ACHIEVEMENTS.length,
    );
  });

  it("unlocks each record achievement exactly at its threshold", () => {
    for (const item of ACHIEVEMENTS) {
      if (item.metric === "client") continue;
      const at = { ...NONE, [item.metric]: item.threshold };
      const below = { ...NONE, [item.metric]: item.threshold - 1 };
      expect(isAchievementUnlocked(item, at), item.id).toBe(true);
      expect(isAchievementUnlocked(item, below), item.id).toBe(false);
    }
  });

  it("never unlocks the tutorial from the records", () => {
    const all = Object.fromEntries(
      Object.keys(NONE).map((key) => [key, 1000]),
    ) as unknown as AchievementStats;
    expect(newlyUnlockedAchievementIds(all, [])).not.toContain(
      "tutorial_complete",
    );
  });

  it("lets the screen unlock only the tutorial", () => {
    expect(isClientUnlockable("tutorial_complete")).toBe(true);
    for (const id of ["clear_first", "no_hint", "unknown", 1, null])
      expect(isClientUnlockable(id), String(id)).toBe(false);
  });

  it("lists the ones met and not stored, in order", () => {
    const stats = { ...NONE, clears: 10, noHintClears: 1 };
    expect(newlyUnlockedAchievementIds(stats, ["clear_first"])).toEqual([
      "clear_10",
      "no_hint",
    ]);
  });

  it("announces only what a record crossed", () => {
    const before = { ...NONE, clears: 9, noHintClears: 3 };
    const after = { ...NONE, clears: 10, noHintClears: 4 };
    expect(crossedAchievementIds(before, after)).toEqual(["clear_10"]);
    expect(crossedAchievementIds(after, after)).toEqual([]);
  });

  it("caps the progress and hides a secret one until unlocked", () => {
    const clear10 = ACHIEVEMENTS.find(
      (item) => item.id === "clear_10",
    ) as RecordAchievement;
    expect(achievementProgress(clear10, { ...NONE, clears: 25 })).toBe(10);
    const secret = ACHIEVEMENTS.find((item) => item.id === "clear_500")!;
    expect(isAchievementHidden(secret, false)).toBe(true);
    expect(isAchievementHidden(secret, true)).toBe(false);
    expect(isAchievementHidden(clear10, false)).toBe(false);
  });
});

describe("the answers", () => {
  it("reads the list in definition order, dropping unknown ids", () => {
    const list = parseAchievementList({
      achievements: [
        { id: "no_hint", unlockedAt: 5, progress: 1 },
        { id: "gone", unlockedAt: 1, progress: null },
      ],
    });
    expect(list).toHaveLength(ACHIEVEMENTS.length);
    expect(list![0].definition.id).toBe("tutorial_complete");
    expect(
      list!.find((item) => item.definition.id === "no_hint"),
    ).toMatchObject({ unlockedAt: 5, progress: 1 });
    expect(list!.some((item) => item.definition.id === "gone")).toBe(false);
  });

  it("refuses a malformed list", () => {
    expect(parseAchievementList({})).toBeNull();
    expect(
      parseAchievementList({
        achievements: [{ id: "no_hint", unlockedAt: "x" }],
      }),
    ).toBeNull();
  });

  it("keeps only known new achievements", () => {
    expect(
      parseNewAchievements({
        newAchievements: ["clear_first", "unknown", 3, "clear_first"],
      }),
    ).toEqual(["clear_first"]);
    expect(parseNewAchievements({ status: "created" })).toEqual([]);
  });
});

describe("on the device", () => {
  it("keeps the shown ones per ID", () => {
    const storage = memoryStorage();
    markAchievementsSeen(storage, "a", ["clear_first"]);
    markAchievementsSeen(storage, "a", ["no_hint"]);
    expect([...loadSeenAchievements(storage, "a")].sort()).toEqual([
      "clear_first",
      "no_hint",
    ]);
    expect(loadSeenAchievements(storage, "b").size).toBe(0);
  });

  it("reads a broken value as nothing shown", () => {
    const storage = memoryStorage();
    storage.setItem("nyoro-rin.achievements-seen.v1:a", "{");
    expect(loadSeenAchievements(storage, "a").size).toBe(0);
  });

  it("sends the tutorial for the ID it was finished with only", () => {
    const storage = memoryStorage();
    expect(loadTutorialPending(storage)).toBeUndefined();
    saveTutorialPending(storage, "a");
    expect(tutorialPendingFor(loadTutorialPending(storage), "a")).toBe("a");
    expect(
      tutorialPendingFor(loadTutorialPending(storage), "b"),
    ).toBeUndefined();
    // Finished without an ID: the next ID known takes it.
    saveTutorialPending(storage, "");
    expect(tutorialPendingFor(loadTutorialPending(storage), "b")).toBe("b");
    saveTutorialPending(storage, null);
    expect(
      tutorialPendingFor(loadTutorialPending(storage), "b"),
    ).toBeUndefined();
  });
});
