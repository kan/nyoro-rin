<script setup lang="ts">
/**
 * The player's kan-game.app ID, name and consent to publish (DESIGN.md
 * chapter 20). The wording follows TAKO-SEN's account screen, since the name
 * is shared across kan-game.app. Recovery codes and withdrawal live on the
 * portal's account screen.
 */
import { computed, ref } from "vue";
import {
  GAME_NAME_MAX,
  GAME_NAME_MIN,
  gameNameProblem,
  validateGameName,
} from "../core/account-profile";
import { portalUrl } from "./auth";
import type { Online } from "./use-online";

const props = defineProps<{ online: Online }>();

const gameName = ref("");
const consent = ref(false);
const busy = ref(false);
const message = ref("");

const accountUrl = portalUrl("/account");
const privacyUrl = portalUrl("/privacy");

/** A name the ID already has from another kan-game.app game. */
const sharedName = computed(() => props.online.name.value);

const nameProblem = computed(() => {
  if (sharedName.value || gameName.value.trim() === "") return "";
  const problem = gameNameProblem(gameName.value);
  if (problem === "length") {
    return `${GAME_NAME_MIN}〜${GAME_NAME_MAX}文字にしてください。`;
  }
  if (problem === "chars") return "使えない記号が入っています。";
  return "";
});

const canSubmit = computed(
  () =>
    !busy.value &&
    consent.value &&
    !!props.online.id.value &&
    (!!sharedName.value || validateGameName(gameName.value) !== undefined),
);

const statusText = computed(() => {
  switch (props.online.status.value) {
    case "ready":
      return "";
    case "loading":
      return "ID を確認しています…";
    case "offline":
      return "オフラインです。クリアの記録は端末に保存し、つながったら送ります。";
    default:
      return "ID を取得できませんでした。しばらくしてから自動でやり直します。";
  }
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  message.value = "";
  const result = await props.online.registerProfile(
    sharedName.value ?? gameName.value,
  );
  busy.value = false;
  if (result.ok) {
    message.value = "設定しました。";
    return;
  }
  message.value = {
    name_taken:
      "このプレイヤー名はほかの人が使っています。別の名前にしてください。",
    invalid: "この名前は使えません。",
    offline: "通信できませんでした。つながってからもう一度試してください。",
    failed: "設定できませんでした。しばらくしてからもう一度試してください。",
  }[result.reason];
}
</script>

<template>
  <div class="account">
    <p v-if="statusText" class="note" aria-live="polite">{{ statusText }}</p>

    <template v-if="online.profile.value">
      <h3>プレイヤー名</h3>
      <p class="account-name">{{ online.profile.value.displayName }}</p>
      <p class="note">
        同意したあとに初めて解いた問題は、最初のクリアの成績が問題ごとのランキングに載ります。再挑戦は自分の記録だけに残ります。
      </p>
    </template>

    <form
      v-else-if="online.id.value"
      class="account-setup"
      @submit.prevent="submit"
    >
      <h3>ランキングに参加する</h3>
      <p v-if="sharedName">
        この ID には、kan-game.app のほかのゲームで決めたプレイヤー名「{{
          sharedName
        }}」があります。NYORO-RIN でもこの名前を使います。
      </p>
      <template v-else>
        <label for="account-name">プレイヤー名</label>
        <input
          id="account-name"
          v-model="gameName"
          autocomplete="off"
          :aria-invalid="nameProblem ? 'true' : undefined"
          aria-describedby="account-name-rules account-name-problem"
        />
        <p id="account-name-problem" class="error" aria-live="polite">
          {{ nameProblem }}
        </p>
        <p id="account-name-rules" class="note">
          {{ GAME_NAME_MIN }}〜{{
            GAME_NAME_MAX
          }}文字。文字・数字・絵文字・空白・ハイフン（-）・下線（_）を使えます。「・」などの記号は使えません。ランキングに表示されるので、本名やメールアドレスは使わないでください。kan-game.app
          のほかのゲームでも同じ名前を使い、あとから変えられません。
        </p>
      </template>
      <p class="note">
        同意したあとに初めて解いた問題は、最初のクリアの成績が公開ランキングに載ります。名前を決める前に解いた問題は、解き直しても載りません。再挑戦は自分の記録だけに残ります。非公開の設定はなく、退会すると公開記録とプレイヤー名を削除します（ほかの人が保存したコピーは消せません）。
      </p>
      <label class="toggle">
        <input v-model="consent" type="checkbox" />
        <span>この公開ルールに同意する</span>
      </label>
      <button type="submit" class="primary" :disabled="!canSubmit">
        {{ sharedName ? "同意して参加する" : "プレイヤー名を設定して参加する" }}
      </button>
    </form>

    <p class="note" aria-live="polite">{{ message }}</p>

    <h3>集める情報</h3>
    <p class="note">
      kan-game.app の ID ごとに、クリアの記録と、プレイの操作の記録（線と ×
      の書き込み、元に戻す、ヒント、一時停止とその時刻）を集め、問題の難しさや遊びにくい所を調べるのに使います。操作の記録と感想はほかの人には公開しません。退会するとすべて削除します。
    </p>
    <p class="note">
      復旧コードの発行と入力、退会は、kan-game.app の<a
        :href="accountUrl"
        target="_blank"
        rel="noopener"
        >アカウント画面</a
      >で行います。<a :href="privacyUrl" target="_blank" rel="noopener"
        >プライバシーポリシー</a
      >
    </p>
  </div>
</template>
