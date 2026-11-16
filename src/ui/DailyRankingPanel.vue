<script setup lang="ts">
/**
 * A day's daily ranking (DESIGN.md 25.6): the top 100 and the player's own
 * row below them. The ranking is the Worker's; this only shows it.
 */
import { shallowRef, watch } from "vue";
import type { DailyRanking } from "../core/daily";
import LeaderboardList from "./LeaderboardList.vue";
import type { Online } from "./use-online";

const props = defineProps<{ online: Online; date: string }>();

/** Undefined while asked, null when it failed. */
const ranking = shallowRef<DailyRanking | null>();

let request = 0;
watch(
  () => props.date,
  async (date) => {
    request += 1;
    const mine = request;
    ranking.value = undefined;
    const result = await props.online.fetchDailyRanking(date);
    if (mine === request) ranking.value = result ?? null;
  },
  { immediate: true },
);

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}
</script>

<template>
  <div class="daily-ranking">
    <h3>{{ dateLabel(date) }}のデイリー</h3>
    <p class="note">
      クリアした人の成績です。スコアは通常の問題と同じ式です。時間とヒントは、端末が送った値です。
    </p>
    <p v-if="ranking === undefined" class="note">ランキングを取得しています…</p>
    <p v-else-if="ranking === null" class="note">
      ランキングを取得できません。通信状態を確認して、開き直してください。
    </p>
    <LeaderboardList v-else :entries="ranking.entries" />
  </div>
</template>
