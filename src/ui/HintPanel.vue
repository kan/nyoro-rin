<script setup lang="ts">
/**
 * The hint's words, under the board so the marked edges stay in sight
 * (DESIGN.md 11.2). It is not modal: the board and the controls stay
 * usable, any move ends the hint, and the hint button goes to the next step.
 */
import { type HintStep, LAST_HINT_STEP } from "../core/hint";
import UiIcon from "./UiIcon.vue";

defineProps<{
  text: string;
  /** Undefined when no hint was found. */
  step?: HintStep;
  hasNext: boolean;
  /** What the next press does: 次のステップ, 書き込む or 誤りを消す. */
  nextLabel: string;
}>();

const emit = defineEmits<{ next: []; close: [] }>();
</script>

<template>
  <section class="hint-panel" aria-labelledby="hint-title">
    <header>
      <h2 id="hint-title">
        <UiIcon name="hint" />ヒント
        <small v-if="step">ステップ {{ step }} / {{ LAST_HINT_STEP }}</small>
      </h2>
      <button
        type="button"
        class="icon-button"
        aria-label="ヒントを閉じる"
        title="閉じる"
        @click="emit('close')"
      >
        <UiIcon name="close" />
      </button>
    </header>
    <p role="status">{{ text }}</p>
    <button v-if="hasNext" type="button" class="primary" @click="emit('next')">
      {{ nextLabel }}
    </button>
  </section>
</template>
