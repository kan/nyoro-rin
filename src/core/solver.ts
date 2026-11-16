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
 *
 * The answer below a row depends only on a small state (see `search`), and
 * many upper parts share it, so each state's answer is remembered. Without
 * that, a 10 × 10 board with few clues took minutes.
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

  const bit = (row: number, c: number): number => (row >> c) & 1;

  /** The clues of the last row, whose cells below are all outside. */
  const lastCluesHold = (up: number, current: number): boolean => {
    const r = size - 1;
    for (let c = 0; c < size; c += 1) {
      const clue = clues[r * size + c];
      if (clue === null) continue;
      const v = bit(current, c);
      let n = v; // the cell below is outside
      if (bit(up, c) !== v) n += 1;
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
  const edgesHold = (
    r: number,
    up: number,
    current: number,
    isLast: boolean,
  ): boolean => {
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

  /** No 2 × 2 checkerboard across rows `up` and `current`. */
  const noCheckerboard = (up: number, current: number): boolean => {
    // A checkerboard at columns c, c + 1: the rows differ at both columns
    // and each row differs from itself between them.
    const differ = up ^ current;
    const turns = (current ^ (current >> 1)) & (fullRow >> 1);
    return (differ & (differ >> 1) & turns) === 0;
  };

  /**
   * Once row r is placed, each clue in it knows three of its four
   * neighbours (above, left, right); only the cell below is open. The clue
   * then fixes that cell: the same as the clue's cell if the three already
   * make the clue, different if they make one less. Returns the fixed bits
   * of the next row, or undefined when some clue is already out of reach.
   * The next row is only ever chosen among rows with these bits, so the
   * clues of row r hold without being checked again.
   */
  const forcedBelow = (
    r: number,
    up: number,
    current: number,
  ): { mask: number; value: number } | undefined => {
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
   * Connectivity is followed row by row through the frontier: the cells of
   * the last placed row, labelled by the region (inside or outside) of the
   * rows so far that each belongs to, with whether that region of the
   * outside touches the border. Rows above the frontier matter to the rest
   * of the search only through these labels.
   */
  interface Frontier {
    /** Region label of each cell of the row, numbered in order of first appearance. */
    readonly labels: Int8Array;
    /** Per label: an outside region that reaches the border. */
    readonly border: Uint8Array;
  }

  const parent = new Int32Array(3 * size);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  /**
   * Places row r (`current`) under `up`, whose frontier is `previous`. Fails
   * on an outside region closed off from the border (a hole) and on a
   * second inside region next to one that is closed (the inside must be one
   * region). `insideClosed` tells whether an inside region already closed
   * above; the rows after it are all outside.
   */
  const advance = (
    r: number,
    up: number,
    current: number,
    previous: Frontier | undefined,
    insideClosed: boolean,
    isLast: boolean,
  ): { frontier: Frontier; insideClosed: boolean } | undefined => {
    // Nodes 0..size-1 are the labels of the row above, size.. the cells.
    const labelCount = previous ? previous.border.length : 0;
    for (let i = 0; i < size + labelCount; i += 1) parent[i] = i;
    const cellNode = (c: number) => labelCount + c;
    for (let c = 0; c < size; c += 1) {
      if (c + 1 < size && bit(current, c) === bit(current, c + 1)) {
        union(cellNode(c), cellNode(c + 1));
      }
      if (previous && bit(up, c) === bit(current, c)) {
        union(previous.labels[c], cellNode(c));
      }
    }

    // The regions above that reach no cell of this row are now closed.
    let insideRegions = insideClosed ? 1 : 0;
    let closedNow = 0;
    const reachesRow = new Uint8Array(size + labelCount);
    for (let c = 0; c < size; c += 1) reachesRow[find(cellNode(c))] = 1;
    if (previous) {
      const valueOfLabel = new Int8Array(labelCount);
      for (let c = 0; c < size; c += 1) {
        valueOfLabel[previous.labels[c]] = bit(up, c);
      }
      for (let label = 0; label < labelCount; label += 1) {
        if (reachesRow[find(label)]) continue;
        if (valueOfLabel[label]) {
          insideRegions += 1;
          closedNow += 1;
        } else if (!previous.border[label]) {
          return undefined; // an outside hole
        }
      }
    }

    // Label this row's regions in order of first appearance.
    const labels = new Int8Array(size);
    const labelOfRoot = new Int8Array(size + labelCount).fill(-1);
    const border: number[] = [];
    const inside: number[] = [];
    for (let c = 0; c < size; c += 1) {
      const root = find(cellNode(c));
      if (labelOfRoot[root] < 0) {
        labelOfRoot[root] = border.length;
        border.push(0);
        inside.push(bit(current, c));
      }
      const label = labelOfRoot[root];
      labels[c] = label;
      if (r === 0 || isLast || c === 0 || c === size - 1) border[label] = 1;
    }
    if (previous) {
      for (let label = 0; label < labelCount; label += 1) {
        if (!previous.border[label]) continue;
        const root = find(label);
        if (labelOfRoot[root] >= 0) border[labelOfRoot[root]] = 1;
      }
    }
    for (const isInside of inside) if (isInside) insideRegions += 1;

    const closed = insideClosed || closedNow > 0;
    if (closed && insideRegions > 1) return undefined;
    // On the last row every region closes: exactly one inside region, and
    // every outside one touches the border (the last row is border).
    if (isLast && insideRegions !== 1) return undefined;
    return {
      frontier: {
        labels,
        border: Uint8Array.from(border, (touches, i) =>
          inside[i] ? 0 : touches,
        ),
      },
      insideClosed: closed,
    };
  };

  /** Solutions below a state: none, one (with its rows) or two or more. */
  interface Count {
    readonly count: 0 | 1 | 2;
    /** The rows of the first solution in search order, from this row down. */
    readonly first?: readonly number[];
  }
  const ABORTED = "aborted";
  const NONE: Count = { count: 0 };

  /*
   * The search tries rows top to bottom, each in ascending order, as a
   * depth-first search. Many different upper parts leave the same state
   * for the rows below, so the result below each state is remembered: the
   * rows below depend only on the row above (for its clues, edges and
   * checkerboards), the bits its clues force, the frontier and whether the
   * inside is closed. Results are kept in search order, so the first
   * solution is the one the plain search would find first.
   */
  const memo = new Map<string, Count>();
  let nodes = 0;

  const search = (
    r: number,
    up: number,
    mask: number,
    value: number,
    previous: Frontier | undefined,
    insideClosed: boolean,
  ): Count | typeof ABORTED => {
    const key = previous
      ? `${r}:${up}:${mask}:${value}:${insideClosed ? 1 : 0}:${previous.labels.join("")}:${previous.border.join("")}`
      : undefined;
    const known = key === undefined ? undefined : memo.get(key);
    if (known) return known;

    const isLast = r === size - 1;
    // Below a closed inside, every row is outside.
    if (insideClosed && value !== 0) return NONE;
    const free = insideClosed ? 0 : fullRow & ~mask;
    let count = 0;
    let first: number[] | undefined;
    let subset = 0;
    for (;;) {
      const row = value | subset;
      nodes += 1;
      if (nodes > nodeLimit) return ABORTED;
      if (
        noCheckerboard(up, row) &&
        edgesHold(r, up, row, isLast) &&
        (!isLast || lastCluesHold(up, row))
      ) {
        const forced = isLast ? undefined : forcedBelow(r, up, row);
        if (isLast || forced) {
          const next = advance(r, up, row, previous, insideClosed, isLast);
          if (next) {
            let below: Count | typeof ABORTED;
            if (isLast) below = { count: 1, first: [] };
            else {
              below = search(
                r + 1,
                row,
                forced!.mask,
                forced!.value,
                next.frontier,
                next.insideClosed,
              );
            }
            if (below === ABORTED) return ABORTED;
            if (below.count > 0 && !first) first = [row, ...below.first!];
            count += below.count;
            if (count >= 2) break;
          }
        }
      }
      if (subset === free) break;
      subset = (subset - free) & free;
    }
    const result: Count =
      count === 0 ? NONE : { count: count >= 2 ? 2 : 1, first };
    if (key !== undefined) memo.set(key, result);
    return result;
  };

  const result = search(0, 0, 0, 0, undefined, false);
  if (result === ABORTED) return { status: "aborted" };
  if (result.count === 0) return { status: "none" };
  const solution = loopOfRows(geometry, Int32Array.from(result.first!));
  return { status: result.count >= 2 ? "multiple" : "unique", solution };
}

function loopOfRows(geometry: BoardGeometry, rows: Int32Array): number[] {
  const size = geometry.size;
  const inside = Array.from(
    { length: geometry.cellCount },
    (_, cell) => (rows[Math.floor(cell / size)] >> (cell % size)) & 1,
  );
  return loopAroundCells(geometry, inside);
}
