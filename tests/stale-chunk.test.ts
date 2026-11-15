import { describe, expect, it } from "vitest";
import { type KeyValueStorage } from "../src/core/storage";
import { shouldReloadForStaleChunk } from "../src/ui/stale-chunk";
import { memoryStorage } from "./helpers";

describe("reloading for a part gone after a deploy", () => {
  it("reloads once a minute at most", () => {
    const { storage } = memoryStorage();
    expect(shouldReloadForStaleChunk(storage, true, 1_000_000)).toBe(true);
    expect(shouldReloadForStaleChunk(storage, true, 1_030_000)).toBe(false);
    expect(shouldReloadForStaleChunk(storage, true, 1_061_000)).toBe(true);
  });

  it("does not reload offline or without storage", () => {
    expect(shouldReloadForStaleChunk(memoryStorage().storage, false, 1)).toBe(
      false,
    );
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(shouldReloadForStaleChunk(broken, true, 1)).toBe(false);
  });
});
