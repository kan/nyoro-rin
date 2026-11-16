import { type DailyBoard, dailyPuzzleFromBoard } from "../core/daily";
import type { Puzzle } from "../core/model";

export interface DailyRequest {
  readonly board: DailyBoard;
}

export type DailyResponse =
  { readonly puzzle: Puzzle | undefined } | { readonly error: string };

/**
 * How long the worker may stay silent before the board is worked out here
 * instead: a 10 × 10 board takes about a second on a desktop, several times
 * that on a slow phone.
 */
export const DAILY_REPLY_TIMEOUT_MS = 15000;

export interface DailyBoardOptions {
  /** Starts the worker; tests pass a stand-in. */
  readonly createWorker?: () => Worker;
  readonly replyTimeoutMs?: number;
}

function createDailyWorker(): Worker {
  return new Worker(new URL("./daily-worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * The board to play from the one the server handed out (dailyPuzzleFromBoard),
 * worked out in a worker of its own. Where the worker cannot start, fails or
 * stays silent, the main thread does it: slower, but the day is playable.
 * One worker per call: the calendar button is pressed once in a while.
 */
export function playableDailyPuzzle(
  board: DailyBoard,
  options: DailyBoardOptions = {},
): Promise<Puzzle | undefined> {
  const createWorker = options.createWorker ?? createDailyWorker;
  const replyTimeoutMs = options.replyTimeoutMs ?? DAILY_REPLY_TIMEOUT_MS;
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    return dailyPuzzleFromBoard(board);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (puzzle: Promise<Puzzle | undefined>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(puzzle);
    };
    const here = () => finish(dailyPuzzleFromBoard(board));
    const timer = setTimeout(here, replyTimeoutMs);
    worker.onmessage = (event: MessageEvent<DailyResponse>) => {
      const response = event.data;
      if ("error" in response) here();
      else finish(Promise.resolve(response.puzzle));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      here();
    };
    try {
      worker.postMessage({ board } satisfies DailyRequest);
    } catch {
      // A board that cannot be sent (one not cloneable) is worked out here.
      here();
    }
  });
}
