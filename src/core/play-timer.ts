/**
 * The clear time (DESIGN.md 16.3): only time spent playing counts. A new
 * board, a pause, a hidden tab and a reload all wait on READY, and the
 * clock runs again only from its OK. Times are passed in, never read here.
 */
export type TimerStatus = "ready" | "running" | "finished";

export interface PlayTimer {
  readonly status: TimerStatus;
  /** Time counted before `activeSince`. */
  readonly elapsedMs: number;
  /** When the clock last started; set only while running. */
  readonly activeSince?: number;
}

export const WAITING_TIMER: PlayTimer = { status: "ready", elapsedMs: 0 };

export function elapsedTimerMs(timer: PlayTimer, now: number): number {
  const running =
    timer.status === "running" && timer.activeSince !== undefined
      ? Math.max(0, now - timer.activeSince)
      : 0;
  return timer.elapsedMs + running;
}

/** Whole seconds, as shown and recorded. */
export function elapsedTimerSeconds(timer: PlayTimer, now: number): number {
  return Math.floor(elapsedTimerMs(timer, now) / 1000);
}

/** READY's OK. */
export function startTimer(timer: PlayTimer, now: number): PlayTimer {
  if (timer.status !== "ready") return timer;
  return { status: "running", elapsedMs: timer.elapsedMs, activeSince: now };
}

/** Back to READY, keeping the time counted so far. */
export function pauseTimer(timer: PlayTimer, now: number): PlayTimer {
  if (timer.status !== "running") return timer;
  return { status: "ready", elapsedMs: elapsedTimerMs(timer, now) };
}

export function finishTimer(timer: PlayTimer, now: number): PlayTimer {
  if (timer.status === "finished") return timer;
  return { status: "finished", elapsedMs: elapsedTimerMs(timer, now) };
}
