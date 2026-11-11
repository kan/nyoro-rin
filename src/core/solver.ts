import { type BoardGeometry, horizontalEdge, verticalEdge } from "./board";
import { type Clue } from "./model";
import { loopAroundCells } from "./rules";

/**
 * The complete solver (DESIGN.md 12.1): exact, by search.
 *
 * The loop is restated as the set of cells inside it. An edge is on the loop
 * when the cells on its two sides differ (outside the board counts as
 * outside). Rows of cells are enumerated top to bottom as bit masks and the
 * search is pruned by:
 * - the clues of a row, once the rows above and below it are known
 * - no 2 × 2 checkerboard (the loop would touch itself at a vertex)
 * - every outside cell reaching the border (no holes)
 * - the inside being connected (once an inside block is closed, every
 *   later row is outside)
 */
export type SolveStatus = "none" | "unique" | "multiple" | "aborted";

export interface SolveResult {
  readonly status: SolveStatus;
  /** The loop edges of the first solution found, ascending. */
  readonly solution?: readonly number[];
}

export interface SolveOptions {
  /** Edges that must be on the loop. */
  readonly lines?: readonly number[];
  /** Edges that must not be on the loop. */
  readonly crosses?: readonly number[];
  /**
   * Stop after this many search nodes and report "aborted". A node budget,
   * not a time limit, so the answer never depends on the machine.
   */
  readonly nodeLimit?: number;
}

const DEFAULT_NODE_LIMIT = 2_000_000;
const NO_CONSTRAINT = 0;
const MUST_DIFFER = 1;
const MUST_MATCH = 2;

export function solveCompletely(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  options: SolveOptions = {},
): SolveResult {
  const size = geometry.size;
  const fullRow = (1 << size) - 1;
  const nodeLimit = options.nodeLimit ?? DEFAULT_NODE_LIMIT;

  const constraint = new Uint8Array(geometry.edgeCount);
  for (const edge of options.lines ?? []) constraint[edge] = MUST_DIFFER;
  for (const edge of options.crosses ?? []) {
    if (constraint[edge] === MUST_DIFFER) return { status: "none" };
    constraint[edge] = MUST_MATCH;
  }

  const rows = new Int32Array(size);
  const grid = new Uint8Array(geometry.cellCount);
  const component = new Int32Array(geometry.cellCount);
  const stack: number[] = [];
  let count = 0;
  let nodes = 0;
  let aborted = false;
  let first: Int32Array | undefined;

  const bit = (row: number, c: number): number => (row >> c) & 1;

  const cluesHold = (r: number, isLast: boolean): boolean => {
    const current = rows[r];
    const up = r > 0 ? rows[r - 1] : 0;
    const down = isLast ? 0 : rows[r + 1];
    for (let c = 0; c < size; c += 1) {
      const clue = clues[r * size + c];
      if (clue === null) continue;
      const v = bit(current, c);
      let n = 0;
      if (bit(up, c) !== v) n += 1;
      if (bit(down, c) !== v) n += 1;
      if ((c > 0 ? bit(current, c - 1) : 0) !== v) n += 1;
      if ((c < size - 1 ? bit(current, c + 1) : 0) !== v) n += 1;
      if (n !== clue) return false;
    }
    return true;
  };

  const edgeHolds = (edge: number, a: number, b: number): boolean => {
    const rule = constraint[edge];
    if (rule === NO_CONSTRAINT) return true;
    return rule === MUST_DIFFER ? a !== b : a === b;
  };

  /** The edges above row r and inside it; below too for the last row. */
  const edgesHold = (r: number, isLast: boolean): boolean => {
    const current = rows[r];
    const up = r > 0 ? rows[r - 1] : 0;
    for (let c = 0; c < size; c += 1) {
      if (!edgeHolds(horizontalEdge(size, r, c), bit(up, c), bit(current, c))) {
        return false;
      }
      if (
        isLast &&
        !edgeHolds(horizontalEdge(size, r + 1, c), bit(current, c), 0)
      ) {
        return false;
      }
    }
    for (let c = 0; c <= size; c += 1) {
      const left = c > 0 ? bit(current, c - 1) : 0;
      const right = c < size ? bit(current, c) : 0;
      if (!edgeHolds(verticalEdge(size, r, c), left, right)) return false;
    }
    return true;
  };

  const noCheckerboard = (r: number): boolean => {
    if (r === 0) return true;
    const a = rows[r - 1];
    const b = rows[r];
    for (let c = 0; c < size - 1; c += 1) {
      const p = bit(a, c);
      const q = bit(a, c + 1);
      const s = bit(b, c);
      const t = bit(b, c + 1);
      if (p === t && q === s && p !== q) return false;
    }
    return true;
  };

  const INVALID = 0;
  const OPEN = 1;
  const INSIDE_CLOSED = 2;

  /** Connectivity of rows 0..r. */
  const connectivity = (r: number, isLast: boolean): number => {
    const n = (r + 1) * size;
    for (let i = 0; i < n; i += 1)
      grid[i] = bit(rows[Math.floor(i / size)], i % size);
    component.fill(-1, 0, n);
    let insideComponents = 0;
    let insideClosed = false;
    for (let start = 0; start < n; start += 1) {
      if (component[start] >= 0) continue;
      const v = grid[start];
      component[start] = start;
      stack.push(start);
      let touchesLastRow = false;
      let touchesBorder = false;
      while (stack.length > 0) {
        const i = stack.pop()!;
        const rr = Math.floor(i / size);
        const cc = i % size;
        if (rr === r) touchesLastRow = true;
        if (rr === 0 || cc === 0 || cc === size - 1 || (isLast && rr === r)) {
          touchesBorder = true;
        }
        if (rr > 0 && component[i - size] < 0 && grid[i - size] === v) {
          component[i - size] = start;
          stack.push(i - size);
        }
        if (rr < r && component[i + size] < 0 && grid[i + size] === v) {
          component[i + size] = start;
          stack.push(i + size);
        }
        if (cc > 0 && component[i - 1] < 0 && grid[i - 1] === v) {
          component[i - 1] = start;
          stack.push(i - 1);
        }
        if (cc < size - 1 && component[i + 1] < 0 && grid[i + 1] === v) {
          component[i + 1] = start;
          stack.push(i + 1);
        }
      }
      if (v) {
        insideComponents += 1;
        if (!touchesLastRow || isLast) insideClosed = true;
      } else if (!touchesBorder && (!touchesLastRow || isLast)) {
        return INVALID; // an outside hole
      }
    }
    if (insideClosed && insideComponents > 1) return INVALID;
    if (isLast && insideComponents !== 1) return INVALID;
    return insideClosed ? INSIDE_CLOSED : OPEN;
  };

  /**
   * Once row r is placed, each clue in it knows three of its four
   * neighbours (above, left, right); only the cell below is open. The clue
   * then fixes that cell: the same as the clue's cell if the three already
   * make the clue, different if they make one less. Returns the fixed bits
   * of the next row, or undefined when some clue is already out of reach.
   */
  const forcedBelow = (
    r: number,
  ): { mask: number; value: number } | undefined => {
    const current = rows[r];
    const up = r > 0 ? rows[r - 1] : 0;
    let mask = 0;
    let value = 0;
    for (let c = 0; c < size; c += 1) {
      const clue = clues[r * size + c];
      if (clue === null) continue;
      const v = bit(current, c);
      let n = 0;
      if (bit(up, c) !== v) n += 1;
      if ((c > 0 ? bit(current, c - 1) : 0) !== v) n += 1;
      if ((c < size - 1 ? bit(current, c + 1) : 0) !== v) n += 1;
      const below = clue - n;
      if (below !== 0 && below !== 1) return undefined;
      mask |= 1 << c;
      if ((below === 1 ? 1 - v : v) === 1) value |= 1 << c;
    }
    return { mask, value };
  };

  /**
   * Tries every row r that keeps the bits `mask` at `value`, in ascending
   * order. The free bits are walked as subsets of `free`.
   */
  const search = (
    r: number,
    mustBeEmpty: boolean,
    mask: number,
    value: number,
  ): void => {
    const isLast = r === size - 1;
    const free = mustBeEmpty ? 0 : fullRow & ~mask;
    if (mustBeEmpty && value !== 0) return;
    let subset = 0;
    for (;;) {
      const row = value | subset;
      nodes += 1;
      if (nodes > nodeLimit) {
        aborted = true;
        return;
      }
      rows[r] = row;
      const fits =
        noCheckerboard(r) &&
        edgesHold(r, isLast) &&
        (r === 0 || cluesHold(r - 1, false)) &&
        (!isLast || cluesHold(r, true));
      const forced = fits && !isLast ? forcedBelow(r) : undefined;
      if (fits && (isLast || forced)) {
        const state = connectivity(r, isLast);
        if (state !== INVALID) {
          if (isLast) {
            count += 1;
            if (count === 1) first = Int32Array.from(rows);
            if (count >= 2) return;
          } else {
            search(r + 1, state === INSIDE_CLOSED, forced!.mask, forced!.value);
            if (aborted || count >= 2) return;
          }
        }
      }
      if (subset === free) return;
      subset = (subset - free) & free;
    }
  };

  search(0, false, 0, 0);

  const solution = first ? loopOfRows(geometry, first) : undefined;
  if (count >= 2) return { status: "multiple", solution };
  if (aborted) return { status: "aborted", solution };
  if (count === 1) return { status: "unique", solution };
  return { status: "none" };
}

function loopOfRows(geometry: BoardGeometry, rows: Int32Array): number[] {
  const size = geometry.size;
  const inside = Array.from(
    { length: geometry.cellCount },
    (_, cell) => (rows[Math.floor(cell / size)] >> (cell % size)) & 1,
  );
  return loopAroundCells(geometry, inside);
}
