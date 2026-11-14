import { describe, expect, it } from "vitest";
import {
  gameNameProblem,
  hasCachedProfile,
  loadCachedProfile,
  loadInviteSeen,
  saveCachedProfile,
  saveInviteSeen,
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

describe("the first-visit invitation", () => {
  it("is remembered once shown", () => {
    const { storage } = memoryStorage();
    expect(loadInviteSeen(storage)).toBe(false);
    expect(saveInviteSeen(storage)).toBe(true);
    expect(loadInviteSeen(storage)).toBe(true);
  });

  it("knows whether the API's answer for an ID is cached, even no name", () => {
    const { storage } = memoryStorage();
    expect(hasCachedProfile("a", storage)).toBe(false);
    saveCachedProfile("a", null, storage);
    expect(hasCachedProfile("a", storage)).toBe(true);
    expect(hasCachedProfile("b", storage)).toBe(false);
  });

  it("is shown again when the saved value is not true", () => {
    const { storage } = memoryStorage();
    storage.setItem("nyoro-rin.ranking-invite.v1", '"yes"');
    expect(loadInviteSeen(storage)).toBe(false);
  });
});
