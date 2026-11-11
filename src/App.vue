<script setup lang="ts">
/**
 * The play screen: the board takes the space, with only the difficulty and
 * the menu above it and the tool switch and moves below it. Everything else
 * is in the menu (src/ui/MenuDialog.vue).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { type Difficulty } from "./core/model";
import { type SeedCode } from "./core/seed-code";
import { type Tool } from "./core/settings";
import BoardView, { type BoardPointerEvent } from "./ui/BoardView.vue";
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
import { DIFFICULTY_LABELS } from "./ui/labels";
import { usePlay } from "./ui/use-play";
import { useSettings } from "./ui/use-settings";

const settings = useSettings();
const play = usePlay(settings);
const { puzzle, board, geometry, annotations, inside, solved, loading } = play;

const menuOpen = ref(false);
const zoom = ref<ZoomWindow>();
const clearCardOpen = ref(false);
const confirmDialog = ref<HTMLDialogElement>();
/** What to start once the player agrees to leave the current board. */
let pendingStart: (() => Promise<boolean>) | undefined;

const difficultyLabel = computed(() =>
  puzzle.value ? DIFFICULTY_LABELS[puzzle.value.difficulty] : "",
);

watch(solved, (isSolved) => {
  if (!isSolved) return;
  zoom.value = undefined;
  clearCardOpen.value = true;
});

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
  const dialogOpen = menuOpen.value || confirmDialog.value?.open;
  if (event.key === "Escape" && zoom.value && !dialogOpen) closeZoom();
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
  menuOpen.value = false;
  if (play.marked.value && !solved.value) {
    pendingStart = start;
    confirmDialog.value?.showModal();
    return;
  }
  void begin(start);
}

async function begin(start: () => Promise<boolean>): Promise<void> {
  zoom.value = undefined;
  clearCardOpen.value = false;
  await start();
}

function confirmStart(): void {
  confirmDialog.value?.close();
  if (pendingStart) void begin(pendingStart);
  pendingStart = undefined;
}

function requestNew(difficulty: Difficulty): void {
  requestStart(() => play.startNew(difficulty));
}

function loadSeed(code: SeedCode): void {
  requestStart(() => play.load(code));
}

function next(): void {
  requestNew(puzzle.value?.difficulty ?? "easy");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void play.startNew("easy");
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="app-shell">
    <header class="top-bar">
      <div class="status" aria-live="polite">
        <span v-if="difficultyLabel" class="chip">
          <UiIcon name="difficulty" />{{ difficultyLabel }}
        </span>
        <span v-if="loading" class="status-text">問題を作っています…</span>
        <span v-else-if="play.failure.value" class="status-text error">
          {{ play.failure.value }}
        </span>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="メニューを開く"
        title="メニュー"
        aria-haspopup="dialog"
        :aria-expanded="menuOpen"
        @click="menuOpen = true"
      >
        <UiIcon name="menu" />
      </button>
    </header>

    <main class="board-area">
      <div class="board-frame" :class="{ busy: loading, solved }">
        <BoardView
          v-if="puzzle"
          :geometry="geometry"
          :clues="puzzle.clues"
          :states="board.states"
          :annotations="annotations"
          :inside="inside"
          :label="`NYORO-RIN ${puzzle.size}×${puzzle.size} の盤面`"
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
            <div class="clear-actions">
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

    <footer class="controls">
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

    <MenuDialog
      v-model:settings="settings"
      :open="menuOpen"
      :seed-code="play.seedCode.value"
      :difficulty="puzzle?.difficulty"
      @close="menuOpen = false"
      @new-puzzle="requestNew"
      @load-seed="loadSeed"
    />

    <dialog
      ref="confirmDialog"
      class="confirm-dialog"
      aria-labelledby="confirm-title"
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
