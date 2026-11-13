/**
 * Reading play logs back (DESIGN.md 20.1): replaying the events on the board
 * to find where a player stopped to think. The reader (scripts/stats.ts) asks
 * the hint finder what the next step was at each of those boards, which
 * tells which techniques players get stuck on.
 */
import { type EdgeStates } from "./model";
import type { PlayLogEvent } from "./play-log";

/** A board the player looked at for a long time without a move. */
export interface Stall {
  /** The play clock when the wait began. */
  readonly t: number;
  readonly gapMs: number;
  /** The board during the wait. */
  readonly states: EdgeStates;
  /** What ended the wait: the next event's kind. */
  readonly then: PlayLogEvent[0];
}

export interface Replay {
  readonly stalls: readonly Stall[];
  /** The board after the last event. */
  readonly final: EdgeStates;
}

/**
 * Replays a log on an empty board of `edgeCount` edges: every change to the
 * board is a move with the edges it changed, undo and reset included. A wait
 * counts only while the clock ran: between a pause and the next start the
 * play clock does not move at all.
 */
export function replayPlayLog(
  events: readonly PlayLogEvent[],
  edgeCount: number,
  minGapMs: number,
): Replay {
  const states = new Uint8Array(edgeCount);
  const stalls: Stall[] = [];
  let previous: PlayLogEvent | undefined;
  for (const event of events) {
    const [kind, t] = event;
    if (previous && previous[0] !== "pause" && t - previous[1] >= minGapMs) {
      stalls.push({
        t: previous[1],
        gapMs: t - previous[1],
        states: Uint8Array.from(states),
        then: kind,
      });
    }
    if (kind === "move") {
      for (const [edge, , after] of event[3]) states[edge] = after;
    }
    previous = event;
  }
  return { stalls, final: states };
}

/** The value at a share of the sorted values (0.5 for the median). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
