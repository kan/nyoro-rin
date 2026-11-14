import { describe, expect, it } from "vitest";
import { vertexIndex } from "../src/core/board";
import {
  BOARD_MARGIN,
  clampZoomWindow,
  fullWindow,
  nearestEdge,
  nearestVertex,
  panZoomWindow,
  zoomWindowAt,
} from "../src/ui/board-input";
import { BoardGesture } from "../src/ui/gesture";
import { edge, edges, geometry } from "./helpers";

describe("positions to edges and vertices", () => {
  it("picks the edge under a tap", () => {
    expect(nearestEdge(geometry, { x: 2.5, y: 3.05 }, 0.5)).toBe(edge("h 3 2"));
    expect(nearestEdge(geometry, { x: 4.1, y: 1.4 }, 0.5)).toBe(edge("v 1 4"));
  });

  it("reaches the border edges from the margin", () => {
    expect(nearestEdge(geometry, { x: 3.5, y: -0.3 }, 0.5)).toBe(edge("h 0 3"));
    expect(nearestEdge(geometry, { x: 7.3, y: 6.5 }, 0.5)).toBe(edge("v 6 7"));
  });

  it("finds nothing in the middle of a cell with a short reach", () => {
    expect(nearestEdge(geometry, { x: 2.5, y: 2.5 }, 0.22)).toBeUndefined();
  });

  it("finds a vertex only close to it", () => {
    expect(nearestVertex(geometry, { x: 3.1, y: 1.9 }, 0.36)).toBe(
      vertexIndex(7, 2, 3),
    );
    expect(nearestVertex(geometry, { x: 3.4, y: 2.4 }, 0.36)).toBeUndefined();
    expect(nearestVertex(geometry, { x: -1, y: 0 }, 0.36)).toBeUndefined();
  });
});

describe("gestures (DESIGN.md 7.2-7.4)", () => {
  const line = { tool: "line", inZoom: false } as const;

  it("reports a press that does not move as a tap", () => {
    const gesture = new BoardGesture(geometry, { x: 2.5, y: 3 }, line);
    gesture.move({ x: 2.55, y: 3.05 });
    expect(gesture.hasMoved).toBe(false);
    expect(gesture.release()).toBe(edge("h 3 2"));
  });

  it("knows the tapped edge from the press, before release", () => {
    const gesture = new BoardGesture(geometry, { x: 4.1, y: 1.4 }, line);
    expect(gesture.tapEdge).toBe(edge("v 1 4"));
    expect(gesture.release()).toBe(edge("v 1 4"));
  });

  it("taps nothing right on a vertex, where no one edge is meant", () => {
    const onVertex = new BoardGesture(geometry, { x: 2.05, y: 3.1 }, line);
    expect(onVertex.tapEdge).toBeUndefined();
    expect(onVertex.release()).toBeUndefined();
    const nearEnd = new BoardGesture(geometry, { x: 2.3, y: 3.05 }, line);
    expect(nearEnd.tapEdge).toBe(edge("h 3 2"));
  });

  it("calls the tap off when the finger moves away", () => {
    const gesture = new BoardGesture(geometry, { x: 2.5, y: 3 }, line);
    expect(gesture.tapEdge).toBe(edge("h 3 2"));
    gesture.move({ x: 2.5, y: 3.4 });
    expect(gesture.hasMoved).toBe(true);
    expect(gesture.release()).toBeUndefined();
  });

  it("draws no line from a press that starts off a vertex", () => {
    const gesture = new BoardGesture(geometry, { x: 1.5, y: 1 }, line);
    expect(gesture.kind).toBe("tap");
    expect(gesture.move({ x: 2, y: 1 })).toEqual([]);
    expect(gesture.move({ x: 3, y: 1 })).toEqual([]);
    expect(gesture.release()).toBeUndefined();
  });

  it("turns a line stroke into the edges between the vertices passed", () => {
    const gesture = new BoardGesture(geometry, { x: 1, y: 1 }, line);
    expect(gesture.move({ x: 1.5, y: 1 })).toEqual([]);
    expect(gesture.move({ x: 2, y: 1 })).toEqual([edge("h 1 1")]);
    expect(gesture.move({ x: 2, y: 2 })).toEqual([edge("v 1 2")]);
    expect(gesture.release()).toBeUndefined();
  });

  it("fills in vertices a fast finger skipped along a row", () => {
    const gesture = new BoardGesture(geometry, { x: 0, y: 4 }, line);
    expect(gesture.move({ x: 3, y: 4 })).toEqual(
      edges("h 4 0", "h 4 1", "h 4 2"),
    );
  });

  it("ignores a diagonal jump and reports each edge once", () => {
    const gesture = new BoardGesture(geometry, { x: 1, y: 1 }, line);
    expect(gesture.move({ x: 2, y: 2 })).toEqual([]);
    expect(gesture.move({ x: 2, y: 1 })).toEqual([edge("v 1 2")]);
    expect(gesture.move({ x: 2, y: 2 })).toEqual([]);
  });

  it("sweeps edges with the × tool", () => {
    const gesture = new BoardGesture(
      geometry,
      { x: 0, y: 0.2 },
      { tool: "cross", inZoom: false },
    );
    expect(gesture.kind).toBe("sweep");
    expect(gesture.move({ x: 0.02, y: 0.5 })).toEqual([edge("v 0 0")]);
    expect(gesture.move({ x: 0, y: 1.5 })).toEqual([edge("v 1 0")]);
  });

  it("in the magnified view, draws from a vertex and moves the view from elsewhere", () => {
    const fromVertex = new BoardGesture(
      geometry,
      { x: 3, y: 3 },
      { tool: "cross", inZoom: true },
    );
    expect(fromVertex.kind).toBe("path");
    expect(fromVertex.move({ x: 4, y: 3 })).toEqual([edge("h 3 3")]);
    const fromCell = new BoardGesture(
      geometry,
      { x: 3.5, y: 3.5 },
      { tool: "line", inZoom: true },
    );
    expect(fromCell.kind).toBe("pan");
    expect(fromCell.move({ x: 5, y: 5 })).toEqual([]);
  });
});

describe("magnified view", () => {
  it("centres on the press and stays inside the board", () => {
    expect(zoomWindowAt(geometry, { x: 3.5, y: 3.5 })).toEqual({
      x: 1.75,
      y: 1.75,
      size: 3.5,
    });
    const corner = zoomWindowAt(geometry, { x: 0, y: 7 });
    expect(corner.x).toBe(-BOARD_MARGIN);
    expect(corner.y).toBeCloseTo(7 + BOARD_MARGIN - 3.5);
  });

  it("does not move past the board's edge", () => {
    const moved = clampZoomWindow(geometry, { x: 10, y: -5, size: 3.5 });
    expect(moved.x).toBeCloseTo(7 + BOARD_MARGIN - 3.5);
    expect(moved.y).toBe(-BOARD_MARGIN);
  });

  it("moves the other way from the finger, so the board follows it", () => {
    const window = { x: 2, y: 2, size: 3.5 };
    expect(panZoomWindow(geometry, window, 1, -0.5)).toEqual({
      x: 1,
      y: 2.5,
      size: 3.5,
    });
    expect(panZoomWindow(geometry, window, 10, 0).x).toBe(-BOARD_MARGIN);
  });

  it("shows the whole board with its margin by default", () => {
    expect(fullWindow(geometry)).toEqual({
      x: -BOARD_MARGIN,
      y: -BOARD_MARGIN,
      size: 7 + 2 * BOARD_MARGIN,
    });
  });
});
