<script setup lang="ts">
/**
 * The daily notice in the menu's settings (DESIGN.md 25.8, src/ui/push.ts),
 * as TAKO-SEN's src/ui/DailyNoticeSetting.vue.
 */
import { computed, onMounted } from "vue";
import {
  disablePush,
  enablePush,
  pushBusy,
  pushProblem,
  pushState,
  refreshPushState,
} from "./push";

const emit = defineEmits<{
  /** iPhone and iPad in Safari: the steps to add it to the home screen. */
  install: [];
}>();

onMounted(() => void refreshPushState());

const usable = computed(
  () => pushState.value === "on" || pushState.value === "off",
);

const help = computed(() => {
  switch (pushState.value) {
    case "checking":
      return "通知の設定を確かめています。";
    case "install":
      return "iPhone と iPad では、ホーム画面に追加した NYORO-RIN から開くと通知を受け取れます。";
    case "unsupported":
      return "このブラウザでは通知を受け取れません。";
    case "unavailable":
      return "いまは通知を設定できません。";
    case "denied":
      return "この端末かブラウザの設定で、NYORO-RIN の通知が許可されていません。許可すると、ここでオンにできます。";
    default:
      return "毎日 0:05 ごろ、その日のデイリーが始まったことを知らせます。この端末だけの設定です。";
  }
});

const PROBLEMS = {
  offline:
    "通信できませんでした。通信できる場所で、もう一度切り替えてください。",
  too_many:
    "この ID で通知をオンにしている端末が多すぎます。使っていない端末で通知をオフにしてから、もう一度切り替えてください。",
  failed:
    "通知を設定できませんでした。少し待ってから、もう一度切り替えてください。",
} as const;

/** On or off as the player asks; the box follows the state, not the click. */
function toggle(event: Event): void {
  const box = event.target as HTMLInputElement;
  const wanted = box.checked;
  // A refused or failed switch shows as it was until the state says otherwise.
  box.checked = pushState.value === "on";
  void (wanted ? enablePush() : disablePush());
}
</script>

<template>
  <div class="daily-notice">
    <label class="toggle">
      <input
        type="checkbox"
        :checked="pushState === 'on'"
        :disabled="!usable || pushBusy"
        aria-describedby="daily-notice-help"
        @change="toggle"
      />
      <span>
        デイリーの開始を通知する
        <small id="daily-notice-help">{{ help }}</small>
      </span>
    </label>
    <button
      v-if="pushState === 'install'"
      type="button"
      class="text-button"
      @click="emit('install')"
    >
      ホーム画面に追加する手順
    </button>
    <p v-if="pushProblem" class="note error" role="status">
      {{ PROBLEMS[pushProblem] }}
    </p>
  </div>
</template>
