import { describe, expect, it } from "vitest";
import {
  WAITING_TIMER,
  elapsedTimerMs,
  elapsedTimerSeconds,
  finishTimer,
  pauseTimer,
  startTimer,
} from "../src/core/play-timer";

describe("the clock (DESIGN.md 16.3)", () => {
  it("does not count the time READY waits", () => {
    const started = startTimer(WAITING_TIMER, 5_000);
    expect(elapsedTimerMs(WAITING_TIMER, 5_000)).toBe(0);
    expect(elapsedTimerMs(started, 8_000)).toBe(3_000);
  });

  it("stops while paused and goes on from there after OK", () => {
    let timer = startTimer(WAITING_TIMER, 0);
    timer = pauseTimer(timer, 2_500);
    expect(timer).toEqual({ status: "ready", elapsedMs: 2_500 });
    expect(elapsedTimerMs(timer, 60_000)).toBe(2_500);
    timer = startTimer(timer, 60_000);
    expect(elapsedTimerMs(timer, 61_000)).toBe(3_500);
  });

  it("keeps the clear time once finished", () => {
    const finished = finishTimer(startTimer(WAITING_TIMER, 0), 4_200);
    expect(elapsedTimerSeconds(finished, 99_999)).toBe(4);
    expect(startTimer(finished, 99_999)).toBe(finished);
    expect(pauseTimer(finished, 99_999)).toBe(finished);
    expect(finishTimer(finished, 99_999)).toBe(finished);
  });

  it("does not count a clock that ran backwards", () => {
    expect(elapsedTimerMs(startTimer(WAITING_TIMER, 10_000), 9_000)).toBe(0);
  });
});
