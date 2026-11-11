import { describe, expect, it } from "vitest";
import {
  boardGeometry,
  cellIndex,
  cellPosition,
  edgeBetween,
  horizontalEdge,
  verticalEdge,
  vertexIndex,
  vertexPosition,
} from "../src/core/board";

describe("board numbering (DATA_CONTRACT.md 盤面の表現)", () => {
  const geometry = boardGeometry(7);

  it("has the counts of a 7 × 7 board", () => {
    expect(geometry.cellCount).toBe(49);
    expect(geometry.vertexCount).toBe(64);
    expect(geometry.edgeCount).toBe(112);
    expect(geometry.horizontalEdgeCount).toBe(56);
  });

  it("numbers horizontal edges 0-55 and vertical edges 56-111", () => {
    expect(horizontalEdge(7, 0, 0)).toBe(0);
    expect(horizontalEdge(7, 7, 6)).toBe(55);
    expect(verticalEdge(7, 0, 0)).toBe(56);
    expect(verticalEdge(7, 6, 7)).toBe(111);
  });

  it("numbers cells and vertices row by row", () => {
    expect(cellIndex(7, 2, 3)).toBe(17);
    expect(cellPosition(7, 17)).toEqual({ row: 2, col: 3 });
    expect(vertexIndex(7, 2, 3)).toBe(19);
    expect(vertexPosition(7, 19)).toEqual({ row: 2, col: 3 });
  });

  it("lists a cell's top, bottom, left and right edges", () => {
    expect(geometry.cellEdges[0]).toEqual([0, 7, 56, 57]);
    expect(geometry.cellEdges[cellIndex(7, 6, 6)]).toEqual([48, 55, 110, 111]);
  });

  it("joins each edge to its two vertices and the cells beside it", () => {
    expect(geometry.edgeVertices[horizontalEdge(7, 1, 2)]).toEqual([10, 11]);
    expect(geometry.edgeVertices[verticalEdge(7, 1, 2)]).toEqual([10, 18]);
    expect(geometry.edgeCells[horizontalEdge(7, 0, 2)]).toEqual([2]);
    expect(geometry.edgeCells[horizontalEdge(7, 1, 2)]).toEqual([2, 9]);
    expect(geometry.edgeCells[verticalEdge(7, 1, 7)]).toEqual([13]);
  });

  it("gives corner vertices two edges and inner vertices four", () => {
    expect(geometry.vertexEdges[0]).toHaveLength(2);
    expect(geometry.vertexEdges[vertexIndex(7, 0, 3)]).toHaveLength(3);
    expect(geometry.vertexEdges[vertexIndex(7, 3, 3)]).toHaveLength(4);
  });

  it("finds the edge between neighbouring vertices only", () => {
    expect(edgeBetween(geometry, 10, 11)).toBe(horizontalEdge(7, 1, 2));
    expect(edgeBetween(geometry, 18, 10)).toBe(verticalEdge(7, 1, 2));
    expect(edgeBetween(geometry, 10, 19)).toBeUndefined();
  });

  it("numbers a 10 × 10 board the same way", () => {
    const daily = boardGeometry(10);
    expect(daily.edgeCount).toBe(220);
    expect(verticalEdge(10, 0, 0)).toBe(110);
  });
});
