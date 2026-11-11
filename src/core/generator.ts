import { type BoardGeometry } from "./board";
import { N1, generateN1, rateN1 } from "./generator-n1";
import {
  BOARD_SIZE,
  type BoardSize,
  type Clue,
  type Difficulty,
  type DifficultyRating,
  type GeneratedPuzzle,
} from "./model";

/** The version new puzzles are made with. */
export const CURRENT_GENERATOR_VERSION = N1;

interface VersionedGenerator {
  generate(
    seed: string,
    difficulty: Difficulty,
    size: BoardSize,
  ): GeneratedPuzzle;
  /** The difficulty a board has by this version's rules. */
  rate(geometry: BoardGeometry, clues: readonly Clue[]): DifficultyRating;
}

/** Every released version stays here, frozen (DESIGN.md 13.4). */
const GENERATORS: Readonly<Record<string, VersionedGenerator>> = {
  [N1]: { generate: generateN1, rate: rateN1 },
};

export function isSupportedGeneratorVersion(version: string): boolean {
  return Object.hasOwn(GENERATORS, version);
}

function generatorOf(version: string): VersionedGenerator {
  if (!isSupportedGeneratorVersion(version)) {
    throw new Error(`Unknown generator version: ${version}`);
  }
  return GENERATORS[version];
}

export function generatePuzzle(
  seed: string,
  difficulty: Difficulty,
  options: { readonly version?: string; readonly size?: BoardSize } = {},
): GeneratedPuzzle {
  return generatorOf(options.version ?? CURRENT_GENERATOR_VERSION).generate(
    seed,
    difficulty,
    options.size ?? BOARD_SIZE,
  );
}

/** Rates a board by the rules of the version that made it. */
export function rateDifficulty(
  version: string,
  geometry: BoardGeometry,
  clues: readonly Clue[],
): DifficultyRating {
  return generatorOf(version).rate(geometry, clues);
}
