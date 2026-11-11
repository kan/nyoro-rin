/**
 * Generator version n1. Frozen: once released, the same seed must keep
 * giving the same board (DESIGN.md 13.4). Change the algorithm in a new
 * version instead; the fixed hashes in tests/generator.test.ts guard this.
 */
import { type BoardGeometry, boardGeometry } from "./board";
import { solveLogically } from "./logical";
import {
  BOARD_SIZE,
  type BoardSize,
  type Clue,
  type Difficulty,
  type DifficultyRating,
  type GeneratedPuzzle,
} from "./model";
import {
  type RandomSource,
  createWideSeededRandom,
  randomInt,
  shuffled,
} from "./random";
import { cluesOfLoop, loopAroundCells } from "./rules";
import { solveCompletely } from "./solver";
import { type BasicTechniqueId } from "./techniques";

export const N1 = "n1";

/**
 * The techniques n1 boards are rated with. Fixed here, so that techniques
 * added later (the intermediate ones of DESIGN.md 12.3) do not change n1.
 */
const N1_TECHNIQUES: readonly BasicTechniqueId[] = [
  "ZERO",
  "CORNER_ONE",
  "CORNER_THREE",
  "ADJACENT_THREES",
  "DIAGONAL_THREES",
  "CLUE_SATURATED",
  "CLUE_REMAINING",
  "VERTEX_BRANCH",
  "VERTEX_CONTINUE",
  "VERTEX_DEAD_END",
  "SMALL_LOOP",
];

/**
 * The most trials each difficulty may need. Without intermediate techniques
 * or INSIDE_OUTSIDE, normal and hard are told apart by trial count
 * (DESIGN.md 13.2); measured with `npm run measure`. The hard cap bounds the
 * work per board.
 */
const N1_MAX_TRIALS: Readonly<Record<Difficulty, number>> = {
  easy: 0,
  normal: 3,
  hard: 20,
};

/** The fewest clues each difficulty keeps, as a share of the cells (DESIGN.md 13.2). */
const MIN_CLUE_SHARE: Readonly<Record<Difficulty, number>> = {
  easy: 0.3,
  normal: 0.2,
  hard: 0,
};

/** The inside of the loop covers this share of the cells. */
const INSIDE_SHARE_MIN = 0.42;
const INSIDE_SHARE_SPAN = 0.16;
/** Failed growth steps before a region is taken as it is. */
const MAX_STUCK_GROWTH = 400;
/** Fresh boards to try before giving up. */
const MAX_ATTEMPTS = 200;

/** The difficulty of a board by n1's rules. */
export function rateN1(
  geometry: BoardGeometry,
  clues: readonly Clue[],
): DifficultyRating {
  const result = solveLogically(geometry, clues, {
    techniques: N1_TECHNIQUES,
    maxTrials: N1_MAX_TRIALS.hard,
  });
  if (!result.solved) return { trials: result.trials };
  const difficulty: Difficulty =
    result.trials === 0
      ? "easy"
      : result.trials <= N1_MAX_TRIALS.normal
        ? "normal"
        : "hard";
  return { difficulty, trials: result.trials };
}

/** Solvable within the difficulty (the test of each clue removal). */
function solvableWithin(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  difficulty: Difficulty,
): boolean {
  return solveLogically(geometry, clues, {
    techniques: N1_TECHNIQUES,
    maxTrials: N1_MAX_TRIALS[difficulty],
  }).solved;
}

export function generateN1(
  seed: string,
  difficulty: Difficulty,
  size: BoardSize = BOARD_SIZE,
): GeneratedPuzzle {
  const geometry = boardGeometry(size);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Each attempt draws from its own stream, derived from the seed, so a
    // retry is as reproducible as the first try (DESIGN.md 13.3).
    const random = createWideSeededRandom(
      `${N1}:${size}:${difficulty}:${seed}:${attempt}`,
    );
    const inside = growInside(geometry, random);
    if (!inside) continue;
    const solution = loopAroundCells(geometry, inside);
    const fullClues = cluesOfLoop(geometry, solution);
    // No node limit: the answer must be the mathematical one, so that a
    // change in how the shared solver searches cannot change n1's boards.
    const unique = solveCompletely(geometry, fullClues, {
      nodeLimit: Infinity,
    });
    if (unique.status !== "unique") continue;

    const clues = removeClues(geometry, fullClues, inside, difficulty, random);
    if (!clues) continue;
    const rating = rateN1(geometry, clues);
    if (rating.difficulty !== difficulty) continue;
    // The logical solve already proves the solution unique; check it apart
    // from the techniques anyway (AGENTS.md 「Puzzle Generator」). A failure
    // here is a bug in a technique, not a board to skip.
    const check = solveCompletely(geometry, clues, { nodeLimit: Infinity });
    if (
      check.status !== "unique" ||
      check.solution!.join() !== solution.join()
    ) {
      throw new Error(
        `n1 made a board the complete solver rejects (seed ${seed}, ${difficulty})`,
      );
    }
    return {
      puzzle: { generatorVersion: N1, difficulty, seed, size, clues, solution },
      trials: rating.trials,
      attempt,
    };
  }
  throw new Error(
    `n1 could not generate a ${difficulty} board for seed ${seed}`,
  );
}

/**
 * Grows the inside of the loop one cell at a time from a cell off the
 * border, never making a 2 × 2 checkerboard or an outside hole
 * (DESIGN.md 13.1).
 */
function growInside(
  geometry: BoardGeometry,
  random: RandomSource,
): Uint8Array | undefined {
  const size = geometry.size;
  const inside = new Uint8Array(geometry.cellCount);
  const target = Math.floor(
    geometry.cellCount * (INSIDE_SHARE_MIN + random.next() * INSIDE_SHARE_SPAN),
  );
  const startRow = 1 + randomInt(random, size - 2);
  const startCol = 1 + randomInt(random, size - 2);
  inside[startRow * size + startCol] = 1;
  let count = 1;
  let stuck = 0;
  const at = (r: number, c: number) =>
    r < 0 || c < 0 || r >= size || c >= size ? 0 : inside[r * size + c];

  while (count < target && stuck < MAX_STUCK_GROWTH) {
    // Cells touching the inside on fewer sides weigh more, which keeps the
    // region thin and the loop winding.
    const frontier: number[] = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (inside[r * size + c]) continue;
        const touching =
          at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1);
        const weight =
          touching === 0 ? 0 : touching === 1 ? 4 : touching === 2 ? 2 : 1;
        for (let w = 0; w < weight; w += 1) frontier.push(r * size + c);
      }
    }
    if (frontier.length === 0) break;
    const pick = frontier[randomInt(random, frontier.length)];
    inside[pick] = 1;
    if (
      makesCheckerboard(geometry, inside, pick) ||
      !outsideReachesBorder(geometry, inside)
    ) {
      inside[pick] = 0;
      stuck += 1;
    } else {
      count += 1;
    }
  }
  return count >= target * 0.8 ? inside : undefined;
}

function makesCheckerboard(
  geometry: BoardGeometry,
  inside: Uint8Array,
  cell: number,
): boolean {
  const size = geometry.size;
  const row = Math.floor(cell / size);
  const col = cell % size;
  for (let r = row - 1; r <= row; r += 1) {
    for (let c = col - 1; c <= col; c += 1) {
      if (r < 0 || c < 0 || r >= size - 1 || c >= size - 1) continue;
      const a = inside[r * size + c];
      const b = inside[r * size + c + 1];
      const d = inside[(r + 1) * size + c];
      const e = inside[(r + 1) * size + c + 1];
      if (a === e && b === d && a !== b) return true;
    }
  }
  return false;
}

function outsideReachesBorder(
  geometry: BoardGeometry,
  inside: Uint8Array,
): boolean {
  const size = geometry.size;
  const seen = new Uint8Array(geometry.cellCount);
  const queue: number[] = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const cell = r * size + c;
      const onBorder = r === 0 || c === 0 || r === size - 1 || c === size - 1;
      if (onBorder && !inside[cell]) {
        seen[cell] = 1;
        queue.push(cell);
      }
    }
  }
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const r = Math.floor(cell / size);
    const c = cell % size;
    const neighbours = [
      r > 0 ? cell - size : -1,
      r < size - 1 ? cell + size : -1,
      c > 0 ? cell - 1 : -1,
      c < size - 1 ? cell + 1 : -1,
    ];
    for (const next of neighbours) {
      if (next >= 0 && !seen[next] && !inside[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return inside.every((value, cell) => value === 1 || seen[cell] === 1);
}

/**
 * Removes clues one by one while the board stays solvable within the
 * difficulty. 0s away from the loop go first: they help no deduction and
 * would only set off hints and the assist (DESIGN.md 13.1).
 */
function removeClues(
  geometry: BoardGeometry,
  fullClues: readonly Clue[],
  inside: Uint8Array,
  difficulty: Difficulty,
  random: RandomSource,
): Clue[] | undefined {
  const size = geometry.size;
  const nearLoop = (cell: number) => {
    const row = Math.floor(cell / size);
    const col = cell % size;
    for (let r = row - 1; r <= row + 1; r += 1) {
      for (let c = col - 1; c <= col + 1; c += 1) {
        if (r >= 0 && c >= 0 && r < size && c < size && inside[r * size + c])
          return true;
      }
    }
    return false;
  };
  const isFarZero = (cell: number) => fullClues[cell] === 0 && !nearLoop(cell);
  const cells = shuffled(
    Array.from({ length: geometry.cellCount }, (_, cell) => cell),
    random,
  );
  const order = [
    ...cells.filter(isFarZero),
    ...cells.filter((cell) => !isFarZero(cell)),
  ];

  const clues = [...fullClues];
  if (!solvableWithin(geometry, clues, difficulty)) return undefined;
  const minimum = Math.round(geometry.cellCount * MIN_CLUE_SHARE[difficulty]);
  let remaining = geometry.cellCount;
  for (const cell of order) {
    if (remaining <= minimum) break;
    const saved = clues[cell];
    clues[cell] = null;
    if (solvableWithin(geometry, clues, difficulty)) remaining -= 1;
    else clues[cell] = saved;
  }
  return clues;
}
