<script setup lang="ts">
/**
 * The weekly player ranking (DESIGN.md 20.3): per difficulty, by clears or
 * by average score. The counting is the Worker's; this only shows it.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { DIFFICULTIES, type Difficulty } from "../core/model";
import {
  WEEKLY_SCORE_MIN_CLEARS,
  type WeeklyMetric,
  type WeeklyRanking,
} from "../core/weekly-ranking";
import { ASSIST_MARKS, DIFFICULTY_LABELS } from "./labels";
import type { Online } from "./use-online";

const props = defineProps<{ online: Online; difficulty?: Difficulty }>();

const METRIC_LABELS: Readonly<Record<WeeklyMetric, string>> = {
  clears: "クリア数",
  score: "平均スコア",
};

const difficulty = ref<Difficulty>(props.difficulty ?? "easy");
const metric = ref<WeeklyMetric>("clears");
/** Undefined while asked, null when it failed. */
const ranking = shallowRef<WeeklyRanking | null>();

let request = 0;
async function load(): Promise<void> {
  request += 1;
  const mine = request;
  ranking.value = undefined;
  const result = await props.online.fetchWeeklyRanking(
    difficulty.value,
    metric.value,
  );
  // A newer choice answers for itself.
  if (mine === request) ranking.value = result ?? null;
}

watch([difficulty, metric], () => void load(), { immediate: true });

/** The week as month/day, Monday to Sunday, in Japan time. */
function weekLabel({ start, end }: WeeklyRanking): string {
  const day = (epochMs: number) =>
    new Date(epochMs).toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
    });
  return `${day(start)}〜${day(end - 1)}`;
}

const explanation = computed(() =>
  [
    "月曜 0 時から日曜 24 時（日本時間）までのクリアです。同じ問題は週に 1 回だけ数えます。",
    metric.value === "score"
      ? `平均スコアは、週に ${WEEKLY_SCORE_MIN_CLEARS} 問以上クリアした人だけを並べます。`
      : "",
    "印は、数えたクリアで使ったアシストの最大の段階です。",
  ].join(""),
);

function averageScore(value: number): string {
  return Math.round(value).toLocaleString("ja-JP");
}
</script>

<template>
  <div class="weekly-ranking">
    <div class="tabs" role="tablist" aria-label="難易度">
      <button
        v-for="level in DIFFICULTIES"
        :key="level"
        type="button"
        role="tab"
        :aria-selected="level === difficulty"
        @click="difficulty = level"
      >
        {{ DIFFICULTY_LABELS[level] }}
      </button>
    </div>
    <div class="tabs two" role="tablist" aria-label="並び">
      <button
        v-for="(label, value) in METRIC_LABELS"
        :key="value"
        type="button"
        role="tab"
        :aria-selected="value === metric"
        @click="metric = value"
      >
        {{ label }}
      </button>
    </div>
    <p class="note">{{ explanation }}</p>
    <p v-if="ranking === undefined" class="note">ランキングを取得しています…</p>
    <p v-else-if="ranking === null" class="note">
      ランキングを取得できません。通信状態を確認して、開き直してください。
    </p>
    <template v-else>
      <h3>{{ weekLabel(ranking) }}</h3>
      <p v-if="ranking.entries.length === 0" class="note">
        まだ誰も載っていません。
      </p>
      <ol v-else class="leaderboard">
        <li
          v-for="entry in ranking.entries"
          :key="`${entry.rank}-${entry.displayName}`"
          :class="{ self: entry.isSelf }"
        >
          <span class="rank">{{ entry.rank }}</span>
          <span class="name">{{ entry.displayName }}</span>
          <span class="score">
            {{
              metric === "clears"
                ? `${entry.clears} 問`
                : averageScore(entry.averageScore)
            }}
          </span>
          <span class="detail">
            <template v-if="metric === 'clears'">
              平均スコア {{ averageScore(entry.averageScore) }}
            </template>
            <template v-else>{{ entry.clears }} 問</template>
            <small v-if="ASSIST_MARKS[entry.maxAssist]" class="assist-mark">
              {{ ASSIST_MARKS[entry.maxAssist] }}
            </small>
          </span>
        </li>
      </ol>
    </template>
  </div>
</template>
