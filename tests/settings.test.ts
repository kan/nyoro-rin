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
  it("starts with ×＋ガイド and conflicts shown", () => {
    expect(loadSettings(memoryStorage().storage)).toEqual({
      assist: 2,
      showConflicts: true,
      sound: false,
      haptics: true,
    });
  });

  it("reads back what it saved", () => {
    const { storage } = memoryStorage();
    const changed = { ...DEFAULT_SETTINGS, assist: 0 as const };
    expect(saveSettings(storage, changed)).toBe(true);
    expect(loadSettings(storage)).toEqual(changed);
  });

  it("loads settings saved with the retired × tool as they were", () => {
    const saved = { ...DEFAULT_SETTINGS, assist: 1 as const };
    const { storage, map } = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...saved, tool: "cross" }),
    });
    expect(loadSettings(storage)).toEqual(saved);
    expect(map.has(`${SETTINGS_KEY}.corrupt`)).toBe(false);
  });

  it.each(["{", "[]", '{"assist":3}'])(
    "starts from the defaults and keeps %j aside",
    (raw) => {
      const { storage, map } = memoryStorage({ [SETTINGS_KEY]: raw });
      expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
      expect(map.get(`${SETTINGS_KEY}.corrupt`)).toBe(raw);
    },
  );

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
