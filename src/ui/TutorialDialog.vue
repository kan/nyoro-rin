<script setup lang="ts">
/**
 * The tutorial (DESIGN.md 11.5): the lesson of src/core/tutorial.ts played
 * on the same board view and input as a puzzle. A step lets the player
 * change only its own edges and moves on once they are right. Nothing here
 * reaches the results, the play log, the clock or the hint count.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { annotateBoard } from "../core/annotations";
import { type Hint, type HintStep, findHint, nextHintStep } from "../core/hint";
import {
  type PlayBoard,
  type Stroke,
  applyEdits,
  beginStroke,
  continueStroke,
  emptyPlayBoard,
  tappedState,
  undoMove,
} from "../core/play";
import { cellsInsideLoop, lineEdges, loopVertices } from "../core/rules";
import { type AssistLevel } from "../core/settings";
import {
  type TutorialStepId,
  canEdit,
  isStepDone,
  lastHintStep,
  offersHint,
  pendingEdges,
  stepAssist,
  takesMarks,
  tutorialLesson,
} from "../core/tutorial";
import { type EdgeState } from "../core/model";
import BoardView from "./BoardView.vue";
import UiIcon from "./UiIcon.vue";
import { type HintMarks, hintMarks, hintText, placeMarks } from "./hint-view";
import { useModalDialog } from "./modal-dialog";
import { useBoardInput } from "./use-board-input";

const props = defineProps<{
  open: boolean;
  /** Opened by itself on a first visit: asks first. */
  firstVisit: boolean;
  /** The settings the free play at the end uses, as a puzzle would. */
  assist: AssistLevel;
  showConflicts: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const lesson = tutorialLesson();
const { geometry, clues, solution, steps } = lesson;

const WORDS: Readonly<Record<TutorialStepId, { title: string; text: string }>> =
  {
    rules: {
      title: "輪をつなごう",
      text: "点と点を結んで、枝分かれも交差もしない 1 本の輪を作ります。数字は、そのマスの 4 辺のうち線が通る本数です。",
    },
    corner: {
      title: "角の 3",
      text: "盤の角にある 3 は、角を作る 2 辺が必ず線になります。光っている辺をタップして、線を引きましょう。",
    },
    zero: {
      title: "0 の周りは ×",
      text: "0 のマスの周りには線が通りません。辺はタップするたびに 線 → × → 空 と変わります。光っている辺を × にしましょう。",
    },
    assist: {
      title: "アシストの ×",
      text: "線が通らないと分かりきった辺には、アシストが薄い × を付けます。0 の周りや、本数が埋まった数字の周りがそうです。強さはメニューの「設定」で変えられます。",
    },
    remaining: {
      title: "残り全部",
      text: "光っている数字は、× でない辺の数が数字と同じです。残っている辺は全部線になります。線を引きましょう。",
    },
    extend: {
      title: "線を延ばす",
      text: "線が 1 本来ている点で、ほかに行ける辺が 1 本しかなければ、線はそこへ続きます。点から点へなぞると、続けて線を引けます。光っている点から線を延ばしましょう。",
    },
    hint: {
      title: "ヒントを使う",
      text: "迷ったら電球のボタンでヒントを出します。押すたびに、注目する場所、理由、と進みます。理由を読んだら、自分で線を引いてみましょう。",
    },
    free: {
      title: "自由に解こう",
      text: "ここからは自由に解いてみましょう。困ったらヒント、間違えたら元に戻すが使えます。7×7 の盤面では、長押しで周りを拡大できます。",
    },
  };

/** `intro` asks first; `done` is the end, after the snake's lap. */
const phase = ref<"intro" | "step" | "lap" | "done">("step");
const index = ref(0);
const board = ref<PlayBoard>(emptyPlayBoard(geometry.edgeCount));
let stroke: Stroke | undefined;
const nudge = ref(false);
const shown = ref<{ hint?: Hint; step: HintStep }>();

const step = computed(() => steps[index.value]);
const words = computed(() => WORDS[step.value.id]);
const free = computed(() => step.value.id === "free");
const playable = computed(
  () => phase.value === "step" && takesMarks(step.value),
);
const solved = computed(() => phase.value === "lap" || phase.value === "done");

const dialog = ref<HTMLDialogElement>();
const { onCancel, onDialogClick } = useModalDialog(
  dialog,
  () => props.open,
  // Esc during the snake's lap ends the lap, as on a puzzle's board.
  () => (phase.value === "lap" ? endLap() : emit("close")),
  () => {
    phase.value = props.firstVisit ? "intro" : "step";
    index.value = 0;
    board.value = emptyPlayBoard(geometry.edgeCount);
    stroke = undefined;
    nudge.value = false;
    shown.value = undefined;
  },
);

const annotations = computed(() =>
  annotateBoard(geometry, clues, board.value.states, {
    showConflicts: !solved.value && (!free.value || props.showConflicts),
    assist: solved.value ? 0 : stepAssist(step.value, props.assist),
  }),
);
const loop = computed(() =>
  solved.value
    ? loopVertices(geometry, lineEdges(board.value.states))
    : undefined,
);
const inside = computed(() =>
  solved.value ? cellsInsideLoop(geometry, solution) : undefined,
);

/** What the board shows: the open hint, or the step's own places. */
const marks = computed<HintMarks | undefined>(() => {
  if (shown.value?.hint) return hintMarks(shown.value.hint, shown.value.step);
  if (phase.value !== "step" || free.value) return undefined;
  return {
    ...placeMarks(step.value.focus),
    edges: pendingEdges(step.value, board.value.states),
  };
});

const hintWords = computed(() =>
  shown.value ? hintText(shown.value.hint, shown.value.step, clues) : "",
);
const hintAvailable = computed(
  () => phase.value === "step" && offersHint(step.value),
);
/** The step the hint button goes to next, if any. */
function followingHint() {
  const open = shown.value;
  const next = open?.hint && nextHintStep(open.hint, open.step);
  return next && next.step <= lastHintStep(step.value) ? next : undefined;
}
const hintHasNext = computed(
  () => !shown.value?.hint || followingHint() !== undefined,
);

// --- moves -------------------------------------------------------------

function setBoard(next: PlayBoard): void {
  if (next === board.value) return;
  board.value = next;
  shown.value = undefined;
  nudge.value = false;
  if (isStepDone(lesson, step.value, next.states)) advance();
}

function advance(): void {
  if (free.value) {
    input.endGesture();
    phase.value = "lap";
    return;
  }
  stroke = undefined;
  index.value += 1;
  // Each step starts from the board as it is: undo cannot take apart the
  // steps before it.
  board.value = { ...board.value, undo: [], redo: [] };
}

function editable(edge: number): boolean {
  if (canEdit(step.value, edge)) return true;
  nudge.value = true;
  return false;
}

function tap(edge: number): void {
  if (!playable.value || !editable(edge)) return;
  const after = tappedState(board.value.states[edge] as EdgeState);
  setBoard(applyEdits(board.value, [{ edge, after }]));
}

const input = useBoardInput({
  geometry: computed(() => geometry),
  states: computed(() => board.value.states),
  playable,
  zoomable: false,
  tap,
  beginStroke: () => {
    stroke = beginStroke(board.value);
  },
  strokeEdges: (edges) => {
    if (!stroke) return;
    const taken = edges.filter(editable);
    if (taken.length === 0) return;
    const next = continueStroke(stroke, taken);
    stroke = next.stroke;
    setBoard(next.board);
  },
  endStroke: () => {
    stroke = undefined;
  },
  // A tap cuts the snake's lap short, as on a puzzle's board.
  onPress: () => endLap(),
});
const { tapPreview, mainBoardHandlers } = input;

// Leaving the page ends a press, as on a puzzle's board (App.vue suspend).
onMounted(() => window.addEventListener("blur", input.endGesture));
onUnmounted(() => window.removeEventListener("blur", input.endGesture));

function undo(): void {
  if (playable.value) setBoard(undoMove(board.value));
}

/** The hint button: the next step of the open hint, or a new one. */
function requestHint(): void {
  if (!hintAvailable.value) return;
  const open = shown.value;
  if (!open?.hint) {
    const hint =
      step.value.hint ??
      findHint(geometry, { clues, solution }, board.value.states);
    shown.value = { hint, step: 1 };
    return;
  }
  const next = followingHint();
  if (!next) return;
  if (next.action === "step")
    shown.value = { hint: open.hint, step: next.step };
  else setBoard(applyEdits(board.value, next.edits));
}

function begin(): void {
  phase.value = "step";
}

function endLap(): void {
  if (phase.value === "lap") phase.value = "done";
}
</script>

<template>
  <dialog
    ref="dialog"
    class="tutorial-dialog"
    aria-labelledby="tutorial-title"
    @cancel="onCancel"
    @click="onDialogClick"
  >
    <div class="dialog-card">
      <header class="dialog-header">
        <h2 id="tutorial-title">
          <template v-if="phase === 'intro'"
            >チュートリアルを見ますか？</template
          >
          <template v-else-if="phase === 'done'">チュートリアル完了</template>
          <template v-else>{{ words.title }}</template>
        </h2>
        <!-- Not called ステップ: that is the hint's word (DESIGN.md 11.2). -->
        <small
          v-if="phase === 'step'"
          class="tutorial-count"
          :aria-label="`${steps.length} のうち ${index + 1} 番目`"
        >
          {{ index + 1 }} / {{ steps.length }}
        </small>
        <button
          type="button"
          class="icon-button"
          aria-label="チュートリアルを閉じる"
          title="閉じる"
          @click="emit('close')"
        >
          <UiIcon name="close" />
        </button>
      </header>

      <template v-if="phase === 'intro'">
        <p class="note">
          小さな盤面を実際に操作しながら、ルールと基本の解き方を覚えます。あとからメニューの「遊び方」でも始められます。
        </p>
        <div class="dialog-actions">
          <button type="button" @click="emit('close')">あとで</button>
          <button type="button" class="primary" autofocus @click="begin">
            はい
          </button>
        </div>
      </template>

      <template v-else>
        <p v-if="phase === 'done'" class="tutorial-text" role="status">
          輪が閉じました。これで基本はおしまいです。実際の問題を解いてみましょう。
        </p>
        <p v-else class="tutorial-text" role="status">{{ words.text }}</p>
        <p v-if="nudge" class="note tutorial-nudge" role="status">
          光っている辺を操作しましょう。
        </p>
        <p v-if="shown" class="tutorial-hint" role="status">
          <UiIcon name="hint" />{{ hintWords }}
        </p>

        <div class="tutorial-board">
          <BoardView
            :geometry="geometry"
            :clues="clues"
            :states="board.states"
            :annotations="annotations"
            :inside="inside"
            :loop="loop"
            :lap="phase === 'lap'"
            label="チュートリアルの 5×5 の盤面"
            :hint="marks"
            :tap-preview="tapPreview"
            v-bind="mainBoardHandlers"
            @lap-end="endLap"
          />
        </div>

        <div class="tutorial-actions">
          <button
            v-if="hintAvailable"
            type="button"
            class="icon-button hint-button"
            aria-label="ヒント"
            title="ヒント"
            :disabled="!hintHasNext"
            @click="requestHint"
          >
            <UiIcon name="hint" />
          </button>
          <button
            v-if="free && phase === 'step'"
            type="button"
            class="icon-button"
            aria-label="元に戻す"
            title="元に戻す"
            :disabled="board.undo.length === 0"
            @click="undo"
          >
            <UiIcon name="undo" />
          </button>
          <button
            v-if="phase === 'step' && !takesMarks(step)"
            type="button"
            class="primary"
            @click="advance"
          >
            次へ
          </button>
          <button
            v-if="phase === 'done'"
            type="button"
            class="primary"
            @click="emit('close')"
          >
            遊ぶ
          </button>
        </div>
      </template>
    </div>
  </dialog>
</template>
