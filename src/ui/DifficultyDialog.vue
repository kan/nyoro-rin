<script setup lang="ts">
/**
 * Opened from the difficulty at the top left: the records of a difficulty
 * and a way to start a puzzle at it. The online ranking of the difficulty
 * joins here with the online features.
 */
import { ref } from "vue";
import { type DifficultyChoice } from "../core/difficulty-choice";
import { type Difficulty } from "../core/model";
import { type ResultHistory } from "../core/results";
import RecordsPanel from "./RecordsPanel.vue";
import UiIcon from "./UiIcon.vue";
import { DIFFICULTY_LABELS } from "./labels";
import { useModalDialog } from "./modal-dialog";

const props = defineProps<{
  open: boolean;
  /** The board's difficulty: the dialog opens at it. */
  difficulty?: Difficulty;
  history: ResultHistory;
  currentPlayId?: string;
}>();

const emit = defineEmits<{
  close: [];
  newPuzzle: [choice: DifficultyChoice];
}>();

const selected = ref<Difficulty>("easy");

const dialog = ref<HTMLDialogElement>();
const { onCancel, onDialogClick } = useModalDialog(
  dialog,
  () => props.open,
  () => emit("close"),
  () => {
    selected.value = props.difficulty ?? "easy";
  },
);
</script>

<template>
  <dialog
    ref="dialog"
    class="menu-dialog"
    aria-labelledby="difficulty-title"
    @cancel="onCancel"
    @click="onDialogClick"
  >
    <div class="dialog-card">
      <header class="dialog-header">
        <h2 id="difficulty-title">難易度</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="閉じる"
          title="閉じる"
          @click="emit('close')"
        >
          <UiIcon name="close" />
        </button>
      </header>
      <section class="menu-page">
        <RecordsPanel
          v-if="open"
          v-model:difficulty="selected"
          :history="history"
          :current-play-id="currentPlayId"
        />
        <div class="dialog-actions start-actions">
          <button type="button" @click="emit('newPuzzle', 'random')">
            ランダムで始める
          </button>
          <button
            type="button"
            class="primary"
            @click="emit('newPuzzle', selected)"
          >
            <UiIcon name="next" />{{ DIFFICULTY_LABELS[selected] }}で始める
          </button>
        </div>
      </section>
    </div>
  </dialog>
</template>
