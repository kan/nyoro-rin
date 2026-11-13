/**
 * A completed play as sent to the server (DATA_CONTRACT.md 「`POST
 * /api/plays`」), and its check. The screen builds it at the clear and queues
 * it (src/core/outbox.ts); the server checks it again, regenerating the board
 * from the seed code, so neither the puzzle ID nor the loop is taken on
 * trust.
 */
import { type Attempt, isCount, parseAttempt } from "./attempt";
import { generatePuzzle } from "./generator";
import { type Difficulty, type Puzzle, isDifficulty } from "./model";
import { isPuzzleId, puzzleId } from "./puzzle-identity";
import type { CompletedPlay } from "./results";
import { isSeedCodeOf, parseSeedCode } from "./seed-code";
import { isRecord } from "./storage";

export interface CompletedPlayUpload extends Attempt {
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: Difficulty;
  readonly completedAt: number;
  readonly elapsedSeconds: number;
  /** The edges of the loop, ascending. */
  readonly loop: readonly number[];
}

/** A play as the server keeps it: the loop is checked and then dropped. */
export interface OnlinePlay extends Omit<CompletedPlayUpload, "loop"> {
  /** Whether it is the ID's ranked first clear of the puzzle. */
  readonly isPublic: boolean;
}

/**
 * The upload of a local clear, made at the clear from the board on screen:
 * its ID and its solution, which the cleared lines equal. The local userId
 * is not an account and is never sent. Fails on a record that the server
 * would refuse by its shape.
 */
export async function createCompletedPlayUpload(
  play: CompletedPlay,
  puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues" | "solution">,
): Promise<CompletedPlayUpload> {
  const upload = parseCompletedPlayUpload({
    ...play,
    puzzleId: await puzzleId(puzzle),
    loop: [...puzzle.solution],
  });
  if (!upload) throw new Error("Invalid completed play.");
  return upload;
}

/**
 * Checks an upload: its shape and ranges, then the board. The seed code must
 * regenerate a board whose ID and solution match the claim.
 */
export async function verifyCompletedPlayUpload(
  value: unknown,
): Promise<CompletedPlayUpload> {
  const play = parseCompletedPlayUpload(value);
  if (!play) throw new Error("Invalid completed play.");
  const code = parseSeedCode(play.seedCode)!;
  const { puzzle } = generatePuzzle(code.seed, code.difficulty, {
    version: code.version,
  });
  if ((await puzzleId(puzzle)) !== play.puzzleId) {
    throw new Error("Puzzle ID does not match the seed code.");
  }
  if (!sameEdges(play.loop, puzzle.solution)) {
    throw new Error("The loop is not the solution.");
  }
  return play;
}

/**
 * Checks the shape and ranges only; the board is checked by the server. The
 * seed code must be exactly as written (no padding) and name the same
 * version and difficulty.
 */
export function parseCompletedPlayUpload(
  value: unknown,
): CompletedPlayUpload | undefined {
  if (!isRecord(value)) return undefined;
  const attempt = parseAttempt(value);
  const {
    puzzleId: id,
    seedCode,
    generatorVersion,
    difficulty,
    completedAt,
    elapsedSeconds,
    loop,
  } = value;
  if (
    !attempt ||
    // A clear's records agree: no hint, no hint stage.
    (attempt.hintsUsed === 0) !== (attempt.maxHintStage === 0) ||
    !isPuzzleId(id) ||
    !isDifficulty(difficulty) ||
    typeof generatorVersion !== "string" ||
    !isSeedCodeOf(seedCode, generatorVersion, difficulty) ||
    !isCount(completedAt) ||
    completedAt < attempt.startedAt ||
    !isCount(elapsedSeconds) ||
    !Array.isArray(loop) ||
    !loop.every(isCount)
  ) {
    return undefined;
  }
  return {
    ...attempt,
    puzzleId: id,
    seedCode,
    generatorVersion,
    difficulty,
    completedAt,
    elapsedSeconds,
    loop: loop as number[],
  };
}

/** Both ascending, as the contract writes edge lists. */
function sameEdges(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((edge, i) => edge === b[i]);
}
