import { describe, expect, it } from "vitest";
import {
  MAX_LOG_EVENTS,
  type PlayLogEvent,
  appendEvent,
  changesBetween,
  emptyPlayLog,
  hasEnded,
  isPlayLogEvent,
  loadPlayLog,
  savePlayLog,
  summarizePlayLog,
} from "../src/core/play-log";
import { memoryStorage } from "./helpers";

const PLAY_ID = "00000000-0000-4000-8000-000000000001";

describe("the play log (DESIGN.md 20.1)", () => {
  it("lists the edges a move changed", () => {
    const before = Uint8Array.from([0, 1, 2, 0]);
    const after = Uint8Array.from([1, 1, 0, 0]);
    expect(changesBetween(before, after)).toEqual([
      [0, 0, 1],
      [2, 2, 0],
    ]);
  });

  it("stops growing at the limit but still takes the end", () => {
    let log = emptyPlayLog(PLAY_ID);
    for (let i = 0; i < MAX_LOG_EVENTS + 5; i += 1) {
      log = appendEvent(log, ["zoom", i]);
    }
    expect(log.events).toHaveLength(MAX_LOG_EVENTS);
    expect(log.truncated).toBe(true);
    log = appendEvent(log, ["end", 1, "cleared"]);
    expect(hasEnded(log)).toBe(true);
  });

  it("keeps the log of the attempt in play only", () => {
    const { storage } = memoryStorage();
    const log = appendEvent(emptyPlayLog(PLAY_ID), ["start", 0]);
    savePlayLog(storage, log);
    expect(loadPlayLog(storage, PLAY_ID)).toEqual(log);
    const other = "00000000-0000-4000-8000-000000000002";
    expect(loadPlayLog(storage, other)).toEqual(emptyPlayLog(other));
  });

  it("checks each kind of event", () => {
    const good: PlayLogEvent[] = [
      ["start", 0],
      ["move", 5, "stroke", [[1, 0, 1]]],
      ["hint", 6, 3, "LINE_INTO_THREE"],
      ["assist", 7, 0],
      ["tool", 8, "cross"],
      ["end", 9, "abandoned"],
    ];
    expect(good.every(isPlayLogEvent)).toBe(true);
    for (const bad of [
      ["start", -1],
      ["move", 5, "tap", []],
      ["hint", 6, 0, "ZERO"],
      ["hint", 6, 1, "<b>"],
      ["end", 9, "lost"],
      ["zoom", 1, "extra"],
      ["undo", 1],
    ]) {
      expect(isPlayLogEvent(bad)).toBe(false);
    }
  });

  it("counts moves, undos and the longest gap", () => {
    expect(
      summarizePlayLog([
        ["start", 0],
        ["move", 1_000, "stroke", [[1, 0, 1]]],
        ["move", 1_200, "stroke-more", [[2, 0, 1]]],
        ["pause", 30_000],
        ["start", 30_000],
        ["move", 31_000, "undo", [[2, 1, 0]]],
        ["hint", 91_000, 1, "ZERO"],
      ]),
    ).toEqual({
      moves: 1,
      undos: 1,
      resets: 0,
      hintSteps: 1,
      pauses: 1,
      longestGapMs: 60_000,
    });
  });
});
