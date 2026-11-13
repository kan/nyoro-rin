import { describe, expect, it } from "vitest";
import {
  gameNameProblem,
  loadCachedProfile,
  saveCachedProfile,
  validateGameName,
} from "../src/core/account-profile";
import { memoryStorage } from "./helpers";

describe("game names (the rules TAKO-SEN uses)", () => {
  it("says why a name is refused", () => {
    expect(gameNameProblem("ヘビ")).toBeUndefined();
    expect(gameNameProblem("ヘ")).toBe("length");
    expect(gameNameProblem("ヘ".repeat(21))).toBe("length");
    expect(gameNameProblem("ヘビ・テスト")).toBe("chars");
    expect(gameNameProblem(" 🐍ヘ ")).toBeUndefined();
  });

  it("normalizes a valid name and refuses markup, mail addresses and controls", () => {
    expect(validateGameName("  ヘビ-123  ")).toBe("ヘビ-123");
    for (const name of [
      null,
      {},
      "",
      "a",
      "a".repeat(21),
      "<script>",
      "user@example.com",
      "a\nb",
    ]) {
      expect(validateGameName(name)).toBeUndefined();
    }
  });

  it("counts an emoji sequence as one character", () => {
    expect(validateGameName("🐍🐍")).toBe("🐍🐍");
    expect(validateGameName("🇯🇵ヘビ")).toBe("🇯🇵ヘビ");
  });
});

describe("the cached profile", () => {
  it("is kept per ID and never inferred for another", () => {
    const { storage } = memoryStorage();
    const profile = { displayName: "端末ヘビ", consentVersion: 1 };
    saveCachedProfile("a", profile, storage);
    expect(loadCachedProfile("a", storage)).toEqual(profile);
    expect(loadCachedProfile("b", storage)).toBeNull();
    saveCachedProfile("a", null, storage);
    expect(loadCachedProfile("a", storage)).toBeNull();
  });
});
