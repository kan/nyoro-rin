import { isSupportedGeneratorVersion } from "./generator";
import { type Difficulty, isDifficulty } from "./model";

/**
 * The seed code shown to players: `NYORO:<version>:<difficulty>:<seed>`
 * (DATA_CONTRACT.md). It is the input that regenerates a board, not the
 * puzzle's identity.
 */
export interface SeedCode {
  readonly version: string;
  readonly difficulty: Difficulty;
  readonly seed: string;
}

const PREFIX = "NYORO";
/** In UTF-16 code units. */
export const MAX_SEED_LENGTH = 128;

/** A lone surrogate (half of an emoji cut off) cannot be URI-encoded. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function isValidSeed(seed: string): boolean {
  return (
    seed.length >= 1 &&
    seed.length <= MAX_SEED_LENGTH &&
    !LONE_SURROGATE.test(seed)
  );
}

export function encodeSeedCode(code: SeedCode): string {
  return `${PREFIX}:${code.version}:${code.difficulty}:${encodeURIComponent(code.seed)}`;
}

/**
 * Reads a code a player typed or pasted; surrounding spaces are ignored.
 * Only the form encodeSeedCode writes is accepted, so one board has one
 * code (no raw spaces, no needlessly escaped letters).
 */
export function parseSeedCode(text: string): SeedCode | undefined {
  const trimmed = text.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return undefined;
  const [, version, difficulty, encodedSeed] = parts;
  if (!isSupportedGeneratorVersion(version) || !isDifficulty(difficulty)) {
    return undefined;
  }
  let seed: string;
  try {
    seed = decodeURIComponent(encodedSeed);
  } catch {
    return undefined;
  }
  if (!isValidSeed(seed)) return undefined;
  const code = { version, difficulty, seed };
  return encodeSeedCode(code) === trimmed ? code : undefined;
}
