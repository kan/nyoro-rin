/**
 * Recognises one press on the board (DESIGN.md 7.2-7.4) and reports what it
 * means as edges, never as game rules: the caller decides what the edges
 * become (src/core/play.ts).
 *
 * - a press that does not move is a tap on the nearest edge
 * - with the line tool, or anywhere in the magnified view, a press that
 *   starts on a vertex and moves is a path through vertices
 * - with the × tool on the board, a press that moves sweeps edges
 * - in the magnified view, a press that starts off a vertex moves the view
 */
import {
  type BoardGeometry,
  edgeBetween,
  vertexPosition,
  vertexIndex,
} from "../core/board";
import { type Tool } from "../core/settings";
import {
  type BoardPoint,
  MOVE_THRESHOLD,
  STROKE_EDGE_REACH,
  STROKE_VERTEX_REACH,
  TAP_EDGE_REACH,
  distance,
  nearestEdge,
  nearestVertex,
} from "./board-input";

/** A press counts as starting on a vertex this close to it. */
export const START_VERTEX_REACH = 0.42;
/** In the magnified view, a press this close to a vertex draws instead of moving the view. */
export const ZOOM_START_VERTEX_REACH = 0.3;

export type GestureKind = "path" | "sweep" | "pan";

export class BoardGesture {
  readonly kind: GestureKind;
  private moved = false;
  private lastVertex: number | undefined;
  private readonly passed = new Set<number>();

  constructor(
    private readonly geometry: BoardGeometry,
    private readonly start: BoardPoint,
    options: { readonly tool: Tool; readonly inZoom: boolean },
  ) {
    if (options.inZoom) {
      this.lastVertex = nearestVertex(geometry, start, ZOOM_START_VERTEX_REACH);
      this.kind = this.lastVertex === undefined ? "pan" : "path";
    } else {
      this.lastVertex = nearestVertex(geometry, start, START_VERTEX_REACH);
      this.kind = options.tool === "line" ? "path" : "sweep";
    }
  }

  /** Whether the press has moved far enough to stop being a tap. */
  get hasMoved(): boolean {
    return this.moved;
  }

  /**
   * The edges the press newly passes on its way to `point`, in order. Each
   * edge is reported once per gesture.
   */
  move(point: BoardPoint): number[] {
    if (!this.moved && distance(point, this.start) > MOVE_THRESHOLD) {
      this.moved = true;
    }
    if (!this.moved || this.kind === "pan") return [];
    if (this.kind === "sweep") {
      const edge = nearestEdge(this.geometry, point, STROKE_EDGE_REACH);
      return edge === undefined ? [] : this.report([edge]);
    }
    const vertex = nearestVertex(this.geometry, point, STROKE_VERTEX_REACH);
    if (vertex === undefined || vertex === this.lastVertex) return [];
    const from = this.lastVertex;
    this.lastVertex = vertex;
    return from === undefined
      ? []
      : this.report(this.straightPath(from, vertex));
  }

  /** The tapped edge, when the press never moved. */
  release(): number | undefined {
    if (this.moved) return undefined;
    return nearestEdge(this.geometry, this.start, TAP_EDGE_REACH);
  }

  /**
   * The edges from one vertex to another along a row or a column. A fast
   * finger can skip vertices between two pointer events; a diagonal jump
   * has no single path and gives nothing.
   */
  private straightPath(from: number, to: number): number[] {
    const size = this.geometry.size;
    const a = vertexPosition(size, from);
    const b = vertexPosition(size, to);
    if (a.row !== b.row && a.col !== b.col) return [];
    const steps = Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
    const dRow = Math.sign(b.row - a.row);
    const dCol = Math.sign(b.col - a.col);
    const edges: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const p = vertexIndex(size, a.row + dRow * i, a.col + dCol * i);
      const q = vertexIndex(
        size,
        a.row + dRow * (i + 1),
        a.col + dCol * (i + 1),
      );
      edges.push(edgeBetween(this.geometry, p, q)!);
    }
    return edges;
  }

  private report(edges: number[]): number[] {
    const fresh = edges.filter((edge) => !this.passed.has(edge));
    for (const edge of fresh) this.passed.add(edge);
    return fresh;
  }
}
