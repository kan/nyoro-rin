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
import { CROSS, LINE, type Clue, type EdgeStates } from "../core/model";
import { type BoardPoint, type ZoomWindow, fullWindow } from "./board-input";

const props = defineProps<{
  geometry: BoardGeometry;
  clues: readonly Clue[];
  states: EdgeStates;
  annotations: BoardAnnotations;
  /** Cells inside the finished loop, shaded once the board is cleared. */
  inside?: Uint8Array;
  /** The part to show; the whole board by default. */
  view?: ZoomWindow;
  label: string;
}>();

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
    <g class="lines">
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
  </svg>
</template>
