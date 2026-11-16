<script setup lang="ts">
/**
 * An achievement's icon: the snake holding its tail (public/nyoro.svg) round
 * a sign of what was done. Not yet unlocked, it is a grey silhouette; a
 * secret one not yet unlocked shows only "?".
 */
import { computed } from "vue";
import { achievementDefinition } from "../core/achievements";

const props = defineProps<{ id: string; unlocked?: boolean }>();

const definition = computed(() => achievementDefinition(props.id));
const hidden = computed(
  () => !props.unlocked && definition.value?.secret === true,
);

/** The sign in the ring: a word or number, or a drawn sign. */
const sign = computed<
  | { readonly text: string; readonly small?: boolean }
  | { readonly draw: "no-hint" | "no-assist" }
>(() => {
  if (hidden.value) return { text: "?" };
  switch (definition.value?.category) {
    case "no-hint":
      return { draw: "no-hint" };
    case "no-assist":
      return { draw: "no-assist" };
    default:
      break;
  }
  const texts: Readonly<Record<string, string>> = {
    tutorial_complete: "始",
    clear_first: "初",
    clear_hard_first: "上",
    clear_10: "10",
    clear_50: "50",
    clear_100: "100",
    clear_500: "500",
    days_7: "7日",
    days_30: "30日",
    days_100: "100日",
  };
  const text = texts[props.id] ?? "";
  return { text, small: text.length >= 3 };
});

/** The hard variants carry a small 上 mark. */
const hard = computed(() => !hidden.value && props.id.endsWith("_hard"));
</script>

<template>
  <svg
    class="achievement-icon"
    :class="{ locked: !unlocked }"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <g class="body" fill="none" stroke-linecap="round">
      <path stroke-width="3" d="M42 16.68A20 20 0 1 1 32 14" />
      <path stroke-width="5" d="M47.32 21.14A20 20 0 1 1 32 14" />
      <path stroke-width="7" d="M50.13 25.55A20 20 0 1 1 32 14" />
      <path stroke-width="9" d="M51.92 32.26A20 20 0 1 1 32 14" />
    </g>
    <ellipse class="head" cx="33" cy="14.2" rx="8.5" ry="6.6" />
    <template v-if="unlocked">
      <circle cx="35.6" cy="11.4" r="2.2" fill="#fff" />
      <circle cx="36.4" cy="11.4" r="1.2" fill="#1d2a22" />
    </template>
    <text
      v-if="'text' in sign"
      class="sign"
      x="32"
      y="35"
      text-anchor="middle"
      dominant-baseline="central"
      :font-size="sign.small ? 10 : 15"
    >
      {{ sign.text }}
    </text>
    <g
      v-else
      class="sign-line"
      fill="none"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <!-- A light bulb, struck through: no hint. -->
      <template v-if="sign.draw === 'no-hint'">
        <path d="M27.5 38a7 7 0 1 1 9 0v3h-9z" />
        <path d="M28.5 44h7" />
      </template>
      <!-- The assist's ×, struck through: the assist off. -->
      <path v-else d="m27 30 10 10m0-10-10 10" />
      <path class="strike" d="M24 45 40 26" />
    </g>
    <g v-if="hard">
      <circle class="hard-mark" cx="47" cy="47" r="7" />
      <text
        class="hard-text"
        x="47"
        y="47.5"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="9"
      >
        上
      </text>
    </g>
  </svg>
</template>
