import { generatePuzzle } from "../core/generator";
import { type Difficulty, type Puzzle } from "../core/model";

export interface GenerationRequest {
  readonly id: number;
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly version: string;
}

export type GenerationResponse =
  | { readonly id: number; readonly puzzle: Puzzle }
  | { readonly id: number; readonly error: string };

interface Pending {
  readonly request: GenerationRequest;
  resolve(puzzle: Puzzle): void;
  reject(error: Error): void;
}

/** The rejection of a request that a newer one replaced. */
export class SupersededError extends Error {
  constructor() {
    super("A newer board was asked for.");
  }
}

/**
 * Asks the puzzle worker for boards, one at a time: only the newest request
 * matters, so a new one stops the worker on the old one. Where a worker
 * cannot run (a module worker on Safari 14, blocked scripts), boards are
 * made on the main thread instead: slower, but still playable.
 */
export class PuzzleGenerator {
  private worker: Worker | undefined;
  private workerFailed = false;
  private nextId = 1;
  private pending: Pending | undefined;

  generate(
    seed: string,
    difficulty: Difficulty,
    version: string,
  ): Promise<Puzzle> {
    if (this.pending) {
      this.pending.reject(new SupersededError());
      this.pending = undefined;
      // The worker is busy with the old board; a fresh one starts at once.
      this.stopWorker();
    }
    const request: GenerationRequest = {
      id: this.nextId,
      seed,
      difficulty,
      version,
    };
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending = { request, resolve, reject };
      const worker = this.startWorker();
      if (worker) worker.postMessage(request);
      else this.generateHere(this.pending);
    });
  }

  private startWorker(): Worker | undefined {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      const worker = new Worker(
        new URL("./puzzle-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<GenerationResponse>) =>
        this.settle(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.onWorkerFailed();
      };
      this.worker = worker;
    } catch {
      this.workerFailed = true;
    }
    return this.worker;
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  /** From now on, boards are made here; the one in progress too. */
  private onWorkerFailed(): void {
    this.workerFailed = true;
    this.stopWorker();
    if (this.pending) this.generateHere(this.pending);
  }

  private generateHere(pending: Pending): void {
    const { seed, difficulty, version } = pending.request;
    // Let the screen show that it is working before the long task.
    setTimeout(() => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      try {
        pending.resolve(generatePuzzle(seed, difficulty, { version }).puzzle);
      } catch (error) {
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }, 0);
  }

  private settle(response: GenerationResponse): void {
    const pending = this.pending;
    if (!pending || pending.request.id !== response.id) return;
    this.pending = undefined;
    if ("puzzle" in response) pending.resolve(response.puzzle);
    else pending.reject(new Error(response.error));
  }
}

const SEED_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** The largest multiple of the alphabet's length a byte can reach. */
const UNBIASED_LIMIT =
  Math.floor(256 / SEED_ALPHABET.length) * SEED_ALPHABET.length;

/** A short random seed for a new board, easy to read aloud and type. */
export function randomSeed(length = 8): string {
  let seed = "";
  while (seed.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // Bytes past the last whole multiple would favour the first letters.
      if (byte >= UNBIASED_LIMIT || seed.length >= length) continue;
      seed += SEED_ALPHABET[byte % SEED_ALPHABET.length];
    }
  }
  return seed;
}
