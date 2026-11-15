import { describe, expect, it } from "vitest";
import { availableMoves, solveLogically } from "../src/core/logical";
import { CROSS, LINE, UNKNOWN } from "../src/core/model";
import { isSolved } from "../src/core/rules";
import { solveCompletely } from "../src/core/solver";
import { type KeyValueStorage } from "../src/core/storage";
import {
  TUTORIAL_KEY,
  canEdit,
  isStepDone,
  lastHintStep,
  offersHint,
  pendingEdges,
  rememberTutorial,
  shouldShowTutorial,
  stepAssist,
  takesMarks,
  tutorialLesson,
} from "../src/core/tutorial";
import { memoryStorage } from "./helpers";

const lesson = tutorialLesson();
const { geometry, clues, solution, steps } = lesson;
const step = (id: string) => steps.find((s) => s.id === id)!;

/** The board as each step begins: every earlier goal played. */
function statesBefore(id: string): Uint8Array {
  const states = new Uint8Array(geometry.edgeCount);
  for (const s of steps) {
    if (s.id === id) return states;
    for (const { edge, after } of s.goal) states[edge] = after;
  }
  throw new Error(id);
}

describe("the tutorial board (DESIGN.md 11.5)", () => {
  it("has one answer, reached with the basic techniques alone", () => {
    expect(solveCompletely(geometry, clues).status).toBe("unique");
    expect(solveLogically(geometry, clues).solved).toBe(true);
  });

  it("goes through its steps in order", () => {
    expect(steps.map((s) => s.id)).toEqual([
      "rules",
      "corner",
      "zero",
      "assist",
      "remaining",
      "extend",
      "hint",
      "free",
    ]);
  });

  it("only ever asks for the answer", () => {
    const answer = new Set(solution);
    for (const s of steps) {
      for (const { edge, after } of s.goal) {
        expect(after === LINE, `${s.id} ${edge}`).toBe(answer.has(edge));
      }
    }
  });

  it("asks for edges still open when each step begins", () => {
    for (const s of steps) {
      const before = statesBefore(s.id);
      for (const { edge } of s.goal) expect(before[edge]).toBe(UNKNOWN);
    }
  });

  it("draws the corner's two lines and crosses around a 0", () => {
    expect(step("corner").goal).toHaveLength(2);
    expect(step("zero").goal.every((e) => e.after === CROSS)).toBe(true);
    expect(clues[step("zero").focus.cells[0]]).toBe(0);
  });

  it("needs the assist's × before the remaining lines show", () => {
    const remaining = step("remaining").goal.map((e) => e.edge);
    const moves = availableMoves(geometry, clues, statesBefore("remaining"), {
      techniques: ["CLUE_REMAINING"],
    }).moves;
    expect(
      moves.some((m) => remaining.every((edge) => m.lines.includes(edge))),
    ).toBe(false);
  });

  it("leads a line on through several vertices in one path", () => {
    const path = step("extend").goal.map((e) => e.edge);
    expect(path.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < path.length; i += 1) {
      const [a, b] = geometry.edgeVertices[path[i - 1]];
      const [c, d] = geometry.edgeVertices[path[i]];
      expect([a, b].some((v) => v === c || v === d)).toBe(true);
    }
  });

  it("has the hint step draw the hint's own lines", () => {
    const s = step("hint");
    expect(s.hint?.move.lines).toEqual(s.goal.map((e) => e.edge));
  });

  it("leaves something to solve freely, and the answer finishes it", () => {
    const before = statesBefore("free");
    expect(
      solution.filter((edge) => before[edge] === UNKNOWN).length,
    ).toBeGreaterThanOrEqual(10);
    expect(isStepDone(lesson, step("free"), before)).toBe(false);
    for (const edge of solution) before[edge] = LINE;
    expect(isSolved(geometry, clues, before)).toBe(true);
    expect(isStepDone(lesson, step("free"), before)).toBe(true);
  });

  it("counts a step done only when every goal edge is reached", () => {
    const s = step("corner");
    const states = new Uint8Array(geometry.edgeCount);
    expect(isStepDone(lesson, s, states)).toBe(false);
    states[s.goal[0].edge] = LINE;
    expect(isStepDone(lesson, s, states)).toBe(false);
    states[s.goal[1].edge] = LINE;
    expect(isStepDone(lesson, s, states)).toBe(true);
    expect(isStepDone(lesson, step("rules"), states)).toBe(false);
  });
});

describe("what each step allows (DESIGN.md 11.5)", () => {
  it("takes marks only on its own edges, and on any at the end", () => {
    const corner = step("corner");
    const own = corner.goal[0].edge;
    const other = step("zero").goal[0].edge;
    expect(takesMarks(step("rules"))).toBe(false);
    expect(takesMarks(step("assist"))).toBe(false);
    expect(takesMarks(corner)).toBe(true);
    expect(canEdit(corner, own)).toBe(true);
    expect(canEdit(corner, other)).toBe(false);
    expect(canEdit(step("free"), other)).toBe(true);
  });

  it("lights up the goal's edges until each is right", () => {
    const corner = step("corner");
    const states = new Uint8Array(geometry.edgeCount);
    expect(pendingEdges(corner, states)).toHaveLength(2);
    states[corner.goal[0].edge] = LINE;
    expect(pendingEdges(corner, states)).toEqual([corner.goal[1].edge]);
  });

  it("brings in the assist's × at the assist step, and the setting at the end", () => {
    expect(stepAssist(step("zero"), 2)).toBe(0);
    expect(stepAssist(step("assist"), 2)).toBe(1);
    expect(stepAssist(step("hint"), 0)).toBe(1);
    expect(stepAssist(step("free"), 0)).toBe(0);
    expect(stepAssist(step("free"), 2)).toBe(2);
  });

  it("stops the hint step's hint at the reason, for the player to draw", () => {
    expect(lastHintStep(step("hint"))).toBe(2);
    expect(lastHintStep(step("free"))).toBe(3);
  });

  it("offers the hint in the hint step and the free play only", () => {
    expect(steps.filter(offersHint).map((s) => s.id)).toEqual(["hint", "free"]);
  });
});

describe("whether the tutorial was seen", () => {
  it("is shown until it is closed once", () => {
    const { storage } = memoryStorage();
    expect(shouldShowTutorial(storage)).toBe(true);
    rememberTutorial(storage);
    expect(storage.getItem(TUTORIAL_KEY)).toBe("true");
    expect(shouldShowTutorial(storage)).toBe(false);
  });

  it("is shown again when the stored value is not true", () => {
    const { storage } = memoryStorage({ [TUTORIAL_KEY]: '"seen"' });
    expect(shouldShowTutorial(storage)).toBe(true);
  });

  it("is shown, and closes, without storage", () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldShowTutorial(blocked)).toBe(true);
    expect(() => rememberTutorial(blocked)).not.toThrow();
  });
});
