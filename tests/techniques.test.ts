import { describe, expect, it } from "vitest";
import { vertexIndex } from "../src/core/board";
import type { Clue, EdgeStates } from "../src/core/model";
import {
  type Technique,
  adjacentThrees,
  clueRemaining,
  clueSaturated,
  cornerOne,
  cornerThree,
  diagonalThrees,
  smallLoop,
  techniqueContext,
  vertexBranch,
  vertexContinue,
  vertexDeadEnd,
  zero,
} from "../src/core/techniques";
import { cell, cluesAt, edge, edges, geometry, states } from "./helpers";

function run(
  technique: Technique,
  clues: Clue[],
  board: EdgeStates = states(),
) {
  return technique(techniqueContext(geometry, clues, board));
}

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** Every line and × the moves derive. */
function derived(technique: Technique, clues: Clue[], board?: EdgeStates) {
  const result = run(technique, clues, board);
  return {
    lines: sorted(result.moves.flatMap((move) => move.lines)),
    crosses: sorted(result.moves.flatMap((move) => move.crosses)),
  };
}

describe("ZERO", () => {
  it("crosses the four edges of a 0", () => {
    expect(derived(zero, cluesAt([[3, 3, 0]]))).toEqual({
      lines: [],
      crosses: sorted(edges("h 3 3", "h 4 3", "v 3 3", "v 3 4")),
    });
  });

  it("does nothing without a 0", () => {
    expect(run(zero, cluesAt([[3, 3, 1]])).moves).toEqual([]);
  });

  it("reports a line next to a 0 as a contradiction", () => {
    const result = run(zero, cluesAt([[3, 3, 0]]), states([edge("h 3 3")]));
    expect(result.contradiction?.places.cells).toEqual([cell(3, 3)]);
  });
});

describe("ADJACENT_THREES", () => {
  it("draws the three parallel edges of 3s side by side", () => {
    expect(
      derived(
        adjacentThrees,
        cluesAt([
          [2, 2, 3],
          [2, 3, 3],
        ]),
      ).lines,
    ).toEqual(sorted(edges("v 2 2", "v 2 3", "v 2 4")));
  });

  it("draws the three parallel edges of 3s one above the other", () => {
    expect(
      derived(
        adjacentThrees,
        cluesAt([
          [2, 2, 3],
          [3, 2, 3],
        ]),
      ).lines,
    ).toEqual(sorted(edges("h 2 2", "h 3 2", "h 4 2")));
  });

  it("does nothing for a 3 beside a 2", () => {
    expect(
      run(
        adjacentThrees,
        cluesAt([
          [2, 2, 3],
          [2, 3, 2],
        ]),
      ).moves,
    ).toEqual([]);
  });

  it("names both 3s as the focus", () => {
    const [move] = run(
      adjacentThrees,
      cluesAt([
        [2, 2, 3],
        [2, 3, 3],
      ]),
    ).moves;
    expect(move.focus.cells).toEqual([cell(2, 2), cell(2, 3)]);
  });
});

describe("DIAGONAL_THREES", () => {
  it("draws the outer corners of 3s on a down-right diagonal", () => {
    expect(
      derived(
        diagonalThrees,
        cluesAt([
          [2, 2, 3],
          [3, 3, 3],
        ]),
      ).lines,
    ).toEqual(sorted(edges("h 2 2", "v 2 2", "h 4 3", "v 3 4")));
  });

  it("draws the outer corners of 3s on a down-left diagonal", () => {
    expect(
      derived(
        diagonalThrees,
        cluesAt([
          [2, 3, 3],
          [3, 2, 3],
        ]),
      ).lines,
    ).toEqual(sorted(edges("h 2 3", "v 2 4", "h 4 2", "v 3 2")));
  });

  it("does nothing for 3s two cells apart", () => {
    expect(
      run(
        diagonalThrees,
        cluesAt([
          [2, 2, 3],
          [4, 4, 3],
        ]),
      ).moves,
    ).toEqual([]);
  });
});

describe("CORNER_THREE and CORNER_ONE", () => {
  it("draws the corner edges of a 3 in a corner", () => {
    expect(derived(cornerThree, cluesAt([[0, 0, 3]])).lines).toEqual(
      edges("h 0 0", "v 0 0"),
    );
    expect(derived(cornerThree, cluesAt([[6, 6, 3]])).lines).toEqual(
      edges("h 7 6", "v 6 7"),
    );
  });

  it("crosses the corner edges of a 1 in a corner", () => {
    expect(derived(cornerOne, cluesAt([[0, 6, 1]])).crosses).toEqual(
      edges("h 0 6", "v 0 7"),
    );
  });

  it("does nothing on the border away from a corner", () => {
    expect(run(cornerThree, cluesAt([[0, 1, 3]])).moves).toEqual([]);
    expect(run(cornerOne, cluesAt([[1, 0, 1]])).moves).toEqual([]);
  });
});

describe("CLUE_SATURATED", () => {
  const clues = cluesAt([[3, 3, 2]]);

  it("crosses the rest of a clue that has its lines", () => {
    const board = states(edges("h 3 3", "v 3 3"));
    const [move] = run(clueSaturated, clues, board).moves;
    expect(sorted(move.crosses)).toEqual(sorted(edges("h 4 3", "v 3 4")));
    expect(move.premises.edges).toEqual(edges("h 3 3", "v 3 3"));
  });

  it("waits while lines are missing", () => {
    expect(run(clueSaturated, clues, states(edges("h 3 3"))).moves).toEqual([]);
  });

  it("leaves 0 to ZERO", () => {
    expect(run(clueSaturated, cluesAt([[3, 3, 0]])).moves).toEqual([]);
  });
});

describe("CLUE_REMAINING", () => {
  const clues = cluesAt([[3, 3, 2]]);

  it("draws every unknown edge when exactly enough remain", () => {
    const board = states([], edges("h 3 3", "v 3 3"));
    const [move] = run(clueRemaining, clues, board).moves;
    expect(sorted(move.lines)).toEqual(sorted(edges("h 4 3", "v 3 4")));
    expect(move.premises.edges).toEqual(edges("h 3 3", "v 3 3"));
  });

  it("waits while more edges remain than the clue needs", () => {
    expect(run(clueRemaining, clues, states([], edges("h 3 3"))).moves).toEqual(
      [],
    );
  });
});

describe("vertex techniques", () => {
  const none = cluesAt([]);
  const center = vertexIndex(7, 3, 3);

  it("VERTEX_BRANCH crosses the rest of a vertex with two lines", () => {
    const [move] = run(
      vertexBranch,
      none,
      states(edges("h 3 2", "v 3 3")),
    ).moves;
    expect(sorted(move.crosses)).toEqual(sorted(edges("h 3 3", "v 2 3")));
    expect(move.focus.vertices).toEqual([center]);
  });

  it("VERTEX_BRANCH waits at a vertex with one line", () => {
    const moves = run(vertexBranch, none, states(edges("h 3 2"))).moves;
    expect(moves).toEqual([]);
  });

  it("VERTEX_CONTINUE draws the only way a line can go on", () => {
    const board = states(edges("h 3 2"), edges("h 3 3", "v 3 3"));
    const moves = run(vertexContinue, none, board).moves;
    expect(moves.map((move) => move.lines)).toEqual([edges("v 2 3")]);
  });

  it("VERTEX_CONTINUE waits while two ways are open", () => {
    const board = states(edges("h 3 2"), edges("h 3 3"));
    expect(run(vertexContinue, none, board).moves).toEqual([]);
  });

  it("VERTEX_DEAD_END crosses the last edge of a vertex no line reaches", () => {
    const moves = run(vertexDeadEnd, none, states([], edges("h 0 0"))).moves;
    expect(moves.map((move) => move.crosses)).toEqual([edges("v 0 0")]);
  });

  it("VERTEX_DEAD_END waits while two edges are open", () => {
    expect(run(vertexDeadEnd, none, states([], [])).moves).toEqual([]);
  });
});

describe("SMALL_LOOP", () => {
  const none = cluesAt([]);
  const cup = edges("h 2 2", "v 2 2", "h 3 2");

  it("crosses the edge that would close a loop while other lines exist", () => {
    const [move] = run(smallLoop, none, states([...cup, edge("h 5 5")])).moves;
    expect(move.crosses).toEqual([edge("v 2 3")]);
    expect(sorted(move.premises.edges)).toEqual(sorted(cup));
  });

  it("lets the loop close when it holds every line", () => {
    expect(run(smallLoop, none, states(cup)).moves).toEqual([]);
  });
});
