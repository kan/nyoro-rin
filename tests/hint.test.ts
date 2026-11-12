import { describe, expect, it } from "vitest";
import { newAttempt } from "../src/core/attempt";
import { generatePuzzle } from "../src/core/generator";
import {
  type Hint,
  findHint,
  hintStepEdits,
  withHintStep,
} from "../src/core/hint";
import { propagate } from "../src/core/logical";
import { CROSS, LINE, type EdgeStates, type Puzzle } from "../src/core/model";
import { applyEdits, emptyPlayBoard } from "../src/core/play";
import { isSolved, statesFromLines } from "../src/core/rules";
import { CROSS_ONLY_TECHNIQUES } from "../src/core/techniques";
import { geometry, states } from "./helpers";

const easy = generatePuzzle("hint-easy", "easy").puzzle;
const normal = generatePuzzle("hint-normal", "normal").puzzle;

/** Step 3 of the hint, written as the game writes it. */
function apply(board: EdgeStates, hint: Hint): EdgeStates {
  const played = { ...emptyPlayBoard(geometry.edgeCount), states: board };
  return applyEdits(played, hintStepEdits(hint, 3)).states;
}

/** Follows hints from an empty board; returns the kinds of hint used. */
function followHints(puzzle: Puzzle) {
  let board = states();
  const used: string[] = [];
  for (let i = 0; i < geometry.edgeCount; i += 1) {
    const hint = findHint(geometry, puzzle, board);
    if (!hint) break;
    used.push(hint.kind === "move" ? hint.move.technique : hint.kind);
    board = apply(board, hint);
  }
  return { board, used };
}

describe("hint order (DESIGN.md 11.1)", () => {
  it("points at a step that draws a line, not at an obvious ×", () => {
    const hint = findHint(geometry, easy, states());
    expect(hint?.kind).toBe("move");
    if (hint?.kind !== "move") return;
    expect(hint.move.lines.length).toBeGreaterThan(0);
    expect(CROSS_ONLY_TECHNIQUES).not.toContain(hint.move.technique);
  });

  it("leads an easy board to the end with the basic techniques", () => {
    const { board, used } = followHints(easy);
    expect(isSolved(geometry, easy.clues, board)).toBe(true);
    expect(used).not.toContain("TRIAL");
    expect(used).not.toContain("reveal");
  });

  it("leads a board that needs trials to the end without revealing", () => {
    const { board, used } = followHints(normal);
    expect(isSolved(geometry, normal.clues, board)).toBe(true);
    expect(used).toContain("TRIAL");
    expect(used).not.toContain("reveal");
  });

  it("names where a trial goes wrong (DESIGN.md 11.4)", () => {
    const stuck = propagate(geometry, normal.clues, states()).states;
    const hint = findHint(geometry, normal, stuck);
    expect(hint?.kind).toBe("move");
    if (hint?.kind !== "move") return;
    expect(hint.move.technique).toBe("TRIAL");
    // Assuming × and failing draws a line, which a hint prefers.
    expect(hint.move.trial?.assumed).toBe(CROSS);
    expect(hint.move.lines).toEqual([hint.move.trial?.edge]);
    const places = hint.move.trial!.contradiction.places;
    expect(
      places.cells.length + places.vertices.length + places.edges.length,
    ).toBeGreaterThan(0);
  });

  it("shows and writes only unknown edges, each as the answer has it", () => {
    const { board } = followHints(easy);
    // Take back one line at a time, so that hints of every kind come up.
    for (const edge of easy.solution) {
      const back = Uint8Array.from(board);
      back[edge] = 0;
      const hint = findHint(geometry, easy, back);
      if (hint?.kind !== "move") continue;
      expect(hint.crosses).toEqual(
        expect.arrayContaining([...hint.move.crosses]),
      );
      for (const { after, edge: written } of hintStepEdits(hint, 3)) {
        expect(back[written]).toBe(0);
        expect(after === LINE).toBe(easy.solution.includes(written));
      }
    }
  });

  it("writes nothing before step 3", () => {
    const hint = findHint(geometry, easy, states())!;
    expect(hintStepEdits(hint, 1)).toEqual([]);
    expect(hintStepEdits(hint, 2)).toEqual([]);
    expect(hintStepEdits(hint, 3).length).toBeGreaterThan(0);
  });

  it("gives nothing on a solved board", () => {
    const solved = statesFromLines(geometry, easy.solution);
    expect(findHint(geometry, easy, solved)).toBeUndefined();
  });
});

describe("mistakes (DESIGN.md 11.3)", () => {
  const offLoop = [...Array(geometry.edgeCount).keys()].find(
    (edge) => !easy.solution.includes(edge),
  )!;
  const onLoop = easy.solution[0];

  it("finds a wrong line and a wrong ×, before any other hint", () => {
    const board = states([offLoop], [onLoop]);
    expect(findHint(geometry, easy, board)).toMatchObject({
      kind: "mistake",
      wrongLines: [offLoop],
      wrongCrosses: [onLoop],
    });
  });

  it("shows the area around the first wrong mark, and writes nothing", () => {
    const hint = findHint(geometry, easy, states([offLoop]));
    if (hint?.kind !== "mistake") throw new Error("expected a mistake");
    for (const cell of geometry.edgeCells[offLoop]) {
      expect(hint.area.cells).toContain(cell);
    }
    expect(hintStepEdits(hint, 3)).toEqual([]);
  });

  it("does not call right marks a mistake", () => {
    const board = states(easy.solution.slice(0, 3));
    expect(findHint(geometry, easy, board)?.kind).toBe("move");
  });
});

describe("recording hints (DATA_CONTRACT.md 「段階と記録の値」)", () => {
  const start = newAttempt("00000000-0000-4000-8000-00000000000a", 0, 2);
  const move = findHint(geometry, easy, states())!;
  const reveal: Hint = { kind: "reveal", edge: 7 };

  it("counts a hint once, at its first step", () => {
    let attempt = withHintStep(start, move, 1);
    attempt = withHintStep(attempt, move, 2);
    expect(attempt).toMatchObject({
      hintsUsed: 1,
      maxHintStage: 2,
      reveals: 0,
    });
  });

  it("never lowers the highest step", () => {
    let attempt = withHintStep(start, move, 3);
    attempt = withHintStep(attempt, move, 1);
    expect(attempt).toMatchObject({ hintsUsed: 1, maxHintStage: 3 });
  });

  it("counts the line a reveal shows, within the hints (DESIGN.md 11.4)", () => {
    let attempt = withHintStep(start, reveal, 1);
    attempt = withHintStep(attempt, reveal, 2);
    attempt = withHintStep(attempt, reveal, 3);
    expect(attempt).toMatchObject({ hintsUsed: 1, reveals: 1 });
  });

  it("writes a revealed line as a line", () => {
    expect(hintStepEdits(reveal, 3)).toEqual([{ edge: 7, after: LINE }]);
  });
});
