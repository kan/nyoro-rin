/**
 * Turns positions on the board into edges and vertices (DESIGN.md 7.2-7.3).
 * Positions are in cell units: (0, 0) is the top-left vertex, (size, size)
 * the bottom-right one, x to the right and y down. Nothing here knows about
 * pixels or the DOM; the board view converts pointer events first.
 */
import {
  type BoardGeometry,
  horizontalEdge,
  vertexIndex,
  verticalEdge,
} from "../core/board";

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

/** A tap within half a cell of an edge picks it (DESIGN.md 7.2). */
export const TAP_EDGE_REACH = 0.5;
/** A stroke passes a vertex within this distance of it (DESIGN.md 7.3). */
export const STROKE_VERTEX_REACH = 0.36;
/** A × stroke passes an edge this close to it. */
export const STROKE_EDGE_REACH = 0.22;
/** Moving this far from where the press began makes it a stroke. */
export const MOVE_THRESHOLD = 0.25;

/**
 * The nearest edge within `reach`, or undefined. Distance to an edge is the
 * distance across it, plus how far the point is past its ends.
 */
export function nearestEdge(
  geometry: BoardGeometry,
  point: BoardPoint,
  reach: number,
): number | undefined {
  const size = geometry.size;
  let best: number | undefined;
  let bestDistance = reach;

  const row = Math.round(point.y);
  const col = Math.floor(point.x);
  if (row >= 0 && row <= size && col >= 0 && col < size) {
    const distance =
      Math.abs(point.y - row) +
      Math.max(0, Math.abs(point.x - (col + 0.5)) - 0.5);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = horizontalEdge(size, row, col);
    }
  }

  const vRow = Math.floor(point.y);
  const vCol = Math.round(point.x);
  if (vRow >= 0 && vRow < size && vCol >= 0 && vCol <= size) {
    const distance =
      Math.abs(point.x - vCol) +
      Math.max(0, Math.abs(point.y - (vRow + 0.5)) - 0.5);
    if (distance < bestDistance) {
      best = verticalEdge(size, vRow, vCol);
    }
  }
  return best;
}

/** The vertex within `reach` (straight-line distance), or undefined. */
export function nearestVertex(
  geometry: BoardGeometry,
  point: BoardPoint,
  reach: number,
): number | undefined {
  const row = Math.round(point.y);
  const col = Math.round(point.x);
  if (row < 0 || col < 0 || row > geometry.size || col > geometry.size) {
    return undefined;
  }
  return Math.hypot(point.x - col, point.y - row) <= reach
    ? vertexIndex(geometry.size, row, col)
    : undefined;
}

export function distance(a: BoardPoint, b: BoardPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Room drawn around the outer vertices, so border edges are easy to hit. */
export const BOARD_MARGIN = 0.4;

/** Holding still this long opens the magnified view (DESIGN.md 7.4, 23.4). */
export const LONG_PRESS_MS = 400;

/** A square part of the board, in cell units: what a view shows. */
export interface ZoomWindow {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** The whole board with its margin. */
export function fullWindow(geometry: BoardGeometry): ZoomWindow {
  return {
    x: -BOARD_MARGIN,
    y: -BOARD_MARGIN,
    size: geometry.size + 2 * BOARD_MARGIN,
  };
}

/** About 3.5 cells across (DESIGN.md 7.4; 23.4 leaves the final value open). */
export const ZOOM_SPAN = 3.5;

/** A window of ZOOM_SPAN cells centred on `center`, kept on the board. */
export function zoomWindowAt(
  geometry: BoardGeometry,
  center: BoardPoint,
): ZoomWindow {
  const size = Math.min(ZOOM_SPAN, fullWindow(geometry).size);
  return clampZoomWindow(geometry, {
    x: center.x - size / 2,
    y: center.y - size / 2,
    size,
  });
}

/** Keeps the window from moving past the edge of the board and its margin. */
export function clampZoomWindow(
  geometry: BoardGeometry,
  window: ZoomWindow,
): ZoomWindow {
  const full = fullWindow(geometry);
  const min = full.x;
  const max = full.x + full.size - window.size;
  const clamp = (value: number) => Math.min(Math.max(value, min), max);
  return { x: clamp(window.x), y: clamp(window.y), size: window.size };
}

/**
 * The window after a finger dragged the view by (dx, dy) board units: the
 * content follows the finger, so the window moves the other way.
 */
export function panZoomWindow(
  geometry: BoardGeometry,
  window: ZoomWindow,
  dx: number,
  dy: number,
): ZoomWindow {
  return clampZoomWindow(geometry, {
    x: window.x - dx,
    y: window.y - dy,
    size: window.size,
  });
}
