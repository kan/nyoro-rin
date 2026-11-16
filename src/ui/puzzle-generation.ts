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

/**
 * How long the worker may stay silent before it is given up. A 7 × 7 hard
 * board takes up to about 0.4 s on a desktop (npm run measure, 2026-11) and
 * several times that on a slow phone, with the worker's start on top. A
 * worker silent for this long was most likely stopped by the browser (low
 * memory, for one): without a limit, the new board would never come.
 */
export const REPLY_TIMEOUT_MS = 10000;

/** Silent replies in a row after which boards are made on the main thread. */
export const SILENT_LIMIT = 2;

export interface PuzzleGeneratorOptions {
  /** Starts the worker; tests pass a stand-in. */
  readonly createWorker?: () => Worker;
  readonly replyTimeoutMs?: number;
}

function createPuzzleWorker(): Worker {
  return new Worker(new URL("./puzzle-worker.ts", import.meta.url), {
    type: "module",
  });
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
  /** Requests in a row the worker did not answer in time. */
  private silentInARow = 0;
  private nextId = 1;
  private pending: Pending | undefined;
  private replyTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly createWorker: () => Worker;
  private readonly replyTimeoutMs: number;

  constructor(options: PuzzleGeneratorOptions = {}) {
    this.createWorker = options.createWorker ?? createPuzzleWorker;
    this.replyTimeoutMs = options.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
  }

  generate(
    seed: string,
    difficulty: Difficulty,
    version: string,
  ): Promise<Puzzle> {
    if (this.pending) {
      this.pending.reject(new SupersededError());
      this.pending = undefined;
      this.clearReplyTimer();
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
      if (worker) {
        worker.postMessage(request);
        this.replyTimer = setTimeout(
          () => this.onWorkerSilent(),
          this.replyTimeoutMs,
        );
      } else this.generateHere(this.pending);
    });
  }

  private startWorker(): Worker | undefined {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      const worker = this.createWorker();
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

  private clearReplyTimer(): void {
    clearTimeout(this.replyTimer);
    this.replyTimer = undefined;
  }

  /** A worker that failed: from now on, boards are made here, this one too. */
  private onWorkerFailed(): void {
    this.workerFailed = true;
    this.clearReplyTimer();
    this.stopWorker();
    if (this.pending) this.generateHere(this.pending);
  }

  /**
   * A worker that stopped answering: this board is made here, and the next
   * request starts a fresh worker. One slow board (a slow phone, the worker
   * starting at the same time) must not leave every later one on the main
   * thread; a worker silent SILENT_LIMIT times in a row is given up, so a
   * worker that never answers does not cost every board the full wait.
   */
  private onWorkerSilent(): void {
    this.silentInARow += 1;
    if (this.silentInARow >= SILENT_LIMIT) this.workerFailed = true;
    this.clearReplyTimer();
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
    this.clearReplyTimer();
    this.silentInARow = 0;
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
