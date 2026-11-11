import { describe, expect, it } from "vitest";
import { cluesOfLoop } from "../src/core/rules";
import { solveCompletely } from "../src/core/solver";
import { cell, cluesAt, edge, geometry, rectangleLoop } from "./helpers";

const loop = rectangleLoop(1, 1, 3, 4);
const fullClues = cluesOfLoop(geometry, loop);

describe("complete solver (DESIGN.md 12.1)", () => {
  it("finds the only solution of a fully clued board", () => {
    expect(solveCompletely(geometry, fullClues)).toEqual({
      status: "unique",
      solution: loop,
    });
  });

  it("reports several solutions of a board without clues", () => {
    expect(solveCompletely(geometry, cluesAt([])).status).toBe("multiple");
  });

  it("reports no solution for contradictory clues", () => {
    const clues = [...fullClues];
    clues[cell(6, 6)] = 3;
    expect(solveCompletely(geometry, clues)).toEqual({ status: "none" });
  });

  it("respects the player's lines and ×", () => {
    expect(
      solveCompletely(geometry, fullClues, { lines: [loop[0]] }).status,
    ).toBe("unique");
    expect(
      solveCompletely(geometry, fullClues, { crosses: [loop[0]] }).status,
    ).toBe("none");
    expect(
      solveCompletely(geometry, fullClues, { lines: [edge("h 6 6")] }).status,
    ).toBe("none");
  });

  it("narrows several solutions down to the one the player's marks allow", () => {
    // 数字のない盤面でも、輪の辺を線、それ以外を × にすれば解は 1 つに決まる。
    const square = rectangleLoop(2, 2, 2, 2);
    const others = Array.from(
      { length: geometry.edgeCount },
      (_, e) => e,
    ).filter((e) => !square.includes(e));
    expect(
      solveCompletely(geometry, cluesAt([]), {
        lines: square,
        crosses: others,
      }),
    ).toEqual({ status: "unique", solution: square });
  });

  it("stops at the node budget, not at a clock", () => {
    // 唯一解だと分かるには探索を最後まで終える必要がある。
    expect(
      solveCompletely(geometry, fullClues, { nodeLimit: 100 }).status,
    ).toBe("aborted");
  });
});
