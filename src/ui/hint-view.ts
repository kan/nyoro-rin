/**
 * What a hint shows at each step (DESIGN.md 11.2, 9.2): the words and the
 * marks on the board. The hint itself comes from src/core/hint.ts.
 */
import { type Hint, type HintStep } from "../core/hint";
import { CROSS, type Clue, type Places } from "../core/model";
import { type TechniqueId } from "../core/techniques";

/** The hint's marks on the board; every list holds numbers of its kind. */
export interface HintMarks {
  /** Clues to look at: a blue frame. */
  readonly cells: readonly number[];
  /** Vertices to look at: a blue ring. */
  readonly vertices: readonly number[];
  /** Where a mistake is: a pale fill. */
  readonly area: readonly number[];
  /**
   * Edges to look at, without saying what they become: a pale glow. Also
   * the wrong marks of a mistake, which are already drawn.
   */
  readonly edges: readonly number[];
  /** Edges that become lines: blue dashes. */
  readonly lines: readonly number[];
  /** Edges that become ×: a blue ×. */
  readonly crosses: readonly number[];
}

const NO_HINT_MARKS: HintMarks = {
  cells: [],
  vertices: [],
  area: [],
  edges: [],
  lines: [],
  crosses: [],
};

function placeMarks(places: Places): HintMarks {
  return {
    ...NO_HINT_MARKS,
    cells: places.cells,
    vertices: places.vertices,
    edges: places.edges,
  };
}

/** Each number once: the board keys its marks by number. */
function unique(...lists: (readonly number[] | undefined)[]): number[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

export function hintMarks(hint: Hint, step: HintStep): HintMarks {
  switch (hint.kind) {
    case "mistake":
      if (step === 1) return NO_HINT_MARKS;
      if (step === 2) return { ...NO_HINT_MARKS, area: hint.area.cells };
      // A glow, not dashes: dashes would read as "draw a line here".
      return {
        ...NO_HINT_MARKS,
        edges: unique(hint.wrongLines, hint.wrongCrosses),
      };
    case "reveal":
      return step === 1
        ? NO_HINT_MARKS
        : { ...NO_HINT_MARKS, lines: [hint.edge] };
    case "move": {
      const { move } = hint;
      if (step === 1) return placeMarks(move.focus);
      // Step 2 keeps the focus, says what the edges become, and for a
      // trial also shows where its assumption went wrong.
      const wrongAt = move.trial?.contradiction.places;
      return {
        ...NO_HINT_MARKS,
        cells: unique(move.focus.cells, wrongAt?.cells),
        vertices: unique(move.focus.vertices, wrongAt?.vertices),
        edges: unique(move.focus.edges, wrongAt?.edges),
        lines: move.lines,
        crosses: hint.crosses,
      };
    }
  }
}

/** The players' names of the techniques (DESIGN.md 12.3). */
const TECHNIQUE_NAMES: Readonly<Record<TechniqueId, string>> = {
  ZERO: "0",
  ADJACENT_THREES: "隣り合う 3",
  DIAGONAL_THREES: "斜めの 3",
  CORNER_THREE: "角の 3",
  CORNER_ONE: "角の 1",
  CLUE_SATURATED: "本数が埋まった数字",
  CLUE_REMAINING: "残り全部",
  VERTEX_BRANCH: "枝分かれ禁止",
  VERTEX_CONTINUE: "線の延長",
  VERTEX_DEAD_END: "行き止まり",
  SMALL_LOOP: "小さな輪",
  LINE_INTO_THREE: "線が入ってくる 3",
  LINE_INTO_ONE: "線が入ってくる 1",
  TRIAL: "仮置き",
};

/** What the places of a contradiction are called, for a trial's reason. */
function placeWord(places: Places): string {
  if (places.cells.length > 0) return "青い枠の数字";
  if (places.vertices.length > 0) return "青い丸の点";
  return "光っている線";
}

/** Which kinds of mark are wrong, so the player looks for the right ones. */
function mistakeWord(hint: Extract<Hint, { kind: "mistake" }>): string {
  if (hint.wrongLines.length === 0) return " ×";
  if (hint.wrongCrosses.length === 0) return "線";
  return "線と ×";
}

function moveReason(
  hint: Extract<Hint, { kind: "move" }>,
  clues: readonly Clue[],
): string {
  const { move } = hint;
  const clue = clues[move.focus.cells[0]];
  switch (move.technique) {
    case "ZERO":
      return "0 のマスの周りには線を引けません。";
    case "ADJACENT_THREES":
      return "3 が隣り合うと、間の辺とその両外側の辺の 3 本が線になります。";
    case "DIAGONAL_THREES":
      return "3 が斜めに並ぶと、それぞれ外側の角を作る 2 辺が線になります。";
    case "CORNER_THREE":
      return "盤の角にある 3 は、角の 2 辺が線になります。";
    case "CORNER_ONE":
      return "盤の角にある 1 は、角の 2 辺が × になります。";
    case "CLUE_SATURATED":
      return `この ${clue} の周りにはもう ${clue} 本の線があるので、残りの辺は × になります。`;
    case "CLUE_REMAINING":
      return `この ${clue} の周りで線を引ける辺は残り ${move.lines.length} 本だけなので、全部線になります。`;
    case "VERTEX_BRANCH":
      return "この点からはもう線が 2 本出ているので、ほかの向きには線を引けません。";
    case "VERTEX_CONTINUE":
      return "線は途中で途切れません。この点から延ばせる向きは 1 つしかありません。";
    case "VERTEX_DEAD_END":
      return "この点で線が通れる向きは 1 つしかないので、線を引くと行き止まりになります。";
    case "SMALL_LOOP":
      return "ここをつなぐと小さな輪が閉じて、ほかの線とつながれなくなります。";
    case "LINE_INTO_THREE":
      return "この 3 の角（青い丸の点）に、外から線が来ています。外へ抜けると 3 本に届かないので、線は角から 3 の辺のどちらかへ進みます。なので、角に接しない 2 辺は線、角のほかの外側の辺は × になります。";
    case "LINE_INTO_ONE":
      return "この 1 の角（青い丸の点）に外から線が来ていて、外へは抜けられません。線は角から 1 の辺のどちらかへ進み、それが 1 本目になります。なので、角に接しない 2 辺は × になります。";
    case "TRIAL": {
      const trial = move.trial!;
      // The assumed edge is the trial's focus and glows from step 1 on;
      // the blue × may include others, so they cannot name it.
      const where = placeWord(trial.contradiction.places);
      return trial.assumed === CROSS
        ? `光っている辺を × と仮定して進めると、${where}で矛盾します。なのでこの辺は線です。`
        : `光っている辺に線を引いたと仮定して進めると、${where}で矛盾します。なのでこの辺は × です。`;
    }
  }
}

/** The words of a hint at a step; step 3 of a move is the writing itself. */
export function hintText(
  hint: Hint,
  step: HintStep,
  clues: readonly Clue[],
): string {
  switch (hint.kind) {
    case "mistake":
      if (step === 1) return "今の線か × に誤りがあります。";
      if (step === 2) return "光っているあたりに誤りがあります。";
      return `光っている${mistakeWord(hint)}が誤りです。`;
    case "reveal":
      return step === 1
        ? "定石で説明できる一手が見つかりません。次のステップで正解の線を 1 本示します。"
        : "青い破線の辺は線になります。";
    case "move": {
      const { move } = hint;
      if (step === 1) {
        if (move.technique === "TRIAL") {
          return "定石だけでは進めない場面です。光っている辺を仮に決めてみてください。";
        }
        if (move.focus.cells.length > 0) {
          return "光っている数字に注目すると、決まる辺があります。";
        }
        return "光っている点に注目すると、決まる辺があります。";
      }
      // The × beyond the move's own are the ones its reason rests on.
      const related = hint.crosses.length > move.crosses.length;
      const crosses = related ? "関係する × も青で示しています。" : "";
      return `${moveReason(hint, clues)}（${TECHNIQUE_NAMES[move.technique]}）${crosses}`;
    }
  }
}
