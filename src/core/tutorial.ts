/**
 * The tutorial (DESIGN.md 11.5): a fixed 5 × 5 board played through in
 * steps, each teaching one rule, operation or technique on the board itself.
 * The steps are derived here from the board with the same techniques the
 * hints use, so their words and the board cannot drift apart. Nothing of
 * the tutorial is recorded: no results, play log, clock or hint count.
 */
import { type BoardGeometry, boardGeometry } from "./board";
import { type HintStep, LAST_HINT_STEP, type MoveHint, findHint } from "./hint";
import { availableMoves, propagateCrosses } from "./logical";
import {
  CROSS,
  LINE,
  NO_PLACES,
  type Clue,
  type EdgeStates,
  type Places,
} from "./model";
import { type EdgeEdit } from "./play";
import { isSolved } from "./rules";
import { solveCompletely } from "./solver";
import { type AssistLevel } from "./settings";
import { type KeyValueStorage, readJson, writeJson } from "./storage";
import { type StepTechniqueId } from "./techniques";

export const TUTORIAL_KEY = "nyoro-rin.tutorial.v1";

const _ = null;

/**
 * An n1 easy board of 5 × 5 (seed `tut-30`), kept as clues so that a later
 * change of the generator cannot change the lesson. tests/tutorial.test.ts
 * checks that it has one answer and that the steps below come in order.
 */
// prettier-ignore
const TUTORIAL_CLUES: readonly Clue[] = [
  _, _, 1, _, 3,
  2, _, 0, _, _,
  0, 3, _, 3, _,
  _, _, _, 2, 3,
  0, _, _, 2, _,
];

export type TutorialStepId =
  | "rules"
  | "corner"
  | "zero"
  | "assist"
  | "remaining"
  | "extend"
  | "hint"
  | "free";

export interface TutorialStep {
  readonly id: TutorialStepId;
  /**
   * The edges the step lets the player change and what each must become.
   * Empty for a step that is only read, and for the free play at the end.
   */
  readonly goal: readonly EdgeEdit[];
  /** The clues and vertices the step is about. */
  readonly focus: Places;
  /** Whether the assist's × are on the board from this step on. */
  readonly autoCrosses: boolean;
  /** The hint the hint step has the player ask for. */
  readonly hint?: MoveHint;
}

export interface TutorialLesson {
  readonly geometry: BoardGeometry;
  readonly clues: readonly Clue[];
  readonly solution: readonly number[];
  readonly steps: readonly TutorialStep[];
}

/** Whether the board takes marks in the step; the others are only read. */
export function takesMarks(step: TutorialStep): boolean {
  return step.id === "free" || step.goal.length > 0;
}

/** The edges a step lets the player change: all of them at the end. */
export function canEdit(step: TutorialStep, edge: number): boolean {
  return step.id === "free" || step.goal.some((goal) => goal.edge === edge);
}

/** The goal's edges not yet as they should be: those the board lights up. */
export function pendingEdges(step: TutorialStep, states: EdgeStates): number[] {
  return step.goal
    .filter(({ edge, after }) => states[edge] !== after)
    .map(({ edge }) => edge);
}

/** Whether the hint button works: in the hint step and the free play. */
export function offersHint(step: TutorialStep): boolean {
  return step.id === "hint" || step.id === "free";
}

/**
 * The assist on the board: none before the assist step, then the × alone
 * (the step's own places stand for the guide), and at the end the
 * player's setting, as in a puzzle.
 */
export function stepAssist(
  step: TutorialStep,
  setting: AssistLevel,
): AssistLevel {
  if (!step.autoCrosses) return 0;
  return step.id === "free" ? setting : 1;
}

/**
 * How far the hint goes. The hint step stops at the reason (step 2): the
 * player draws the lines, since writing the answer is the habit the step
 * is there to break. The free play goes on to the writing, as in a puzzle.
 */
export function lastHintStep(step: TutorialStep): HintStep {
  return step.id === "hint" ? 2 : LAST_HINT_STEP;
}

/** Every step after the read-only ones can be told done from the board. */
export function isStepDone(
  lesson: TutorialLesson,
  step: TutorialStep,
  states: EdgeStates,
): boolean {
  if (step.id === "free")
    return isSolved(lesson.geometry, lesson.clues, states);
  return (
    step.goal.length > 0 &&
    step.goal.every(({ edge, after }) => states[edge] === after)
  );
}

let built: TutorialLesson | undefined;

/** The lesson, built once: the board is fixed, so it never changes. */
export function tutorialLesson(): TutorialLesson {
  return (built ??= buildLesson());
}

/** Builds the lesson, playing each step's goal onto the board in turn. */
function buildLesson(): TutorialLesson {
  const geometry = boardGeometry(5);
  const clues = TUTORIAL_CLUES;
  const answer = solveCompletely(geometry, clues, { nodeLimit: Infinity });
  if (answer.status !== "unique") {
    throw new Error("The tutorial board must have one answer.");
  }
  const solution = answer.solution!;
  const states: EdgeStates = new Uint8Array(geometry.edgeCount);
  const steps: TutorialStep[] = [];

  const moveOf = (technique: StepTechniqueId, on: EdgeStates) => {
    const move = availableMoves(geometry, clues, on, {
      techniques: [technique],
    }).moves[0];
    if (!move) throw new Error(`The tutorial needs a ${technique} move.`);
    return move;
  };
  const withAssist = () => propagateCrosses(geometry, clues, states).states;
  const add = (
    id: TutorialStepId,
    goal: readonly EdgeEdit[] = [],
    focus: Places = NO_PLACES,
    hint?: MoveHint,
  ) => {
    for (const { edge, after } of goal) states[edge] = after;
    // The assist's × come in with the assist step and stay.
    const autoCrosses = id === "assist" || (steps.at(-1)?.autoCrosses ?? false);
    steps.push({ id, goal, focus, autoCrosses, hint });
  };
  const lines = (edges: readonly number[]): EdgeEdit[] =>
    edges.map((edge) => ({ edge, after: LINE }));

  add("rules");

  const corner = moveOf("CORNER_THREE", states);
  add("corner", lines(corner.lines), corner.focus);

  const zero = moveOf("ZERO", states);
  add(
    "zero",
    zero.crosses.map((edge): EdgeEdit => ({ edge, after: CROSS })),
    zero.focus,
  );

  add("assist");

  const remaining = moveOf("CLUE_REMAINING", withAssist());
  add("remaining", lines(remaining.lines), remaining.focus);

  // A line led on through the vertices that each leave it one way.
  const first = moveOf("VERTEX_CONTINUE", withAssist());
  const path = [...first.lines];
  let end = first.focus.vertices[0];
  for (;;) {
    const known = propagateCrosses(
      geometry,
      clues,
      withPath(states, path),
    ).states;
    const [a, b] = geometry.edgeVertices[path.at(-1)!];
    end = a === end ? b : a;
    const next = availableMoves(geometry, clues, known, {
      techniques: ["VERTEX_CONTINUE"],
    }).moves.find((move) => move.focus.vertices[0] === end);
    if (!next) break;
    path.push(...next.lines);
  }
  add("extend", lines(path), first.focus);

  const hint = findHint(geometry, { clues, solution }, states);
  if (hint?.kind !== "move" || hint.move.lines.length === 0) {
    throw new Error("The tutorial's hint must draw lines.");
  }
  add("hint", lines(hint.move.lines), NO_PLACES, hint);

  add("free");
  return { geometry, clues, solution, steps };
}

function withPath(states: EdgeStates, path: readonly number[]): EdgeStates {
  const next = Uint8Array.from(states);
  for (const edge of path) next[edge] = LINE;
  return next;
}

/** Unseen, or nowhere to remember it: then it comes each visit. */
export function shouldShowTutorial(storage: KeyValueStorage): boolean {
  return !readJson(storage, TUTORIAL_KEY, (value: unknown) =>
    value === true ? true : undefined,
  );
}

export function rememberTutorial(storage: KeyValueStorage): void {
  writeJson(storage, TUTORIAL_KEY, true);
}
