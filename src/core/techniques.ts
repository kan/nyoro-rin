import {
  type BoardGeometry,
  cellPosition,
  horizontalEdge,
  verticalEdge,
  vertexIndex,
} from "./board";
import {
  CROSS,
  LINE,
  NO_PLACES,
  UNKNOWN,
  type Clue,
  type EdgeStates,
  type Places,
} from "./model";
import {
  type BoardAnalysis,
  type Conflict,
  analyzeBoard,
  lineEdgesByRoot,
} from "./rules";

/**
 * The basic techniques (DESIGN.md 12.3). Each one reads the board and returns
 * the moves it can make now; none of them writes to the board.
 */
export type BasicTechniqueId =
  | "ZERO"
  | "ADJACENT_THREES"
  | "DIAGONAL_THREES"
  | "CORNER_THREE"
  | "CORNER_ONE"
  | "CLUE_SATURATED"
  | "CLUE_REMAINING"
  | "VERTEX_BRANCH"
  | "VERTEX_CONTINUE"
  | "VERTEX_DEAD_END"
  | "SMALL_LOOP";

/**
 * Intermediate techniques (DESIGN.md 12.3), used by hints and the guide
 * only: board making and difficulty rating do not use them (yet).
 */
export type IntermediateTechniqueId = "LINE_INTO_THREE" | "LINE_INTO_ONE";

/** A technique that reads the board, as opposed to a trial. */
export type StepTechniqueId = BasicTechniqueId | IntermediateTechniqueId;

export type TechniqueId = StepTechniqueId | "TRIAL";

/** A contradiction found while reasoning, and where it is. */
export interface Contradiction {
  /** The technique that could not be satisfied, or the broken rule. */
  readonly reason: TechniqueId | Conflict["kind"];
  readonly places: Places;
}

export interface TrialDetail {
  /** The edge assumed, and what it was assumed to be. */
  readonly edge: number;
  readonly assumed: typeof LINE | typeof CROSS;
  /** Where the assumption led to a contradiction. */
  readonly contradiction: Contradiction;
  /** The number of moves from the assumption to the contradiction. */
  readonly steps: number;
}

export interface LogicalMove {
  readonly technique: TechniqueId;
  /** Unknown edges this move makes lines. */
  readonly lines: readonly number[];
  /** Unknown edges this move makes ×. */
  readonly crosses: readonly number[];
  /** What a hint shows first (stage 1). */
  readonly focus: Places;
  /** The already decided lines and × the reason rests on. */
  readonly premises: Places;
  readonly trial?: TrialDetail;
}

export interface TechniqueContext extends BoardAnalysis {
  readonly geometry: BoardGeometry;
  readonly clues: readonly Clue[];
  readonly states: EdgeStates;
}

export interface TechniqueResult {
  readonly moves: readonly LogicalMove[];
  /** Set when the technique's conclusion clashes with a decided edge. */
  readonly contradiction?: Contradiction;
}

export type Technique = (context: TechniqueContext) => TechniqueResult;

export function techniqueContext(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  analysis: BoardAnalysis = analyzeBoard(geometry, states),
): TechniqueContext {
  return { geometry, clues, states, ...analysis };
}

const atCells = (cells: readonly number[]): Places => ({
  cells,
  vertices: [],
  edges: [],
});
const atVertex = (vertex: number): Places => ({
  cells: [],
  vertices: [vertex],
  edges: [],
});
const onEdges = (edges: readonly number[]): Places => ({
  cells: [],
  vertices: [],
  edges,
});

/**
 * Collects moves whose conclusion is fixed by the clue layout alone: the
 * conclusion may already be partly drawn, and a decided edge that disagrees
 * with it is a contradiction.
 */
class PatternCollector {
  readonly moves: LogicalMove[] = [];
  contradiction?: Contradiction;

  constructor(
    private readonly context: TechniqueContext,
    private readonly technique: BasicTechniqueId,
  ) {}

  add(
    edges: readonly number[],
    value: typeof LINE | typeof CROSS,
    cells: number[],
  ): void {
    const todo: number[] = [];
    for (const edge of edges) {
      const state = this.context.states[edge];
      if (state === UNKNOWN) todo.push(edge);
      else if (state !== value) {
        // The first one is reported; the other places still give their
        // moves, for callers that go on past contradictions.
        this.contradiction ??= {
          reason: this.technique,
          places: { cells, vertices: [], edges },
        };
        return;
      }
    }
    if (todo.length === 0) return;
    this.moves.push({
      technique: this.technique,
      lines: value === LINE ? todo : [],
      crosses: value === CROSS ? todo : [],
      focus: atCells(cells),
      premises: NO_PLACES,
    });
  }

  result(): TechniqueResult {
    return { moves: this.moves, contradiction: this.contradiction };
  }
}

function clueAt(
  context: TechniqueContext,
  row: number,
  col: number,
): Clue | undefined {
  const size = context.geometry.size;
  if (row < 0 || col < 0 || row >= size || col >= size) return undefined;
  return context.clues[row * size + col];
}

export const zero: Technique = (context) => {
  const collector = new PatternCollector(context, "ZERO");
  context.clues.forEach((clue, cell) => {
    if (clue === 0) {
      collector.add(context.geometry.cellEdges[cell], CROSS, [cell]);
    }
  });
  return collector.result();
};

/** Two 3s side by side: the edge between them and both outer parallel edges. */
export const adjacentThrees: Technique = (context) => {
  const size = context.geometry.size;
  const collector = new PatternCollector(context, "ADJACENT_THREES");
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (clueAt(context, r, c) !== 3) continue;
      const cell = r * size + c;
      if (clueAt(context, r, c + 1) === 3) {
        collector.add(
          [
            verticalEdge(size, r, c),
            verticalEdge(size, r, c + 1),
            verticalEdge(size, r, c + 2),
          ],
          LINE,
          [cell, cell + 1],
        );
      }
      if (clueAt(context, r + 1, c) === 3) {
        collector.add(
          [
            horizontalEdge(size, r, c),
            horizontalEdge(size, r + 1, c),
            horizontalEdge(size, r + 2, c),
          ],
          LINE,
          [cell, cell + size],
        );
      }
    }
  }
  return collector.result();
};

/** Two 3s on a diagonal: the two edges of each one's outer corner. */
export const diagonalThrees: Technique = (context) => {
  const size = context.geometry.size;
  const collector = new PatternCollector(context, "DIAGONAL_THREES");
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (clueAt(context, r, c) !== 3) continue;
      const cell = r * size + c;
      if (clueAt(context, r + 1, c + 1) === 3) {
        collector.add(
          [
            horizontalEdge(size, r, c),
            verticalEdge(size, r, c),
            horizontalEdge(size, r + 2, c + 1),
            verticalEdge(size, r + 1, c + 2),
          ],
          LINE,
          [cell, cell + size + 1],
        );
      }
      if (clueAt(context, r + 1, c - 1) === 3) {
        collector.add(
          [
            horizontalEdge(size, r, c),
            verticalEdge(size, r, c + 1),
            horizontalEdge(size, r + 2, c - 1),
            verticalEdge(size, r + 1, c - 1),
          ],
          LINE,
          [cell, cell + size - 1],
        );
      }
    }
  }
  return collector.result();
};

/** The two edges at the board's corner of a corner cell. */
function cornerEdges(
  context: TechniqueContext,
  cell: number,
): number[] | undefined {
  const size = context.geometry.size;
  const { row, col } = cellPosition(size, cell);
  const atRowEnd = row === 0 || row === size - 1;
  const atColEnd = col === 0 || col === size - 1;
  if (!atRowEnd || !atColEnd) return undefined;
  return [
    row === 0 ? horizontalEdge(size, 0, col) : horizontalEdge(size, size, col),
    col === 0 ? verticalEdge(size, row, 0) : verticalEdge(size, row, size),
  ];
}

function cornerTechnique(
  id: "CORNER_THREE" | "CORNER_ONE",
  clueValue: Clue,
  value: typeof LINE | typeof CROSS,
): Technique {
  return (context) => {
    const collector = new PatternCollector(context, id);
    context.clues.forEach((clue, cell) => {
      const edges = clue === clueValue ? cornerEdges(context, cell) : undefined;
      if (edges) collector.add(edges, value, [cell]);
    });
    return collector.result();
  };
}

export const cornerThree = cornerTechnique("CORNER_THREE", 3, LINE);
export const cornerOne = cornerTechnique("CORNER_ONE", 1, CROSS);

/** The edges of a cell or vertex, sorted by state. */
function edgesByState(states: EdgeStates, edges: readonly number[]) {
  const lines: number[] = [];
  const crosses: number[] = [];
  const unknown: number[] = [];
  for (const edge of edges) {
    if (states[edge] === LINE) lines.push(edge);
    else if (states[edge] === CROSS) crosses.push(edge);
    else unknown.push(edge);
  }
  return { lines, crosses, unknown };
}

/** The clue already has its lines: the rest of its edges are ×. */
export const clueSaturated: Technique = ({
  clues,
  marks,
  geometry,
  states,
}) => {
  const moves: LogicalMove[] = [];
  clues.forEach((clue, cell) => {
    // 0 is ZERO's: it needs no line to be drawn first.
    if (clue === null || clue === 0) return;
    const lines = marks.cellLines[cell];
    if (lines !== clue || lines + marks.cellCrosses[cell] === 4) return;
    const edges = edgesByState(states, geometry.cellEdges[cell]);
    moves.push({
      technique: "CLUE_SATURATED",
      lines: [],
      crosses: edges.unknown,
      focus: atCells([cell]),
      premises: onEdges(edges.lines),
    });
  });
  return { moves };
};

/** Lines plus unknown edges equal the clue: every unknown edge is a line. */
export const clueRemaining: Technique = ({
  clues,
  marks,
  geometry,
  states,
}) => {
  const moves: LogicalMove[] = [];
  clues.forEach((clue, cell) => {
    if (clue === null || clue === 0) return;
    const unknown = 4 - marks.cellLines[cell] - marks.cellCrosses[cell];
    if (unknown === 0 || marks.cellLines[cell] + unknown !== clue) return;
    const edges = edgesByState(states, geometry.cellEdges[cell]);
    moves.push({
      technique: "CLUE_REMAINING",
      lines: edges.unknown,
      crosses: [],
      focus: atCells([cell]),
      premises: onEdges(edges.crosses),
    });
  });
  return { moves };
};

function unknownAtVertex(context: TechniqueContext, vertex: number): number {
  return (
    context.geometry.vertexEdges[vertex].length -
    context.marks.vertexLines[vertex] -
    context.marks.vertexCrosses[vertex]
  );
}

/** Two lines at a vertex: its other edges are ×. */
export const vertexBranch: Technique = (context) => {
  const moves: LogicalMove[] = [];
  context.marks.vertexLines.forEach((lines, vertex) => {
    if (lines !== 2 || unknownAtVertex(context, vertex) === 0) return;
    const edges = edgesByState(
      context.states,
      context.geometry.vertexEdges[vertex],
    );
    moves.push({
      technique: "VERTEX_BRANCH",
      lines: [],
      crosses: edges.unknown,
      focus: atVertex(vertex),
      premises: onEdges(edges.lines),
    });
  });
  return { moves };
};

/** One line at a vertex and one way on: that edge is a line. */
export const vertexContinue: Technique = (context) => {
  const moves: LogicalMove[] = [];
  context.marks.vertexLines.forEach((lines, vertex) => {
    if (lines !== 1 || unknownAtVertex(context, vertex) !== 1) return;
    const edges = edgesByState(
      context.states,
      context.geometry.vertexEdges[vertex],
    );
    moves.push({
      technique: "VERTEX_CONTINUE",
      lines: edges.unknown,
      crosses: [],
      focus: atVertex(vertex),
      premises: onEdges([...edges.lines, ...edges.crosses]),
    });
  });
  return { moves };
};

/** No line at a vertex and one edge open: a line there would end, so ×. */
export const vertexDeadEnd: Technique = (context) => {
  const moves: LogicalMove[] = [];
  context.marks.vertexLines.forEach((lines, vertex) => {
    if (lines !== 0 || unknownAtVertex(context, vertex) !== 1) return;
    const edges = edgesByState(
      context.states,
      context.geometry.vertexEdges[vertex],
    );
    moves.push({
      technique: "VERTEX_DEAD_END",
      lines: [],
      crosses: edges.unknown,
      focus: atVertex(vertex),
      premises: onEdges(edges.crosses),
    });
  });
  return { moves };
};

/**
 * An edge joining the two ends of one line closes a loop; while other lines
 * exist, that loop could not be the only one, so the edge is ×.
 */
export const smallLoop: Technique = (context) => {
  const { geometry, states, marks, components } = context;
  const moves: LogicalMove[] = [];
  if (components.totalLines === 0) return { moves };
  let pieces: Map<number, number[]> | undefined;
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    if (states[edge] !== UNKNOWN) continue;
    const [a, b] = geometry.edgeVertices[edge];
    if (marks.vertexLines[a] !== 1 || marks.vertexLines[b] !== 1) continue;
    const root = components.root[a];
    if (root !== components.root[b]) continue;
    if (components.edgeCount[root] >= components.totalLines) continue;
    pieces ??= lineEdgesByRoot(geometry, states, components);
    moves.push({
      technique: "SMALL_LOOP",
      lines: [],
      crosses: [edge],
      focus: { cells: [], vertices: [a, b], edges: [edge] },
      premises: onEdges(pieces.get(root)!),
    });
  }
  return { moves };
};

/**
 * A clue's corner where exactly one line arrives from outside the cell:
 * `far` are the cell's two edges away from the corner, `arriving` the line,
 * `otherOutside` the corner's other edges that are not the cell's.
 *
 * With two lines arriving, the line does not go on into the cell at all,
 * and neither technique holds (that corner is VERTEX_BRANCH's).
 */
interface ClueCorner {
  readonly cell: number;
  readonly vertex: number;
  readonly far: readonly [number, number];
  readonly arriving: number;
  readonly otherOutside: readonly number[];
}

function cornersWithArrivingLine(
  context: TechniqueContext,
  clue: Clue,
): ClueCorner[] {
  const { geometry, clues, states } = context;
  const size = geometry.size;
  const corners: ClueCorner[] = [];
  clues.forEach((value, cell) => {
    if (value !== clue) return;
    const { row, col } = cellPosition(size, cell);
    const [top, bottom, left, right] = geometry.cellEdges[cell];
    const layout = [
      {
        vertex: vertexIndex(size, row, col),
        inner: [top, left],
        far: [bottom, right],
      },
      {
        vertex: vertexIndex(size, row, col + 1),
        inner: [top, right],
        far: [bottom, left],
      },
      {
        vertex: vertexIndex(size, row + 1, col),
        inner: [bottom, left],
        far: [top, right],
      },
      {
        vertex: vertexIndex(size, row + 1, col + 1),
        inner: [bottom, right],
        far: [top, left],
      },
    ] as const;
    for (const { vertex, inner, far } of layout) {
      const outside = geometry.vertexEdges[vertex].filter(
        (edge) => edge !== inner[0] && edge !== inner[1],
      );
      const arriving = outside.filter((edge) => states[edge] === LINE);
      if (arriving.length !== 1) continue;
      corners.push({
        cell,
        vertex,
        far,
        arriving: arriving[0],
        otherOutside: outside.filter((edge) => edge !== arriving[0]),
      });
    }
  });
  return corners;
}

/**
 * Collects a corner technique's moves: the edges it decides, those still
 * unknown as the move, a decided edge against it as a contradiction.
 */
function cornerMoves(
  context: TechniqueContext,
  technique: IntermediateTechniqueId,
  decided: (corner: ClueCorner) => {
    lines: readonly number[];
    crosses: readonly number[];
    /** Decided edges the reason needs besides the arriving line. */
    premises?: readonly number[];
  },
  corners: readonly ClueCorner[],
): TechniqueResult {
  const { states } = context;
  const moves: LogicalMove[] = [];
  let contradiction: Contradiction | undefined;
  for (const corner of corners) {
    const { lines, crosses, premises } = decided(corner);
    const focus: Places = {
      cells: [corner.cell],
      vertices: [corner.vertex],
      edges: [],
    };
    const clash =
      lines.some((edge) => states[edge] === CROSS) ||
      crosses.some((edge) => states[edge] === LINE);
    if (clash) {
      contradiction ??= { reason: technique, places: focus };
      continue;
    }
    const newLines = lines.filter((edge) => states[edge] === UNKNOWN);
    const newCrosses = crosses.filter((edge) => states[edge] === UNKNOWN);
    if (newLines.length === 0 && newCrosses.length === 0) continue;
    moves.push({
      technique,
      lines: newLines,
      crosses: newCrosses,
      focus,
      premises: onEdges([corner.arriving, ...(premises ?? [])]),
    });
  }
  return { moves, contradiction };
}

/**
 * A line arrives at a 3's corner from outside: the 3's two far edges are
 * lines, and the corner's other outside edge is ×.
 *
 * Proof: the line goes on from the corner along one edge. Going on outside
 * would leave the 3 only its two far edges, one short; so it goes on along
 * one of the two edges at the corner (both would branch). The 3 then has
 * exactly one of those two, so its two far edges are lines; and the corner
 * already has its two lines, so the rest of its edges are ×.
 */
export const lineIntoThree: Technique = (context) =>
  cornerMoves(
    context,
    "LINE_INTO_THREE",
    (corner) => ({
      lines: corner.far,
      crosses: corner.otherOutside,
    }),
    cornersWithArrivingLine(context, 3),
  );

/**
 * A line arrives at a 1's corner from outside and cannot go on outside
 * (the corner's other outside edges are ×, or there are none): the 1's
 * two far edges are ×.
 *
 * Proof: the line must go on along one of the 1's two edges at the corner,
 * which is then the 1's only line.
 */
export const lineIntoOne: Technique = (context) =>
  cornerMoves(
    context,
    "LINE_INTO_ONE",
    // The × that keep the line from going on outside are part of the reason.
    (corner) => ({
      lines: [],
      crosses: corner.far,
      premises: corner.otherOutside,
    }),
    cornersWithArrivingLine(context, 1).filter((corner) =>
      corner.otherOutside.every((edge) => context.states[edge] === CROSS),
    ),
  );

/** Every basic technique, in the order a hint prefers among equals. */
export const BASIC_TECHNIQUES: Readonly<Record<BasicTechniqueId, Technique>> = {
  ZERO: zero,
  CORNER_ONE: cornerOne,
  CORNER_THREE: cornerThree,
  ADJACENT_THREES: adjacentThrees,
  DIAGONAL_THREES: diagonalThrees,
  CLUE_SATURATED: clueSaturated,
  CLUE_REMAINING: clueRemaining,
  VERTEX_BRANCH: vertexBranch,
  VERTEX_CONTINUE: vertexContinue,
  VERTEX_DEAD_END: vertexDeadEnd,
  SMALL_LOOP: smallLoop,
};

export const BASIC_TECHNIQUE_IDS = Object.keys(
  BASIC_TECHNIQUES,
) as BasicTechniqueId[];

/** Every technique that reads the board, basic first. */
export const STEP_TECHNIQUES: Readonly<Record<StepTechniqueId, Technique>> = {
  ...BASIC_TECHNIQUES,
  LINE_INTO_THREE: lineIntoThree,
  LINE_INTO_ONE: lineIntoOne,
};

/** Basic first, then intermediate: the order hints prefer (DESIGN.md 11.1). */
export const STEP_TECHNIQUE_IDS = Object.keys(
  STEP_TECHNIQUES,
) as StepTechniqueId[];

/**
 * Techniques whose conclusion depends on the clue layout alone. Once applied,
 * their edges never change again, so propagation runs them only in its first
 * round.
 */
export const LAYOUT_TECHNIQUES: ReadonlySet<StepTechniqueId> = new Set([
  "ZERO",
  "CORNER_ONE",
  "CORNER_THREE",
  "ADJACENT_THREES",
  "DIAGONAL_THREES",
]);

/**
 * The techniques the guide points at (DESIGN.md 8.2): the threes' patterns
 * and a line with one way on. Counting a clue's edges (CLUE_REMAINING) is
 * left to the player, as the heart of the reasoning.
 */
export const GUIDE_TECHNIQUES: readonly StepTechniqueId[] = [
  "CORNER_THREE",
  "ADJACENT_THREES",
  "DIAGONAL_THREES",
  "VERTEX_CONTINUE",
  "LINE_INTO_THREE",
  "LINE_INTO_ONE",
];

/** The basic techniques that only ever derive × (the assist's, DESIGN.md 8.1). */
export const CROSS_ONLY_TECHNIQUES: readonly BasicTechniqueId[] = [
  "ZERO",
  "CORNER_ONE",
  "CLUE_SATURATED",
  "VERTEX_BRANCH",
  "VERTEX_DEAD_END",
  "SMALL_LOOP",
];
