/**
 * The snake on the cleared loop (DESIGN.md chapter 10), in board units: the
 * loop is the body, the head follows the loop and holds the tail in its
 * mouth. During the lap the head goes once round the loop, and the snake
 * stops where it started.
 *
 * Positions along the loop are distances from its first vertex. Every edge
 * is one unit long, so a loop of n edges is n long.
 */

import { type BoardPoint as Point } from "./board-input";

/** How far back along the loop the head looks to find its heading. */
const LOOK_BACK = 0.3;

/** How long the lap takes, whatever the length of the loop. */
export const LAP_MS = 2000;

/** The lap as a share of its time; it starts and stops gently. */
export function lapEase(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return (1 - Math.cos(Math.PI * clamped)) / 2;
}

/** The point at a distance along the closed loop; any distance wraps. */
export function pointAlong(points: readonly Point[], distance: number): Point {
  const n = points.length;
  const s = ((distance % n) + n) % n;
  const index = Math.floor(s);
  const t = s - index;
  const a = points[index];
  const b = points[(index + 1) % n];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Which way the head faces, in degrees (0 is right, 90 is down). It looks a
 * little way back along the loop, so the head turns through a corner
 * instead of snapping.
 */
export function headingAlong(
  points: readonly Point[],
  distance: number,
): number {
  const from = pointAlong(points, distance - LOOK_BACK);
  const to = pointAlong(points, distance);
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** The closed path through the points. */
export function loopPath(points: readonly Point[]): string {
  return (
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("") + "Z"
  );
}

/**
 * The dash that draws the part of the closed loop from `start` on for
 * `length` units, as stroke-dasharray and stroke-dashoffset.
 */
export function dashFrom(
  total: number,
  start: number,
  length: number,
): { dasharray: string; dashoffset: number } {
  const offset = ((-start % total) + total) % total;
  return { dasharray: `${length} ${total - length}`, dashoffset: offset };
}
