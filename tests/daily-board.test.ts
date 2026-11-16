import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type DailyBoard, dailyPuzzleFromBoard } from "../src/core/daily";
import { dailySeed, generateDailyPuzzle } from "../src/core/daily-generator";
import type { Puzzle } from "../src/core/model";
import { puzzleId } from "../src/core/puzzle-identity";
import {
  DAILY_REPLY_TIMEOUT_MS,
  type DailyRequest,
  type DailyResponse,
  playableDailyPuzzle,
} from "../src/ui/daily-board";

/** A stand-in for the daily worker that answers only when told to. */
class FakeWorker {
  onmessage: ((event: MessageEvent<DailyResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: DailyRequest[] = [];
  terminated = false;

  postMessage(request: DailyRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: DailyResponse): void {
    this.onmessage?.({ data } as MessageEvent<DailyResponse>);
  }
}

describe("the daily board off the main thread", () => {
  let board: DailyBoard;
  let expected: Puzzle;

  beforeAll(async () => {
    const date = "2026-11-16";
    const puzzle = generateDailyPuzzle(
      await dailySeed("nyoro-test-daily-secret", date),
      date,
    );
    board = {
      date,
      puzzleId: await puzzleId(puzzle),
      generatorVersion: puzzle.generatorVersion,
      size: 10,
      clues: puzzle.clues,
    };
    expected = (await dailyPuzzleFromBoard(board))!;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function withWorker() {
    const worker = new FakeWorker();
    const options = { createWorker: () => worker as unknown as Worker };
    return { worker, options };
  }

  it("uses the worker's board and stops the worker", async () => {
    const { worker, options } = withWorker();
    const result = playableDailyPuzzle(board, options);
    expect(worker.requests).toEqual([{ board }]);
    worker.reply({ puzzle: expected });
    await expect(result).resolves.toEqual(expected);
    expect(worker.terminated).toBe(true);
  });

  it("passes on the worker's verdict of a bad board", async () => {
    const { worker, options } = withWorker();
    const result = playableDailyPuzzle(board, options);
    worker.reply({ puzzle: undefined });
    await expect(result).resolves.toBeUndefined();
  });

  it("works it out here when the worker fails or errs", async () => {
    const failed = withWorker();
    const first = playableDailyPuzzle(board, failed.options);
    failed.worker.onerror?.({ preventDefault() {} } as ErrorEvent);
    await expect(first).resolves.toEqual(expected);

    const erred = withWorker();
    const second = playableDailyPuzzle(board, erred.options);
    erred.worker.reply({ error: "boom" });
    await expect(second).resolves.toEqual(expected);
  });

  it("works it out here when no worker starts", async () => {
    const result = playableDailyPuzzle(board, {
      createWorker: () => {
        throw new Error("no module workers");
      },
    });
    await expect(result).resolves.toEqual(expected);
  });

  it("works it out here when the worker stays silent", async () => {
    vi.useFakeTimers();
    const { worker, options } = withWorker();
    const result = playableDailyPuzzle(board, options);
    vi.advanceTimersByTime(DAILY_REPLY_TIMEOUT_MS);
    expect(worker.terminated).toBe(true);
    // A late answer changes nothing.
    worker.reply({ puzzle: undefined });
    await expect(result).resolves.toEqual(expected);
  });
});
