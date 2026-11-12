import { type BoardGeometry } from "./board";
import {
  CROSS,
  LINE,
  type Clue,
  type EdgeState,
  type EdgeStates,
  type Places,
} from "./model";

/**
 * A contradiction visible from the rules alone, without the answer
 * (DESIGN.md 6.2).
 */
export type Conflict =
  /** More lines around the clue than the clue. */
  | { readonly kind: "clue-excess"; readonly cell: number }
  /** So many × around the clue that it cannot be reached. */
  | { readonly kind: "clue-shortage"; readonly cell: number }
  /** Three or more lines from one vertex. */
  | { readonly kind: "branch"; readonly vertex: number }
  /** One line comes in and every other edge is ×. */
  | { readonly kind: "dead-end"; readonly vertex: number }
  /** A closed loop while other lines exist outside it. */
  | { readonly kind: "small-loop"; readonly edges: readonly number[] };

export function conflictPlaces(conflict: Conflict): Places {
  switch (conflict.kind) {
    case "clue-excess":
    case "clue-shortage":
      return { cells: [conflict.cell], vertices: [], edges: [] };
    case "branch":
    case "dead-end":
      return { cells: [], vertices: [conflict.vertex], edges: [] };
    case "small-loop":
      return { cells: [], vertices: [], edges: conflict.edges };
  }
}

/** How many lines and × touch each cell and each vertex. */
export interface MarkCounts {
  readonly cellLines: Uint8Array;
  readonly cellCrosses: Uint8Array;
  /** The number of lines at each vertex (its degree). */
  readonly vertexLines: Uint8Array;
  readonly vertexCrosses: Uint8Array;
}

export function countMarks(
  geometry: BoardGeometry,
  states: EdgeStates,
): MarkCounts {
  const counts: MarkCounts = {
    cellLines: new Uint8Array(geometry.cellCount),
    cellCrosses: new Uint8Array(geometry.cellCount),
    vertexLines: new Uint8Array(geometry.vertexCount),
    vertexCrosses: new Uint8Array(geometry.vertexCount),
  };
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    const state = states[edge];
    if (state !== LINE && state !== CROSS) continue;
    const cells = state === LINE ? counts.cellLines : counts.cellCrosses;
    const vertices = state === LINE ? counts.vertexLines : counts.vertexCrosses;
    for (const cell of geometry.edgeCells[edge]) cells[cell] += 1;
    const [a, b] = geometry.edgeVertices[edge];
    vertices[a] += 1;
    vertices[b] += 1;
  }
  return counts;
}

export interface LineComponents {
  /** The representative vertex of each vertex's component. */
  readonly root: Int32Array;
  /** The number of line edges in each component, at its root. */
  readonly edgeCount: Int32Array;
  readonly totalLines: number;
}

/** The connected pieces of drawn line. */
export function lineComponents(
  geometry: BoardGeometry,
  states: EdgeStates,
): LineComponents {
  const parent = new Int32Array(geometry.vertexCount);
  for (let v = 0; v < parent.length; v += 1) parent[v] = v;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  let totalLines = 0;
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    if (states[edge] !== LINE) continue;
    totalLines += 1;
    const [a, b] = geometry.edgeVertices[edge];
    parent[find(a)] = find(b);
  }
  const root = new Int32Array(geometry.vertexCount);
  for (let v = 0; v < root.length; v += 1) root[v] = find(v);
  const edgeCount = new Int32Array(geometry.vertexCount);
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    if (states[edge] === LINE) {
      edgeCount[root[geometry.edgeVertices[edge][0]]] += 1;
    }
  }
  return { root, edgeCount, totalLines };
}

/** The line edges of each component, keyed by its root, ascending. */
export function lineEdgesByRoot(
  geometry: BoardGeometry,
  states: EdgeStates,
  components: LineComponents,
): Map<number, number[]> {
  const pieces = new Map<number, number[]>();
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    if (states[edge] !== LINE) continue;
    const root = components.root[geometry.edgeVertices[edge][0]];
    let piece = pieces.get(root);
    if (!piece) pieces.set(root, (piece = []));
    piece.push(edge);
  }
  return pieces;
}

/** What the rules and the techniques read off a board, computed once. */
export interface BoardAnalysis {
  readonly marks: MarkCounts;
  readonly components: LineComponents;
}

export function analyzeBoard(
  geometry: BoardGeometry,
  states: EdgeStates,
): BoardAnalysis {
  return {
    marks: countMarks(geometry, states),
    components: lineComponents(geometry, states),
  };
}

/** Every rule contradiction of the player's lines and ×. */
export function findConflicts(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
  analysis: BoardAnalysis = analyzeBoard(geometry, states),
): Conflict[] {
  const { marks, components } = analysis;
  const conflicts: Conflict[] = [];

  for (let cell = 0; cell < geometry.cellCount; cell += 1) {
    const clue = clues[cell];
    if (clue === null) continue;
    if (marks.cellLines[cell] > clue) {
      conflicts.push({ kind: "clue-excess", cell });
    } else if (marks.cellCrosses[cell] > 4 - clue) {
      conflicts.push({ kind: "clue-shortage", cell });
    }
  }

  for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1) {
    const lines = marks.vertexLines[vertex];
    if (lines > 2) {
      conflicts.push({ kind: "branch", vertex });
    } else if (
      lines === 1 &&
      lines + marks.vertexCrosses[vertex] ===
        geometry.vertexEdges[vertex].length
    ) {
      conflicts.push({ kind: "dead-end", vertex });
    }
  }

  if (components.totalLines > 0) {
    // A component is a closed loop when every vertex on it has two lines.
    const broken = new Uint8Array(geometry.vertexCount);
    marks.vertexLines.forEach((lines, vertex) => {
      if (lines !== 0 && lines !== 2) broken[components.root[vertex]] = 1;
    });
    for (const [root, edges] of lineEdgesByRoot(geometry, states, components)) {
      if (!broken[root] && edges.length < components.totalLines) {
        conflicts.push({ kind: "small-loop", edges });
      }
    }
  }
  return conflicts;
}

/**
 * Whether the lines form one closed loop that satisfies every clue
 * (DESIGN.md 6.3). Unknown edges and × count as no line.
 */
export function isSolved(
  geometry: BoardGeometry,
  clues: readonly Clue[],
  states: EdgeStates,
): boolean {
  const { marks, components } = analyzeBoard(geometry, states);
  if (components.totalLines === 0) return false;
  if (
    clues.some((clue, cell) => clue !== null && marks.cellLines[cell] !== clue)
  ) {
    return false;
  }
  if (marks.vertexLines.some((lines) => lines !== 0 && lines !== 2)) {
    return false;
  }
  const onLoop = marks.vertexLines.findIndex((lines) => lines === 2);
  return (
    components.edgeCount[components.root[onLoop]] === components.totalLines
  );
}

/** The line edges, ascending. */
export function lineEdges(states: EdgeStates): number[] {
  return edgesWithState(states, LINE);
}

/** The edges in this state, ascending. */
export function edgesWithState(states: EdgeStates, state: EdgeState): number[] {
  const edges: number[] = [];
  for (let edge = 0; edge < states.length; edge += 1) {
    if (states[edge] === state) edges.push(edge);
  }
  return edges;
}

export function statesFromLines(
  geometry: BoardGeometry,
  lines: readonly number[],
  crosses: readonly number[] = [],
): EdgeStates {
  const states = new Uint8Array(geometry.edgeCount);
  for (const edge of lines) states[edge] = LINE;
  for (const edge of crosses) states[edge] = CROSS;
  return states;
}

/**
 * The loop around a set of inside cells, ascending: an edge is on it when
 * the cells on its two sides differ, outside the board counting as outside.
 */
export function loopAroundCells(
  geometry: BoardGeometry,
  inside: ArrayLike<number>,
): number[] {
  const loop: number[] = [];
  for (let edge = 0; edge < geometry.edgeCount; edge += 1) {
    const cells = geometry.edgeCells[edge];
    const a = inside[cells[0]];
    const b = cells.length > 1 ? inside[cells[1]] : 0;
    if (a !== b) loop.push(edge);
  }
  return loop;
}

/**
 * The cells inside a loop (1) and outside it (0): walking a row from the
 * left, each vertical loop edge crossed flips inside and outside.
 */
export function cellsInsideLoop(
  geometry: BoardGeometry,
  loop: readonly number[],
): Uint8Array {
  const states = statesFromLines(geometry, loop);
  const size = geometry.size;
  const inside = new Uint8Array(geometry.cellCount);
  for (let cell = 0; cell < geometry.cellCount; cell += 1) {
    const col = cell % size;
    const left = geometry.cellEdges[cell][2];
    const outsideOfLeft = col === 0 ? 0 : inside[cell - 1];
    inside[cell] = states[left] === LINE ? 1 - outsideOfLeft : outsideOfLeft;
  }
  return inside;
}

/** The clue of every cell, given the loop. */
export function cluesOfLoop(
  geometry: BoardGeometry,
  loop: readonly number[],
): Clue[] {
  const { cellLines } = countMarks(geometry, statesFromLines(geometry, loop));
  return Array.from(cellLines, (lines) => lines as Clue);
}
