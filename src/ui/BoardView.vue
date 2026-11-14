<script setup lang="ts">
/**
 * Draws the board as SVG in cell units: (0, 0) is the top-left vertex and a
 * cell is 1 × 1. The magnified view is the same drawing with a smaller
 * viewBox. Pointer events go out as board positions; what they mean is
 * decided elsewhere (src/ui/gesture.ts).
 */
import { computed, ref } from "vue";
import {
  type BoardGeometry,
  cellPosition,
  vertexPosition,
} from "../core/board";
import { type BoardAnnotations } from "../core/annotations";
import {
  CROSS,
  LINE,
  type Clue,
  type EdgeState,
  type EdgeStates,
} from "../core/model";
import { type BoardPoint, type ZoomWindow, fullWindow } from "./board-input";
import { type HintMarks } from "./hint-view";
import SnakeLoop from "./SnakeLoop.vue";

const props = defineProps<{
  geometry: BoardGeometry;
  clues: readonly Clue[];
  states: EdgeStates;
  annotations: BoardAnnotations;
  /** Cells inside the finished loop, shaded once the board is cleared. */
  inside?: Uint8Array;
  /**
   * The vertices of the finished loop in walking order: the snake takes
   * the place of the lines (DESIGN.md chapter 10).
   */
  loop?: readonly number[];
  /** Whether the snake is going round the loop now. */
  lap?: boolean;
  /** The part to show; the whole board by default. */
  view?: ZoomWindow;
  /** What the open hint points at (src/ui/hint-view.ts). */
  hint?: HintMarks;
  /** The edge a press would tap, while the finger is still down. */
  tapPreview?: TapPreview;
  label: string;
}>();

/** An edge about to be tapped and what the tap makes of it (DESIGN.md 7.2). */
export interface TapPreview {
  readonly edge: number;
  readonly after: EdgeState;
}

export interface BoardPointerEvent {
  readonly point: BoardPoint;
  readonly clientX: number;
  readonly clientY: number;
  /** Board units per screen pixel, to turn a finger's movement into cells. */
  readonly unitsPerPixel: number;
}

const emit = defineEmits<{
  press: [event: BoardPointerEvent];
  drag: [event: BoardPointerEvent];
  release: [];
  cancel: [];
  lapEnd: [];
}>();

const CROSS_ARM = 0.11;
const AUTO_CROSS_ARM = 0.08;

const svg = ref<SVGSVGElement>();
let activePointer: number | undefined;

const full = computed(() => fullWindow(props.geometry));

const viewBox = computed(() => {
  const view = props.view ?? full.value;
  return `${view.x} ${view.y} ${view.size} ${view.size}`;
});

const cells = computed(() =>
  props.clues.map((clue, cell) => ({
    cell,
    clue,
    ...cellPosition(props.geometry.size, cell),
  })),
);

const vertices = computed(() =>
  Array.from({ length: props.geometry.vertexCount }, (_, vertex) => ({
    vertex,
    ...vertexPosition(props.geometry.size, vertex),
  })),
);

/** Where each edge is drawn: worked out once per board size. */
const edgeEndpoints = computed(() =>
  props.geometry.edgeVertices.map(([a, b]) => {
    const p = vertexPosition(props.geometry.size, a);
    const q = vertexPosition(props.geometry.size, b);
    return { x1: p.col, y1: p.row, x2: q.col, y2: q.row };
  }),
);

function edgeEnds(edge: number) {
  return edgeEndpoints.value[edge];
}

const lines = computed(() => {
  const result: {
    edge: number;
    conflict: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[] = [];
  props.states.forEach((state, edge) => {
    if (state === LINE) {
      result.push({
        edge,
        conflict: props.annotations.conflictEdges.has(edge),
        ...edgeEnds(edge),
      });
    }
  });
  return result;
});

const snakePoints = computed(() =>
  props.loop?.map((vertex) => {
    const { row, col } = vertices.value[vertex];
    return { x: col, y: row };
  }),
);

function crossPath(edge: number, arm: number): string {
  const { x1, y1, x2, y2 } = edgeEnds(edge);
  const x = (x1 + x2) / 2;
  const y = (y1 + y2) / 2;
  return `M${x - arm} ${y - arm}L${x + arm} ${y + arm}M${x + arm} ${y - arm}L${x - arm} ${y + arm}`;
}

const playerCrosses = computed(() => {
  const paths: string[] = [];
  props.states.forEach((state, edge) => {
    if (state === CROSS) paths.push(crossPath(edge, CROSS_ARM));
  });
  return paths.join("");
});

const autoCrosses = computed(() =>
  [...props.annotations.autoCrosses]
    .map((edge) => crossPath(edge, AUTO_CROSS_ARM))
    .join(""),
);

/** The guide's places (a few at most), as positions to draw. */
const guideShapes = computed(() => {
  const size = props.geometry.size;
  return {
    cells: [...props.annotations.guideCells].map((cell) => ({
      cell,
      ...cellPosition(size, cell),
    })),
    vertices: [...props.annotations.guideVertices].map((vertex) => ({
      vertex,
      ...vertexPosition(size, vertex),
    })),
  };
});

/** The tap's edge and, pale, the line or × it will become. */
const tapShape = computed(() => {
  const preview = props.tapPreview;
  if (!preview) return undefined;
  return {
    ...edgeEnds(preview.edge),
    line: preview.after === LINE,
    cross: preview.after === CROSS ? crossPath(preview.edge, CROSS_ARM) : "",
  };
});

/** The hint's marks, as positions to draw. */
const hintShapes = computed(() => {
  const hint = props.hint;
  if (!hint) return undefined;
  const size = props.geometry.size;
  return {
    cells: hint.cells.map((cell) => ({ cell, ...cellPosition(size, cell) })),
    area: hint.area.map((cell) => ({ cell, ...cellPosition(size, cell) })),
    vertices: hint.vertices.map((vertex) => ({
      vertex,
      ...vertexPosition(size, vertex),
    })),
    edges: hint.edges.map((edge) => ({ edge, ...edgeEnds(edge) })),
    lines: hint.lines.map((edge) => ({ edge, ...edgeEnds(edge) })),
    crosses: hint.crosses.map((edge) => crossPath(edge, CROSS_ARM)).join(""),
  };
});

function toEvent(event: PointerEvent): BoardPointerEvent | undefined {
  const element = svg.value;
  const matrix = element?.getScreenCTM();
  if (!element || !matrix) return undefined;
  const inverse = matrix.inverse();
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    inverse,
  );
  return {
    point: { x: point.x, y: point.y },
    clientX: event.clientX,
    clientY: event.clientY,
    unitsPerPixel: 1 / matrix.a,
  };
}

function onPointerDown(event: PointerEvent): void {
  if (
    activePointer !== undefined ||
    (event.pointerType === "mouse" && event.button !== 0)
  )
    return;
  const boardEvent = toEvent(event);
  if (!boardEvent) return;
  activePointer = event.pointerId;
  svg.value?.setPointerCapture(event.pointerId);
  emit("press", boardEvent);
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  const boardEvent = toEvent(event);
  if (boardEvent) emit("drag", boardEvent);
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  emit("release");
}

function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  emit("cancel");
}
</script>

<template>
  <svg
    ref="svg"
    class="board-svg"
    :viewBox="viewBox"
    role="img"
    :aria-label="label"
    @pointerdown.prevent="onPointerDown"
    @pointermove.prevent="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onPointerCancel"
    @contextmenu.prevent
  >
    <rect
      class="board-surface"
      :x="full.x"
      :y="full.y"
      :width="full.size"
      :height="full.size"
      rx="0.25"
    />
    <g v-if="inside" class="loop-inside">
      <template v-for="item in cells" :key="item.cell">
        <rect
          v-if="inside[item.cell]"
          :x="item.col"
          :y="item.row"
          width="1"
          height="1"
        />
      </template>
    </g>
    <!-- The guide: a pale fill under the clue or vertex (DESIGN.md 9.2). -->
    <g class="guide">
      <rect
        v-for="item in guideShapes.cells"
        :key="item.cell"
        :x="item.col + 0.06"
        :y="item.row + 0.06"
        width="0.88"
        height="0.88"
        rx="0.16"
      />
      <circle
        v-for="item in guideShapes.vertices"
        :key="item.vertex"
        :cx="item.col"
        :cy="item.row"
        r="0.24"
      />
    </g>
    <g v-if="hintShapes" class="hint-area">
      <rect
        v-for="item in hintShapes.area"
        :key="item.cell"
        :x="item.col"
        :y="item.row"
        width="1"
        height="1"
      />
    </g>
    <g class="clues">
      <template v-for="item in cells" :key="item.cell">
        <text
          v-if="item.clue !== null"
          :x="item.col + 0.5"
          :y="item.row + 0.53"
          :class="{
            conflict: annotations.conflictCells.has(item.cell),
            satisfied: annotations.satisfiedCells.has(item.cell),
          }"
        >
          {{ item.clue }}
        </text>
      </template>
    </g>
    <path class="cross auto" :d="autoCrosses" />
    <path class="cross" :d="playerCrosses" />
    <g v-if="!snakePoints?.length" class="lines">
      <line
        v-for="line in lines"
        :key="line.edge"
        :class="{ conflict: line.conflict }"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
      />
    </g>
    <!-- The tap to come: a pale band along the edge, and the line or × it
         becomes; nothing changes until the finger lifts (DESIGN.md 7.2). -->
    <g v-if="tapShape" class="tap-preview">
      <line
        class="tap-band"
        :x1="tapShape.x1"
        :y1="tapShape.y1"
        :x2="tapShape.x2"
        :y2="tapShape.y2"
      />
      <line
        v-if="tapShape.line"
        class="tap-line"
        :x1="tapShape.x1"
        :y1="tapShape.y1"
        :x2="tapShape.x2"
        :y2="tapShape.y2"
      />
      <path v-if="tapShape.cross" class="tap-cross" :d="tapShape.cross" />
    </g>
    <!-- The hint draws over the marks but leaves the clues readable:
         frames go around the clue, never across it (DESIGN.md 9.2). -->
    <g v-if="hintShapes" class="hint">
      <line
        v-for="item in hintShapes.edges"
        :key="`e${item.edge}`"
        class="hint-edge"
        :x1="item.x1"
        :y1="item.y1"
        :x2="item.x2"
        :y2="item.y2"
      />
      <line
        v-for="item in hintShapes.lines"
        :key="`l${item.edge}`"
        class="hint-line"
        :x1="item.x1"
        :y1="item.y1"
        :x2="item.x2"
        :y2="item.y2"
      />
      <path class="hint-cross" :d="hintShapes.crosses" />
      <rect
        v-for="item in hintShapes.cells"
        :key="`c${item.cell}`"
        class="hint-cell"
        :x="item.col + 0.1"
        :y="item.row + 0.1"
        width="0.8"
        height="0.8"
        rx="0.16"
      />
      <circle
        v-for="item in hintShapes.vertices"
        :key="`v${item.vertex}`"
        class="hint-vertex"
        :cx="item.col"
        :cy="item.row"
        r="0.2"
      />
    </g>
    <g class="vertices">
      <circle
        v-for="item in vertices"
        :key="item.vertex"
        :class="{ conflict: annotations.conflictVertices.has(item.vertex) }"
        :cx="item.col"
        :cy="item.row"
        :r="annotations.conflictVertices.has(item.vertex) ? 0.13 : 0.055"
      />
    </g>
    <!-- Over the vertices: the body hides the dots it lies on. -->
    <SnakeLoop
      v-if="snakePoints?.length"
      :points="snakePoints"
      :lap="lap"
      @lap-end="emit('lapEnd')"
    />
  </svg>
</template>
