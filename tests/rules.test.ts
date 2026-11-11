import { describe, expect, it } from "vitest";
import { vertexIndex } from "../src/core/board";
import {
  cluesOfLoop,
  findConflicts,
  isSolved,
  lineEdges,
} from "../src/core/rules";
import {
  cell,
  cluesAt,
  edge,
  edges,
  geometry,
  rectangleLoop,
  states,
} from "./helpers";

const loop = rectangleLoop(1, 1, 2, 3);
const fullClues = cluesOfLoop(geometry, loop);
const noClues = cluesAt([]);

describe("completion (DESIGN.md 6.3)", () => {
  it("accepts one closed loop that satisfies every clue", () => {
    expect(isSolved(geometry, fullClues, states(loop))).toBe(true);
  });

  it("accepts it with unknown edges and × left around", () => {
    expect(
      isSolved(geometry, fullClues, states(loop, edges("h 0 0", "v 5 5"))),
    ).toBe(true);
  });

  it("rejects two loops", () => {
    const two = [...rectangleLoop(0, 0, 1, 1), ...rectangleLoop(4, 4, 5, 5)];
    expect(isSolved(geometry, noClues, states(two))).toBe(false);
  });

  it("rejects a branch", () => {
    expect(isSolved(geometry, noClues, states([...loop, edge("v 0 1")]))).toBe(
      false,
    );
  });

  it("rejects a clue that does not match", () => {
    const wrong = [...fullClues];
    wrong[cell(0, 0)] = 1;
    expect(isSolved(geometry, wrong, states(loop))).toBe(false);
  });

  it("rejects a broken line", () => {
    expect(isSolved(geometry, noClues, states(loop.slice(1)))).toBe(false);
  });

  it("rejects an empty board", () => {
    expect(isSolved(geometry, noClues, states())).toBe(false);
  });

  it("derives clues from a loop", () => {
    expect(fullClues[cell(1, 1)]).toBe(2);
    expect(fullClues[cell(1, 2)]).toBe(1);
    expect(fullClues[cell(0, 1)]).toBe(1);
    expect(fullClues[cell(5, 5)]).toBe(0);
  });
});

describe("conflicts (DESIGN.md 6.2)", () => {
  it("finds more lines than the clue", () => {
    const clues = cluesAt([[3, 3, 1]]);
    expect(
      findConflicts(geometry, clues, states(edges("h 3 3", "h 4 3"))),
    ).toEqual([{ kind: "clue-excess", cell: cell(3, 3) }]);
  });

  it("finds a clue that too many × keep from being reached", () => {
    const clues = cluesAt([[3, 3, 3]]);
    expect(
      findConflicts(geometry, clues, states([], edges("h 3 3", "h 4 3"))),
    ).toEqual([{ kind: "clue-shortage", cell: cell(3, 3) }]);
  });

  it("finds a branch", () => {
    const lines = edges("h 3 2", "h 3 3", "v 3 3");
    expect(findConflicts(geometry, noClues, states(lines))).toContainEqual({
      kind: "branch",
      vertex: vertexIndex(7, 3, 3),
    });
  });

  it("finds a dead end", () => {
    const conflicts = findConflicts(
      geometry,
      noClues,
      states(edges("h 0 0"), edges("v 0 0")),
    );
    expect(conflicts).toEqual([
      { kind: "dead-end", vertex: vertexIndex(7, 0, 0) },
    ]);
  });

  it("finds a small loop while other lines exist", () => {
    const small = rectangleLoop(0, 0, 0, 0);
    const conflicts = findConflicts(
      geometry,
      noClues,
      states([...small, edge("h 5 5")]),
    );
    expect(conflicts).toEqual([{ kind: "small-loop", edges: small }]);
  });

  it("finds nothing on a correct board, finished or not", () => {
    expect(findConflicts(geometry, fullClues, states(loop))).toEqual([]);
    expect(findConflicts(geometry, fullClues, states(loop.slice(2)))).toEqual(
      [],
    );
  });
});

describe("line edges", () => {
  it("lists the line edges in order", () => {
    expect(lineEdges(states([5, 2, 9], [3]))).toEqual([2, 5, 9]);
  });
});
