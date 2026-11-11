import { describe, expect, it } from "vitest";
import {
  encodeSeedCode,
  isValidSeed,
  parseSeedCode,
} from "../src/core/seed-code";

describe("seed code (DATA_CONTRACT.md)", () => {
  it("writes NYORO:<version>:<difficulty>:<seed> and reads it back", () => {
    const code = { version: "n1", difficulty: "hard", seed: "abc" } as const;
    expect(encodeSeedCode(code)).toBe("NYORO:n1:hard:abc");
    expect(parseSeedCode("NYORO:n1:hard:abc")).toEqual(code);
  });

  it("URI-encodes the seed", () => {
    const code = {
      version: "n1",
      difficulty: "easy",
      seed: "にょろ:🐍 x",
    } as const;
    const text = encodeSeedCode(code);
    expect(text.split(":")).toHaveLength(4);
    expect(parseSeedCode(text)).toEqual(code);
  });

  it("ignores spaces around a pasted code", () => {
    expect(parseSeedCode("  NYORO:n1:normal:x \n")?.seed).toBe("x");
  });

  it.each([
    "TAKO:n1:easy:x",
    "NYORO:n9:easy:x",
    "NYORO:n1:expert:x",
    "NYORO:n1:easy:",
    "NYORO:n1:easy:%E0",
    "NYORO:n1:easy:x:y",
    `NYORO:n1:easy:${"x".repeat(129)}`,
  ])("rejects %j", (text) => {
    expect(parseSeedCode(text)).toBeUndefined();
  });

  it.each(["NYORO:n1:easy:a b", "NYORO:n1:easy:%61%20b"])(
    "rejects %j, which is not the form the game writes",
    (text) => {
      expect(parseSeedCode(text)).toBeUndefined();
      expect(parseSeedCode("NYORO:n1:easy:a%20b")?.seed).toBe("a b");
    },
  );

  it("refuses a seed with half an emoji, which cannot be encoded", () => {
    expect(isValidSeed("a\uD800")).toBe(false);
    expect(isValidSeed("\uDC00a")).toBe(false);
    expect(isValidSeed("a🐍")).toBe(true);
    expect(parseSeedCode("NYORO:n1:easy:a%ED%A0%80")).toBeUndefined();
  });

  it("accepts a seed of 128 UTF-16 code units", () => {
    expect(parseSeedCode(`NYORO:n1:easy:${"x".repeat(128)}`)).toBeDefined();
  });
});
