import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from "../src/core/settings";
import { type KeyValueStorage } from "../src/core/storage";
import { memoryStorage } from "./helpers";

describe("settings (DATA_CONTRACT.md)", () => {
  it("starts with ×＋ガイド, conflicts shown and the line tool", () => {
    expect(loadSettings(memoryStorage().storage)).toEqual({
      assist: 2,
      showConflicts: true,
      tool: "line",
      sound: false,
      haptics: true,
    });
  });

  it("reads back what it saved", () => {
    const { storage } = memoryStorage();
    const changed = {
      ...DEFAULT_SETTINGS,
      assist: 0 as const,
      tool: "cross" as const,
    };
    expect(saveSettings(storage, changed)).toBe(true);
    expect(loadSettings(storage)).toEqual(changed);
  });

  it.each([
    "{",
    "[]",
    '{"assist":3}',
    JSON.stringify({ ...DEFAULT_SETTINGS, tool: "pen" }),
  ])("starts from the defaults and keeps %j aside", (raw) => {
    const { storage, map } = memoryStorage({ [SETTINGS_KEY]: raw });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(map.get(`${SETTINGS_KEY}.corrupt`)).toBe(raw);
  });

  it("works where storage throws", () => {
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(storage, DEFAULT_SETTINGS)).toBe(false);
  });
});
