/**
 * The numbering of cells, vertices and edges (DATA_CONTRACT.md 「盤面の表現」).
 * This is the only place that defines it.
 *
 * - cell (r, c): r * size + c
 * - vertex (r, c): r * (size + 1) + c
 * - horizontal edge between vertices (r, c) and (r, c + 1): r * size + c
 * - vertical edge between vertices (r, c) and (r + 1, c):
 *   (size + 1) * size + r * (size + 1) + c
 */
export interface BoardGeometry {
  readonly size: number;
  readonly cellCount: number;
  readonly vertexCount: number;
  readonly edgeCount: number;
  /** Edges below this number are horizontal. */
  readonly horizontalEdgeCount: number;
  /** For each cell: its top, bottom, left and right edge. */
  readonly cellEdges: readonly (readonly [number, number, number, number])[];
  /** For each vertex: the 2 to 4 edges that meet there. */
  readonly vertexEdges: readonly (readonly number[])[];
  /** For each edge: its two vertices. */
  readonly edgeVertices: readonly (readonly [number, number])[];
  /** For each edge: the one or two cells beside it. */
  readonly edgeCells: readonly (readonly number[])[];
}

export interface GridPosition {
  readonly row: number;
  readonly col: number;
}

const cache = new Map<number, BoardGeometry>();

export function boardGeometry(size: number): BoardGeometry {
  let geometry = cache.get(size);
  if (!geometry) {
    geometry = buildGeometry(size);
    cache.set(size, geometry);
  }
  return geometry;
}

export function cellIndex(size: number, row: number, col: number): number {
  return row * size + col;
}

export function vertexIndex(size: number, row: number, col: number): number {
  return row * (size + 1) + col;
}

export function horizontalEdge(size: number, row: number, col: number): number {
  return row * size + col;
}

export function verticalEdge(size: number, row: number, col: number): number {
  return (size + 1) * size + row * (size + 1) + col;
}

export function cellPosition(size: number, cell: number): GridPosition {
  return { row: Math.floor(cell / size), col: cell % size };
}

export function vertexPosition(size: number, vertex: number): GridPosition {
  return { row: Math.floor(vertex / (size + 1)), col: vertex % (size + 1) };
}

/** The edge between two orthogonally adjacent vertices, or undefined. */
export function edgeBetween(
  geometry: BoardGeometry,
  a: number,
  b: number,
): number | undefined {
  return geometry.vertexEdges[a].find((edge) => {
    const [p, q] = geometry.edgeVertices[edge];
    return (p === a && q === b) || (p === b && q === a);
  });
}

function buildGeometry(size: number): BoardGeometry {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`Invalid board size: ${size}`);
  }
  const cellCount = size * size;
  const vertexCount = (size + 1) * (size + 1);
  const horizontalEdgeCount = (size + 1) * size;
  const edgeCount = horizontalEdgeCount * 2;

  const edgeVertices: [number, number][] = new Array(edgeCount);
  const edgeCells: number[][] = Array.from({ length: edgeCount }, () => []);
  for (let r = 0; r <= size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const edge = horizontalEdge(size, r, c);
      edgeVertices[edge] = [
        vertexIndex(size, r, c),
        vertexIndex(size, r, c + 1),
      ];
      if (r > 0) edgeCells[edge].push(cellIndex(size, r - 1, c));
      if (r < size) edgeCells[edge].push(cellIndex(size, r, c));
    }
  }
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c <= size; c += 1) {
      const edge = verticalEdge(size, r, c);
      edgeVertices[edge] = [
        vertexIndex(size, r, c),
        vertexIndex(size, r + 1, c),
      ];
      if (c > 0) edgeCells[edge].push(cellIndex(size, r, c - 1));
      if (c < size) edgeCells[edge].push(cellIndex(size, r, c));
    }
  }

  const cellEdges: [number, number, number, number][] = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      cellEdges.push([
        horizontalEdge(size, r, c),
        horizontalEdge(size, r + 1, c),
        verticalEdge(size, r, c),
        verticalEdge(size, r, c + 1),
      ]);
    }
  }

  const vertexEdges: number[][] = [];
  for (let r = 0; r <= size; r += 1) {
    for (let c = 0; c <= size; c += 1) {
      const edges: number[] = [];
      if (r > 0) edges.push(verticalEdge(size, r - 1, c));
      if (r < size) edges.push(verticalEdge(size, r, c));
      if (c > 0) edges.push(horizontalEdge(size, r, c - 1));
      if (c < size) edges.push(horizontalEdge(size, r, c));
      vertexEdges.push(edges);
    }
  }

  return {
    size,
    cellCount,
    vertexCount,
    edgeCount,
    horizontalEdgeCount,
    cellEdges,
    vertexEdges,
    edgeVertices,
    edgeCells,
  };
}
