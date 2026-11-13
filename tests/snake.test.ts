import { describe, expect, it } from "vitest";
import {
  dashFrom,
  headingAlong,
  lapEase,
  loopPath,
  pointAlong,
} from "../src/ui/snake";

// A 1 × 1 square, clockwise from the top-left.
const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("the snake along the loop (DESIGN.md chapter 10)", () => {
  it("finds points along the loop and wraps past the end", () => {
    expect(pointAlong(square, 0.5)).toEqual({ x: 0.5, y: 0 });
    expect(pointAlong(square, 2.25)).toEqual({ x: 0.75, y: 1 });
    expect(pointAlong(square, 4.5)).toEqual({ x: 0.5, y: 0 });
    expect(pointAlong(square, -0.5)).toEqual({ x: 0, y: 0.5 });
  });

  it("faces the way the loop goes", () => {
    expect(headingAlong(square, 0.5)).toBeCloseTo(0);
    expect(headingAlong(square, 1.5)).toBeCloseTo(90);
    // At the start the head looks back across the closing edge.
    expect(headingAlong(square, 0)).toBeCloseTo(-90);
  });

  it("turns through a corner instead of snapping", () => {
    const angle = headingAlong(square, 1.1);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(90);
  });

  it("draws the closed path", () => {
    expect(loopPath(square)).toBe("M0 0L1 0L1 1L0 1Z");
  });

  it("starts the dash where asked, wrapping round", () => {
    expect(dashFrom(4, 1, 3)).toEqual({ dasharray: "3 1", dashoffset: 3 });
    expect(dashFrom(4, 5.5, 2)).toEqual({ dasharray: "2 2", dashoffset: 2.5 });
  });

  it("starts and stops the lap gently", () => {
    expect(lapEase(0)).toBe(0);
    expect(lapEase(0.5)).toBeCloseTo(0.5);
    expect(lapEase(1)).toBe(1);
    expect(lapEase(2)).toBe(1);
  });
});
