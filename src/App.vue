<script setup lang="ts">
/**
 * The play screen: the board takes the space, with only the difficulty and
 * the menu above it and the tool switch and moves below it. Everything else
 * is in the menu (src/ui/MenuDialog.vue).
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { type DifficultyChoice } from "./core/difficulty-choice";
import { completedPlay } from "./core/results";
import { type SeedCode } from "./core/seed-code";
import { type Tool } from "./core/settings";
import BoardView, { type BoardPointerEvent } from "./ui/BoardView.vue";
import DifficultyDialog from "./ui/DifficultyDialog.vue";
import HintPanel from "./ui/HintPanel.vue";
import MenuDialog from "./ui/MenuDialog.vue";
import UiIcon from "./ui/UiIcon.vue";
import {
  LONG_PRESS_MS,
  type BoardPoint,
  type ZoomWindow,
  panZoomWindow,
  zoomWindowAt,
} from "./ui/board-input";
import { BoardGesture } from "./ui/gesture";
import { formatScore, formatSeconds } from "./ui/format";
import { DIFFICULTY_CHOICE_LABELS, DIFFICULTY_LABELS } from "./ui/labels";
import { useDifficultyChoice } from "./ui/use-difficulty-choice";
import { usePlay } from "./ui/use-play";
import { useHint } from "./ui/use-hint";
import { useSettings } from "./ui/use-settings";

const settings = useSettings();
const play = usePlay(settings, { onClear: showClear });
const hint = useHint(play);
const difficulty = useDifficultyChoice();
const { puzzle, board, geometry, annotations, inside, solved, loading } = play;

/** The dialog open over the board, if any; one at a time. */
type Panel = "menu" | "difficulty";
const panel = ref<Panel>();
const zoom = ref<ZoomWindow>();
const clearCardOpen = ref(false);
const confirmDialog = ref<HTMLDialogElement>();
const confirmOpen = ref(false);
const readyButton = ref<HTMLButtonElement>();
/** What to start once the player agrees to leave the current board. */
let pendingStart: (() => Promise<boolean>) | undefined;

const difficultyLabel = computed(() =>
  puzzle.value ? DIFFICULTY_LABELS[puzzle.value.difficulty] : "",
);

/** READY covers the board, so the time off the clock is not time to think. */
const readyShown = computed(
  () => play.waiting.value && panel.value === undefined && !confirmOpen.value,
);

// OK takes the focus once it can be pressed: READY also waits out the
// making of the next board, with OK disabled meanwhile.
watch([readyShown, loading], async ([shown, making]) => {
  if (!shown) return;
  zoom.value = undefined;
  if (making) return;
  await nextTick();
  readyButton.value?.focus();
});

/** The record of the board on screen, once it is cleared. */
const clearedPlay = computed(() =>
  completedPlay(play.history.value, play.attempt.value?.playId),
);

function showClear(): void {
  zoom.value = undefined;
  clearCardOpen.value = true;
}

// --- the clock --------------------------------------------------------------

/**
 * Whether closing the menu or the confirmation runs the clock again: only
 * when it ran before they opened and the page stayed in front (as TAKO-SEN).
 */
let resumeOnClose = false;

function holdClock(): void {
  if (!play.running.value) return;
  resumeOnClose = true;
  play.pause();
}

function releaseClock(): void {
  const resume = resumeOnClose;
  resumeOnClose = false;
  if (resume && document.visibilityState === "visible" && document.hasFocus()) {
    play.start();
  }
}

/** Another tab or app came in front: back to READY (DESIGN.md 16.3). */
function suspend(): void {
  resumeOnClose = false;
  endGesture();
  play.pause();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") suspend();
}

/** A dialog over the board stops the clock while it is open. */
function openPanel(name: Panel): void {
  holdClock();
  panel.value = name;
}

function closePanel(): void {
  panel.value = undefined;
  releaseClock();
}

// --- input -------------------------------------------------------------

let gesture: BoardGesture | undefined;
let gestureInZoom = false;
let pan: { clientX: number; clientY: number; window: ZoomWindow } | undefined;
let longPress: ReturnType<typeof setTimeout> | undefined;

function stopLongPress(): void {
  if (longPress !== undefined) clearTimeout(longPress);
  longPress = undefined;
}

function endGesture(): void {
  stopLongPress();
  play.endStroke();
  gesture = undefined;
  pan = undefined;
}

function onPress(event: BoardPointerEvent, inZoom: boolean): void {
  if (!play.playable.value) return;
  stopLongPress();
  gesture = new BoardGesture(geometry.value, event.point, {
    tool: settings.value.tool,
    inZoom,
  });
  gestureInZoom = inZoom;
  if (gesture.kind === "pan" && zoom.value) {
    pan = {
      clientX: event.clientX,
      clientY: event.clientY,
      window: zoom.value,
    };
  } else {
    pan = undefined;
    play.beginStroke();
  }
  if (!inZoom) {
    const start = event.point;
    longPress = setTimeout(() => openZoom(start), LONG_PRESS_MS);
  }
}

function onDrag(event: BoardPointerEvent, inZoom: boolean): void {
  if (!gesture || inZoom !== gestureInZoom) return;
  const edges = gesture.move(event.point);
  if (gesture.hasMoved) stopLongPress();
  if (pan && gesture.hasMoved) {
    zoom.value = panZoomWindow(
      geometry.value,
      pan.window,
      (event.clientX - pan.clientX) * event.unitsPerPixel,
      (event.clientY - pan.clientY) * event.unitsPerPixel,
    );
  } else if (edges.length > 0) {
    play.strokeEdges(edges);
  }
}

function onRelease(inZoom: boolean): void {
  if (!gesture || inZoom !== gestureInZoom) return;
  const tapped = gesture.release();
  endGesture();
  if (tapped !== undefined) play.tap(tapped);
}

function onCancel(inZoom: boolean): void {
  if (inZoom === gestureInZoom) endGesture();
}

/** The pointer handlers of one of the two boards. */
function boardHandlers(inZoom: boolean) {
  return {
    onPress: (event: BoardPointerEvent) => onPress(event, inZoom),
    onDrag: (event: BoardPointerEvent) => onDrag(event, inZoom),
    onRelease: () => onRelease(inZoom),
    onCancel: () => onCancel(inZoom),
  };
}
const mainBoardHandlers = boardHandlers(false);
const zoomBoardHandlers = boardHandlers(true);

/** Long press: magnify around the press (DESIGN.md 7.4). */
function openZoom(center: BoardPoint): void {
  longPress = undefined;
  if (!gesture || gesture.hasMoved) return;
  endGesture();
  zoom.value = zoomWindowAt(geometry.value, center);
  if (settings.value.haptics) navigator.vibrate?.(12);
}

function closeZoom(): void {
  zoom.value = undefined;
  onCancel(true);
}

function onKeydown(event: KeyboardEvent): void {
  // Esc in a dialog closes the dialog only; the view behind it stays.
  const dialogOpen = panel.value !== undefined || confirmDialog.value?.open;
  // READY is modal too: what it covers ignores the key.
  if (event.key !== "Escape" || dialogOpen || readyShown.value) return;
  if (zoom.value) closeZoom();
  else if (hint.open.value) hint.close();
}

// --- moves and puzzles --------------------------------------------------

function setTool(tool: Tool): void {
  settings.value = { ...settings.value, tool };
}

/**
 * Starts another board. Leaving a board the player has worked on asks
 * first: the lines and × on it would be lost.
 */
function requestStart(start: () => Promise<boolean>): void {
  holdClock();
  panel.value = undefined;
  if (play.marked.value && !solved.value) {
    pendingStart = start;
    confirmOpen.value = true;
    confirmDialog.value?.showModal();
    return;
  }
  void begin(start);
}

async function begin(start: () => Promise<boolean>): Promise<void> {
  resumeOnClose = false;
  zoom.value = undefined;
  clearCardOpen.value = false;
  await start();
}

function confirmStart(): void {
  const start = pendingStart;
  pendingStart = undefined;
  // Closing fires onConfirmClosed; the old board must not resume first.
  resumeOnClose = false;
  confirmDialog.value?.close();
  if (start) void begin(start);
}

/** The confirmation closed by 続ける, Esc or confirmStart. */
function onConfirmClosed(): void {
  confirmOpen.value = false;
  pendingStart = undefined;
  releaseClock();
}

/** A new puzzle at the device's choice, drawn anew each time for random. */
function next(): void {
  requestStart(() => play.startNew(difficulty.next()));
}

/**
 * Starting at a difficulty also makes it the choice for later puzzles; a
 * start the player calls off at the confirmation changes nothing.
 */
function requestNew(choice: DifficultyChoice): void {
  requestStart(() => {
    difficulty.choose(choice);
    return play.startNew(difficulty.next());
  });
}

function loadSeed(code: SeedCode): void {
  requestStart(() => play.load(code));
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("blur", suspend);
  window.addEventListener("pagehide", suspend);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const restored = play.restore();
  difficulty.startFrom(puzzle.value?.difficulty);
  if (!restored) void play.startNew(difficulty.next());
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("blur", suspend);
  window.removeEventListener("pagehide", suspend);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <div class="app-shell">
    <!-- READY is modal: what it covers takes no focus or clicks. -->
    <header class="top-bar" :inert="readyShown">
      <div class="status">
        <button
          v-if="difficultyLabel"
          type="button"
          class="chip chip-button"
          :aria-label="`難易度: ${difficultyLabel}。成績と、別の難易度で始める`"
          aria-haspopup="dialog"
          :aria-expanded="panel === 'difficulty'"
          @click="openPanel('difficulty')"
        >
          <UiIcon name="difficulty" />{{ difficultyLabel }}
        </button>
        <!-- Only the passing messages are announced, not the button. -->
        <span aria-live="polite">
          <span v-if="loading" class="status-text">問題を作っています…</span>
          <span v-else-if="play.failure.value" class="status-text error">
            {{ play.failure.value }}
          </span>
        </span>
      </div>
      <div class="top-actions">
        <span v-if="puzzle" class="chip timer" aria-label="経過時間">
          <UiIcon name="clock" />{{ formatSeconds(play.elapsedSeconds.value) }}
        </span>
        <button
          v-if="play.running.value"
          type="button"
          class="icon-button"
          aria-label="一時停止"
          title="一時停止"
          @click="play.pause"
        >
          <UiIcon name="pause" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="メニューを開く"
          title="メニュー"
          aria-haspopup="dialog"
          :aria-expanded="panel === 'menu'"
          @click="openPanel('menu')"
        >
          <UiIcon name="menu" />
        </button>
      </div>
    </header>

    <main class="board-area" :inert="readyShown">
      <div class="board-frame" :class="{ busy: loading, solved }">
        <BoardView
          v-if="puzzle"
          :geometry="geometry"
          :clues="puzzle.clues"
          :states="board.states"
          :annotations="annotations"
          :inside="inside"
          :label="`NYORO-RIN ${puzzle.size}×${puzzle.size} の盤面`"
          :hint="hint.marks.value"
          v-bind="mainBoardHandlers"
        />

        <div
          v-if="zoom && puzzle"
          class="zoom-overlay"
          @pointerdown.self="closeZoom"
        >
          <div class="zoom-box" role="dialog" aria-label="拡大表示">
            <BoardView
              :geometry="geometry"
              :clues="puzzle.clues"
              :states="board.states"
              :annotations="annotations"
              :view="zoom"
              label="拡大した盤面"
              :hint="hint.marks.value"
              v-bind="zoomBoardHandlers"
            />
            <button
              type="button"
              class="icon-button zoom-close"
              aria-label="拡大表示を閉じる"
              title="閉じる"
              @click="closeZoom"
            >
              <UiIcon name="close" />
            </button>
          </div>
        </div>

        <div v-if="clearCardOpen" class="clear-overlay">
          <section
            class="clear-card"
            role="status"
            aria-labelledby="clear-title"
          >
            <h2 id="clear-title">輪が閉じました</h2>
            <dl v-if="clearedPlay" class="stats">
              <div>
                <dt>時間</dt>
                <dd>{{ formatSeconds(clearedPlay.elapsedSeconds) }}</dd>
              </div>
              <div>
                <dt>ヒント</dt>
                <dd>{{ clearedPlay.hintsUsed }}</dd>
              </div>
              <div>
                <dt>スコア</dt>
                <dd>{{ formatScore(clearedPlay) }}</dd>
              </div>
            </dl>
            <div class="clear-actions">
              <select
                :value="difficulty.choice.value"
                class="difficulty-select"
                aria-label="次の問題の難易度"
                @change="
                  difficulty.choose(
                    ($event.target as HTMLSelectElement)
                      .value as DifficultyChoice,
                  )
                "
              >
                <option
                  v-for="(label, value) in DIFFICULTY_CHOICE_LABELS"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
              </select>
              <button type="button" class="primary" @click="next">
                <UiIcon name="next" />次の問題
              </button>
              <button type="button" @click="clearCardOpen = false">
                盤面を見る
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>

    <!-- The hint sits between the board and the controls: it never covers
         the board, and undo and the tool stay at hand while reading it. -->
    <HintPanel
      v-if="hint.open.value"
      :inert="readyShown"
      :text="hint.text.value"
      :step="hint.step.value"
      :has-next="hint.hasNext.value"
      :next-writes="hint.nextWrites.value"
      @next="hint.next"
      @close="hint.close"
    />
    <footer class="controls" :inert="readyShown">
      <div class="tool-switch" role="group" aria-label="書き込むもの">
        <button
          type="button"
          :aria-pressed="settings.tool === 'line'"
          @click="setTool('line')"
        >
          <UiIcon name="line" />線
        </button>
        <button
          type="button"
          :aria-pressed="settings.tool === 'cross'"
          @click="setTool('cross')"
        >
          <UiIcon name="cross" />×
        </button>
      </div>
      <div class="actions">
        <button
          type="button"
          class="icon-button hint-button"
          aria-label="ヒント"
          title="ヒント"
          :disabled="!play.playable.value"
          @click="hint.request"
        >
          <UiIcon name="hint" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="元に戻す"
          title="元に戻す"
          :disabled="!play.canUndo.value"
          @click="play.undo"
        >
          <UiIcon name="undo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="やり直す"
          title="やり直す"
          :disabled="!play.canRedo.value"
          @click="play.redo"
        >
          <UiIcon name="redo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="線と×をすべて消す"
          title="リセット"
          :disabled="!play.canReset.value"
          @click="play.reset"
        >
          <UiIcon name="reset" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="次の問題へ"
          title="次の問題"
          :disabled="loading"
          @click="next"
        >
          <UiIcon name="next" />
        </button>
      </div>
    </footer>

    <div v-if="readyShown" class="ready-overlay" role="presentation">
      <section
        class="ready-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ready-title"
      >
        <h2 id="ready-title">READY?</h2>
        <p v-if="loading" class="note">問題を作っています…</p>
        <p v-else-if="play.elapsedSeconds.value > 0" class="note">
          一時停止中（{{ formatSeconds(play.elapsedSeconds.value) }}）
        </p>
        <div class="ready-actions">
          <button
            ref="readyButton"
            type="button"
            class="primary"
            :disabled="loading"
            @click="play.start"
          >
            OK
          </button>
          <button type="button" @click="openPanel('menu')">
            <UiIcon name="menu" />メニュー
          </button>
        </div>
      </section>
    </div>

    <MenuDialog
      v-model:settings="settings"
      :open="panel === 'menu'"
      :seed-code="play.seedCode.value"
      :difficulty="puzzle?.difficulty"
      :choice="difficulty.choice.value"
      :history="play.history.value"
      :current-play-id="play.attempt.value?.playId"
      @close="closePanel"
      @new-puzzle="requestNew"
      @load-seed="loadSeed"
    />

    <DifficultyDialog
      :open="panel === 'difficulty'"
      :difficulty="puzzle?.difficulty"
      :history="play.history.value"
      :current-play-id="play.attempt.value?.playId"
      @close="closePanel"
      @new-puzzle="requestNew"
    />

    <dialog
      ref="confirmDialog"
      class="confirm-dialog"
      aria-labelledby="confirm-title"
      @close="onConfirmClosed"
    >
      <div class="dialog-card">
        <h2 id="confirm-title">この問題をやめますか？</h2>
        <p>書き込んだ線と × は消えます。</p>
        <div class="dialog-actions">
          <button type="button" @click="confirmDialog?.close()">続ける</button>
          <button type="button" class="primary" @click="confirmStart">
            やめて始める
          </button>
        </div>
      </div>
    </dialog>
  </div>
</template>
