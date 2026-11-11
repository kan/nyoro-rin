import { describe, expect, it } from "vitest";
import { randomSeed } from "../src/ui/puzzle-generation";
import { parseSeedCode } from "../src/core/seed-code";

describe("random seeds", () => {
  it("uses only the easy-to-read letters and makes a valid seed code", () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = randomSeed();
      expect(seed).toMatch(/^[a-hjkmnp-z2-9]{8}$/);
      expect(parseSeedCode(`NYORO:n1:easy:${seed}`)?.seed).toBe(seed);
    }
  });

  it("makes the length asked for", () => {
    expect(randomSeed(3)).toHaveLength(3);
  });
});
