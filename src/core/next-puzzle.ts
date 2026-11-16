/**
 * The next ordinary puzzle from the rankings (DESIGN.md 13.8): a board other
 * players have a public first record on, so that players meet on the same
 * boards instead of each solving one of their own. Without a usable
 * candidate the device makes a new board, as before.
 */
import { CURRENT_GENERATOR_VERSION } from "./generator";
import { type Difficulty, type Puzzle } from "./model";
import { isPuzzleId } from "./puzzle-identity";
import { type RandomSource, randomInt } from "./random";
import {
  MAX_SEED_CODE_LENGTH,
  type SeedCode,
  parseSeedCode,
} from "./seed-code";

/** One board GET /api/next-puzzle offers (DATA_CONTRACT.md). */
export interface RankedPuzzleCandidate {
  readonly puzzleId: string;
  readonly seedCode: string;
  /** Players with a public first record on the board. */
  readonly players: number;
}

/** The most candidates the API returns. */
export const MAX_CANDIDATES = 30;

function isCandidate(value: unknown): value is RankedPuzzleCandidate {
  if (typeof value !== "object" || value === null) return false;
  const { puzzleId, seedCode, players } = value as Record<string, unknown>;
  return (
    isPuzzleId(puzzleId) &&
    typeof seedCode === "string" &&
    seedCode.length <= MAX_SEED_CODE_LENGTH &&
    Number.isSafeInteger(players) &&
    (players as number) > 0
  );
}

/**
 * The candidates of an API answer; anything malformed is dropped. Undefined
 * when the answer has no list at all, which counts as a failure.
 */
export function parseCandidates(
  body: unknown,
): readonly RankedPuzzleCandidate[] | undefined {
  const list = (body as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, MAX_CANDIDATES).filter(isCandidate);
}

/** What the device has already seen, which no candidate may repeat. */
export interface SeenBoards {
  /** Boards shown on this device recently, by puzzle ID. */
  readonly puzzleIds: ReadonlySet<string>;
  /** Seed codes in this device's history (played or cleared here). */
  readonly seedCodes: ReadonlySet<string>;
}

/**
 * The candidate to play: among the unseen ones of the current version and
 * the difficulty asked for, one with the most players, ties drawn at random.
 */
export function chooseNextPuzzle(
  candidates: readonly RankedPuzzleCandidate[],
  difficulty: Difficulty,
  seen: SeenBoards,
  random: RandomSource,
):
  | { readonly candidate: RankedPuzzleCandidate; readonly code: SeedCode }
  | undefined {
  const usable = candidates.flatMap((candidate) => {
    if (seen.puzzleIds.has(candidate.puzzleId)) return [];
    if (seen.seedCodes.has(candidate.seedCode)) return [];
    const code = parseSeedCode(candidate.seedCode);
    // Older versions keep their rankings but are not offered (DESIGN.md 13.8).
    if (
      !code ||
      code.version !== CURRENT_GENERATOR_VERSION ||
      code.difficulty !== difficulty
    ) {
      return [];
    }
    return [{ candidate, code }];
  });
  if (usable.length === 0) return undefined;
  const most = Math.max(...usable.map(({ candidate }) => candidate.players));
  const popular = usable.filter(({ candidate }) => candidate.players === most);
  return popular[randomInt(random, popular.length)];
}

export interface NextPuzzleSource {
  /** GET /api/next-puzzle's body; throws when it cannot be had. */
  fetchCandidates(difficulty: Difficulty): Promise<unknown>;
  /** Regenerates a board from its seed code (the puzzle worker). */
  generate(code: SeedCode): Promise<Puzzle>;
  /** The puzzle ID of a board (src/core/puzzle-identity.ts). */
  identify(puzzle: Puzzle): Promise<string>;
}

/**
 * A ranked board to play next, regenerated here from its seed code and
 * checked against the puzzle ID the server gave: the board itself never
 * comes from the server. Undefined, for the device to make a new board,
 * when there is no candidate or anything on the way fails.
 */
export async function pickRankedPuzzle(
  difficulty: Difficulty,
  seen: SeenBoards,
  source: NextPuzzleSource,
  random: RandomSource,
): Promise<{ readonly puzzle: Puzzle; readonly puzzleId: string } | undefined> {
  try {
    const candidates = parseCandidates(
      await source.fetchCandidates(difficulty),
    );
    if (!candidates) return undefined;
    const chosen = chooseNextPuzzle(candidates, difficulty, seen, random);
    if (!chosen) return undefined;
    const puzzle = await source.generate(chosen.code);
    const id = await source.identify(puzzle);
    return id === chosen.candidate.puzzleId
      ? { puzzle, puzzleId: id }
      : undefined;
  } catch {
    return undefined;
  }
}
