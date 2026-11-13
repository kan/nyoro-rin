<script setup lang="ts">
/**
 * Feedback to the developer (DESIGN.md 20.2), as in pujan: the text, what
 * goes with it (shown before sending), and the feedback sent from this
 * device. Nobody answers here, and nothing is published.
 */
import { computed, ref } from "vue";
import {
  FEEDBACK_MAX_LENGTH,
  type FeedbackContext,
  contextText,
  feedbackBody,
} from "../core/feedback";
import { formatPlayDate } from "./format";
import type { Online } from "./use-online";

const props = defineProps<{
  online: Online;
  /** What the game was showing when the screen opened. */
  context: FeedbackContext;
}>();

const body = ref("");
const busy = ref(false);
const message = ref("");

const length = computed(() => [...body.value.trim()].length);
const canSend = computed(
  () =>
    !busy.value &&
    !!props.online.id.value &&
    feedbackBody(body.value) !== undefined,
);

async function send(): Promise<void> {
  if (!canSend.value) return;
  busy.value = true;
  message.value = "";
  const result = await props.online.sendFeedback(
    feedbackBody(body.value)!,
    props.context,
  );
  busy.value = false;
  if (result.ok) {
    body.value = "";
    message.value = "送りました。ありがとうございます。";
    return;
  }
  message.value = {
    too_many:
      "続けて送れるのは 1 時間に 5 件までです。少し時間をおいてください。",
    offline: "通信できませんでした。つながってからもう一度送ってください。",
    failed: "送れませんでした。しばらくしてからもう一度送ってください。",
  }[result.reason];
}
</script>

<template>
  <form class="feedback" @submit.prevent="send">
    <p class="note">
      遊んでみての感想や、分かりにくかった所、不具合を送ってください。開発者だけが読みます。返信はしていません。
    </p>
    <label for="feedback-body" class="visually-hidden">感想</label>
    <textarea
      id="feedback-body"
      v-model="body"
      rows="6"
      :maxlength="FEEDBACK_MAX_LENGTH * 2"
      placeholder="感想を書く"
    ></textarea>
    <p
      class="note counter"
      :class="{ error: length > FEEDBACK_MAX_LENGTH }"
      aria-live="polite"
    >
      {{ length }} / {{ FEEDBACK_MAX_LENGTH }}
    </p>
    <p class="note">一緒に送るもの: {{ contextText(context) }}</p>
    <p v-if="!online.id.value" class="note">
      ID
      を確認できないため、今は送れません。通信できる状態で開き直してください。
    </p>
    <button type="submit" class="primary" :disabled="!canSend">送る</button>
    <p class="note" role="status">{{ message }}</p>

    <template v-if="online.sentFeedback.value.length > 0">
      <h3>この端末から送った感想</h3>
      <ol class="sent-feedback">
        <li v-for="sent in online.sentFeedback.value" :key="sent.sentAt">
          <span class="when">{{ formatPlayDate(sent.sentAt) }}</span>
          <p>{{ sent.body }}</p>
        </li>
      </ol>
    </template>
  </form>
</template>
