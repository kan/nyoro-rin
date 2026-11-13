import { describe, expect, it } from "vitest";
import type { PlayLogEvent } from "../src/core/play-log";
import { percentile, replayPlayLog } from "../src/core/play-log-analysis";

describe("replaying a play log (DESIGN.md 20.1)", () => {
  it("rebuilds the board from the moves, undo and reset included", () => {
    const events: PlayLogEvent[] = [
      ["start", 0],
      ["move", 10, "stroke", [[0, 0, 1]]],
      ["move", 20, "stroke-more", [[1, 0, 1]]],
      ["move", 30, "tap", [[2, 0, 2]]],
      ["move", 40, "undo", [[2, 2, 0]]],
      [
        "move",
        50,
        "reset",
        [
          [0, 1, 0],
          [1, 1, 0],
        ],
      ],
      [
        "move",
        60,
        "undo",
        [
          [0, 0, 1],
          [1, 0, 1],
        ],
      ],
    ];
    expect([...replayPlayLog(events, 4, 1000).final]).toEqual([1, 1, 0, 0]);
  });

  it("finds long waits while the clock ran, with the board of the wait", () => {
    const { stalls } = replayPlayLog(
      [
        ["start", 0],
        ["move", 1_000, "tap", [[0, 0, 1]]],
        ["pause", 2_000],
        // Paused: the clock does not move, so this is no wait.
        ["start", 2_000],
        ["hint", 80_000, 1, "CORNER_THREE"],
      ],
      2,
      60_000,
    );
    expect(stalls).toEqual([
      {
        t: 2_000,
        gapMs: 78_000,
        states: Uint8Array.from([1, 0]),
        then: "hint",
      },
    ]);
  });

  it("takes percentiles of unsorted values", () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNaN();
  });
});
