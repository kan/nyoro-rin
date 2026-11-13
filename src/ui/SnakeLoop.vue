<script setup lang="ts">
/**
 * The snake on the cleared loop (DESIGN.md chapter 10), drawn inside the
 * board's SVG. With `lap` it goes once round the loop and then emits
 * `lapEnd` (at once when motion is reduced); without it, it rests where the
 * lap ends. Turning `lap` off in the middle ends the lap at once.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { type BoardPoint } from "./board-input";
import {
  LAP_MS,
  dashFrom,
  headingAlong,
  lapEase,
  loopPath,
  pointAlong,
} from "./snake";

const props = defineProps<{
  /** The loop's vertices in walking order, as board points. */
  points: readonly BoardPoint[];
  lap?: boolean;
}>();

const emit = defineEmits<{ lapEnd: [] }>();

/** The gap between the head and the tail's tip, where the mouth holds it. */
const MOUTH_GAP = 0.16;
/** The tail narrows in steps of this length, thinnest at the tip. */
const TAIL_STEP = 0.16;
const TAIL_WIDTHS = [0.04, 0.07, 0.1, 0.13];
/** Where the head rests, as a distance along the loop. */
const REST = 0.55;

/** How far round the lap is, 0 to 1. */
const progress = ref(1);
let frame: number | undefined;

const total = computed(() => props.points.length);
const path = computed(() => loopPath(props.points));
/**
 * Where the head is. The lap starts and ends halfway along the first edge,
 * not at the corner: there the head faces along the edge, at the tail.
 */
const head = computed(() => REST + progress.value * total.value);

const headTransform = computed(() => {
  const { x, y } = pointAlong(props.points, head.value);
  const angle = headingAlong(props.points, head.value);
  return `translate(${x} ${y}) rotate(${angle})`;
});

/** The body, one dash per width: the thinner ones reach nearer the tip. */
const bodyLayers = computed(() =>
  TAIL_WIDTHS.map((width, step) => {
    const start = head.value + MOUTH_GAP + step * TAIL_STEP;
    const length = total.value - MOUTH_GAP - step * TAIL_STEP;
    return { width, ...dashFrom(total.value, start, length) };
  }),
);

function stop(): void {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
}

/** Puts the snake where the lap ends. */
function finish(): void {
  stop();
  progress.value = 1;
}

/** Goes round once; with motion reduced, the lap ends at once. */
function run(): void {
  stop();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    finish();
    emit("lapEnd");
    return;
  }
  progress.value = 0;
  const begin = performance.now();
  const tick = (now: number) => {
    const t = (now - begin) / LAP_MS;
    if (t >= 1) {
      finish();
      emit("lapEnd");
      return;
    }
    progress.value = lapEase(t);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

watch(
  () => props.lap,
  (lap) => (lap ? run() : finish()),
  { immediate: true },
);

onBeforeUnmount(stop);
</script>

<template>
  <g class="snake">
    <path
      v-for="layer in bodyLayers"
      :key="layer.width"
      class="snake-body"
      :d="path"
      :stroke-width="layer.width"
      :stroke-dasharray="layer.dasharray"
      :stroke-dashoffset="layer.dashoffset"
    />
    <!-- Drawn facing right; the transform turns it along the loop. -->
    <g class="snake-head" :transform="headTransform">
      <ellipse cx="0.05" cy="0" rx="0.21" ry="0.16" />
      <circle class="eye" cx="0.1" cy="-0.075" r="0.05" />
      <circle class="eye" cx="0.1" cy="0.075" r="0.05" />
      <circle class="pupil" cx="0.12" cy="-0.075" r="0.026" />
      <circle class="pupil" cx="0.12" cy="0.075" r="0.026" />
    </g>
  </g>
</template>
