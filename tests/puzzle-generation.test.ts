import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import { CURRENT_GENERATOR_VERSION as GENERATOR_VERSION } from "../src/core/generator";
import {
  PuzzleGenerator,
  REPLY_TIMEOUT_MS,
  SILENT_LIMIT,
  randomSeed,
  type GenerationRequest,
  type GenerationResponse,
} from "../src/ui/puzzle-generation";
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

/** A stand-in for the puzzle worker that answers only when told to. */
class FakeWorker {
  onmessage: ((event: MessageEvent<GenerationResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: GenerationRequest[] = [];
  terminated = false;

  postMessage(request: GenerationRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(): void {
    const { id, seed, difficulty, version } = this.requests.at(-1)!;
    this.onmessage?.({
      data: {
        id,
        puzzle: generatePuzzle(seed, difficulty, { version }).puzzle,
      },
    } as MessageEvent<GenerationResponse>);
  }
}

describe("the puzzle worker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function generatorWith(workers: FakeWorker[]) {
    return new PuzzleGenerator({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
  }

  it("uses the worker's board when it answers in time", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    const board = generator.generate("answer", "easy", GENERATOR_VERSION);
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS - 1);
    workers[0]!.answer();
    await expect(board).resolves.toEqual(
      generatePuzzle("answer", "easy").puzzle,
    );
    // The timer of the answered request does nothing later.
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS);
    expect(workers[0]!.terminated).toBe(false);
  });

  it("makes the board on the main thread when the worker stays silent", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    const board = generator.generate("silent", "easy", GENERATOR_VERSION);
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
    // The main thread starts on the next turn, so the screen can update.
    await vi.runOnlyPendingTimersAsync();
    await expect(board).resolves.toEqual(
      generatePuzzle("silent", "easy").puzzle,
    );
    expect(workers[0]!.terminated).toBe(true);

    // One slow board does not give the worker up: the next takes a fresh one.
    const next = generator.generate("next", "easy", GENERATOR_VERSION);
    expect(workers).toHaveLength(2);
    workers[1]!.answer();
    await expect(next).resolves.toEqual(generatePuzzle("next", "easy").puzzle);
  });

  it("gives the worker up after it is silent twice in a row", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    for (const seed of ["silent-1", "silent-2"]) {
      const board = generator.generate(seed, "easy", GENERATOR_VERSION);
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      await vi.runOnlyPendingTimersAsync();
      await expect(board).resolves.toEqual(generatePuzzle(seed, "easy").puzzle);
    }
    expect(workers).toHaveLength(SILENT_LIMIT);

    // From now on, boards are made here at once, without the wait.
    const next = generator.generate("next", "easy", GENERATOR_VERSION);
    await vi.runOnlyPendingTimersAsync();
    await expect(next).resolves.toEqual(generatePuzzle("next", "easy").puzzle);
    expect(workers).toHaveLength(SILENT_LIMIT);
  });

  it("counts silences in a row only: an answer in between resets them", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    const silent = generator.generate("silent", "easy", GENERATOR_VERSION);
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
    await vi.runOnlyPendingTimersAsync();
    await silent;
    const answered = generator.generate("answered", "easy", GENERATOR_VERSION);
    workers[1]!.answer();
    await answered;
    const again = generator.generate("again", "easy", GENERATOR_VERSION);
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
    await vi.runOnlyPendingTimersAsync();
    await again;
    // Silent once since the answer: a fresh worker is still tried. (The one
    // that answered took "again" too, and was stopped when silent.)
    generator.generate("last", "easy", GENERATOR_VERSION).catch(() => {});
    expect(workers).toHaveLength(3);
  });

  it("makes every board on the main thread once the worker failed", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    const board = generator.generate("failed", "easy", GENERATOR_VERSION);
    workers[0]!.onerror?.({ preventDefault() {} } as ErrorEvent);
    await vi.runOnlyPendingTimersAsync();
    await expect(board).resolves.toEqual(
      generatePuzzle("failed", "easy").puzzle,
    );

    // The failed worker is not tried again.
    const next = generator.generate("next", "easy", GENERATOR_VERSION);
    await vi.runOnlyPendingTimersAsync();
    await expect(next).resolves.toEqual(generatePuzzle("next", "easy").puzzle);
    expect(workers).toHaveLength(1);
  });

  it("gives each request its own time, not the time left of the last", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const generator = generatorWith(workers);
    const first = generator.generate("first", "easy", GENERATOR_VERSION);
    first.catch(() => {});
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS - 1);
    const second = generator.generate("second", "easy", GENERATOR_VERSION);
    await expect(first).rejects.toThrow();
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS - 1);
    // A new worker took the second request, and is still in time.
    expect(workers).toHaveLength(2);
    workers[1]!.answer();
    await expect(second).resolves.toEqual(
      generatePuzzle("second", "easy").puzzle,
    );
  });
});
