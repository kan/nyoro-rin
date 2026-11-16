import { describe, expect, it } from "vitest";
import { isWeeklyMetric, rankingWeekOf } from "../src/core/weekly-ranking";

const JST = 9 * 3_600_000;
/** An instant given as a time in Japan. */
const jst = (y: number, m: number, d: number, h = 0, min = 0, ms = 0) =>
  Date.UTC(y, m - 1, d, h, min, 0, ms) - JST;

describe("the ranking week", () => {
  it("starts on Monday 00:00 in Japan and lasts seven days", () => {
    const week = rankingWeekOf(jst(2026, 11, 11, 12));
    expect(week.start).toBe(jst(2026, 11, 9));
    expect(week.end).toBe(jst(2026, 11, 16));
  });

  it("puts Monday 00:00 in the new week and the instant before in the old", () => {
    expect(rankingWeekOf(jst(2026, 11, 16)).start).toBe(jst(2026, 11, 16));
    expect(rankingWeekOf(jst(2026, 11, 16) - 1).start).toBe(jst(2026, 11, 9));
  });

  it("keeps Sunday night in Japan in the week, though UTC is still Sunday", () => {
    // Sunday 23:59 JST is Sunday 14:59 UTC; Monday 08:59 JST is Sunday UTC.
    expect(rankingWeekOf(jst(2026, 11, 15, 23, 59)).start).toBe(
      jst(2026, 11, 9),
    );
    expect(rankingWeekOf(jst(2026, 11, 16, 8, 59)).start).toBe(
      jst(2026, 11, 16),
    );
  });

  it("crosses a month and a year", () => {
    // 2027-01-01 is a Friday; its week starts on Monday 2026-12-28.
    expect(rankingWeekOf(jst(2027, 1, 1, 9)).start).toBe(jst(2026, 12, 28));
  });

  it("knows the two orders", () => {
    expect(isWeeklyMetric("clears")).toBe(true);
    expect(isWeeklyMetric("score")).toBe(true);
    expect(isWeeklyMetric("time")).toBe(false);
  });
});
